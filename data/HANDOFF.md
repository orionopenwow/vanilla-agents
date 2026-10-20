# HANDOFF (current state, newest first)

## 2026-10-19 - browser access: the inn from any browser, and Claude connectors (V-054)
- Options > Browser access: switch, status, pairing links (Watch only / Watch and approve, QR, once, 10 min), paired browsers (Remove), Connect a Claude (address shown once, Remove). docs/BROWSER.md; PRIVACY.md; guide topic "Browser access".
- New package `vanilla_agents/remote/`: relay.py (runs on the server), wsproto.py (WebSocket, stdlib), seal.py (the one use of `cryptography`), store.py (remote.json), bridge.py (inside the window server). `app/remote_api.py` (GET/POST /api/remote). Page: app/web/remote.html + js/remote.js + js/remote-core.js + css/remote.css (also served at /remote.html). setup.cmd installs cryptography. scripts/export_browser_access.py copies the page and the relay into Open Vanilla (done: Open Vanilla 095ec9b adds www/agents/live/ and hetzner/agents_relay_up.sh).
- Verified: tests/test_remote.py (sealing, relay token/forwarding/spoofing/limits, pairing single use and expiry, watch vs respond scopes, replays across and within sessions, revoke, live pushes, the relay never seeing quest titles/device names/paths/the key, connector tools/agent name/removal, no secrets in GET, remote.json 0600; plus the real page code remote-core.js under node WebCrypto against the Python side); full suite; config check; headless Chromium at phone size: pairing page, pair, inn, Approve (shows "you (browser)"), a live quest arriving, reload remembers the pairing, no console errors with the page's CSP; Options > Browser access rendered on its own (status, link + QR, list, connector address).
- Not verified: the real relay at agents.openvanilla.app (needs DNS + agents_relay_up.sh on the server), the hosted page on GitHub Pages, a real phone camera scanning the QR, Safari/Firefox (WebCrypto X25519 should be there in current versions), adding the connector in claude.ai for real, Windows paths for remote.json permissions (chmod is a no-op there; the file is in the user's profile).
- Next: owner deploy steps (DNS A record agents.openvanilla.app, `bash hetzner/agents_relay_up.sh` on the server, push Open Vanilla so Pages serves /agents/live/). Then phase 2-3 of the plan: shared inns.

## 2026-10-19 - first-run pass: party links, loading screen, welcome, inn start (V-053)
- Party: the invite link opened in a browser is a small page with "Join in Vanilla Agents" (hub.invite_page, CSP none, name escaped); it opens `GET /join?invite=` on the friend's own window server, which only remembers the offer (PartyClient.offer, 10 min) and the Party window opens with "You're invited to <party>", Join as <name>, Join / Not now (action dismiss). The host gets one link per way in (`view().invites`: Same Wi-Fi, plus Tailscale 100.64.0.0/10 addresses). Name boxes start from `git config user.name` (first word) or the sign-in name.
- Loading screen: the bar creeps toward the next step during long steps (never past it), moves while the windows are built, says "{count} helpers are already in the inn", and after 9 s explains that the first start is slowest; the zone name sits above the tip (it covered the WoW logo).
- First start: a welcome card (four lines, Open the guide / Let's go), once per window profile (localStorage va.welcomed).
- Inn: you start on the roomiest spot of the main floor facing the tables (was a stair corner facing barrels); helpers already working when the inn opens are in their seats at once; new arrivals appear 2.5-6 m from you, not on top of you; the empty-inn hint sits under windows; chat line "walked into the inn" (was "sat down at a desk").
- Verified (cloud copy with the owner's baked art, headless swiftshader): demo seating (6 at laptops, gnome on the table, barmaid), hero idle variations cycling for 70 s with no stop, start view, walking into furniture stops, the full invite flow between two windows (invite page, hand-off page, prompt, joined; host view), loading timeline (bar moves every second), welcome card; tests/test_party_invite.py, test_party, test_app_guide/check, full suite.
- Not verified: a real GPU, Tailscale on a real PC (address detection is mocked in tests), the hand-off when the friend's window runs on another port than 8766.

## 2026-10-19 - demo seating, gnome on the table, barmaid, idle freeze fix
- Demo (demo.cmd now runs `demo_feed.py --barmaid` and the server with `--demo`; the snapshot then carries `demo: true`): every helper takes a laptop seat at a table and stays there typing (no errands, no standing up when idle); one barmaid (role "barmaid", a woman, human when the roster has one) walks from helper to helper, stops for a few seconds, bows or asks, moves on, and never takes a chair.
- A gnome at a laptop sits on the table (sitground) with the laptop pushed further in, facing him; everywhere, not only in the demo.
- Idle freeze: when a one-off Stand variation ended and the same variation was picked again, play() returned without restarting it, so the character (often the human hero) froze on the last frame. It now restarts it (the same holds for repeating the same emote twice).
- Files: app/web/workshop3d/inn.js, vanilla_agents/app/server.py (--demo), scripts/demo_feed.py (--barmaid), demo.cmd.
- Verified: `node --check`, full suite (only the 7 failures the untouched tree has here: baked art), demo feed writes the barmaid.
- Not verified: the 3D look (gnome height on the table, the laptop position, the barmaid's stops) on a real GPU with baked assets.

## 2026-10-19 - action bar fitted to the rack, number keys 1-6 (V-052)
- The bar now has six game-style buttons inside the rack's dark channel, each with its key in the corner and its name under it: Verify now (1), Pause/Resume (2), Needs you (3: next helper with a gold "!", count + gold pulse while helpers wait), Quest log (4), Changes (5: Inspect), Hearth (6, two presses). V, Z, L and N still work. It centres in the free gap between the chat and the backpack when the middle of the screen would cover them (fits the default 1280x800 window).
- Files: js/panels/actionbar.js, css/skin.css (fonts.css overrides removed), config/panels/action_bar.json, strings ui/tooltips, schema.py (slot `key`, ACTION_SLOTS, text nobody), check_app.py (known ids, digit keys, no duplicates), docs/CHANGE-GUIDE.md, guide strings + docs/GUIDE.md (make_guide), DECISION_LOG V-052, tests/test_app_check.py.
- Verified: full suite in a copy without baked art (only the 8 failures the untouched copy has there too: they need the baked icons and inn), config check tests, `node --check`; headless 2D (1280x800 and 1600x900): buttons in the channel, names, keys, Needs you dimmed / counting 2 with the pulse, pressing 3 picks the first waiting helper and opens its talk window, Quest log lit while open, bar clear of chat and backpack.
- Not verified: the 3D inn (the bar is the same element there), a real GPU, very long translated names (they cut with an ellipsis).

## 2026-10-19 - chat replies from Discord, Slack and ntfy (feat-q, V-050)
- Options > Chat replies: switch on Discord (bot token + channel id), Slack (xoxb bot token + channel id) or ntfy (server + reply topic + passphrase); who may command (user ids; ntfy: the passphrase prefix), read every 5-120 s, Allow pause/resume (off by default), Test (reads once, posts a hello), status line ("Listening in #channel. Last command 2 min ago. Ignored 1 ..."). Setup steps for the bot / app / topic: docs/INTEGRATIONS.md.
- In the channel: `@Varn msg` / `/w Varn msg`, `/p msg` / `@everyone msg` whisper through the normal whisper path; `status`; `pause` / `resume` only when allowed; `approve` and other owner actions are refused with a short reply. A helper's answer to a chat whisper goes back to the channel (no code, paths or file names).
- Verified: tests/test_chat_replies.py (real-shaped samples of all three services, cursors + first enable from now, allow list + constant-time passphrase, command parsing, owner-only refusals, in-process whisper, answer forwarding, 429 / Retry-After / X-RateLimit, garbled answers, no secrets in GET /api / diagnostics / errors), MCP tool-list test unchanged, full suite, check; headless 2D with the dev-only fake services (scripts/demo_chat_fake.py + VANILLA_CHAT_FAKE): settings page, Test, a Discord whisper in the chat, status / approve-refusal / forwarded answer replies, Slack and ntfy Test, ntfy passphrase pause + /p.
- Not verified: the real Discord, Slack and ntfy services (no network or accounts here); Discord's message order with more than 50 new messages between reads; Slack has_more paging (over 100 messages per read are not paged).

## 2026-10-19 - addons, complete: AddOns window and the Open Vanilla Workshop (feat-r, V-051)
- New AddOns window (Esc > AddOns, or Options > Vanilla Agents > AddOns; no hotkey): every installed addon with a checkbox (enabled), version, author, summary, folder or old single file; Details (description, what it says it does, the trust warning, licence, links); Enable/Disable, Remove (moved to addons/.removed, never deleted), Install from .zip (checked first, Replace needed for an installed id, starts off), Package for the Workshop (deterministic zip + catalogue .yml in addons/.packages, with How to submit), Browse the Workshop (only on the click; friendly empty state), Reload window.
- Addons can now be folders with addon.json + main.js (+ main.css); old single .js files still load. Which ones load is kept in your settings file. docs/ADDONS.md rewritten; example `examples/addons/hello-inn/` (a small sign with the helper and quest counts).
- `docs/openvanilla/ov-workshop-agents.patch` (+ README): a proposed change for the Open Vanilla Workshop tools (category "Vanilla Agents addons", no game-client scan for them, packaging, chapter section). Not applied; the owner decides. A copy sits in the clone root for the owner's _local folder.
- Verified: tests/test_addons.py (manifests, legacy, enable/disable persistence and not loading/serving disabled ones, crafted zips: traversal, absolute, backslash/drive, device names, symlink/device/fifo, bombs, too many files, too deep, damaged and lying entries, encrypted, missing manifest/main.js, bad id, file types, duplicates; Replace; Remove; packaging determinism and exact YAML; YAML round trip of tricky values; Browse/Install with a fake opener incl. sha256 mismatch, http, redirect to http, size, id mismatch; window key on every POST, body limits), test_mcp (no addon tools), full suite, config check; the patched workshop_build run with stubs on the example entry; headless 2D screenshots of the whole flow.
- Not verified: the real Workshop (no entries of this kind exist yet; never contacted), the 3D inn with addons, Windows paths for the .removed/.packages folders (pathlib, should be fine).

## 2026-10-19 - review follow-ups (V-048, V-049)
- Independent review fixed 9 issues (V-048: GitHub token only to github.com or your Enterprise host, party hub hardening, phone listener body limit and timeouts, garbled HTTP answers, settings groups kept on Pause, member ids not reused, strict validators). V-049: Resurrect runs claude by full path, settings write lock, proposals tied to their branch, generic quest log error text.
- Fresh-install check on the owner's PC (throwaway HOME): every bake step ran, 24 inns, no stale steps.
- Known limits: checker-style feed lines are trusted (a helper with a shell could write the feed file); see V-049.

## 2026-10-19 - independent review of today's merges (feat-p, V-048)
- Fixed (each with a failing test first, tests/test_review_v048.py): GitHub token could be sent to a look-alike remote host (any host containing "github"); party hub hang on a negative Content-Length, crashes on non-ASCII keys and 1e999, reused member ids; server POSTs dropping the connection on wrong JSON types, /api/diff NUL crash, phone listener reading big bodies / waiting forever before its checks; notification sender thread killed by a garbled HTTP answer (same class in httpjson and the party client); Pause wiping the phone / notify / integrations settings when the sound part of the settings file did not validate; validators accepting a trailing newline.
- Verified: full suite, config check, fuzzing of every POST route (wrong types, huge numbers, unicode, empty / nested bodies) and the party hub, all GET routes with odd paths; headless 2D: every hotkey window, Esc menu entries, Options pages (Vanilla Agents, Notifications, Integrations, Phone), the contest picker, with no console errors; 3D inn: see the V-048 report.
- Left as is (see the review report): quest log shows "Could not approve: ..." for any failed quest button, including Let several try (shared error string); settings read-modify-write has no lock (two saves at the same moment can lose one); a helper may pass another helper's id to propose_fix; done_elsewhere / fix_checked lines in the feed are trusted like the other checker lines (agents with a shell can write the feed).

## 2026-10-19 - zone light from the game's own lighting tables (feat-n, V-046)
- Each zone's light in the 3D inn now comes from the game's Light / LightIntBand / LightFloatBand tables at the inn's town (places.json `map_id` + `pos`), sampled at noon, 19:30 and midnight by the `places` bake (version 2: the rebake notice asks for `bake places`). The hand presets (PLACE_LIGHT) stay as the fallback.
- `vanilla_agents/assets/lighting.py` (layouts and checks in its docstring and V-046), `app/web/workshop3d/innsky.js` (game light -> readable indoor light; Auto time of day blends smoothly by the clock).
- Verified: tests/test_lighting.py (synthetic DBC bytes: layouts, BGRA colours, midnight wrap, falloff choice, default fallback, folder bake, index records, the JS mapping and fallback via node), full suite, config check; the lighting part run on the copied 1.12 tables for all 17 zones; headless 3D screenshots (Darkshire, Gadgetzan, Kharanos, day and night) with a sample index in a copied assets folder, compared with the presets. Not verified: a real `bake places` against the MPQs (no game data here), the dusk look and the smooth blend visually.

## 2026-10-19 - office PC screens, contest table, map fog (feat-o, V-047)
- Your own office (docs/OFFICE.md): a mesh whose material is called `Screen` shows the page of the helper at the nearest `desk_*` empty, live; a dim screensaver while that desk is free. A desk with its own screen gets only the chair. Only real empties named desk_N / seat_N count now (a mesh `desk_1_top` used to become an extra desk). No desks and no screens: automatic wall desks as before.
- Competing fixes in the inn: every competitor (proposers + the helper on the quest) sits at one shared table with its laptop open, facing the others, until you pick or stop; the winner cheers, the others applaud. Needed at the quest board, or being checked at the anvil, goes first and comes back; errands start and end at the contest seat.
- World map: the explored/fog tracker uses the same path rule as the hero dots (relative paths, the helper's own worktree, Windows spelling; outside paths ignored), and a zone with a dot is never left in fog.
- Verified: full suite + check (new tests/test_map_fog.py, tests/test_office_screens.py with a synthetic office GLB built by assets/gltf.py, test_contests claimer case); headless 3D (swiftshader 640x360): synthetic office with 3 desks/screens (2 live pages, 1 screensaver), plain office fallback, goldshire_c contest table with the board/anvil/test-errand priorities checked through window.__inn.force/doing and the pick (cheer/applaud states); 2D world map with dots in explored zones.
- Not verified: a real Blender-made office GLB (UV orientation of a real screen), more competitors than seats at any table (the extra one keeps its own laptop), the look of the cheer/applaud on a real GPU (the still frame catches them mid-stand).

## 2026-10-19 - competing fixes (Need or Greed) and World map hero dots (feat-m, V-045)
- Quest log: "Let several try" (2-4 tries) on any open quest; then "Competing: n of m fixes in" + Roll. Helpers send `propose_fix` (MCP) with a summary and their branch or worktree; raid frames show crossed swords while they compete.
- Need or Greed window (Roll): one row per fix with portrait, summary, files +/-, verdict; Check this one (the project's checks on that branch, one fix_checked line), Show changes (Inspect on the branch), Need = pick (owner only, confirm; winner whispered to merge into the base, others thanked; nothing is merged), Pass, Stop competing. Cosmetic dice roll.
- World map (M): helpers as small portraits in the zone of the file they touched last, pulsing while working, click selects.
- Verified: full suite (new tests/test_contests.py: validation incl. traversal and ref injection, owner-only, check/pick/whisper flow, read-only branch diff, file->zone dots), config check, node module checks; headless 2D screenshots with a temp repo (two worktrees): roll window, checking, diff, winner, world map dots. Not verified: Reduce motion visually (code path only), the 3D inn view (no table gathering built; raid marker instead).
- Note: the zone fog/explored state still only counts absolute paths in the main checkout (Tracker); dots also understand worktree paths, so a helper can stand in a fogged zone.

## 2026-10-19 - integration hub: GitHub / Jira / Linear as bounties, CI line (feat-l, V-044)
- Options > Integrations: GitHub import (gh command or a pasted token; labels, which PRs, Enterprise host, refresh minutes, Test, Refresh now, status line), Jira / Linear CSV import, optional Linear API key and Jira Cloud token. All off by default; secrets stay in the settings file and never come back to the window.
- Bounty Board (H) > Imported: source badges and filter, Open link, Make it a quest (owner only; normal unapproved quest, why = "GitHub #123: <url>"), Hide. Closed upstream -> gone at the next refresh, the quest stays.
- CI: "CI: build passed 4 min ago" under quests in progress / ready, and a CI row in the system monitor (red when failed); information only, Verify unchanged.
- Verified: tests/test_integrations_sources.py + test_integrations_hub.py (fake gh runner, fake HTTP opener, no network), MCP tool-list test, full suite, check_app; headless 2D screenshots with the dev-only fixture (VANILLA_INTEGRATIONS_FAKE=scripts/demo_integrations.json). Not verified: real GitHub / gh / Jira / Linear (no network or accounts here), real CSV exports beyond the documented column names.

## 2026-10-19 - how helpers do their tasks + inn lights (feat-k, V-043)
- Tests and builds (a Bash step matching `workshop.json#inn.tasks.test`) and the checker testing a helper's quest: the helper hammers at the anvil/forge (Anvilmar, Orc Inn) or, without one, stands by its laptop and works; it stays while test commands keep coming (20 s hold), no ping-pong. Commit/push/publish/zip (`inn.tasks.ship`): carries the game's sack to the crates, puts it down, walks back. Waiting for you (quest ready or a question/permission): stands at the quest board until you decide, asking now and then. A passed check: one cheer.
- Candle/lantern/chandelier lights (`inn.lights`, `workshop3d/innlights.js`): 0/3/6/6 point lights by quality at the sources nearest you, soft flicker (none with Reduce motion), brighter at night; shed first when the inn runs slow. Soft window fill light in the zone's colour.
- state.py: a check that starts again clears its old verdict (needed to know a re-run is running).
- Verified: full suite + check_app (new tests/test_inn_tasks.py: patterns valid in Python and JS, sample command table, bad settings rejected, check restart); headless 3D screenshots (see V-043 report). Not verified: real GPU look/speed of the lights, real Claude sessions (feed events and `__inn.force` used).
- Note: a Bash command is only known when it finishes (PreToolUse only says "using Bash"), so a helper walks to the anvil after its first test command; following ones keep it there.

## 2026-10-19 - Zones & Inns (V-042)
- Zones window (F3; also Esc menu, Flight Master button, Options): 17 zones with explored world maps, 24 inns (11 new small-town inns), inn pictures (first visit or the picture tour), Travel here, a zone per project. docs/ZONES.md.
- Bake: `python -m vanilla_agents.assets bake places buildings` (new step `places`; buildings version 3). Rebake notice lists them.
- Inn: zone light and far fog, zone loading screen, start position needs a roof overhead.
- Verified: tests/test_places.py, every inn loaded in headless 3D and photographed through /api/inn_photo, Zones window screenshots. Not verified: picture tour on a real GPU (it ran inn by inn in the headless browser instead), names of inns whose building the game reuses in several towns.

## 2026-10-19 - community chat for the people in a party (feat-g, V-036)
- Chat window tabs: General (the log) and Community (people in your party only). Type on the Community tab or `/c text` anywhere. Unread badge, soft sound (chat.json options), screen reader lines, search per tab, host can delete a line.
- Hub `/party/say` + `/party/unsay` (host), cursor `since` in sync, 300 kept in party-hub.json, 500 chars, 5 per 10 s; server POST /api/party say/unsay; live updates follow the party (no feed event needed).
- Never reaches Claude: PartyClient keeps the chat in memory/view only (popped before party-state.json is written); tests/test_community.py proves feed, files, MCP outputs, hook texts and diagnostics have no trace. docs/PRIVACY.md, docs/PARTY.md.
- Verified: full suite, browser (2d) with the host in the page and a friend joining through python against the hub; screenshots of no-party, unread badge, community lines, search, host delete. Not verified: two real PCs, a real screen reader.

## 2026-10-19 - feature guide (feat-h, V-037)
- In-app Feature Guide (parchment book, 14 chapters, 103 topics, search, Open it / Show in Options): Help (F1) > Feature guide, Esc > Guide, ? in Options. Content in `app/config/guide.json` + `strings/ui.json` guide.*; `docs/GUIDE.md` is generated (`python scripts/make_guide.py`).
- Options window: every own option has a line under it and a tooltip with "when to change it"; game options say whether Vanilla Agents uses them.
- Verified: full suite (new tests/test_guide.py), config check, headless screenshots at 1280x800 (2d). Not verified: the inn renderer view of the guide (same DOM), a screen reader.
- Integrator: the Community chat and zone-picker topics describe features being built on other branches; adjust their wording (guide.community_*, guide.zones_*) when those land, add tooltips `setting_<id>` + a settings topic for any new Options choice (the tests name what is missing), then rerun make_guide.py.

## 2026-10-19 - worktrees, Resurrect, phone buttons, notifications, tokens (feat-j, V-038..V-041)
- Worktrees (V-038): new quiet event `agent_place` (session, folder, checkout root, worktree, branch) from hooks and transcripts; the same-file warning only fires inside one checkout; branch/worktree in raid frame hover, talk window work view, Inspect header.
- Resurrect (V-039): talk window option + raid frame right-click (ghosts and the grey "went home" frames) -> new terminal with `claude --resume <id>` in the helper's folder (POST /api/resurrect, owner only); error + command to copy when it cannot; revive glow in the raid frame and a golden column in the inn when the session comes back.
- Phone (V-040): Options > Phone (or Help > Phone link): Phone access switch (default off), LAN link with key, Copy, QR code (js/qr.js, own encoder). phone.html gets Approve / Pause / Verify only with the key; over the network everything needs the key and only those three calls exist.
- Notifications (V-041): Options > Notifications: Discord, Slack, ntfy, JSON webhook, per-event tick boxes, Send test, Save; background sending with dedupe/retries. docs/INTEGRATIONS.md, PRIVACY.md, LIMITATIONS.md updated. Damage meter (U) has a Tokens tab (tokens/minute from transcripts).
- Verified: full suite + check_app; new tests/test_worktree_resurrect.py (incl. a real `git worktree`), test_phone.py (binding, key, allowed calls, QR decode with OpenCV), test_notify.py (fake sender), test_tokens.py; headless screenshots (2D panels, 3D revive effect, phone page with/without key, browser QR decoded). Not verified: a real phone on a real Wi-Fi, a real terminal opening on Windows/macOS/Linux desktop, real Discord/Slack/ntfy delivery (no network here).

## 2026-10-19 - accessibility, chat search, party safety (feat-f)
- Accessibility (V-033): windows are named regions/dialogs, gold keyboard focus ring, screen readers hear new chat lines and banners (hidden aria-live log), hotkeys ignore focused buttons, chat colours on parchment >= 4.5:1, in-app Reduce motion stops the raid pulse.
- Chat (V-034): search box (live, marks matches) and "Only <helper>" in the filter list. Chat lines carry `agent`.
- Party (V-035): Only this PC / My network, invite expiry (24 h default) + New link, host can remove members; host-only controls and a plain-HTTP warning. docs/PARTY.md updated.
- Verified: full suite (new tests/test_a11y.py, tests/test_party.py Safety + local-only/kick/renew over HTTP), headless screenshots (chat search/filter, party host/local/outside, kick confirm, focus ring). Not verified: a real screen reader (NVDA/VoiceOver), two real PCs.

## 2026-10-19 - real usage, plugin, background sessions (V-030..V-032)
- Statusline bridge (opt-in): `python scripts/install_statusline.py` or `setup.py --statusline` (`--remove` restores yours). Real memory use per helper (mana), session cost (damage meter Cost tab, U), 5-hour / weekly plan limit in the player frame's blue bar. Re-pointed by reconnect.py.
- Plugin: `data/plugin/` (hooks + tools); install commands in docs/PLUGIN.md. Regenerate with `python scripts/make_plugin.py` after changing hook events or VERSION.
- Background sessions: the server asks `claude agents --json` every 15 s and shows sessions without hook events yet as "background" helpers (app.json background_sessions; nothing happens without the command).
- Verified: full suite, real statusline run, `claude plugin validate`, plugin install + a headless session with --plugin-dir writing the feed, a real `claude agents --json` poll, browser screenshot of the Cost tab and plan bar (2d). Not verified: a real interactive status line on the owner's Windows PC (Pro/Max rate_limits), background-session fields (id/state/waitingFor) on a real background session, Windows `python3 || python` fallback in Git Bash.

## 2026-10-19 - release pass (1.0.0-rc.1)
- Animations: the human male run (and every clip) now plays at its real length (V-022 fix in m2v._track). Re-bake `workers models`.
- Needs-you state, stunned/left helpers, async hooks, whispers at turn end (V-026). Help (F1), diagnostics, fallbacks, uninstall, privacy (V-027).
- Showcase: screenshots in the Open Vanilla repo's `_local/vanilla-agents/` (game art, not published), page `www/agents.html` (original drawing; uses assets/agents/*.webp only if the owner copies them there). Not committed in that repo.
- Still open: worktree awareness (one helper per git worktree); a real screen reader and two real PCs for the party. Done since: more hooks (V-028), statusline bridge, plugin, background sessions (V-030..V-032), accessibility, chat search, party safety (V-033..V-035).

## 2026-10-19 - Party (multiplayer)
- Party window (G): host/join, shared plan, agree, split, take; other members' helpers in your inn; MCP party_plan/party_propose (V-024, docs/PARTY.md).
- Tested with two clients over HTTP (tests/test_party.py) and in the browser (host, friend joins, both agree, share arrives as a quest). Not tested across two real PCs yet.

## 2026-10-19 - collisions, animations, world, fonts
- Doodad collisions from the game's own collision meshes; real character physics (V-021). 78 animations, emotes, X to sit, helper errand animations (V-022). Rounded embossed text, action bar fits (V-023).
- Re-bake needed on Windows: `python -m vanilla_agents.assets bake workers buildings inn` (from data/).
- swiftshader in the container runs the inn at ~2 fps: movement tests there are slow; judge speed on a real GPU.

## 2026-10-19 - layout: launchers on top, everything else in data/
- Root = setup.cmd, vanilla-agents.cmd, demo.cmd, README, CLAUDE.md. Code, config, docs, tests, vanilla.local.json are in `data/` (V-020).
- vanilla-agents.cmd runs `scripts/reconnect.py` first: hooks / tools installed from the old place are re-pointed to data/ once.

## 2026-10-19 - "add all features" (roadmap)
- Buildings: 13 baked vanilla buildings (`bake buildings`, `assets/buildings.json`), picked in Options > Settings > Workshop with time of day, building music, quality, frame cap, helper count and reduce motion (V-014, V-015).
- Inn life: errands by activity, quest board, ghosts, click-to-talk, minimap (V-016). Hearthstone on the action bar, per-helper mana, daily quests (off by default), your own office GLBs (docs/OFFICE.md), addons (docs/ADDONS.md), phone.html (V-017, V-018).
- Panels from four helper branches merged (V-019): talk window, Inspect/Replay, mailbox/achievements/meter, talents/flight master/bounty board/loot rolls/party groups.
- Not done: the owner's own PC GLBs (waiting for the files); per-building start points other than Goldshire are found automatically and were checked by bake only, not walked in every building.

## 2026-10-18 (late) - MCP tools + skin touch-ups
- `vanilla_agents/mcp.py` + `scripts/vanilla_mcp.py`: Claude can use Vanilla Agents as tools (docs/INTEGRATION.md); `scripts/install_mcp.py`; setup.cmd now runs it (`--mcp`).
- Skin: scroll edges cleaned with a CSS drop shadow, portrait ring trimmed, metal frame darkened (no white rim), bag slots drawn in CSS.
- Verified: tests (incl. tests/test_mcp.py), a scripted MCP handshake + calls. Not yet: the tools inside the real Claude desktop app on the owner's PC (needs install + app restart).

## 2026-10-18 (later) - mockup UI skin
- Interface restyled to the owner's mockup (`app/skin/source/target_layout.png`): metal panels, parchment quest log, chat scroll with a channel filter, portrait ring + level/XP + pass rate + task timeline in the character sheet, raid rows with portraits, System Monitoring panel, inventory grid, orb action bar, celebration banner with sparks.
- Verified in headless Chromium (inn, 2D and menus) with the demo feed; full suite passes. Not yet looked at on the owner's Windows screen.
- Next: per-agent context use for the blue raid bar (now: busy/idle), medals row in the controller, hover states on inventory slots.

## 2026-10-18 - fork created: Vanilla Agents
- Fresh repo from a snapshot of forever-core; renamed (`vanilla_agents`), personal data of the upstream owner removed, its WoW Forever server adapter dropped.
- Game art now comes from a WoW 1.12 Data folder: stdlib MPQ/DBC/BLP/M2 v256/WMO v17 readers + one baker (`python -m vanilla_agents.assets bake`).
- Verified: full suite passes (Linux, Python 3.10); bake of the owner's patch.MPQ/sound.MPQ produces UI art, sounds, 181 music tracks, props, 30 random workers and the Goldshire Inn; the program renders the inn with walking/sitting workers and vanilla UI art (headless Chromium screenshots); Claude hook -> feed -> agent shown checked with synthetic hook input.
- Not verified on Windows itself yet (setup.cmd, shortcut, chromeless window) - do that first on the owner's PC.
- Next: helm/shoulder/weapon models on workers; WMO vertex colours for warmer inn lighting; tune the jukebox prop size (GnomeMachine01 replaces the retail jukebox); look at the office renderer (`?renderer=3d`).
