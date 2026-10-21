"""V-055 scripts/va.py: a Claude in a linked cloud session (or any shell on this PC) joins the inn through the feed."""
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import va  # noqa: E402


class VaCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_finds_the_feed_on_this_pc_and_in_a_linked_session(self):
        with mock.patch.dict(os.environ, {"VANILLA_FEED": "/x/feed.jsonl"}):
            self.assertEqual(va.find_feed(), "/x/feed.jsonl")
        env = {}
        home = os.path.join(self.t, "home")
        os.makedirs(os.path.join(home, ".vanilla-agents", "work"))
        self.assertEqual(va.find_feed(env, home=home, here=os.path.join(self.t, "x", "y")), os.path.join(home, ".vanilla-agents", "feed.jsonl"))
        mnt = os.path.join(self.t, "mnt")      # a linked session: the PC's folders side by side
        os.makedirs(os.path.join(mnt, ".vanilla-agents", "work"))
        here = os.path.join(mnt, "vanilla-agents", "data", "scripts")
        os.makedirs(here)
        self.assertEqual(va.find_feed(env, home=home, here=here), os.path.join(mnt, ".vanilla-agents", "feed.jsonl"), "the mounted PC folder wins over the shell's own home")
        os.makedirs(os.path.join(self.t, "empty", ".vanilla-agents"))
        self.assertIsNone(va.find_feed(env, home=os.path.join(self.t, "empty"), here=os.path.join(self.t, "e", "a", "b")), "an empty folder is not the program's")
        self.assertIsNone(va.find_feed(env, home=os.path.join(self.t, "nohome"), here=os.path.join(self.t, "elsewhere", "a", "b")))

    def test_one_name_per_shell(self):
        a, b = va.default_name(self.t), va.default_name(self.t)
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("Cloud Claude "))

    def test_hello_quest_bye_write_the_feed(self):
        feed = os.path.join(self.t, "feed.jsonl")
        out = io.StringIO()
        for argv in (["hello", "Looking around"], ["quest", "Fix the loot window", "--why", "it covers the hero"], ["bye"]):
            self.assertEqual(va.main(["--feed", feed, "--name", "Cloud Claude ab12"] + argv, out=out), 0)
        with open(feed) as f:
            evs = [json.loads(l) for l in f]
        self.assertEqual([e["type"] for e in evs], ["agent_started", "agent_working", "task_created", "quest_claimed", "agent_idle"])
        self.assertTrue(all(e["agent"] == "Cloud Claude ab12" for e in evs))
        self.assertEqual(evs[2]["data"]["why"], "it covers the hero")

    def test_says_how_to_fix_a_missing_folder(self):
        out = io.StringIO()
        with mock.patch.object(va, "find_feed", return_value=None):
            self.assertEqual(va.main(["hello", "x"], out=out), 1)
        self.assertIn(".vanilla-agents", out.getvalue())


if __name__ == "__main__":
    unittest.main()
