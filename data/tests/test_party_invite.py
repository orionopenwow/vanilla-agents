"""Party invites made easy (V-053): the invite link opens a page with one Join button, which hands the link to the friend's own
Vanilla Agents (GET /join); the window then asks before anything is joined. The host sees one link per way in (Wi-Fi, Tailscale),
and the name boxes start from a sensible default."""
import os
import tempfile
import unittest
import urllib.request
from unittest import mock

from vanilla_agents.app.config import load_all
from vanilla_agents.party import client as pc
from vanilla_agents.party import hub


class InvitePage(unittest.TestCase):
    def test_page_escapes_and_points_at_the_local_window(self):
        page = hub.invite_page("<b>Raid</b> & co", "http://192.168.1.5:8940/party?t=abc")
        self.assertIn("&lt;b&gt;Raid&lt;/b&gt; &amp; co", page)
        self.assertNotIn("<b>Raid", page)
        self.assertIn("http://127.0.0.1:8766/join?invite=http%3A%2F%2F192.168.1.5%3A8940%2Fparty%3Ft%3Dabc", page)
        self.assertIn("Join in Vanilla Agents", page)

    def test_hub_serves_html_to_browsers_and_json_to_programs(self):
        p = hub.Party(None, "Raid night")
        srv = hub.serve(p, "127.0.0.1", 0)
        try:
            port = srv.server_address[1]
            url = "http://127.0.0.1:%d/party?t=%s" % (port, p.d["invite"])
            req = urllib.request.Request(url, headers={"Accept": "text/html,application/xhtml+xml"})
            with urllib.request.urlopen(req, timeout=5) as r:
                body = r.read().decode()
                self.assertIn("text/html", r.headers["Content-Type"])
                self.assertIn("default-src 'none'", r.headers["Content-Security-Policy"])
            self.assertIn("Raid night", body)
            with urllib.request.urlopen(url, timeout=5) as r:
                self.assertEqual(r.headers["Content-Type"], "application/json")
        finally:
            srv.shutdown()

    def test_vpn_addresses_are_tailscale_only(self):
        infos = [(2, 1, 6, "", (ip, 0)) for ip in ("192.168.1.5", "100.101.102.103", "10.0.0.2", "100.128.0.1")]
        with mock.patch("socket.getaddrinfo", return_value=infos):
            self.assertEqual(hub.vpn_addresses(), ["100.101.102.103"])


class Offer(unittest.TestCase):
    def test_offer_asks_first_then_join_clears_it(self):
        cfg = load_all()
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "ann")), os.makedirs(os.path.join(d, "bo"))
            mk = lambda who: pc.PartyClient(os.path.join(d, who), os.path.join(d, who, "feed.jsonl"), cfg, period=999)
            ann, bo = mk("ann"), mk("bo")
            try:
                link = ann.host("Raid night", "Ann", port=0, network=False, hours=3)
                with self.assertRaises(pc.PartyError):
                    bo.offer("not a link")
                v0 = bo.version
                bo.offer(link)
                self.assertGreater(bo.version, v0)
                self.assertFalse(bo.joined, "nothing is joined from the browser")
                pend = bo.view()["pending"]
                self.assertEqual(pend["party"], "Raid night")
                self.assertEqual(pend["invite"], link)
                bo.join(pend["invite"], "Bo")
                self.assertIsNone(bo.view()["pending"])
                with self.assertRaises(pc.PartyError):
                    bo.offer(link)          # already in a party
                kinds = [x["kind"] for x in ann.view()["invites"]]
                self.assertEqual(kinds, ["lan"], "a party on this PC only offers no VPN link")
            finally:
                bo.leave()
                ann.leave()

    def test_host_lists_a_tailscale_link_when_this_pc_has_one(self):
        cfg = load_all()
        with tempfile.TemporaryDirectory() as d:
            ann = pc.PartyClient(d, os.path.join(d, "feed.jsonl"), cfg, period=999)
            ann.m = {"invite": "http://192.168.1.5:8940/party?t=tok", "host_bind": "0.0.0.0"}
            with mock.patch.object(hub, "vpn_addresses", return_value=["100.90.1.2"]):
                self.assertEqual(ann.invites(), [{"kind": "lan", "url": "http://192.168.1.5:8940/party?t=tok"},
                                                 {"kind": "vpn", "url": "http://100.90.1.2:8940/party?t=tok"}])

    def test_default_name_is_short(self):
        pc.default_name.cache_clear()
        n = pc.default_name()
        self.assertIsInstance(n, str)
        self.assertLessEqual(len(n), 32)
        self.assertNotIn(" ", n)


if __name__ == "__main__":
    unittest.main()
