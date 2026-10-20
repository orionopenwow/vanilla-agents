"""V-054: Browser access. The inn from any browser, through a blind relay.

    relay.py   the relay that runs on the server (standard library only): pairs, forwards sealed frames, and the Claude connector address
    wsproto.py WebSocket framing and a small client (standard library only)
    seal.py    the sealing (X25519 + HKDF + AES-GCM); the one place that uses `cryptography` (owner's OK, 19 Oct 2026)
    store.py   this PC's pair id, keys, paired devices and connector tokens (remote.json next to the settings file, never the repo)
    bridge.py  runs inside the window server: one outbound connection to the relay, replays allowed calls against 127.0.0.1

The relay never sees what the inn shows: every frame between a paired browser and this PC is sealed with keys only the two hold.
See docs/BROWSER.md.
"""
