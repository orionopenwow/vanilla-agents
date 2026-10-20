"""V-054 browser access: sealing, the relay, the bridge in the window server, pairing, scopes, replays, Claude connectors.
A Python 'browser' stands in for remote.html (same steps as its WebCrypto code). Everything runs on 127.0.0.1."""
import asyncio
import http.client
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest import mock
from urllib.parse import parse_qsl, urlsplit

from vanilla_agents.remote import seal

HAVE = seal.available()


@unittest.skipUnless(HAVE, "cryptography not installed")
class Sealing(unittest.TestCase):
    def test_round_trip_and_tamper(self):
        pc_sk, pc_pub = seal.new_keypair()
        dv_sk, dv_pub = seal.new_keypair()
        pair, dev = "P" * 22, seal.device_id(dv_pub)
        a, b = seal.keys(pc_sk, dv_pub, pair, dv_pub), seal.keys(dv_sk, pc_pub, pair, dv_pub)
        self.assertEqual(a, b)
        self.assertNotEqual(a["d2p"], a["p2d"])
        f = seal.seal(a["p2d"], {"x": "Grüße"}, pair, dev)
        self.assertEqual(seal.unseal(b["p2d"], f, pair, dev), {"x": "Grüße"})
        with self.assertRaises(ValueError):
            seal.unseal(b["d2p"], f, pair, dev)                    # the other direction's key
        with self.assertRaises(ValueError):
            seal.unseal(b["p2d"], f, pair, "x" * 16)               # another device's frame
        raw = bytearray(seal.b64d(f))
        raw[-1] ^= 1
        with self.assertRaises(ValueError):
            seal.unseal(b["p2d"], seal.b64e(bytes(raw)), pair, dev)
        s = os.urandom(32)
        self.assertTrue(seal.proof_ok(s, dv_pub, pair, seal.proof(s, dv_pub, pair)))
        self.assertFalse(seal.proof_ok(os.urandom(32), dv_pub, pair, seal.proof(s, dv_pub, pair)))


class RelayThread:
    """The relay on a free port in its own event loop; .seen collects every frame text it handled (to prove it sees no content)."""
    def __init__(self, data_dir=None):
        from vanilla_agents.remote import relay as rmod
        self.rmod = rmod
        self.relay = rmod.Relay(data_dir)
        self.seen = []
        orig = self.relay._frame

        async def spy(c, text):
            self.seen.append(text)
            await orig(c, text)
        self.relay._frame = spy
        self.loop = asyncio.new_event_loop()
        ready = threading.Event()

        async def boot():
            self.srv = await asyncio.start_server(self.relay.handle, "127.0.0.1", 0, limit=16384)
            self.port = self.srv.sockets[0].getsockname()[1]
            ready.set()
        threading.Thread(target=lambda: (self.loop.run_until_complete(boot()), self.loop.run_forever()), daemon=True).start()
        ready.wait(5)
        self.url = "ws://127.0.0.1:%d/ws" % self.port

    def close(self):
        async def down():
            self.srv.close()
            for t in [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]:
                t.cancel()
            await asyncio.sleep(0.05)
        asyncio.run_coroutine_threadsafe(down(), self.loop).result(5)
        self.loop.call_soon_threadsafe(self.loop.stop)
        time.sleep(0.05)
        self.loop.close()

    def http(self, method, path, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=40)
        c.request(method, path, body=body, headers={"Content-Type": "application/json"} if body else {})
        r = c.getresponse()
        out = r.status, r.read().decode("utf-8")
        c.close()
        return out


class Recv:
    """Reads a wsproto.Client in a thread into a queue."""
    def __init__(self, ws):
        import queue
        self.ws, self.q = ws, queue.Queue()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        from vanilla_agents.remote.wsproto import Closed
        try:
            while True:
                self.q.put(json.loads(self.ws.recv()))
        except (Closed, OSError, ValueError):
            self.q.put(None)

    def get(self, pred=lambda m: True, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            try:
                m = self.q.get(timeout=max(0.01, end - time.time()))
            except Exception:
                break
            if m is None:
                return None
            if pred(m):
                return m
        raise AssertionError("nothing arrived")


class Relay(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = RelayThread(self.tmp.name)

    def tearDown(self):
        self.r.close()
        self.tmp.cleanup()

    def ws(self):
        from vanilla_agents.remote.wsproto import Client
        c = Client(self.r.url)
        self.addCleanup(c.close)
        return c, Recv(c)

    def test_health_and_unknown(self):
        self.assertEqual(self.r.http("GET", "/healthz"), (200, "ok\n"))
        self.assertEqual(self.r.http("GET", "/nope")[0], 404)

    def test_pc_token_is_first_come_and_kept(self):
        pair = secrets.token_urlsafe(16)
        a, ar = self.ws()
        a.send(json.dumps({"t": "pc", "pair": pair, "token": "A" * 40}))
        self.assertEqual(ar.get()["t"], "ready")
        b, br = self.ws()
        b.send(json.dumps({"t": "pc", "pair": pair, "token": "B" * 40}))
        self.assertEqual(br.get()["t"], "error")
        self.assertTrue((self.tmp.name and os.path.isfile(os.path.join(self.tmp.name, "pairs.json"))))
        with open(os.path.join(self.tmp.name, "pairs.json")) as f:
            saved = f.read()
        self.assertNotIn("A" * 40, saved)                          # only the hash is kept

    def test_forwarding_and_no_spoofing(self):
        pair = secrets.token_urlsafe(16)
        pc, pr = self.ws()
        pc.send(json.dumps({"t": "pc", "pair": pair, "token": "T" * 40}))
        pr.get(lambda m: m["t"] == "ready")
        d1, r1 = self.ws()
        d1.send(json.dumps({"t": "dev", "pair": pair, "dev": "d" * 16}))
        self.assertEqual(r1.get(), {"t": "pc", "online": True})
        self.assertEqual(pr.get(lambda m: m["t"] == "join")["dev"], "d" * 16)
        d1.send(json.dumps({"t": "msg", "dev": "someone-else-xx", "data": "zz"}))
        self.assertEqual(pr.get(lambda m: m["t"] == "msg"), {"t": "msg", "dev": "d" * 16, "data": "zz"})     # the relay names the sender
        pc.send(json.dumps({"t": "msg", "dev": "d" * 16, "data": "yy"}))
        self.assertEqual(r1.get(lambda m: m["t"] == "msg"), {"t": "msg", "data": "yy"})
        d1.send(json.dumps({"t": "mcpres", "rid": "x", "body": "{}"}))         # a browser cannot answer for the PC
        pc.close()
        self.assertEqual(r1.get(lambda m: m["t"] == "pc"), {"t": "pc", "online": False})

    def test_bad_hello_closes(self):
        c, r = self.ws()
        c.send(json.dumps({"t": "dev", "pair": "short"}))
        self.assertEqual(r.get()["t"], "error")

    def test_connector_when_pc_is_off(self):
        st, body = self.r.http("POST", "/mcp/%s/%s" % ("p" * 22, "t" * 40), '{"jsonrpc":"2.0","id":1,"method":"ping"}')
        self.assertEqual(st, 503)
        self.assertIn("not running", body)
        self.assertEqual(self.r.http("GET", "/mcp/%s/%s" % ("p" * 22, "t" * 40))[0], 405)


class E2EBase(unittest.TestCase):
    """Window server + bridge + relay (each test class adds its own browser)."""
    def setUp(self):
        from vanilla_agents.app import server
        from vanilla_agents.app.config import load_all
        from vanilla_agents.events.feed import Feed
        self.tmp = tempfile.TemporaryDirectory()
        self.r = RelayThread()
        self.feed = os.path.join(self.tmp.name, "feed.jsonl")
        Feed(self.feed).append("task_created", task="q1", data={"title": "Secret project quest"})
        env = {"VANILLA_RELAY": self.r.url, "VANILLA_CONNECTOR_BASE": "http://127.0.0.1:%d/mcp/" % self.r.port, "VANILLA_REMOTE_PAGE": "https://example.test/live/"}
        cfg = load_all()
        cfg["app"]["approvals_path"] = os.path.join(self.tmp.name, "approvals.json")
        with mock.patch.dict(os.environ, env):
            self.ctx = server.Ctx(cfg, self.feed, None, assets_dir=self.tmp.name, settings_file=os.path.join(self.tmp.name, "s.json"), watch=False)
        self.ctx.cfg["app"]["remote"]["event_min_seconds"] = 0.05
        self.ctx.remote.event_min = 0.05
        self.srv = server.make_server(self.ctx, "127.0.0.1", 0)
        self.ctx.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.ctx.stop.set()
        self.ctx.remote.stop()
        self.srv.shutdown()
        self.srv.server_close()
        self.r.close()
        self.tmp.cleanup()

    def post(self, body, key=True):
        c = http.client.HTTPConnection("127.0.0.1", self.ctx.port, timeout=10)
        c.request("POST", "/api/remote", json.dumps(body), {"Content-Type": "application/json", **({"X-Vanilla-Key": self.ctx.key} if key else {})})
        r = c.getresponse()
        out = r.status, json.loads(r.read())
        c.close()
        return out

    def get(self, path):
        c = http.client.HTTPConnection("127.0.0.1", self.ctx.port, timeout=10)
        c.request("GET", path)
        r = c.getresponse()
        out = r.status, r.read().decode("utf-8")
        c.close()
        return out

    def turn_on(self):
        st, d = self.post({"enabled": True})
        self.assertEqual(st, 200)
        end = time.time() + 5
        while time.time() < end and not self.ctx.remote.status()["online"]:
            time.sleep(0.02)
        self.assertTrue(self.ctx.remote.status()["online"], self.ctx.remote.status())

    def browser(self, scope="watch", name="My laptop"):
        st, d = self.post({"invite": scope})
        self.assertEqual(st, 200, d)
        frag = dict(parse_qsl(urlsplit(d["link"]).fragment))
        self.assertTrue(d["link"].startswith("https://example.test/live/#"))
        return Browser(frag, name, self)



@unittest.skipUnless(HAVE, "cryptography not installed")
class EndToEnd(E2EBase):
    """With a Python browser."""
    def test_off_by_default_and_needs_the_key(self):
        st, body = self.get("/api/remote")
        self.assertEqual(st, 200)
        self.assertFalse(json.loads(body)["enabled"])
        self.assertEqual(self.post({"enabled": True}, key=False)[0], 403)
        self.assertEqual(self.post({"invite": "watch"})[0], 400)               # off: no links

    def test_watch_sees_live_state_but_cannot_press(self):
        self.turn_on()
        b = self.browser("watch")
        self.assertEqual(b.pair(), {"k": "paired", "scope": "watch", "name": "My laptop"})
        w = b.hello()
        self.assertEqual(w["scope"], "watch")
        st = b.req("GET", "/api/state")
        self.assertEqual(st["status"], 200)
        self.assertIn("Secret project quest", json.dumps(st["body"]))
        self.assertEqual(b.req("POST", "/api/approve", {"task": "q1"})["status"], 403)
        self.assertEqual(b.req("GET", "/api/config")["status"], 403)
        self.assertEqual(b.req("GET", "/api/diff")["status"], 403)
        b.sub()
        first = b.next_kind("state")
        self.assertIn("tasks", first["state"])
        from vanilla_agents.events.feed import Feed
        Feed(self.feed).append("task_created", task="q2", data={"title": "Second quest arrives live"})
        self.ctx.state.refresh()
        self.ctx.gen += 1
        live = b.next_kind("state", lambda m: "Second quest arrives live" in json.dumps(m))
        self.assertTrue(live)
        devs = json.loads(self.get("/api/remote")[1])["devices"]
        self.assertEqual([(x["name"], x["scope"]) for x in devs], [("My laptop", "watch")])
        # the relay saw sealed bytes only
        everything = "\n".join(self.r.seen)
        for word in ("Secret project quest", "Second quest arrives live", "My laptop", "/api/state", self.ctx.key):
            self.assertNotIn(word, everything)

    def test_respond_can_approve_and_shows_as_browser(self):
        self.turn_on()
        b = self.browser("respond")
        self.assertEqual(b.pair()["scope"], "respond")
        b.hello()
        res = b.req("POST", "/api/approve", {"task": "q1"})
        self.assertEqual(res["status"], 200, res)
        q = next(t for t in res["body"]["tasks"] if t["id"] == "q1")
        self.assertEqual((q["approved"], q["approved_by"]), (True, "you (browser)"))
        self.assertEqual(b.req("POST", "/api/whisper", {"agent": "x", "text": "hi"})["status"], 403)      # not one of the three buttons

    def test_invite_is_single_use_and_expires(self):
        self.turn_on()
        b = self.browser()
        self.assertEqual(b.pair()["k"], "paired")
        b2 = Browser(b.frag, "Thief", self)                     # same link, another browser
        self.assertEqual(b2.pair(), {"k": "refused"})
        b3 = self.browser()
        self.ctx.remote.store.clock = lambda: time.time() + 3600
        self.assertEqual(b3.pair(), {"k": "refused"})

    def test_replay_and_revoke(self):
        self.turn_on()
        b = self.browser("respond")
        b.pair()
        b.hello()
        self.assertEqual(b.req("GET", "/api/state")["status"], 200)
        old = b.last_sent
        b.ws.send(old)                                           # the relay replays a frame: ignored (n not growing)
        with self.assertRaises(AssertionError):
            b.next_kind("res", timeout=0.6)
        b.hello()                                                # new session, new challenge
        b.ws.send(old)                                           # an old session's frame: ignored
        with self.assertRaises(AssertionError):
            b.next_kind("res", timeout=0.6)
        did = seal.device_id(b.pub)
        self.assertEqual(self.post({"revoke": did})[0], 200)
        self.assertEqual(json.loads(self.get("/api/remote")[1])["devices"], [])

    def test_connector_runs_agent_tools_only(self):
        self.turn_on()
        st, d = self.post({"connector": "Claude web"})
        self.assertEqual(st, 200)
        path = urlsplit(d["url"]).path
        self.assertNotIn("url", json.loads(self.get("/api/remote")[1]))
        self.assertNotIn(path.rsplit("/", 1)[1], self.get("/api/remote")[1])      # the token is shown once, not listed
        call = lambda m: self.r.http("POST", path, json.dumps(m))
        st, body = call({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(body)["result"]["serverInfo"]["name"], "vanilla-agents")
        self.assertEqual(call({"jsonrpc": "2.0", "method": "notifications/initialized"})[0], 202)
        names = [t["name"] for t in json.loads(call({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})[1])["result"]["tools"]]
        self.assertIn("start_quest", names)
        self.assertNotIn("approve", names)
        st, body = call({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "start_quest", "arguments": {"title": "Fix the login page"}}})
        self.assertEqual(st, 200, body)
        from vanilla_agents.events.feed import Feed
        evs = [e for e in Feed(self.feed).read_since(0, 100) if e.type == "task_created"]
        self.assertEqual(evs[-1].agent, "claude-web")                    # the connector's own hero name
        bad = path.rsplit("/", 1)[0] + "/" + "x" * 30
        st, body = self.r.http("POST", bad, json.dumps({"jsonrpc": "2.0", "id": 4, "method": "tools/list"}))
        self.assertEqual(st, 404)
        cid = json.loads(self.get("/api/remote")[1])["connectors"][0]["id"]
        self.assertEqual(self.post({"drop_connector": cid})[0], 200)
        self.assertEqual(call({"jsonrpc": "2.0", "id": 5, "method": "tools/list"})[0], 404)

    def test_secrets_never_in_status(self):
        self.turn_on()
        self.browser()
        body = self.get("/api/remote")[1]
        d = self.ctx.remote.store.d
        for s in (d["token"], d["sk"]):
            self.assertNotIn(s, body)
        self.assertEqual(oct(os.stat(self.ctx.remote.store.path).st_mode & 0o777), "0o600") if os.name == "posix" else None


@unittest.skipUnless(HAVE and shutil.which("node"), "needs cryptography and node")
class WebCryptoBrowser(E2EBase):
    """The real page code (app/web/js/remote-core.js, WebCrypto) against the Python side: both seal the same way."""
    def test_page_code_pairs_reads_and_is_limited(self):
        self.turn_on()
        for scope, approve in (("watch", 403), ("respond", 200)):
            st, d = self.post({"invite": scope})
            frag = urlsplit(d["link"]).fragment
            js = os.path.join(os.path.dirname(__file__), "js", "remote_browser.mjs")
            p = subprocess.run(["node", js, frag], capture_output=True, text=True, timeout=60)
            self.assertEqual(p.returncode, 0, p.stderr)
            got = json.loads(p.stdout.strip().splitlines()[-1])
            self.assertEqual(got["paired"], {"scope": scope, "name": "Node browser"})
            self.assertEqual(got["welcome"]["scope"], scope)
            self.assertEqual(got["state_status"], 200)
            self.assertIn("Secret project quest", got["titles"])
            self.assertTrue(got["pushed"])
            self.assertEqual(got["approve"], approve)
            self.assertEqual(got["config"], 403)
        self.assertNotIn("Secret project quest", "\n".join(self.r.seen))


class Browser:
    """What remote.html does, in Python."""
    def __init__(self, frag, name, test):
        from vanilla_agents.remote.wsproto import Client
        self.frag, self.name = frag, name
        self.pair_id, self.pc_pub, self.secret = frag["p"], seal.b64d(frag["k"]), seal.b64d(frag["s"])
        self.sk, self.pub = seal.new_keypair()
        self.dev = seal.device_id(self.pub)
        self.keys = seal.keys(self.sk, self.pc_pub, self.pair_id, self.pub)
        self.ws = Client(frag["r"])
        test.addCleanup(self.ws.close)
        self.r = Recv(self.ws)
        self.ws.send(json.dumps({"t": "dev", "pair": self.pair_id, "dev": self.dev}))
        self.r.get(lambda m: m["t"] == "pc")
        self.ch, self.n, self.rid, self.last_sent = None, 0, 0, None

    def _open(self, m):
        return seal.unseal(self.keys["p2d"], m["data"], self.pair_id, self.dev)

    def next_kind(self, kind, pred=lambda m: True, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            m = self.r.get(lambda m: m["t"] == "msg", timeout=max(0.05, end - time.time()))
            o = self._open(m)
            if o.get("k") == kind and pred(o):
                return o
        raise AssertionError("no %s" % kind)

    def send(self, obj):
        self.last_sent = json.dumps({"t": "msg", "data": seal.seal(self.keys["d2p"], obj, self.pair_id, self.dev)})
        self.ws.send(self.last_sent)

    def pair(self):
        self.ws.send(json.dumps({"t": "pair", "pub": seal.b64e(self.pub), "proof": seal.proof(self.secret, self.pub, self.pair_id),
                                 "data": seal.seal(self.keys["d2p"], {"name": self.name}, self.pair_id, self.dev)}))
        m = self.r.get(lambda m: m["t"] == "msg", timeout=3)
        o = self._open(m)
        return {k: v for k, v in o.items() if k not in ("sid", "n")}

    def hello(self):
        self.send({"k": "hello", "sid": secrets.token_urlsafe(12)})
        w = self.next_kind("welcome")
        self.ch, self.n = w["ch"], 0
        return w

    def req(self, method, path, body=None):
        self.n += 1
        self.rid += 1
        self.send({"k": "req", "ch": self.ch, "n": self.n, "id": self.rid, "method": method, "path": path, "body": body})
        return self.next_kind("res", lambda o: o["id"] == self.rid)

    def sub(self):
        self.n += 1
        self.send({"k": "sub", "ch": self.ch, "n": self.n})


class Page(unittest.TestCase):
    def test_static_and_strict(self):
        from vanilla_agents.app.config import ROOT
        web = ROOT / "app" / "web"
        html = (web / "remote.html").read_text(encoding="utf-8")
        self.assertIn("Content-Security-Policy", html)
        self.assertIn("script-src 'self'", html)
        self.assertNotRegex(html, r"<script>(?!</script>)")                     # no inline script
        js = (web / "js" / "remote.js").read_text(encoding="utf-8")
        self.assertNotIn("innerHTML", js)                                      # text from the PC is never parsed as HTML
        self.assertIn("history.replaceState", js)                               # the secret leaves the address bar
        core = (web / "js" / "remote-core.js").read_text(encoding="utf-8")
        self.assertIn("generateKey({ name: 'X25519' }, false", core)           # the private key cannot be exported


if __name__ == "__main__":
    unittest.main()
