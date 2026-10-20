"""V-054: Options > Browser access. Switch it on/off, make a pairing link (QR), list and remove paired browsers, make and remove
Claude connector addresses. Saved: on/off in your settings file (group "remote"); keys and devices in remote.json beside it.

GET  /api/remote  -> status WITHOUT secrets (no keys, no tokens, no links)
POST /api/remote  -> one of {"enabled": bool} | {"invite": "watch"|"respond"} | {"revoke": id} | {"connector": name} | {"drop_connector": id}
A pairing link and a connector address are shown once, in the answer to the POST that made them; neither is kept readable later.
"""
from urllib.parse import urlencode

from . import settings as settings_mod
from ..remote import seal
from ..remote.store import SCOPES, Store, path_for


def enabled(settings_file):
    return settings_mod.load_extra(settings_file, "remote").get("enabled") is True


def set_enabled(settings_file, on):
    if not isinstance(on, bool):
        raise ValueError("enabled must be true or false")
    settings_mod.save_extra(settings_file, "remote", {"enabled": on})


class RemoteCtl:
    def __init__(self, ctx, env):
        self.ctx = ctx
        rc = ctx.cfg["app"]["remote"]
        self.relay = env.get("VANILLA_RELAY") or rc["relay_url"]
        self.connector_base = env.get("VANILLA_CONNECTOR_BASE") or rc["connector_base"]
        self.page = env.get("VANILLA_REMOTE_PAGE") or rc["page_url"]
        self.minutes, self.event_min = rc["invite_minutes"], rc["event_min_seconds"]
        self.store = Store(path_for(ctx.settings_file))
        self.bridge, self.error, self._tools = None, "", None

    def _tools_once(self):
        if self._tools is None:
            from ..mcp import Tools
            self._tools = Tools(self.ctx.cfg, self.ctx.feed_path)
        return self._tools

    def start(self):
        if self.bridge is not None:
            return
        if not seal.available():
            self.error = "Browser access needs the Python package 'cryptography' (run setup again, or: py -m pip install cryptography)."
            return
        from ..remote.bridge import Bridge
        self.error = ""
        self.bridge = Bridge(self.store, self.relay, self.ctx.port, self.ctx.key, tools=self._tools_once, event_min=self.event_min,
                             log=lambda s: self.ctx.state.say(s) if hasattr(self.ctx.state, "say") else None)
        self.bridge.start()

    def stop(self):
        b, self.bridge = self.bridge, None
        if b:
            b.stop()

    def status(self):
        on = enabled(self.ctx.settings_file)
        st = self.bridge.status() if self.bridge else {"online": False, "error": ""}
        return {"enabled": on, "available": seal.available(), "online": bool(on and st["online"]), "error": (self.error or st["error"]) if on else "",
                "relay": self.relay, "devices": self.store.devices(), "connectors": self.store.connectors()}

    def action(self, body):
        if "enabled" in body:
            set_enabled(self.ctx.settings_file, body["enabled"])
            self.start() if body["enabled"] else self.stop()
            return self.status()
        if not seal.available():
            raise ValueError("Browser access needs the Python package 'cryptography'.")
        if "invite" in body:
            if body["invite"] not in SCOPES:
                raise ValueError("invite must be watch or respond")
            if not enabled(self.ctx.settings_file):
                raise ValueError("switch Browser access on first")
            secret = self.store.invite(body["invite"], self.minutes)
            frag = urlencode({"r": self.relay, "p": self.store.pair, "k": seal.b64e(self.store.pub()), "s": seal.b64e(secret)})
            return dict(self.status(), link=self.page + "#" + frag, minutes=self.minutes)
        if "revoke" in body:
            if not isinstance(body["revoke"], str) or not self.store.revoke(body["revoke"]):
                raise ValueError("no such browser")
            if self.bridge:
                self.bridge.kick(body["revoke"])
            return self.status()
        if "connector" in body:
            if not isinstance(body["connector"], str):
                raise ValueError("connector must be a name")
            tok = self.store.add_connector(body["connector"])
            return dict(self.status(), url=self.connector_base + self.store.pair + "/" + tok)
        if "drop_connector" in body:
            if not isinstance(body["drop_connector"], str) or not self.store.drop_connector(body["drop_connector"]):
                raise ValueError("no such connector")
            return self.status()
        raise ValueError("nothing to do")
