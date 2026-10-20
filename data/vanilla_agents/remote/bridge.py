"""The bridge (V-054): runs inside the window server while Browser access is on. One outbound WebSocket to the relay; nothing listens.

A paired browser's request is opened (seal.py), checked against that device's scope HERE on the PC, then replayed against this PC's
own window server (127.0.0.1, with the window key), so every check the window already makes still applies. Live updates come from
the window's own /api/events and go out sealed, at most one per app.json remote.event_min_seconds per browser.

Session rule (no replays): a browser says hello with a fresh sid; the bridge answers with a fresh challenge `ch`; every request must
carry that ch and a growing n. A frame recorded by the relay is useless in any later session.

Claude connectors: the relay hands over plain JSON-RPC calls for /mcp/<pair>/<token>; a known token runs them through the same MCP
tools as `python -m vanilla_agents.mcp` (an agent can report and ask, never approve), with the connector's agent name as default.
"""
import http.client
import json
import secrets
import threading
import time

from . import seal, wsproto

READ = ("/api/state", "/api/phone/strings")
WRITE = {"respond": ("/api/approve", "/api/pause", "/api/verify")}      # the phone's three buttons (server.PHONE_CALLS)
MAX_LOCAL = 3 * 1024 * 1024


def allowed(scope, method, path):
    if method == "GET":
        return path in READ
    if method == "POST":
        return path in WRITE.get(scope, ())
    return False


class Session:
    def __init__(self, keys, dev):
        self.keys, self.dev = keys, dev
        self.sid = self.ch = None
        self.n_in = self.n_out = 0
        self.sub, self.last_push = False, 0.0


class Bridge:
    def __init__(self, store, relay_url, local_port, key, tools=None, event_min=0.5, client=wsproto.Client, log=lambda s: None):
        self.store, self.relay_url, self.port, self.key = store, relay_url, local_port, key
        self.tools, self.event_min, self.client_cls, self.log = tools, event_min, client, log
        self.ws, self.sess, self.lock = None, {}, threading.RLock()
        self.stop_ev, self.online, self.error = threading.Event(), False, ""
        self.thread = self.pump = None
        self.latest, self.latest_gen, self.pushed_gen, self.timer = None, 0, {}, None

    # ---- life ----
    def start(self):
        self.store.ensure()
        self.stop_ev.clear()
        self.thread = threading.Thread(target=self._run, daemon=True, name="remote-bridge")
        self.thread.start()

    def stop(self):
        self.stop_ev.set()
        ws, self.ws = self.ws, None
        if ws:
            ws.close()
        self.online = False

    def status(self):
        return {"online": self.online, "error": "" if self.online else self.error}

    def kick(self, dev):
        """A removed browser: forget its session and have the relay drop its connection."""
        with self.lock:
            self.sess.pop(dev, None)
        self._send({"t": "kick", "dev": dev})

    def _run(self):
        wait = 1
        while not self.stop_ev.is_set():
            try:
                self.ws = self.client_cls(self.relay_url)
                self.ws.send(json.dumps({"t": "pc", "pair": self.store.pair, "token": self.store.ensure()["token"]}))
                beat = threading.Thread(target=self._beat, args=(self.ws,), daemon=True, name="remote-beat")
                beat.start()
                while not self.stop_ev.is_set():
                    msg = json.loads(self.ws.recv())
                    if isinstance(msg, dict):
                        if msg.get("t") == "ready":
                            self.online, self.error, wait = True, "", 1
                        self._on(msg)
            except (OSError, ValueError, wsproto.Closed) as e:
                self.error = str(e) or e.__class__.__name__
            finally:
                self.online = False
                ws, self.ws = self.ws, None
                if ws:
                    ws.close()
                with self.lock:
                    self.sess.clear()
            if self.stop_ev.wait(wait):
                break
            wait = min(60, wait * 2)

    def _beat(self, ws):
        while not self.stop_ev.wait(25) and self.ws is ws:
            try:
                ws.ping()
            except OSError:
                return

    def _send(self, obj):
        ws = self.ws
        if ws:
            try:
                ws.send(json.dumps(obj, separators=(",", ":")))
            except OSError:
                pass

    def _out(self, s, obj):
        with self.lock:         # n and the send stay together, so frames leave in the order of n
            s.n_out += 1
            self._send({"t": "msg", "dev": s.dev, "data": seal.seal(s.keys["p2d"], dict(obj, sid=s.sid, n=s.n_out), self.store.pair, s.dev)})

    # ---- frames from the relay ----
    def _on(self, m):
        t = m.get("t")
        if t == "leave":
            with self.lock:
                self.sess.pop(m.get("dev"), None)
        elif t == "pair":
            self._pair(m)
        elif t == "msg":
            self._msg(m)
        elif t == "mcp":
            threading.Thread(target=self._mcp, args=(m,), daemon=True, name="remote-mcp").start()
        elif t == "error":
            self.error = str(m.get("error"))[:200]

    def _keys_for(self, pub_raw):
        return seal.keys(self.store.sk(), pub_raw, self.store.pair, pub_raw)

    def _pair(self, m):
        dev = m.get("dev")
        try:
            pub = seal.b64d(m.get("pub") or "")
        except ValueError:
            return
        if len(pub) != 32 or seal.device_id(pub) != dev:
            return
        keys = self._keys_for(pub)
        try:
            name = seal.unseal(keys["d2p"], m.get("data") or "", self.store.pair, dev).get("name")
        except ValueError:
            name = None
        d = self.store.accept(pub, m.get("proof"), name)
        s = Session(keys, dev)
        s.sid = "pair"
        self._out(s, {"k": "paired", "scope": d["scope"], "name": d["name"]} if d else {"k": "refused"})
        if d:
            self.log("Browser access: paired %s (%s)" % (d["name"], d["scope"]))

    def _msg(self, m):
        dev = m.get("dev")
        d = self.store.device(dev) if isinstance(dev, str) else None
        if not d:
            return              # unknown or revoked: say nothing
        with self.lock:
            s = self.sess.get(dev)
            if not s:
                s = self.sess[dev] = Session(self._keys_for(seal.b64d(d["pub"])), dev)
        try:
            body = seal.unseal(s.keys["d2p"], m.get("data") or "", self.store.pair, dev)
        except ValueError:
            return
        k = body.get("k")
        if k == "hello" and isinstance(body.get("sid"), str) and 8 <= len(body["sid"]) <= 64:
            with self.lock:
                s.sid, s.ch, s.n_in, s.n_out, s.sub = body["sid"], secrets.token_urlsafe(16), 0, 0, False
            self.store.seen(dev)
            self._out(s, {"k": "welcome", "ch": s.ch, "scope": d["scope"], "name": d["name"]})
            return
        if not s.ch or body.get("ch") != s.ch or not isinstance(body.get("n"), int) or body["n"] <= s.n_in:
            return              # not this session, or a replay
        s.n_in = body["n"]
        if k == "sub":
            s.sub = True
            self._want_pump()
            if self.latest is not None:
                self._push(s, force=True)
        elif k == "req":
            threading.Thread(target=self._req, args=(s, d["scope"], body), daemon=True, name="remote-req").start()

    def _req(self, s, scope, body):
        rid, method, path = body.get("id"), body.get("method"), body.get("path")
        if not isinstance(path, str) or not allowed(scope, method, path):
            return self._out(s, {"k": "res", "id": rid, "status": 403, "body": {"error": "not allowed for this browser"}})
        payload = body.get("body") if method == "POST" else None
        status, data = self.local(method, path, payload)
        self._out(s, {"k": "res", "id": rid, "status": status, "body": data})

    def local(self, method, path, payload=None):
        """Call this PC's own window server with its key. (status, parsed JSON or {"error"})."""
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        try:
            h = {"Host": "127.0.0.1:%d" % self.port, "X-Vanilla-Key": self.key, "X-Vanilla-Via": "browser"}
            raw = None
            if method == "POST":
                raw = json.dumps(payload if isinstance(payload, dict) else {}).encode("utf-8")
                h["Content-Type"] = "application/json"
            c.request(method, path, body=raw, headers=h)
            r = c.getresponse()
            data = r.read(MAX_LOCAL + 1)
            if len(data) > MAX_LOCAL:
                return 502, {"error": "answer too big"}
            try:
                return r.status, json.loads(data.decode("utf-8"))
            except ValueError:
                return r.status, {"error": "not JSON"}
        except OSError as e:
            return 502, {"error": str(e)}
        finally:
            c.close()

    # ---- live updates ----
    def _want_pump(self):
        with self.lock:
            if self.pump and self.pump.is_alive():
                return
            self.pump = threading.Thread(target=self._pump, daemon=True, name="remote-events")
            self.pump.start()

    def _subs(self):
        with self.lock:
            return [s for s in self.sess.values() if s.sub]

    def _pump(self):
        while not self.stop_ev.is_set() and self._subs():
            status, st = self.local("GET", "/api/state")
            if status != 200:
                if self.stop_ev.wait(5):
                    return
                continue
            self._new_state(st)
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
            try:
                c.request("GET", "/api/events?cursor=%s" % st.get("cursor", 0), headers={"Host": "127.0.0.1:%d" % self.port})
                r = c.getresponse()
                event, data = None, []
                while not self.stop_ev.is_set() and self._subs():
                    line = r.fp.readline(MAX_LOCAL)
                    if not line:
                        break
                    line = line.decode("utf-8").rstrip("\r\n")
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].lstrip())
                    elif line == "":
                        if event == "reset":
                            break
                        if event == "update" and data:
                            try:
                                self._new_state(json.loads("\n".join(data)).get("state"))
                            except ValueError:
                                pass
                        event, data = None, []
                    self._flush()
            except OSError:
                if self.stop_ev.wait(2):
                    return
            finally:
                c.close()

    def _new_state(self, st):
        if isinstance(st, dict):
            with self.lock:
                self.latest, self.latest_gen = st, self.latest_gen + 1
            self._flush()

    def _flush(self):
        for s in self._subs():
            self._push(s)

    def _push(self, s, force=False):
        now = time.monotonic()
        if self.latest is None or (not force and self.pushed_gen.get(s.dev) == self.latest_gen):
            return
        if not force and now - s.last_push < self.event_min:
            with self.lock:         # too soon: send the newest one a moment later
                if not (self.timer and self.timer.is_alive()):
                    self.timer = threading.Timer(self.event_min - (now - s.last_push) + 0.01, self._flush)
                    self.timer.daemon = True
                    self.timer.start()
            return
        s.last_push, self.pushed_gen[s.dev] = now, self.latest_gen
        self._out(s, {"k": "state", "state": self.latest})

    # ---- Claude connectors ----
    def _mcp(self, m):
        rid = m.get("rid")
        c = self.store.connector(m.get("tok"))
        if not c:
            return self._send({"t": "mcpres", "rid": rid, "status": 404, "body": json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": "Unknown connector address (it may have been removed)."}})})
        try:
            msg = json.loads(m.get("body") or "")
        except ValueError:
            return self._send({"t": "mcpres", "rid": rid, "status": 400, "body": json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})})
        from .. import mcp
        tools = self.tools() if callable(self.tools) else self.tools

        def one(x):
            if not isinstance(x, dict):
                return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request"}}
            if x.get("method") == "tools/call" and isinstance(x.get("params"), dict):
                name, args = x["params"].get("name"), x["params"].get("arguments")
                args = dict(args) if isinstance(args, dict) else {}
                props = next((t[2] for t in mcp.TOOLS if t[0] == name), {})
                if "agent" in props and not args.get("agent"):
                    args["agent"] = c["agent"]
                x = dict(x, params=dict(x["params"], arguments=args))
            return mcp.handle(tools, x)
        out = [r for r in (one(x) for x in msg) if r] if isinstance(msg, list) else one(msg)
        self._send({"t": "mcpres", "rid": rid, "status": 200 if out else 202, "body": json.dumps(out, ensure_ascii=False) if out else ""})
