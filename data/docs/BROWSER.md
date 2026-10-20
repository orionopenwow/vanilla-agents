# Browser access (V-054)

See your inn from any browser, anywhere: a laptop at work, or your phone on mobile data. Off until you switch it on in
**Options > Browser access**.

## How it works

```
your PC: window server <- bridge --wss--> relay (agents.openvanilla.app) <--wss-- your browser (openvanilla.app/agents/live/)
                                              ^
                                Claude on the web (connector address)
```

- **Nothing on your PC listens for the internet.** The bridge (inside the window server) makes one outbound connection to the relay.
- **Sealed end to end.** Every message between your PC and a paired browser is sealed (X25519 + HKDF-SHA256 + AES-256-GCM, one key per
  direction). The relay forwards bytes it cannot open. Code: `vanilla_agents/remote/seal.py` and `app/web/js/remote-core.js` (same steps).
- **Pairing link.** Options > Browser access > *Watch only* or *Watch and approve* makes a link (and QR code). It works once, for
  `app.json remote.invite_minutes` minutes. Its secret is in the address fragment (after `#`), which browsers never send to any server.
  The browser makes its own key pair; the private half cannot be exported and stays in that browser (IndexedDB).
- **Scopes are checked on your PC.** Watch only: the state and the page's words. Watch and approve: also Approve, Pause and Verify (the
  phone page's three buttons). Anything else is refused by the bridge before it reaches the window server, and what is allowed is
  replayed against the window server with its key, so all of its own checks still apply.
- **No replays.** Each connection starts with a fresh session id from the browser and a fresh challenge from the PC; every request
  carries the challenge and a growing number.
- **Remove** a browser in the list and it is cut off at once. Switching Browser access off cuts all of them.

## Connect a Claude (no PC needed for that Claude)

*Make address* gives an address like `https://agents.openvanilla.app/mcp/<pair>/<token>`. In Claude (claude.ai, or Claude Code on the
web) add it as a custom connector. That Claude then has the same tools as the local MCP server (`list_quests`, `start_quest`,
`report_progress`, `quest_ready`, `pending_requests`, ...) and shows up in the inn as a helper named after the connector. It can never
approve, verify or pause. Unlike browser frames, connector calls are plain JSON-RPC at the relay while it passes them on (Claude talks
plain MCP); the relay keeps nothing of them. Remove the address in the list if it leaks.

## Running the relay

`hetzner/agents_relay_up.sh` in the Open Vanilla repo (copied there with `python scripts/export_browser_access.py <OpenVanilla>`).
Locally for testing: `python -m vanilla_agents.remote.relay --port 8790`, then start the window with `VANILLA_RELAY=ws://127.0.0.1:8790/ws`,
`VANILLA_CONNECTOR_BASE=http://127.0.0.1:8790/mcp/` and `VANILLA_REMOTE_PAGE=http://127.0.0.1:8766/remote.html`.

## Needs

- The Python package `cryptography` on the PC (setup.cmd installs it; the only package Vanilla Agents uses, for this feature only).
- A browser with WebCrypto X25519: current Chrome, Edge, Firefox or Safari.

## Not yet (see the plan)

The 3D inn in the browser (it needs your own game art), shared inns for several people, the browser reading your Data folder, the
localhost fast path, a short typed pairing code instead of the link.
