"""Local-only web server for the program window (127.0.0.1 only). Serves app/web, baked assets, /api/config, /api/state,
/api/projects, /api/zones (world map), POST /api/project, POST /api/onboard and /api/events (Server-Sent Events: the browser never polls).
Every POST needs the right Host, Origin, a JSON content type and the per-launch key (D-381)."""
import argparse
import hmac
import json
import subprocess
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from ..contracts import VanillaError
from ..events import transcripts
from ..events.feed import Feed
from ..storage import layout
from ..onboard import setup as onboarding
from . import addons, addons_api, auras, background, chatreplies, integrations_api, places_api, checks_api, contests, detect, idea_api, launch, notify, phone, remote_api, resurrect, runs, settings, social, tiers, worker_level, zones_api
from .verify_job import Refused, VerifyJob, ideas_root
from .check_app import check_app
from .config import CONFIG_DIR, WEB_DIR, load_all
from .state import AppState

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".png": "image/png", ".ttf": "font/ttf", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".glb": "model/gltf-binary", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg"}
WEB_EXT, ASSET_EXT = (".html", ".js", ".css", ".woff2"), (".png", ".jpg", ".ttf", ".ogg", ".wav", ".mp3", ".glb", ".json")
MAX_BODY = 4096
KEY_HEADER = "X-Vanilla-Key"


def safe_join(base, rel, exts):
    """File under base for a URL path, or None. No traversal: no '..', backslash, drive colon, NUL, symlink escape; extension allow-listed."""
    rel = unquote(rel).lstrip("/")
    if not rel or "\x00" in rel or "\\" in rel or ":" in rel or any(p in ("..", ".", "") for p in rel.split("/")) or not rel.lower().endswith(exts):
        return None
    base = Path(base).resolve()
    p = (base / rel).resolve()
    try:
        p.relative_to(base)
    except ValueError:
        return None
    return p if p.is_file() else None


def default_feed(cfg_app, env=os.environ):
    return env.get("VANILLA_FEED") or cfg_app["feed_path"] or str(Path.home() / ".vanilla-agents" / "feed.jsonl")   # same default as events/hooks.py


class Ctx:
    def __init__(self, cfg, feed_path, project=None, web_dir=WEB_DIR, assets_dir=None, settings_file=None, verifier=None, watch=True, key=None):
        self.key = key or secrets.token_urlsafe(32)       # D-381: made fresh at every start, reaches the window only through the address fragment the launcher opens; every state-changing call must send it
        self.settings_file = settings_file or settings.settings_path(cfg["app"])
        self.verify = VerifyJob(cfg, feed_path, self.settings_file, **({"verifier": verifier} if verifier else {}))
        self.cfg, self.feed_path, self.web_dir = cfg, feed_path, Path(web_dir)
        self.assets_dir = Path(assets_dir or cfg["app"]["assets_dir"])
        self.gen, self.stop = 0, threading.Event()
        self.bg = None       # V-032: background session discovery, started by start_background() (the real server only)
        self.phone_srv, self.phone_error, self.phone_probe, self.port = None, "", None, 0      # V-040: the home-network listener (only while Phone access is on)
        self.resurrect_opts = {}       # V-039: tests pass a fake runner / which / platform here
        self.state = AppState(cfg, feed_path, project)
        self.zone_cache = zones_api.ZoneCache()
        self.integ = integrations_api.make_hub(self)       # V-044: imported bounties and the CI line (threads only via start_integrations)
        self.chat = chatreplies.make(self, os.environ)      # V-050: commands from Discord / Slack / ntfy (thread only via start_chat)
        self.remote = remote_api.RemoteCtl(self, os.environ)       # V-054: browser access (the bridge thread only via remote.start, once the port is known)
        self._watch_stop = None
        self.watching = watch       # False for the phone script (scripts/decide.py): no transcript watcher, nothing added to the feed but the decision
        if watch:
            self.watch(project)
        from ..party.client import PartyClient       # several people + their Claudes in one world (vanilla_agents/party)
        self.party = PartyClient(os.path.dirname(os.path.abspath(self.settings_file)), feed_path, cfg, project_of=lambda: self.state.project,
                                 agents_of=lambda: self.state.snapshot()["agents"], tasks_of=lambda: self.state.snapshot()["tasks"])
        if watch:
            self.party.start()
        self.client_cfg = {k: cfg[k] for k in ("theme", "hotkeys", "metaphors", "workshop", "panels", "sounds", "map", "guide")}
        self.client_cfg["strings"] = {"ui": cfg["strings"]["ui"], "tooltips": cfg["strings"]["tooltips"]}
        from . import diagnostics
        self.client_cfg["version"] = diagnostics.version()
        from ..assets.bake import stale_steps
        self.client_cfg["rebake"] = stale_steps(str(self.assets_dir))      # V-029: art baked by an older version: say what to bake again

    def start_notify(self):
        """V-041: watch the feed and send the switched-on notifications (daemon threads; the real server only)."""
        self.notifier = notify.Notifier(self.settings_file, Feed(self.feed_path), notify.Names(self.assets_dir), party_of=lambda: self.party.state or {})
        self.notifier.start(self.stop)

    def start_integrations(self):
        """V-044: refresh the switched-on integrations on a daemon thread (the real server only; nothing runs while all are off)."""
        self.integ.start(self.stop)

    def start_chat(self):
        """V-050: poll the switched-on chat services on a daemon thread (the real server only; no thread while all are off)."""
        self.chat.ensure_running(self.stop)

    # ---- V-040: phone access ----
    def phone_start(self):
        """Open the home-network listener (same port as the window when free). Sets phone_error instead of raising."""
        if self.phone_srv is not None:
            return
        ip = phone.lan_ip(self.phone_probe)
        if not phone.bind_hosts(True, ip)[1:]:
            self.phone_error = "This PC is not on a home network (no private network address found)."
            return
        try:
            self.phone_srv = make_phone_server(self, ip, self.port or 8943)
            self.phone_error = ""
        except OSError as e:
            self.phone_error = "The phone listener could not start (%s)." % e
            return
        threading.Thread(target=self.phone_srv.serve_forever, daemon=True, name="phone").start()

    def phone_stop(self):
        srv, self.phone_srv = self.phone_srv, None
        if srv is not None:
            srv.shutdown()
            srv.server_close()

    def phone_status(self):
        on = phone.enabled(self.settings_file)
        u = None
        if self.phone_srv is not None:
            ip, port = self.phone_srv.server_address[:2]
            u = "http://%s:%d/phone.html" % (ip, port)
        return {"enabled": on, "listening": self.phone_srv is not None, "url": u, "error": self.phone_error if on else ""}

    def start_background(self):
        """V-032: poll `claude agents --json` on a daemon thread (app.json background_sessions). Nothing happens without the command."""
        b = self.cfg["app"].get("background_sessions") or {}
        if b.get("enabled", True) and self.bg is None:
            self.bg = background.Discovery(max(5, b.get("poll_seconds", 15)), max(1, b.get("timeout_seconds", 10)))
            self.bg.start(self.stop)

    def watch(self, project):
        """(Re)start the read-only transcript watcher for the project's Claude session folder. Starts nothing if there is none."""
        if self._watch_stop:
            self._watch_stop.set()
        self._watch_stop = None
        a = self.cfg["app"]
        d = transcripts.find_project_dir(project, a.get("transcripts_dir") or transcripts.default_root()) if project else None
        if d is None:
            return
        self._watch_stop = threading.Event()
        w = transcripts.TranscriptWatcher(Feed(self.feed_path), d, a)
        threading.Thread(target=w.run, args=(self._watch_stop,), daemon=True).start()

    def _detect(self):
        """D-418: at most every 30 s, mark open quests that a commit names and a passing Verify covers as done by another session."""
        now = time.monotonic()
        if now - getattr(self, "_det_at", -99) < 30 or not self.state.project:
            return
        self._det_at = now
        try:
            with self.state.lock:
                open_ids = [t["id"] for t in self.state.f.tasks.values() if t["status"] not in ("complete", "failed") and ":q:" in t["id"]]
            if open_ids:
                for qid, note in detect.finished(open_ids, detect.git_log(self.state.project), runs.read(self.verify.runs_path, 200)).items():
                    self.state.mark_done_elsewhere(qid, note=note, who="auto-detect")
        except (OSError, ValueError, VanillaError):
            pass      # detection is a convenience; it must never break the window

    def _backup(self):
        """V-029: at most hourly, make today's copy of the open project's quest database (state/backups, last 7 kept)."""
        now = time.monotonic()
        if now - getattr(self, "_backup_at", -1e9) < 3600 or not self.state.project:
            return
        self._backup_at = now
        try:
            from ..storage import daily_backup
            daily_backup(self.state.project)
        except Exception:
            pass          # a backup must never break the window

    def _dailies(self):
        """app.json "daily" (off by default): at most once a minute, post the owner's daily quests that are due."""
        now = time.monotonic()
        if now - getattr(self, "_daily_at", -99) < 60 or not self.state.project or not (self.cfg["app"].get("daily") or {}).get("enabled"):
            return
        self._daily_at = now
        try:
            if social.post_dailies(Feed(self.feed_path), self.cfg, self.state.project, str(self.feed_path) + ".dailies.json"):
                self.state.refresh()
        except (OSError, ValueError, VanillaError):
            pass      # a daily quest is a convenience; it must never break the window

    def snap(self, st=None):
        """The state snapshot plus the Verify/Pause status (the action bar, cast bar and Paused banner read 'verify')."""
        if st is None or st is self.state:
            self._detect()
            self._dailies()
            self._backup()
        s = {**(st or self.state).snapshot(), "verify": self.verify.status()}
        if self.bg is not None and (st is None or st is self.state):
            s["agents"] = background.merge(s["agents"], self.bg.sessions())
        if st is None or st is self.state:
            s = tiers.annotate(self, s)       # D-373: tier per quest, needs this window's project and Idea
        s = worker_level.annotate_agents(s)
        if st is None or st is self.state:
            s.update(self.integ.view(s["tasks"]))      # V-044: imported bounty proposals, the CI line, integration status (never settings or secrets)
        out = {**s, "auras": auras.compute(s, self.cfg["panels"]["raid_frames"]["options"]["max_frames"]), "party": self.party.view()}
        if getattr(self, "demo", False):
            out["demo"] = True        # demo.cmd: the inn seats every helper at a laptop and keeps them there
        return out

    def projects(self):
        out = []
        for root in self.cfg["app"]["project_roots"]:
            r = Path(root)
            for c in [r] + (sorted(x for x in r.iterdir() if x.is_dir()) if r.is_dir() else []):
                if layout(c)["db"].is_file():
                    out.append({"name": c.name, "path": str(c)})
        for k, v in onboarding.load_registry(self.verify.registry_path).items():    # D-334: every onboarded project is listed, even without a database folder
            if isinstance(v, dict) and not any(onboarding.norm(o["path"]) == onboarding.norm(k) for o in out):
                out.append({"name": v.get("name") or Path(k).name, "path": k})
        return out

    def onboard(self, path):
        """D-334: set the folder up for checking (same code as scripts/onboard.py), then open it. Returns the plain summary."""
        s = onboarding.onboard(path, self.verify.registry_path, self.cfg["app"]["trusted_root"], ideas_root=ideas_root(self.cfg["app"]))
        self.open_project(s["path"])
        return s

    def open_project(self, path):
        if path and not Path(path).is_dir():
            raise ValueError("there is no folder at %s" % path)
        self.state = AppState(self.cfg, self.feed_path, path or None)
        self.gen += 1
        if self.watching:
            self.watch(path or None)


class Handler(BaseHTTPRequestHandler):
    server_version = "vanilla-agents"

    def log_message(self, *a):
        pass

    def _hosts(self):
        """Names this listener answers to: 127.0.0.1/localhost for the window; only its own network address for the phone listener (V-040)."""
        port = self.server.server_address[1]
        ip = getattr(self.server, "phone_ip", None)
        return ("%s:%d" % (ip, port),) if ip else ("127.0.0.1:%d" % port, "localhost:%d" % port)

    def _host_ok(self):
        return self.headers.get("Host", "") in self._hosts()

    def _key_ok(self):
        """D-381 / V-040: the per-launch key, compared in constant time."""
        return hmac.compare_digest(self.headers.get(KEY_HEADER, "").encode("utf-8"), self.server.ctx.key.encode("utf-8"))

    def _send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _file(self, p):
        self._send(200, p.read_bytes(), TYPES[p.suffix.lower()])

    def do_GET(self):
        ctx = self.server.ctx
        if not self._host_ok():
            return self._send(403, {"error": "wrong host"})
        u = urlsplit(self.path)
        path, q = u.path, parse_qs(u.query)
        if getattr(self.server, "phone_ip", None):      # V-040: over the network only the phone page, and the state only with the key
            if path in ("/", "/phone.html"):
                return self._file(ctx.web_dir / "phone.html")
            if path == "/api/phone/strings":
                return self._send(200, phone_strings(ctx.cfg))
            if path == "/api/state":
                return self._send(200, ctx.snap()) if self._key_ok() else self._send(403, {"error": "missing or wrong key: open the link from the Phone section"})
            return self._send(404, {"error": "not found"})
        if path in ("/", "/index.html"):
            path = "/index.html"
        if path == "/api/config":
            return self._send(200, ctx.client_cfg)
        if path == "/api/state":
            return self._send(200, ctx.snap())
        if path == "/api/projects":
            cur = ctx.state.project
            return self._send(200, {"projects": ctx.projects(), "current": str(cur) if cur else ""})
        if path == "/api/idea":
            return self._send(200, idea_api.payload(ctx))
        if path == "/api/runs":
            return self._send(200, {"runs": runs.read(ctx.verify.runs_path, ctx.cfg["app"]["runs_api_limit"])})
        if path == "/api/zones":
            ctx.state.refresh()
            return self._send(200, zones_api.payload(ctx.cfg, ctx.zone_cache, ctx.state, ctx.verify.runs_path))
        if path == "/api/checks":
            return self._send(200, checks_api.check_list(ctx.verify.entry(ctx.state.project), ctx.cfg, runs.read(ctx.verify.runs_path, 200)))
        if path == "/api/settings":
            return self._send(200, settings.merge(ctx.cfg["sounds"], settings.load(ctx.settings_file, ctx.cfg["sounds"])))
        if path == "/api/events":
            return self._sse(ctx, q)
        if path == "/api/diff":          # V-013: read-only git view of the open project (Inspect window)
            f = (q.get("file") or [None])[0]
            try:
                if q.get("branch"):      # V-045: a competing helper's branch against the base (read-only, this project's repository only)
                    return self._send(200, contests.branch_diff(ctx.state.project, q["branch"][0], (q.get("base") or [None])[0], f))
                return self._send(200, social.diff(ctx.state.project, f))
            except (OSError, ValueError, subprocess.SubprocessError) as e:       # V-048: ValueError = a NUL in the file name
                return self._send(200, {"error": "git could not show the changes (%s)" % e})
        if path == "/api/history":       # V-013: replay slider
            try:
                until = int(q["until"][0]) if q.get("until") else None
            except ValueError:
                return self._send(400, {"error": "until must be an event number"})
            return self._send(200, social.history(ctx.cfg, Feed(ctx.feed_path), ctx.state.project, until))
        if path == "/api/office":        # your own buildings: <assets>/office/*.glb (+ optional <name>.json with label / music / start)
            return self._send(200, {"buildings": social.office_buildings(ctx.assets_dir)})
        if path == "/api/party":
            return self._send(200, ctx.party.view())
        if path == "/join":              # a friend's invite page sent us here (its Join button): the window asks before anything is joined
            from html import escape
            from ..party.client import PartyError
            try:
                ctx.party.offer((q.get("invite") or [""])[0])
                head, line = "Back to Vanilla Agents", "Your Vanilla Agents window is asking whether to join. You can close this tab."
            except PartyError as e:
                head, line = "That didn't work", str(e)
            page = ("<!doctype html><meta charset=utf-8><title>Vanilla Agents</title><body style='margin:0;min-height:100vh;display:grid;"
                    "place-items:center;background:#0c0a08;color:#e8dcc0;font:16px Georgia,serif'><div style='max-width:420px;margin:16px'>"
                    "<h1 style='color:#ffd100;font-size:22px'>%s</h1><p>%s</p></div>") % (escape(head), escape(line))
            return self._send(200, page, "text/html; charset=utf-8", {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})
        if path == "/api/places":        # V-042: zones, buildings by zone, inn pictures (Zones window)
            return self._send(200, places_api.places(ctx.assets_dir))
        if path == "/api/phone/strings":
            return self._send(200, phone_strings(ctx.cfg))
        if path == "/api/phone":         # V-040: is phone access on, and its address (the window adds the key itself)
            return self._send(200, ctx.phone_status())
        if path == "/api/remote":        # V-054: browser access status, paired browsers, connectors (no keys, tokens or links)
            return self._send(200, ctx.remote.status())
        if path == "/api/notify":        # V-041: notification settings (from your settings file)
            return self._send(200, notify.view(notify.load(ctx.settings_file)))
        if path in chatreplies.GET_CALLS:        # V-050: chat replies settings WITHOUT secrets, and status lines
            return self._send(200, ctx.chat.view())
        if path in integrations_api.GET_CALLS:       # V-044: integration settings WITHOUT secrets, and status lines
            return self._send(200, integrations_api.get(ctx))
        if path == "/api/addons":        # V-051: installed addons (folders with addon.json, old single .js files) and which ones load
            return self._send(200, addons_api.get(ctx))
        if path.startswith("/addons/"):      # only an enabled addon's own files; never .removed / .packages
            rel = path[len("/addons/"):]
            p = safe_join(ctx.assets_dir / "addons", rel, addons_api.FILE_EXT) if addons.served_file(ctx.assets_dir, ctx.settings_file, unquote(rel)) else None
            return self._send(404, {"error": "not found"}) if p is None else self._file(p)
        if path.startswith("/api/"):
            return self._send(404, {"error": "no such call"})
        p = safe_join(ctx.assets_dir, path[len("/assets/"):], ASSET_EXT) if path.startswith("/assets/") else safe_join(ctx.web_dir, path, WEB_EXT)
        if p is None:
            return self._send(404, {"error": "not found"})
        self._file(p)

    def do_POST(self):
        ctx = self.server.ctx
        port = self.server.server_address[1]
        origin = self.headers.get("Origin")
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        route = urlsplit(self.path).path
        limit = places_api.PHOTO_MAX * 4 // 3 + 1024 if route == "/api/inn_photo" else integrations_api.body_limit(ctx.cfg) if route == "/api/integrations/import" else addons_api.body_limit(ctx.cfg) if route == "/api/addons/install" else MAX_BODY      # V-042: an inn picture is bigger; V-044: a CSV export too; V-051: an addon zip
        if getattr(self.server, "phone_ip", None):
            limit = MAX_BODY         # V-048: the phone listener (home network, before any check) never reads a big body
        raw = self.rfile.read(n) if 0 < n <= limit else b""      # read the body BEFORE any early reply, or the client sees a reset
        if not self._host_ok() or (origin and origin not in ["http://" + h for h in self._hosts()]):
            return self._send(403, {"error": "wrong origin"})
        call = urlsplit(self.path).path
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip().lower()      # the main type exactly, not 'text/plain; x=application/json'
        allowed = PHONE_CALLS if getattr(self.server, "phone_ip", None) else ("/api/project", "/api/settings", "/api/verify", "/api/pause", "/api/approve", "/api/quest", "/api/onboard",
                   "/api/idea/draft", "/api/idea/approve", "/api/whisper", "/api/hearth", "/api/quest_new", "/api/party", "/api/log", "/api/diagnostics",
                   "/api/resurrect", "/api/phone", "/api/remote", "/api/notify", "/api/notify/test", "/api/inn_photo", "/api/contest") + integrations_api.POST_CALLS + chatreplies.POST_CALLS + addons_api.POST_CALLS
        if call not in allowed or ctype != "application/json":
            return self._send(404, {"error": "no such call"})
        if not self._key_ok():      # D-381: every state-changing call carries the per-launch key
            return self._send(403, {"error": "missing or wrong key: use the program window that opened with this server"})
        try:
            if not 0 < n <= limit:
                raise ValueError("body size")
            body = json.loads(raw)
            if call == "/api/verify":
                only = body.get("check")
                if only is not None and not isinstance(only, str):
                    raise ValueError("check must be text")
                ctx.verify.start(ctx.state.project, only)
                return self._send(200, ctx.snap())
            if call == "/api/pause":
                if not isinstance(body.get("paused"), bool):
                    raise ValueError("paused must be true or false")
                ctx.verify.set_paused(body["paused"])
                return self._send(200, ctx.snap())
            if call == "/api/approve":
                if not isinstance(body.get("task"), str):
                    raise ValueError("task must be text")
                ctx.state.approve(body["task"], who="you (phone)" if getattr(self.server, "phone_ip", None) else "you (browser)" if self.headers.get("X-Vanilla-Via") == "browser" else "you")      # D-387: a never-quest is never approved AUTOMATICALLY, but the owner's own click is allowed
                return self._send(200, ctx.snap())
            if call == "/api/quest":
                if not isinstance(body.get("task"), str) or body.get("action") not in ("explain", "change", "veto"):
                    raise ValueError("task must be text and action explain, change or veto")
                tiers.veto(ctx, body["task"]) if body["action"] == "veto" else tiers.request(ctx, body["task"], body["action"], body.get("note", ""))
                return self._send(200, ctx.snap())
            if call in ("/api/idea/draft", "/api/idea/approve"):
                if call.endswith("draft"):
                    return self._send(200, idea_api.draft(ctx))
                if not isinstance(body.get("key"), str):
                    raise ValueError("The Idea key is missing; reload the Idea panel and approve again.")
                return self._send(200, idea_api.approve(ctx, body["key"]))
            if call == "/api/onboard":
                if not isinstance(body.get("path"), str) or not body["path"].strip():
                    raise ValueError("path must be text")
                done = ctx.onboard(body["path"].strip())
                return self._send(200, {**ctx.snap(), "onboarded": done})
            if call == "/api/settings":
                return self._send(200, settings.update(ctx.settings_file, body, ctx.cfg["sounds"]))
            if call == "/api/whisper":
                if not isinstance(body.get("text"), str) or not isinstance(body.get("to", ""), str):
                    raise ValueError("to and text must be text")
                social.whisper(Feed(ctx.feed_path), body.get("to", ""), body["text"])
                ctx.state.refresh()
                return self._send(200, ctx.snap())
            if call == "/api/contest":       # V-045: the owner's competing-fixes buttons (never an agent tool): open / stop / check one / pick the winner
                a, quest = body.get("action"), body.get("quest")
                if not isinstance(quest, str) or a not in ("open", "stop", "check", "pick"):
                    raise ValueError("quest must be text and action open, stop, check or pick")
                if a in ("check", "pick") and not isinstance(body.get("agent"), str):
                    raise ValueError("agent must be text")
                try:
                    if a == "open":
                        contests.owner_open(ctx, quest, body.get("tries"))
                    elif a == "stop":
                        contests.owner_stop(ctx, quest)
                    elif a == "check":
                        contests.owner_check(ctx, quest, body["agent"])
                    else:
                        contests.owner_pick(ctx, quest, body["agent"])
                except contests.ContestError as e:
                    return self._send(409, {"error": str(e)})
                return self._send(200, ctx.snap())
            if call == "/api/inn_photo":     # V-042: the picture of an inn for the Zones window (into your assets folder)
                return self._send(200, {"photo": places_api.save_photo(ctx.assets_dir, body.get("key"), body.get("jpeg"))})
            if call == "/api/resurrect":     # V-039: the owner's click: a new terminal resumes that helper's Claude session (never an agent tool)
                if not isinstance(body.get("agent"), str):
                    raise ValueError("agent must be text")
                ctx.state.refresh()
                a = resurrect.find(ctx.snap(), body["agent"])
                if a is None:
                    raise ValueError("there is no helper called %s" % body["agent"])
                try:
                    return self._send(200, resurrect.resurrect(a.get("session"), a.get("cwd"), **ctx.resurrect_opts))
                except resurrect.ResurrectError as e:
                    return self._send(200, {"ok": False, "error": str(e), "command": e.command})
            if call == "/api/phone":         # V-040: switch phone access on/off (saved; the listener opens/closes now)
                phone.set_enabled(ctx.settings_file, body.get("enabled"))
                ctx.phone_start() if body["enabled"] else ctx.phone_stop()
                return self._send(200, ctx.phone_status())
            if call == "/api/remote":        # V-054: browser access on/off, pairing link, remove a browser, Claude connector addresses
                return self._send(200, ctx.remote.action(body))
            if call == "/api/notify":        # V-041: save notification settings
                notify.save(ctx.settings_file, body.get("channels"))
                return self._send(200, notify.view(notify.load(ctx.settings_file)))
            if call == "/api/notify/test":   # V-041: send one test message now (this request waits for it; the window does not)
                ok, err = notify.test(ctx.settings_file, body.get("channel"), body.get("settings") if isinstance(body.get("settings"), dict) else None, **getattr(ctx, "notify_opts", {}))
                return self._send(200, {"ok": ok, "error": err})
            if call in chatreplies.POST_CALLS:       # V-050: chat replies settings and Test
                return self._send(200, chatreplies.post(ctx, call, body))
            if call in integrations_api.POST_CALLS:      # V-044: integration settings, test, refresh, file import, and the owner's "Make it a quest"
                return self._send(200, integrations_api.post(ctx, call, body))
            if call in addons_api.POST_CALLS:          # V-051: the Addons window (owner only: window key; never an MCP tool)
                return self._send(*addons_api.post(ctx, call, body))
            if call == "/api/log":           # the window's own errors, for Help > Save diagnostics
                from . import diagnostics
                diagnostics.log_client_error(os.path.dirname(os.path.abspath(ctx.settings_file)), body if isinstance(body, dict) else {})
                return self._send(200, {"ok": True})
            if call == "/api/diagnostics":
                from . import diagnostics
                return self._send(200, {"file": diagnostics.save(ctx)})
            if call == "/api/party":         # host / join / leave a party, and propose / agree / take in its shared plan
                from ..party.client import PartyError
                a = body.get("action")
                try:
                    if a == "host":
                        ctx.party.host(str(body.get("party") or "Party"), str(body.get("name") or "Host"), int(body.get("port") or 8940),
                                       network=body.get("network") is not False, hours=int(body.get("hours") or 24))
                    elif a == "join":
                        ctx.party.join(str(body.get("invite") or ""), str(body.get("name") or "Adventurer"))
                    elif a == "leave":
                        ctx.party.leave()
                    elif a == "dismiss":            # "Not now" on an invite a friend's page handed over
                        ctx.party.pending = None
                        ctx.party.version += 1
                    elif a in ("propose", "remove", "agree", "unlock", "take", "kick", "renew"):
                        ctx.party.act(a, {k: body[k] for k in ("title", "why", "size", "item", "version", "member", "hours") if k in body})
                    elif a == "say":                # V-036 community chat, people only: never written to the feed or any file Claude reads
                        if not isinstance(body.get("text"), str):
                            raise ValueError("text must be text")
                        ctx.party.act("say", {"text": body["text"]})
                    elif a == "unsay":              # host only (the hub checks)
                        ctx.party.act("unsay", {"id": body.get("id")})
                    else:
                        raise ValueError("action must be host, join, leave, propose, remove, agree, unlock, take, kick, renew, say or unsay")
                except PartyError as e:
                    return self._send(400, {"error": str(e)})
                ctx.state.refresh()
                return self._send(200, ctx.snap())
            if call == "/api/hearth":       # pause the checker and ask every helper to stop and wait
                ctx.verify.set_paused(True)
                social.whisper(Feed(ctx.feed_path), social.EVERYONE, social.HEARTH_TEXT)
                ctx.state.refresh()
                return self._send(200, ctx.snap())
            if call == "/api/quest_new":
                if not isinstance(body.get("title"), str):
                    raise ValueError("title must be text")
                qid = social.owner_quest(Feed(ctx.feed_path), ctx.cfg, ctx.state.project, body["title"], body.get("why", "") if isinstance(body.get("why", ""), str) else "")
                ctx.state.refresh()
                return self._send(200, {**ctx.snap(), "quest": qid})
            path = body.get("path", "")
            if not isinstance(path, str):
                raise ValueError("path must be text")
            ctx.open_project(path)
        except Refused as e:
            return self._send(409, {"error": str(e)})
        except (ValueError, VanillaError, OSError, AttributeError, TypeError, OverflowError) as e:      # V-048: wrong JSON types (e.g. port 1e999 or a list) answer 400 instead of dropping the connection
            return self._send(400, {"error": str(e)})
        self._send(200, ctx.snap())

    def _sse(self, ctx, q):
        try:
            cursor = int((q.get("cursor") or [self.headers.get("Last-Event-ID") or 0])[0])
        except ValueError:
            cursor = 0
        gen, app = ctx.gen, ctx.cfg["app"]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        last_write = time.monotonic()
        bg_seen = ctx.bg.version if ctx.bg else 0
        integ_seen = ctx.integ.version         # V-044: new imported bounties / a CI change are pushed too
        party_seen = ctx.party.version         # a party change (a community chat line, a plan change) is pushed too, not only feed events
        try:
            while not ctx.stop.is_set():
                if ctx.gen != gen:
                    self.wfile.write(b"event: reset\ndata: {}\n\n")
                    self.wfile.flush()
                    return
                st = ctx.state
                st.refresh()
                bg_now = ctx.bg.version if ctx.bg else 0
                party_now, integ_now = ctx.party.version, ctx.integ.version
                if st.cursor > cursor or bg_now != bg_seen or party_now != party_seen or integ_now != integ_seen:
                    bg_seen, party_seen, integ_seen = bg_now, party_now, integ_now
                    snap = ctx.snap(st)
                    new = [l for l in snap["chat"] if l.get("n", 0) > cursor]
                    cursor = snap["cursor"]
                    self.wfile.write(("id: %d\nevent: update\ndata: %s\n\n" % (cursor, json.dumps({"events": new, "state": snap}))).encode("utf-8"))
                    self.wfile.flush()
                    last_write = time.monotonic()
                elif time.monotonic() - last_write > app["sse_keepalive_seconds"]:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    last_write = time.monotonic()
                ctx.stop.wait(app["sse_check_seconds"])
        except (BrokenPipeError, ConnectionResetError, OSError):
            return


class PhoneHandler(Handler):
    timeout = 15          # V-048: on the home network a client that stops sending frees its thread (the window's own listener keeps no timeout: SSE)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    phone_ip = None


# V-040: the only changes a phone may make (with the key): the owner's own approve / pause / verify buttons
PHONE_CALLS = ("/api/approve", "/api/pause", "/api/verify")


def phone_strings(cfg):
    """The phone page's words (strings/ui.json phone.*), without the prefix. Only words: no state, no key."""
    return {k[len("phone."):]: v for k, v in cfg["strings"]["ui"].items() if k.startswith("phone.")}


def make_phone_server(ctx, ip, port):
    """V-040: listen on this PC's home-network address only (never 0.0.0.0 or a public address); next few ports if taken."""
    if not phone.lan_ok(ip):
        raise OSError("not a home-network address: %s" % ip)
    last = None
    for p in ([port] if port == 0 else range(port, port + 10)):
        try:
            s = Server((ip, p), PhoneHandler)
            s.ctx, s.phone_ip = ctx, ip
            return s
        except OSError as e:
            last = e
    raise OSError("no free port near %d: %s" % (port, last))


def make_server(ctx, host="127.0.0.1", port=0):
    """Bind to loopback only; tries the next few ports when the first is taken."""
    if host != "127.0.0.1":
        raise ValueError("the server only listens on 127.0.0.1")
    last = None
    for p in ([port] if port == 0 else range(port, port + 10)):
        try:
            s = Server((host, p), Handler)
            s.ctx = ctx
            return s
        except OSError as e:
            last = e
    raise OSError("no free port near %d: %s" % (port, last))


def fake_verifier(cfg):
    """Demo verifier for --fake-verify: waits a few seconds, then passes. Never touches the repo or cargo."""
    def run(req):
        time.sleep(cfg["app"]["verify_fake_seconds"])
        return {"outcome": "VERIFIED", "checks": [{"check_id": c["check_id"], "status": "VERIFIED"} for c in req["criteria"]], "not_verified": []}, {}
    return run


def main(argv=None):
    ap = argparse.ArgumentParser(prog="vanilla-agents app", description="Run the program window server.")
    ap.add_argument("--project", help="project folder (its vanilla-agents home) to show")
    ap.add_argument("--feed", help="event feed file (default: VANILLA_FEED, app.json feed_path, or ~/.vanilla-agents/feed.jsonl)")
    ap.add_argument("--settings", help="file for your own sound choices (default from app.json settings_path)")
    ap.add_argument("--port", type=int, help="port (default from app.json)")
    ap.add_argument("--fake-verify", action="store_true", help="demo: Verify now runs a pretend check (no cargo) so you can see the cast bar and toast")
    ap.add_argument("--demo", action="store_true", help="demo: every helper sits at a laptop in the inn and stays there; a barmaid walks between the tables")
    ap.add_argument("--open", action="store_true", help="open the chromeless program window (it receives the window key; without --open the buttons that change things do not work)")
    ap.add_argument("--show-key", action="store_true", help="print a link carrying the window key (for opening the page by hand; the key lets whoever holds it approve things)")
    a = ap.parse_args(argv)
    try:
        cfg = load_all(CONFIG_DIR)
        problems = check_app(cfg)
    except VanillaError as e:
        problems = [str(e)]
    if problems:
        print("The program window cannot start yet. Please fix these settings problems:")
        for p in problems:
            print(" - " + p)
        return 1
    if a.fake_verify:
        cfg["app"]["verify_check_seconds"], cfg["app"]["verify_default_seconds"] = {}, cfg["app"]["verify_fake_seconds"]
    ctx = Ctx(cfg, a.feed or default_feed(cfg["app"]), a.project, settings_file=a.settings, verifier=fake_verifier(cfg) if a.fake_verify else None)
    ctx.demo = a.demo
    srv = make_server(ctx, cfg["app"]["host"], a.port if a.port is not None else cfg["app"]["port"])
    ctx.port = srv.server_address[1]
    ctx.start_background()
    ctx.start_notify()
    ctx.start_integrations()
    ctx.start_chat()
    if phone.enabled(ctx.settings_file):       # V-040: Phone access was left on: open the home-network listener again
        ctx.phone_start()
        print("Phone access is on: " + (ctx.phone_status()["url"] or ctx.phone_error))
    if remote_api.enabled(ctx.settings_file):      # V-054: Browser access was left on: connect to the relay again
        ctx.remote.start()
        print("Browser access is on (relay %s)." % ctx.remote.relay + (" " + ctx.remote.error if ctx.remote.error else ""))
    url = "http://127.0.0.1:%d/" % srv.server_address[1]
    print("vanilla-agents is running at " + url)
    if a.show_key:
        print("Your window key link (keep it private; it lets whoever has it approve things): %s#k=%s" % (url, ctx.key))
    started = time.monotonic()
    if a.open:
        try:
            proc = launch.open_window(url + "#k=" + ctx.key, cfg["app"])      # the key travels in the address fragment: never sent to the server, never in a response
            threading.Thread(target=lambda: (proc.wait(), time.monotonic() - started > 3 and srv.shutdown()), daemon=True).start()
        except RuntimeError as e:
            print(e)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        ctx.stop.set()
        ctx.phone_stop()
        ctx.remote.stop()
        if ctx._watch_stop:
            ctx._watch_stop.set()
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
