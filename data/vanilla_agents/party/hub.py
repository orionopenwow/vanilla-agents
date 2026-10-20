"""Party hub: several people, each with their own Vanilla Agents and Claude helpers, share one world.

One person hosts (Esc > Party > Host, or `python -m vanilla_agents.party.hub`). Everyone - the host too - joins with the invite link.
What travels through the hub: member names, each member's helpers (name, role, working/idle, a one-line activity), the shared plan
and who has which part of it, and the status of those parts. Never code, files, keys or approvals.

The plan: anyone proposes items (people in the window, or their Claude through the MCP tool). Any change to the plan clears every
"I agree". When every active member agrees to the same version the plan locks and the items are split between the members
(balanced by size). After that a member can take an unstarted item from someone else. Each member's app turns its own items into
quests on its own PC, where the owner still approves them (D-380): the party can never approve for anyone.

Community chat (V-036): the people in the party can talk to each other (say / unsay). It is for the humans only: the client keeps it
in memory and in the window, never in the files or tools Claude reads (see client.py and docs/PRIVACY.md).

Standard library only. The hub keeps its state in one JSON file and answers HTTP on its own port; every call but /party/join needs the
member key returned by join, and join needs the party's invite token."""
import argparse
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

SIZE_WEIGHT = {"small": 1, "medium": 2, "big": 3}
ACTIVE_S = 15 * 60             # a member not heard from for this long no longer blocks agreement
MAX_ITEMS, MAX_MEMBERS, MAX_AGENTS, MAX_BODY = 60, 12, 20, 64 * 1024
STATUSES = ("open", "quest", "progress", "ready", "complete", "failed", "blocked")
INVITE_HOURS = 24              # an invite link stops working after this many hours (the host can make a new one)
CHAT_KEEP, CHAT_MAX_TEXT = 300, 500   # community chat: messages the hub keeps, longest message
CHAT_RATE = (5, 10.0)          # at most 5 messages per member in 10 seconds


def _hash(key):
    return hashlib.sha256((key or "").encode()).hexdigest()


def _clean(s, n):
    return " ".join(str(s or "").split())[:n]


class Party:
    """Pure party state + rules (no I/O except save()). All times come from `clock` so tests can move them."""

    def __init__(self, path=None, name="Party", clock=time.time, invite_hours=INVITE_HOURS):
        self.path, self.clock, self.lock = path, clock, threading.RLock()
        hours = max(1, min(24 * 30, int(invite_hours or INVITE_HOURS)))
        # host_token: never in the invite link; whoever joins with it is the host (only the host may remove members or renew the invite)
        self.d = {"name": _clean(name, 60) or "Party", "invite": secrets.token_urlsafe(16), "invite_hours": hours,
                  "invite_expires": clock() + hours * 3600, "host_token": secrets.token_urlsafe(16), "host": None, "kicked": [],
                  "members": {}, "next_item": 1, "plan": {"version": 1, "items": [], "agreed": {}, "locked": False}, "log": [],
                  "chat": [], "next_msg": 1, "chat_removed": []}
        self._rate = {}                                    # member id -> times of their recent chat messages (not saved)
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                self.d.update(json.load(f))
            if not self.d.get("host") and self.d["members"]:      # a party saved before hosts were explicit: its first member hosted it
                self.d["host"] = next(iter(self.d["members"]))

    # ---- helpers ----
    def save(self):
        if not self.path:
            return
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.d, f)
        os.replace(tmp, self.path)

    def _say(self, who, text):
        self.d["log"] = (self.d["log"] + [{"ts": self.clock(), "who": who, "text": text}])[-80:]

    def _chat(self, mid, name, text="", sys=""):
        """One community chat line; sys = join / leave / removed for the party's own lines (the window words them)."""
        msg = {"id": self.d["next_msg"], "ts": self.clock(), "member": mid, "name": name, "text": text}
        if sys:
            msg["sys"] = sys
        self.d["next_msg"] += 1
        self.d["chat"] = (self.d["chat"] + [msg])[-CHAT_KEEP:]
        return msg

    def _member(self, key):
        for mid, m in self.d["members"].items():
            if hmac.compare_digest(m["key"].encode("utf-8"), (key or "").encode("utf-8")):      # bytes: a non-ASCII key is simply wrong, not a crash
                m["seen"] = self.clock()
                return mid, m
        if _hash(key) in self.d.get("kicked", []):
            raise PermissionError("the host removed you from this party")
        raise PermissionError("not a member of this party (join again with the invite link)")

    def _host(self, key):
        mid, m = self._member(key)
        if mid != self.d.get("host"):
            raise PermissionError("only the host can do that")
        return mid, m

    def active(self):
        now = self.clock()
        return [mid for mid, m in self.d["members"].items() if now - m.get("seen", 0) < ACTIVE_S]

    def _item(self, iid):
        for it in self.d["plan"]["items"]:
            if it["id"] == iid:
                return it
        raise KeyError("no plan item %s" % iid)

    def _changed(self, who, text):
        p = self.d["plan"]
        p["version"] += 1
        p["agreed"] = {}
        self._say(who, text)

    # ---- calls ----
    def join(self, invite, name, host_token=""):
        with self.lock:
            if not hmac.compare_digest(str(invite or "").encode("utf-8"), self.d["invite"].encode("utf-8")):
                raise PermissionError("that invite link is not for this party (or the host made a new one)")
            is_host = bool(host_token) and hmac.compare_digest(str(host_token).encode("utf-8"), self.d["host_token"].encode("utf-8"))
            if not is_host and self.clock() > self.d["invite_expires"]:
                raise PermissionError("that invite link has expired; ask the host for a new one")
            name = _clean(name, 32) or "Adventurer"
            if len(self.d["members"]) >= MAX_MEMBERS:
                raise ValueError("the party is full")
            n = max(self.d.get("next_member", 1), len(self.d["members"]) + 1)      # V-048: never reuse the id of a member who left or was removed (their started items, chat lines)
            while "m%d" % n in self.d["members"]:
                n += 1
            mid, self.d["next_member"] = "m%d" % n, n + 1
            key = secrets.token_urlsafe(24)
            self.d["members"][mid] = {"name": name, "key": key, "joined": self.clock(), "seen": self.clock(), "agents": []}
            if is_host:
                self.d["host"] = mid
            self._say(name, "joined the party" + (" (host)" if is_host else ""))
            self.d["members"][mid]["chat_from"] = self._chat(mid, name, sys="join")["id"]     # a newcomer sees the chat from their own arrival on
            self.save()
            return {"member": mid, "key": key, "party": self.d["name"], "host": is_host}

    def _drop(self, mid):
        """Unstarted work of a member who goes, goes back to the pool; their agreement no longer counts."""
        for it in self.d["plan"]["items"]:
            if it.get("owner") == mid and it.get("status", "open") in ("open", "quest"):
                it["owner"], it["status"] = None, "open"
        self.d["plan"]["agreed"].pop(mid, None)
        del self.d["members"][mid]
        if self.d.get("host") == mid:
            self.d["host"] = None

    def kick(self, key, member):
        """Host only: remove a member. Their key stops working, their unstarted items go back to the pool, and the invite link is
        renewed so the old link cannot bring them straight back (the others keep their keys)."""
        with self.lock:
            hid, h = self._host(key)
            if member == hid:
                raise ValueError("you cannot remove yourself; use Leave")
            m = self.d["members"].get(member)
            if not m:
                raise KeyError("no member %s" % member)
            self.d["kicked"] = (self.d.get("kicked", []) + [_hash(m["key"])])[-50:]
            self._drop(member)
            self._new_invite()
            self._say(h["name"], "removed %s from the party (new invite link)" % m["name"])
            self._chat(member, m["name"], sys="removed")
            self.save()
            return self.state(key)

    def _new_invite(self, hours=None):
        if hours:
            self.d["invite_hours"] = max(1, min(24 * 30, int(hours)))
        self.d["invite"] = secrets.token_urlsafe(16)
        self.d["invite_expires"] = self.clock() + self.d["invite_hours"] * 3600

    def renew_invite(self, key, hours=None):
        """Host only: a new invite link (the old one stops working; members already in keep their keys)."""
        with self.lock:
            _hid, h = self._host(key)
            self._new_invite(hours)
            self._say(h["name"], "made a new invite link")
            self.save()
            return self.state(key)

    def leave(self, key):
        with self.lock:
            mid, m = self._member(key)
            self._drop(mid)                            # unstarted work goes back to the pool
            self._say(m["name"], "left the party")
            self._chat(mid, m["name"], sys="leave")
            self.save()

    def say(self, key, text, since=None):
        """Community chat: a member writes to the other people in the party (1..500 characters, at most 5 messages in 10 s)."""
        with self.lock:
            mid, m = self._member(key)            # removed members are refused here (their key no longer works)
            text = " ".join(str(text or "").split())
            if not text:
                raise ValueError("write something first")
            if len(text) > CHAT_MAX_TEXT:
                raise ValueError("that message is too long (at most %d characters)" % CHAT_MAX_TEXT)
            n, per = CHAT_RATE
            now = self.clock()
            recent = [t for t in self._rate.get(mid, []) if now - t < per]
            if len(recent) >= n:
                raise ValueError("slow down a little: at most %d messages in %d seconds" % (n, per))
            self._rate[mid] = recent + [now]
            self._chat(mid, m["name"], text)
            self.save()
            return self.state(key, since)

    def unsay(self, key, msg_id, since=None):
        """Host only: take a community chat message away (everyone's window drops it at the next sync)."""
        with self.lock:
            self._host(key)
            try:
                msg_id = int(msg_id)
            except (TypeError, ValueError):
                raise ValueError("which message?")
            before = len(self.d["chat"])
            self.d["chat"] = [c for c in self.d["chat"] if c["id"] != msg_id]
            if len(self.d["chat"]) == before:
                raise KeyError("no message %s" % msg_id)
            self.d["chat_removed"] = (self.d.get("chat_removed", []) + [msg_id])[-100:]
            self.save()
            return self.state(key, since)

    def push(self, key, agents, since=None):
        """A member's helpers right now: [{id, role, state, activity}] (shown in everyone's inn)."""
        with self.lock:
            mid, m = self._member(key)
            m["agents"] = [{"id": _clean(a.get("id"), 40), "role": _clean(a.get("role"), 30), "state": "working" if a.get("state") == "working" else "idle",
                            "activity": _clean(a.get("activity"), 120)} for a in (agents or [])[:MAX_AGENTS] if isinstance(a, dict) and a.get("id")]
            return self.state(key, since)

    def propose(self, key, title, why="", size="medium", by_agent=""):
        with self.lock:
            mid, m = self._member(key)
            p = self.d["plan"]
            if p["locked"]:
                raise ValueError("the plan is agreed and locked; unlock it first to change it")
            title = _clean(title, 160)
            if not title:
                raise ValueError("give the item a title")
            if len(p["items"]) >= MAX_ITEMS:
                raise ValueError("the plan is full (%d items)" % MAX_ITEMS)
            it = {"id": "p%d" % self.d["next_item"], "title": title, "why": _clean(why, 400), "size": size if size in SIZE_WEIGHT else "medium",
                  "by": mid, "by_name": m["name"], "by_agent": _clean(by_agent, 40), "owner": None, "status": "open"}
            self.d["next_item"] += 1
            p["items"].append(it)
            self._changed(m["name"], "proposed: " + title + (" (from " + it["by_agent"] + ")" if it["by_agent"] else ""))
            self.save()
            return it

    def remove(self, key, iid):
        with self.lock:
            mid, m = self._member(key)
            p = self.d["plan"]
            if p["locked"]:
                raise ValueError("the plan is agreed and locked; unlock it first to change it")
            it = self._item(iid)
            p["items"].remove(it)
            self._changed(m["name"], "took out: " + it["title"])
            self.save()

    def agree(self, key, version):
        with self.lock:
            mid, m = self._member(key)
            p = self.d["plan"]
            if int(version) != p["version"]:
                raise ValueError("the plan changed since you read it; look again and agree to the new version")
            if not p["items"]:
                raise ValueError("there is nothing in the plan yet")
            p["agreed"][mid] = p["version"]
            self._say(m["name"], "agrees to the plan")
            act = self.active()
            if not p["locked"] and act and all(p["agreed"].get(x) == p["version"] for x in act):
                p["locked"] = True
                self._split(act)
                self._say("party", "everyone agreed: the plan is locked and split")
            self.save()
            return self.state(key)

    def unlock(self, key):
        """Any member can reopen the plan for changes; items already being worked on keep their owner."""
        with self.lock:
            mid, m = self._member(key)
            p = self.d["plan"]
            p["locked"] = False
            self._changed(m["name"], "reopened the plan")
            self.save()

    def _split(self, members):
        """Balance by size: biggest items first, each to the member with the least work so far (ties: fewest items, join order)."""
        load = {mid: 0 for mid in members}
        count = {mid: 0 for mid in members}
        for it in self.d["plan"]["items"]:
            if it.get("owner") in load and it.get("status") != "open":
                load[it["owner"]] += SIZE_WEIGHT[it["size"]]
                count[it["owner"]] += 1
        order = {mid: i for i, mid in enumerate(self.d["members"])}
        for it in sorted([i for i in self.d["plan"]["items"] if not i.get("owner") or i["owner"] not in load or i.get("status") == "open"],
                         key=lambda i: -SIZE_WEIGHT[i["size"]]):
            mid = min(load, key=lambda x: (load[x], count[x], order.get(x, 99)))
            it["owner"] = mid
            load[mid] += SIZE_WEIGHT[it["size"]]
            count[mid] += 1

    def take(self, key, iid):
        with self.lock:
            mid, m = self._member(key)
            it = self._item(iid)
            if not self.d["plan"]["locked"]:
                raise ValueError("work is split once everyone agrees to the plan")
            if it.get("status") not in ("open", "quest"):
                raise ValueError("%s is already being worked on" % it["title"])
            old = self.d["members"].get(it.get("owner") or "", {}).get("name", "nobody")
            it["owner"], it["status"] = mid, "open"
            self._say(m["name"], "took %s (was %s's)" % (it["title"], old))
            self.save()
            return it

    def report(self, key, iid, status):
        """The owner's app says how its part is going (quest status on that PC)."""
        with self.lock:
            mid, m = self._member(key)
            it = self._item(iid)
            if it.get("owner") != mid:
                raise PermissionError("only the member who has %s can report on it" % it["title"])
            if status not in STATUSES:
                raise ValueError("unknown status %s" % status)
            if it.get("status") != status:
                it["status"] = status
                if status in ("complete", "failed", "blocked"):
                    self._say(m["name"], "%s: %s" % (status, it["title"]))
                self.save()

    def state(self, key, since=None):
        """The party as this member sees it. Community chat: the messages after `since` (the last message id the caller has; none = all
        kept), chat_removed = ids the host took away (the caller drops them), chat_last = the newest id (the next `since`)."""
        with self.lock:
            mid, me = self._member(key)
            act = set(self.active())
            p = self.d["plan"]
            st = {"party": self.d["name"], "me": mid, "host": self.d.get("host"), "version": p["version"], "locked": p["locked"],
                  "members": [{"id": k, "name": v["name"], "active": k in act, "agrees": p["agreed"].get(k) == p["version"], "agents": v["agents"],
                               "host": k == self.d.get("host")} for k, v in self.d["members"].items()],
                  "items": p["items"], "log": self.d["log"][-30:]}
            try:
                since = int(since or 0)
            except (TypeError, ValueError):
                since = 0
            since = max(since, me.get("chat_from", 0) - 1)
            st.update(chat=[c for c in self.d["chat"] if c["id"] > since], chat_removed=self.d.get("chat_removed", [])[-100:],
                      chat_last=self.d["next_msg"] - 1)
            if mid == self.d.get("host"):                # only the host sees the invite (to share it) and when it runs out
                st.update(invite_token=self.d["invite"], invite_expires=self.d["invite_expires"], invite_hours=self.d["invite_hours"])
            return st


# ---- HTTP ------------------------------------------------------------------------------------------------------------------------------

def make_handler(party):
    class H(BaseHTTPRequestHandler):
        server_version = "vanilla-party/1"
        timeout = 15          # V-048: a client that stops sending frees its thread (the hub may listen on the whole network)

        def log_message(self, *a):
            pass

        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _key(self):
            return self.headers.get("X-Party-Key", "")

        def do_GET(self):
            u = urlsplit(self.path)
            try:
                if u.path == "/party/state":
                    return self._send(200, party.state(self._key(), (parse_qs(u.query).get("since") or [None])[0]))
                if u.path == "/party":              # someone opened the invite link in a browser: a page with one Join button
                    if "text/html" in (self.headers.get("Accept") or ""):
                        link = "http://%s%s" % (self.headers.get("Host") or "", self.path)
                        page = invite_page(party.d["name"], link).encode("utf-8")
                        self.send_response(200)
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                        self.send_header("Content-Length", str(len(page)))
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
                        self.end_headers()
                        self.wfile.write(page)
                        return None
                    return self._send(200, {"party": party.d["name"], "hint": "Paste this link into Vanilla Agents: Esc > Party > Join."})
                return self._send(404, {"error": "no such call"})
            except PermissionError as e:
                return self._send(403, {"error": str(e)})

        def do_POST(self):
            u = urlsplit(self.path)
            try:
                n = int(self.headers.get("Content-Length", "0"))
                if n < 0 or n > MAX_BODY:          # V-048: a negative length made read() wait for the connection to close
                    return self._send(413, {"error": "too big"})
                body = json.loads(self.rfile.read(n) or b"{}")
                if not isinstance(body, dict):
                    raise ValueError("send a JSON object")
                k, call = self._key(), u.path
                if call == "/party/join":
                    t = body.get("invite") or (parse_qs(u.query).get("t") or [""])[0]
                    return self._send(200, party.join(t, body.get("name", ""), str(body.get("host") or "")))
                since = body.get("since")
                if call == "/party/push":
                    return self._send(200, party.push(k, body.get("agents"), since))
                if call == "/party/say":
                    return self._send(200, party.say(k, body.get("text"), since))
                if call == "/party/unsay":
                    return self._send(200, party.unsay(k, body.get("id"), since))
                if call == "/party/propose":
                    return self._send(200, party.propose(k, body.get("title"), body.get("why", ""), body.get("size", "medium"), body.get("by_agent", "")))
                if call == "/party/remove":
                    party.remove(k, body.get("item"))
                elif call == "/party/agree":
                    return self._send(200, party.agree(k, body.get("version", -1)))
                elif call == "/party/unlock":
                    party.unlock(k)
                elif call == "/party/take":
                    party.take(k, body.get("item"))
                elif call == "/party/report":
                    party.report(k, body.get("item"), body.get("status"))
                elif call == "/party/kick":
                    return self._send(200, party.kick(k, body.get("member")))
                elif call == "/party/renew":
                    return self._send(200, party.renew_invite(k, body.get("hours")))
                elif call == "/party/leave":
                    party.leave(k)
                    return self._send(200, {"ok": True})
                else:
                    return self._send(404, {"error": "no such call"})
                return self._send(200, party.state(k, since))
            except PermissionError as e:
                return self._send(403, {"error": str(e)})
            except (ValueError, KeyError, TypeError, OverflowError) as e:
                return self._send(400, {"error": str(e).strip("'\"")})
    return H


APP_PORT = 8766       # the Vanilla Agents window's own server on a friend's PC (app.json "port"); the invite page hands the link to it


def invite_page(name, link, app_port=APP_PORT):
    """The page a friend sees when they click the invite link: Join opens their own Vanilla Agents (127.0.0.1), which asks them to
    confirm; nothing joins from this page by itself. Plain HTML, no outside files."""
    from html import escape
    from urllib.parse import quote
    go = "http://127.0.0.1:%d/join?invite=%s" % (app_port, quote(link, safe=""))
    return ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>Join %(n)s</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0a08;color:#e8dcc0;"
            "font:16px/1.5 Georgia,serif}.c{max-width:440px;margin:16px;padding:28px;border:1px solid #6b5228;border-radius:8px;background:#1a140d}"
            "h1{color:#ffd100;font-size:24px;margin:0 0 6px}a.b{display:inline-block;margin:14px 0;padding:10px 22px;border-radius:5px;"
            "background:linear-gradient(#f5c84c,#c8902a);color:#1a1206;font-weight:bold;text-decoration:none}code{word-break:break-all;"
            "color:#c9b78f;font-size:13px}small{color:#a99}</style><div class=c><div>You're invited to a Vanilla Agents party</div>"
            "<h1>%(n)s</h1><a class=b href='%(go)s'>Join in Vanilla Agents</a><p><small>Vanilla Agents must be running on this PC; "
            "it asks you to confirm before you join. Not working? Copy this link into Vanilla Agents: Esc &gt; Party &gt; Join.</small></p>"
            "<code>%(l)s</code></div></html>") % {"n": escape(name), "go": escape(go, quote=True), "l": escape(link)}


def vpn_addresses():
    """This PC's Tailscale addresses (100.64.0.0/10), so friends outside your Wi-Fi can use a link that works over the VPN."""
    import ipaddress
    import socket
    out = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ipaddress.ip_address(ip) in ipaddress.ip_network("100.64.0.0/10") and ip not in out:
                out.append(ip)
    except (OSError, ValueError):
        pass
    return out


def serve(party, bind="0.0.0.0", port=8940):
    """Start the hub in a background thread; returns the server (call .shutdown() to stop)."""
    srv = ThreadingHTTPServer((bind, port), make_handler(party))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def lan_address():
    """This PC's address on the local network (what friends on the same Wi-Fi use), or 127.0.0.1."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))        # no packet is sent; it only picks the outgoing interface
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return "127.0.0.1"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Host a Vanilla Agents party (shared plan + world) on this PC.")
    ap.add_argument("--name", default="Party")
    ap.add_argument("--port", type=int, default=8940)
    ap.add_argument("--bind", default="0.0.0.0", help="0.0.0.0 = reachable from your network; 127.0.0.1 = this PC only")
    ap.add_argument("--hours", type=int, default=INVITE_HOURS, help="the invite link stops working after this many hours")
    ap.add_argument("--state", default=os.path.expanduser("~/.vanilla-agents/work/party.json"))
    a = ap.parse_args(argv)
    p = Party(a.state, a.name, invite_hours=a.hours)
    p.save()
    serve(p, a.bind, a.port)
    base = "http://%s:%d/party?t=%s" % (lan_address() if a.bind == "0.0.0.0" else "127.0.0.1", a.port, p.d["invite"])
    print("Party '%s' is open (plain HTTP). Invite link for your friends (anyone with it can join; it expires in %d h):" % (p.d["name"], p.d["invite_hours"]))
    print("  " + base)
    print("Your own link (join with it first: it makes you the host who can remove members and renew the invite; keep it to yourself):")
    print("  %s&h=%s" % (base, p.d["host_token"]))
    print("Ctrl+C to close it.")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
