"""Browser access state on this PC (V-054): remote.json next to your settings file (never the repository, readable only by you).

    pair        this PC's pair id at the relay (random, 22 characters)
    token       proves to the relay that this PC owns the pair (random; the relay keeps only its sha256)
    sk          this PC's X25519 private key (b64url)
    devices     paired browsers: id -> {pub, name, scope "watch"|"respond", added, seen}
    connectors  Claude connector addresses: id -> {h: sha256 of the secret part, name, agent, added, used}

Invites (pairing links) live only in memory and end after app.json remote.invite_minutes or their first use.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time
from pathlib import Path

from . import seal

SCOPES = ("watch", "respond")
NAME = re.compile(r"^[^\x00-\x1f<>]{1,40}$")
MAX_DEVICES, MAX_CONNECTORS = 16, 16


def path_for(settings_file):
    return Path(settings_file).expanduser().with_name("remote.json")


def clean_name(name, fallback):
    name = (name or "").strip()[:40]
    return name if NAME.match(name or "-") and name else fallback


class Store:
    def __init__(self, path, clock=time.time):
        self.path, self.clock, self.lock = Path(path), clock, threading.RLock()
        self.invites = {}           # secret bytes -> {"scope", "until"}
        self.d = self._load()

    def _load(self):
        try:
            d = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(d, dict) and isinstance(d.get("pair"), str) and isinstance(d.get("token"), str) and isinstance(d.get("sk"), str):
                d.setdefault("devices", {})
                d.setdefault("connectors", {})
                return d
        except (OSError, ValueError):
            pass
        return None

    def ensure(self):
        """Make the pair id, token and key the first time (needs `cryptography`)."""
        with self.lock:
            if self.d is None:
                sk, _ = seal.new_keypair()
                self.d = {"pair": secrets.token_urlsafe(16), "token": secrets.token_urlsafe(32), "sk": seal.b64e(sk), "devices": {}, "connectors": {}}
                self.save()
            return self.d

    def save(self):
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), prefix=".remote")
            try:
                os.chmod(tmp, 0o600)
            except OSError:
                pass
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self.d, f, indent=1)
            os.replace(tmp, self.path)

    # ---- keys ----
    @property
    def pair(self):
        return self.ensure()["pair"]

    def sk(self):
        return seal.b64d(self.ensure()["sk"])

    def pub(self):
        return seal.public_of(self.sk())

    # ---- invites and devices ----
    def invite(self, scope, minutes):
        if scope not in SCOPES:
            raise ValueError("scope must be watch or respond")
        s = secrets.token_bytes(32)
        with self.lock:
            now = self.clock()
            self.invites = {k: v for k, v in self.invites.items() if v["until"] > now}
            self.invites[s] = {"scope": scope, "until": now + minutes * 60}
        return s

    def accept(self, dev_pub_raw, proof, name):
        """A browser's pairing request. Returns the new device dict, or None (no live invite matches). Uses up the invite."""
        if len(dev_pub_raw) != 32:
            return None
        with self.lock:
            now = self.clock()
            for s, inv in list(self.invites.items()):
                if inv["until"] > now and seal.proof_ok(s, dev_pub_raw, self.pair, proof):
                    del self.invites[s]
                    devs = self.ensure()["devices"]
                    if len(devs) >= MAX_DEVICES:
                        return None
                    did = seal.device_id(dev_pub_raw)
                    devs[did] = {"pub": seal.b64e(dev_pub_raw), "name": clean_name(name, "Browser"), "scope": inv["scope"], "added": int(now), "seen": int(now)}
                    self.save()
                    return dict(devs[did], id=did)
        return None

    def device(self, did):
        with self.lock:
            d = (self.d or {}).get("devices", {}).get(did)
            return dict(d, id=did) if d else None

    def seen(self, did):
        with self.lock:
            d = (self.d or {}).get("devices", {}).get(did)
            if d and self.clock() - d.get("seen", 0) > 300:
                d["seen"] = int(self.clock())
                self.save()

    def revoke(self, did):
        with self.lock:
            if self.d and self.d["devices"].pop(did, None) is not None:
                self.save()
                return True
        return False

    def devices(self):
        with self.lock:
            return [{"id": k, "name": v["name"], "scope": v["scope"], "added": v["added"], "seen": v.get("seen")} for k, v in sorted((self.d or {}).get("devices", {}).items(), key=lambda kv: kv[1]["added"])]

    # ---- Claude connectors ----
    def add_connector(self, name):
        with self.lock:
            cons = self.ensure()["connectors"]
            if len(cons) >= MAX_CONNECTORS:
                raise ValueError("at most %d connectors" % MAX_CONNECTORS)
            name = clean_name(name, "Claude")
            cid, secret = secrets.token_urlsafe(6), secrets.token_urlsafe(24)
            agent = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24] or "claude"
            cons[cid] = {"h": hashlib.sha256(secret.encode()).hexdigest(), "name": name, "agent": agent, "added": int(self.clock())}
            self.save()
            return cid + secret       # the address part: 8 characters of id, then the secret

    def connector(self, tok):
        """The connector for an address token, or None. Constant-time compare of the secret part."""
        if not isinstance(tok, str) or len(tok) < 9:
            return None
        with self.lock:
            c = (self.d or {}).get("connectors", {}).get(tok[:8])
            if c and hmac.compare_digest(c["h"], hashlib.sha256(tok[8:].encode()).hexdigest()):
                if self.clock() - c.get("used", 0) > 300:
                    c["used"] = int(self.clock())
                    self.save()
                return dict(c, id=tok[:8])
        return None

    def drop_connector(self, cid):
        with self.lock:
            if self.d and self.d["connectors"].pop(cid, None) is not None:
                self.save()
                return True
        return False

    def connectors(self):
        with self.lock:
            return [{"id": k, "name": v["name"], "agent": v["agent"], "added": v["added"], "used": v.get("used")} for k, v in sorted((self.d or {}).get("connectors", {}).items(), key=lambda kv: kv[1]["added"])]
