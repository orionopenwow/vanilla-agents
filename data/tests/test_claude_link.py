"""V-055 Connect Claude: status from files only, one-click connect of Claude Code (hooks + tools) and the desktop app, "elsewhere"
(another copy) detection, Start Claude Code here, and the owner-only /api/claude calls."""
import http.client
import json
import os
import tempfile
import threading
import unittest
from types import SimpleNamespace

from vanilla_agents.app.claude_link import ClaudeLink


class Fake:
    def __init__(self):
        self.ran, self.opened = [], []

    def run(self, argv, **kw):
        self.ran.append(argv)
        return SimpleNamespace(returncode=0, stdout="Added", stderr="")

    def runner(self, argv, cwd):
        self.opened.append((argv, cwd))


def link(tmp, claude=True, platform="win32", desktop_dir=True):
    f = Fake()
    desk = os.path.join(tmp, "AppData", "Claude", "claude_desktop_config.json")
    if desktop_dir:
        os.makedirs(os.path.dirname(desk), exist_ok=True)
    which = (lambda n: os.path.join(tmp, "bin", n) if n == "claude" and claude else None)
    return ClaudeLink(home=tmp, desktop_config=desk, which=which, run=f.run, platform=platform, runner=f.runner), f


class ClaudeLinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_nothing_connected_at_first(self):
        cl, _ = link(self.t)
        s = cl.status()
        self.assertEqual((s["code"]["hooks"], s["code"]["tools"], s["desktop"]["tools"]), ("off", "off", "off"))
        self.assertTrue(s["code"]["installed"])
        self.assertTrue(s["desktop"]["installed"])
        self.assertEqual(s["web"], {"enabled": False, "online": False, "connectors": 0})

    def test_connect_claude_code_adds_hooks_and_tools(self):
        cl, f = link(self.t)
        os.makedirs(os.path.join(self.t, ".claude"))
        with open(os.path.join(self.t, ".claude", "settings.json"), "w") as fh:
            json.dump({"theme": "dark", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine.sh"}]}]}}, fh)
        r = cl.connect_code()
        self.assertTrue(r["ok"])
        with open(os.path.join(self.t, ".claude", "settings.json")) as fh:
            s = json.load(fh)
        self.assertEqual(s["theme"], "dark", "everything else is kept")
        self.assertIn("mine.sh", json.dumps(s["hooks"]["Stop"]))
        self.assertEqual(cl.status()["code"]["hooks"], "on")
        self.assertEqual(f.ran[-1][:4], ["claude", "mcp", "add", "--scope"])
        self.assertTrue([n for n in os.listdir(os.path.join(self.t, ".claude")) if n.startswith("settings.json.bak-")], "a backup is kept")

    def test_tools_read_from_claude_json_and_other_copies_are_spotted(self):
        cl, _ = link(self.t)
        cl.connect_code()
        with open(os.path.join(self.t, ".claude.json"), "w") as fh:
            json.dump({"mcpServers": {"vanilla-agents": {"command": "py", "args": [cl.mcp_mod.SERVER]}}}, fh)
        self.assertEqual(cl.status()["code"]["tools"], "on")
        with open(os.path.join(self.t, ".claude.json"), "w") as fh:
            json.dump({"mcpServers": {"vanilla-agents": {"command": "py", "args": [os.path.join(self.t, "old", "vanilla_mcp.py")]}}}, fh)
        self.assertEqual(cl.status()["code"]["tools"], "elsewhere")
        with open(os.path.join(self.t, ".claude", "settings.json"), "w") as fh:
            json.dump({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "py C:/old/scripts/claude_hook.py"}]}]}}, fh)
        self.assertEqual(cl.status()["code"]["hooks"], "elsewhere")

    def test_without_claude_code_the_hooks_still_go_in(self):
        cl, f = link(self.t, claude=False)
        self.assertFalse(cl.status()["code"]["installed"])
        cl.connect_code()
        self.assertEqual(cl.status()["code"]["hooks"], "on")
        self.assertEqual(f.ran, [], "no claude command is run")

    def test_desktop_connect_and_disconnect(self):
        cl, _ = link(self.t)
        cl.connect_desktop()
        self.assertEqual(cl.status()["desktop"]["tools"], "on")
        cl.disconnect("desktop")
        self.assertEqual(cl.status()["desktop"]["tools"], "off")
        cl2, _ = link(os.path.join(self.t, "nobody"), desktop_dir=False)
        self.assertFalse(cl2.status()["desktop"]["installed"])

    def test_desktop_bad_json_is_left_alone(self):
        cl, _ = link(self.t)
        with open(cl.desktop, "w") as fh:
            fh.write("{ not json")
        with self.assertRaises(RuntimeError):
            cl.connect_desktop()
        with open(cl.desktop) as fh:
            self.assertEqual(fh.read(), "{ not json")

    def test_sessions_seen_come_from_the_snapshot(self):
        cl, _ = link(self.t)
        snap = {"agents": [{"id": "a", "session": "abc", "seen": 100}, {"id": "demo", "seen": 999}], "departed": [{"id": "b", "session": "d", "seen": 200}]}
        c = cl.status(snap)["code"]
        self.assertEqual((c["sessions"], c["last_seen"]), (2, 200))

    def test_web_line_from_browser_access(self):
        cl, _ = link(self.t)
        self.assertEqual(cl.status(remote={"enabled": True, "online": False, "connectors": [{"id": "x"}]})["web"], {"enabled": True, "online": False, "connectors": 1})

    def test_start_claude_code_in_the_project(self):
        cl, f = link(self.t)
        proj = os.path.join(self.t, "proj")
        os.makedirs(proj)
        r = cl.start(proj)
        self.assertTrue(r["ok"], r)
        argv, cwd = f.opened[0]
        self.assertEqual(argv[:6], ["cmd", "/c", "start", "", "cmd", "/k"])
        self.assertEqual(argv[6], os.path.abspath(os.path.join(self.t, "bin", "claude")), "the full path, never a claude.bat in the folder")
        self.assertEqual(cwd, proj)
        self.assertIn('cd /d "%s" && claude' % proj, r["command"])

    def test_start_says_why_not(self):
        cl, f = link(self.t)
        self.assertFalse(cl.start(None)["ok"])
        self.assertFalse(cl.start(os.path.join(self.t, "gone"))["ok"])
        nocl, _ = link(self.t, claude=False)
        os.makedirs(os.path.join(self.t, "p"))
        r = nocl.start(os.path.join(self.t, "p"))
        self.assertFalse(r["ok"])
        self.assertIn("not installed", r["error"])
        planted = os.path.join(self.t, "bin")
        os.makedirs(planted)
        r = cl.start(self.t)                 # the claude found sits inside the folder
        self.assertFalse(r["ok"])
        self.assertEqual(f.opened, [])

    def test_unknown_requests_are_refused(self):
        cl, _ = link(self.t)
        with self.assertRaises(ValueError):
            cl.action({"connect": "web"})
        with self.assertRaises(ValueError):
            cl.disconnect("everything")


class ApiTests(unittest.TestCase):
    def setUp(self):
        from vanilla_agents.app import server
        from vanilla_agents.app.config import load_all
        self.tmp = tempfile.TemporaryDirectory()
        cfg = load_all()
        cfg["app"]["approvals_path"] = os.path.join(self.tmp.name, "approvals.json")
        feed = os.path.join(self.tmp.name, "feed.jsonl")
        open(feed, "w").close()
        self.ctx = server.Ctx(cfg, feed, None, assets_dir=self.tmp.name, settings_file=os.path.join(self.tmp.name, "s.json"), watch=False)
        self.ctx.claude, self.fake = link(self.tmp.name)
        self.srv = server.make_server(self.ctx, "127.0.0.1", 0)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.ctx.stop.set()
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def call(self, method, body=None, key=True):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, "/api/claude", json.dumps(body) if body is not None else None,
                  {"Content-Type": "application/json", **({"X-Vanilla-Key": self.ctx.key} if key else {})})
        r = c.getresponse()
        out = r.status, json.loads(r.read())
        c.close()
        return out

    def test_get_then_connect_with_the_key_only(self):
        st, s = self.call("GET")
        self.assertEqual(st, 200)
        self.assertEqual(s["code"]["hooks"], "off")
        self.assertEqual(self.call("POST", {"connect": "code"}, key=False)[0], 403)
        st, r = self.call("POST", {"connect": "code"})
        self.assertEqual(st, 200, r)
        self.assertEqual(r["status"]["code"]["hooks"], "on")
        st, r = self.call("POST", {"start": True})
        self.assertFalse(r["ok"], "no project open: says so instead of opening a terminal")
        self.assertEqual(self.fake.opened, [])


if __name__ == "__main__":
    unittest.main()
