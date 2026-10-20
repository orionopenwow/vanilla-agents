"""This PC's side of a party (see hub.py): host or join, keep in sync every few seconds, turn our share of the agreed plan into quests in
our own feed (the owner approves them as usual), and report how they are going. Runs inside the program window's server.

Community chat (V-036) is for the people only and must never reach Claude: the messages live in this object's memory (self.chat) and
in view() for the window, and are taken out of the party state before anything is written to disk (party-state.json is what the MCP
tool party_plan reads). Nothing here writes them to the event feed."""
import http.client
import json
import os
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit

from ..app import social
from ..events.feed import Feed
from . import hub

QUEST_STATUS = {"new": "quest", "progress": "progress", "ready": "ready", "complete": "complete", "failed": "failed", "blocked": "blocked"}


class PartyError(Exception):
    pass


@__import__("functools").lru_cache(maxsize=1)
def default_name():
    """A name to start from in the Host / Join boxes: your git user name, else your sign-in name (you can change it)."""
    import getpass
    import subprocess
    try:
        r = subprocess.run(["git", "config", "--global", "user.name"], capture_output=True, text=True, timeout=3)
        n = (r.stdout or "").strip()
        if n:
            return n.split()[0][:32]
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        return getpass.getuser()[:32]
    except Exception:          # noqa: BLE001 - no user name on this system
        return ""


def parse_invite(link, with_host=False):
    """'http://host:port/party?t=TOKEN[&h=HOST]' -> (base url, token) or, with_host, (base url, token, host token or '')."""
    u = urlsplit((link or "").strip())
    q = parse_qs(u.query)
    t = (q.get("t") or [""])[0]
    if u.scheme not in ("http", "https") or not u.netloc or not t:
        raise PartyError("That is not an invite link. It looks like http://192.168.1.20:8940/party?t=...")
    base = "%s://%s" % (u.scheme, u.netloc)
    return (base, t, (q.get("h") or [""])[0]) if with_host else (base, t)


class PartyClient:
    def __init__(self, work_dir, feed_path, cfg, project_of=lambda: None, agents_of=lambda: [], tasks_of=lambda: [], period=3.0):
        self.work, self.feed_path, self.cfg, self.period = work_dir, feed_path, cfg, period
        self.project_of, self.agents_of, self.tasks_of = project_of, agents_of, tasks_of
        self.member_file = os.path.join(work_dir, "party-member.json")
        self.cache_file = os.path.join(work_dir, "party-state.json")
        self.m = self._load(self.member_file) or {}
        self.state, self.error, self.hub_srv, self.party = None, "", None, None
        self.pending = None                        # an invite a friend clicked in their browser (GET /join): the window asks to confirm
        self.chat, self.chat_last = [], 0          # community chat (humans only): memory and the window, never a file
        self.version = 0                           # goes up whenever what view() shows changes (the window's live updates follow it)
        self._sig = ""
        self._stop = threading.Event()
        self._thread = None
        if self.m.get("host_state") and os.path.exists(self.m["host_state"]):     # we were hosting: open the party again after a restart
            try:
                self._start_hub(self.m["host_state"], self.m.get("host_port", 8940), bind=self.m.get("host_bind", "0.0.0.0"))
            except OSError as e:
                self.error = "could not reopen your party (%s)" % e

    # ---- files ----
    @staticmethod
    def _load(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def _save(self, path, obj):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(obj, f)
        os.replace(path + ".tmp", path)

    # ---- talking to the hub ----
    def _call(self, path, body=None, base=None, key=None):
        url = (base or self.m.get("url", "")) + path
        req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                                     headers={"Content-Type": "application/json", "X-Party-Key": key or self.m.get("key", "")})
        try:
            with urllib.request.urlopen(req, timeout=6) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get("error")
            except (ValueError, AttributeError):
                msg = None
            raise PartyError(msg or "the party answered %s" % e.code)
        except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as e:      # V-048: a garbled answer from the hub too
            raise PartyError("cannot reach the party at %s (%s)" % (base or self.m.get("url", ""), getattr(e, "reason", e)))

    @property
    def joined(self):
        return bool(self.m.get("key"))

    def _start_hub(self, state_path, port, name="Party", bind="0.0.0.0", hours=hub.INVITE_HOURS):
        self.party = hub.Party(state_path, name, invite_hours=hours)
        self.party.save()
        self.hub_srv = hub.serve(self.party, bind, port)

    def host(self, party_name, my_name, port=8940, network=True, hours=hub.INVITE_HOURS):
        """Open a party on this PC and join it ourselves as its host. network=False listens on 127.0.0.1 only (this PC: for trying it
        out or several windows on one PC); network=True on every address (friends on your Wi-Fi / VPN). Returns the invite link."""
        if self.joined:
            raise PartyError("leave your current party first")
        state = os.path.join(self.work, "party-hub.json")
        if os.path.exists(state):
            os.remove(state)                   # a new party: new invite token, empty plan
        bind = "0.0.0.0" if network else "127.0.0.1"
        try:
            self._start_hub(state, port, party_name, bind, hours)
        except OSError as e:
            raise PartyError("could not open port %d for the party (%s)" % (port, e))
        port = self.hub_srv.server_address[1]
        base = "http://%s:%d" % (hub.lan_address() if network else "127.0.0.1", port)
        self.join("http://127.0.0.1:%d/party?t=%s&h=%s" % (port, self.party.d["invite"], self.party.d["host_token"]), my_name)
        self.m.update(host_state=state, host_port=port, host_bind=bind, invite_base=base, invite="%s/party?t=%s" % (base, self.party.d["invite"]))
        self._save(self.member_file, self.m)
        return self.m["invite"]

    def invites(self):
        """The links to share, one per way in: the same Wi-Fi first, then Tailscale (friends over the internet without opening a port)."""
        inv = self.m.get("invite", "")
        if not inv:
            return []
        out = [{"kind": "lan", "url": inv}]
        if self.m.get("host_bind") != "127.0.0.1":
            u = urlsplit(inv)
            port = u.port or 8940
            for ip in hub.vpn_addresses():
                out.append({"kind": "vpn", "url": "http://%s:%d%s?%s" % (ip, port, u.path, u.query)})
        return out

    def offer(self, invite_link):
        """A friend's invite link arrived from their browser (the hub's Join button): remember it for the window to ask about.
        Only a valid link is kept; nothing is joined here."""
        parse_invite(invite_link)
        if self.joined:
            raise PartyError("you are already in a party: leave it first")
        name = ""
        try:
            name = (self._call("/party", base=parse_invite(invite_link)[0], key="") or {}).get("party", "")
        except PartyError:
            pass
        self.pending = {"invite": invite_link.strip(), "party": str(name)[:60], "at": time.time()}
        self.version += 1
        return self.pending

    def join(self, invite_link, my_name):
        base, token, host_token = parse_invite(invite_link, with_host=True)
        r = self._call("/party/join", {"invite": token, "name": my_name, "host": host_token}, base=base, key="")
        if host_token:                          # never keep or show the host secret: the link we share is the plain invite
            invite_link = "%s/party?t=%s" % (base, token)
        self.m = {"url": base, "key": r["key"], "member": r["member"], "party": r["party"], "invite": invite_link, "quests": {}}
        self.pending = None
        self.chat, self.chat_last = [], 0
        self._save(self.member_file, self.m)
        self.error = ""
        self.sync()
        return self.state

    def leave(self):
        if self.joined:
            try:
                self._call("/party/leave", {})
            except PartyError:
                pass                            # gone or unreachable: leaving locally is enough
        if self.hub_srv:
            self.hub_srv.shutdown()
            self.hub_srv.server_close()
            self.hub_srv = None
        self.m, self.state = {}, None
        self.chat, self.chat_last = [], 0
        self.version += 1
        for p in (self.member_file, self.cache_file):
            if os.path.exists(p):
                os.remove(p)

    def act(self, call, body):
        """propose / remove / agree / unlock / take / say (anyone), kick / renew / unsay (host only, the hub checks): forwarded as they
        are; returns the new party state."""
        if call not in ("propose", "remove", "agree", "unlock", "take", "kick", "renew", "say", "unsay"):
            raise PartyError("unknown party call")
        if not self.joined:
            raise PartyError("join or host a party first")
        self._call("/party/" + call, body)
        self.sync()
        return self.state

    # ---- keeping in sync ----
    def sync(self):
        if not self.joined:
            return None
        try:
            agents = [{"id": a.get("id"), "role": a.get("role", ""), "state": a.get("state", "idle"), "activity": a.get("activity", "")} for a in self.agents_of()]
            st = self._call("/party/push", {"agents": agents, "since": self.chat_last})
            self._take_chat(st)
            if st.get("invite_token") and self.m.get("invite_base"):      # host: the link to share follows renewals (new link, kick)
                link = "%s/party?t=%s" % (self.m["invite_base"], st["invite_token"])
                if link != self.m.get("invite"):
                    self.m["invite"] = link
                    self._save(self.member_file, self.m)
            self._mine(st)
            self.state, self.error = st, ""
            self._save(self.cache_file, {"state": st, "member": self.m.get("member"), "quests": self.m.get("quests", {})})
        except PartyError as e:
            self.error = str(e)
        self._bump()
        return self.state

    def _take_chat(self, st):
        """Move the community chat out of a hub answer into self.chat (so the state we cache on disk never holds it)."""
        new, gone, last = st.pop("chat", None) or [], set(st.pop("chat_removed", None) or []), st.pop("chat_last", None)
        have = {c["id"] for c in self.chat}
        chat = [c for c in self.chat if c["id"] not in gone] + [c for c in new if isinstance(c, dict) and isinstance(c.get("id"), int) and c["id"] not in have and c["id"] not in gone]
        if isinstance(last, int) and last < self.chat_last:      # the hub started again with a fresh chat: start over
            chat = [c for c in new if isinstance(c, dict) and isinstance(c.get("id"), int)]
        self.chat = sorted(chat, key=lambda c: c["id"])[-hub.CHAT_KEEP:]
        self.chat_last = last if isinstance(last, int) else max([c["id"] for c in self.chat] or [0])

    def _bump(self):
        sig = json.dumps([self.state, self.error, self.chat and self.chat[-1]["id"], len(self.chat)], sort_keys=True, default=str)
        if sig != self._sig:
            self._sig = sig
            self.version += 1

    def _mine(self, st):
        """Our items: make each one a quest in our feed once, then report the quest's status back."""
        me, quests, changed = st.get("me"), self.m.setdefault("quests", {}), False
        tasks = {t["id"]: t for t in self.tasks_of()}
        for it in st.get("items", []):
            if it.get("owner") != me or not st.get("locked"):
                continue
            if it["id"] not in quests:
                why = "Party plan (%s): %s" % (st.get("party", ""), it.get("why") or "our share of the agreed plan")
                quests[it["id"]] = social.owner_quest(Feed(self.feed_path), self.cfg, self.project_of(), it["title"], why)
                changed = True
            t = tasks.get(quests[it["id"]])
            status = QUEST_STATUS.get(t["status"], "quest") if t else "quest"
            if status != it.get("status"):
                try:
                    self._call("/party/report", {"item": it["id"], "status": status})
                except PartyError:
                    pass
        if changed:
            self._save(self.member_file, self.m)

    def start(self):
        if self._thread:
            return
        def loop():
            while not self._stop.wait(self.period):
                try:
                    self.sync()
                except Exception as e:          # never take the window down
                    self.error = "party sync failed (%s)" % e
        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def view(self):
        """What the window shows: joined?, the party state, our invite link (host), last error."""
        st = self.state or {}
        is_host = bool(st.get("me")) and st.get("me") == st.get("host")
        pend = self.pending if (self.pending and not self.joined and time.time() - self.pending["at"] < 600) else None
        return {"joined": self.joined, "hosting": bool(self.hub_srv), "host": is_host, "local": self.m.get("host_bind") == "127.0.0.1",
                "invite": self.m.get("invite", "") if is_host else "", "invite_expires": st.get("invite_expires"),
                "invites": self.invites() if is_host else [], "pending": pend, "default_name": default_name(),
                "state": self.state, "error": self.error, "member": self.m.get("member", ""), "quests": self.m.get("quests", {}),
                "chat": list(self.chat) if self.joined else []}
