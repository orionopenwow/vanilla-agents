# Privacy

Vanilla Agents runs on your PC. Nothing leaves it except what you start yourself:

- **The window and its server** answer only this PC (127.0.0.1), unless you switch on Phone access (below). Every change needs the key in the window's own address.
- **Claude Code hooks and the Vanilla Agents tools** write events (tool names, file paths, short command lines, quest text) to a
  feed file in `%USERPROFILE%\.vanilla-agents`. They are read by this program only.
- **Party** (only if you host or join): your name, your helpers' names, roles, working/idle and a one-line activity, the shared
  plan and its statuses travel to the party's host over your network. Never code, files, keys or approvals. Leaving stops it.
- **Community chat** (Chat window, Community tab, only in a party) is for the people in the party only. What you write travels to
  the party's host, who keeps the last 300 lines in the party file on their PC (`party-hub.json`), and to the other members' windows.
  It is **never given to Claude**: it is not written to the event feed, not in what the hooks tell Claude, not in the Vanilla Agents
  tools (MCP), not in whispers, not in the party cache file those tools read, and not in diagnostics. Members see the lines from the
  moment they joined; the host can delete a line for everyone. Do not write passwords or secrets there: it is plain HTTP like the rest of the party.
- **Phone access** (only if you switch it on in Options > Phone): the window also answers your home network, and only to a device that has
  the key link; it sends that device the same picture as the window (helpers, quests, chat lines). Off again with the same switch.
- **Browser access** (only if you switch it on in Options > Browser access, V-054): this PC keeps one outbound connection to the
  Open Vanilla relay (agents.openvanilla.app). Browsers you pair get the same picture as the phone page (helpers, quests, chat lines),
  sealed end to end with keys only this PC and that browser hold: the relay sees a pair id, a device id, sizes and times, never the
  content. The relay stores only your pair id with a hash of this PC's token. Your keys and paired browsers are in `remote.json` next to
  your settings file. **Claude connectors** you make there are different: Claude's calls (quest titles, progress lines, requests) are
  plain at the relay while it passes them on, kept in its memory only for that call. See docs/BROWSER.md.
- **Notifications** (only the ones you switch on in Options > Notifications): short sentences such as "Varn needs you: permission for
  Bash" or "Quest done: Fix the login" go to the Discord / Slack / ntfy / webhook address you entered. Never code, file contents, paths,
  commands or keys. The addresses are kept in your settings file in `%USERPROFILE%\.vanilla-agents`. See docs/INTEGRATIONS.md.
- **Chat replies** (only the services you switch on in Options > Chat replies): Vanilla Agents reads ONE Discord or Slack channel
  (with your bot's token) or ONE ntfy topic every few seconds, from the moment you switched it on (older messages are never read for
  commands). It acts only on messages from the user ids on your allow list (ntfy: messages that start with your passphrase); the others
  are only counted, their text is not kept. What it sends back to that channel: short sentences ("Whispered to Varn.", a status line
  with helper names and the titles of quests waiting for your approval, "Approvals are only in the window or on the phone link.") and
  a helper's answer to a whisper that came from chat, with code, file names, paths, links and command lines taken out. Never code, file
  contents, paths, commands, keys or the window link. A whisper from chat goes into the event feed like one from the window, so the
  helper (Claude) sees it, marked `[Discord]` / `[Slack]` / `[ntfy]`. Tokens and the passphrase stay in your settings file and the
  tokens are sent only to their own service; the last message read per channel is kept in `%USERPROFILE%\.vanilla-agents\work\chat-replies.json`.
  Anyone who can read the channel or the ntfy topic sees the replies. See docs/INTEGRATIONS.md.
- **Integrations** (only what you switch on or import in Options > Integrations): Vanilla Agents reads the open project's `.git/config`
  (which GitHub repository) and `.git/HEAD` (branch), then asks GitHub (through your `gh` command or your token), Linear or Jira for
  open issues, pull requests and CI runs. It only reads; nothing is written to those services. Imported titles, short excerpts and
  links are kept per project in `%USERPROFILE%\.vanilla-agents\work\integrations`, and a CSV file you import is read once and not kept.
  Tokens and keys stay in your settings file and are sent only to their own service; they are never shown back in full, logged, put
  in error messages or in diagnostics. Helpers (Claude) never see imported items until you make one a quest. See docs/INTEGRATIONS.md.
- **Resurrect** opens a terminal on this PC with `claude --resume`; nothing is sent anywhere by Vanilla Agents.
- **Diagnostics** (Help > Save diagnostics) writes a text file to your Desktop; it is sent nowhere. Read it before sharing it.
- **Game art and sound** are baked from your own copy of the game into `%USERPROFILE%\.vanilla-agents\assets` and stay there.
- **Addons** (AddOns window, V-051) are your own scripts in `<assets>/addons`; they run in the window with its full power, so only
  enable addons you trust. **Browse the Workshop** is the only network use for addons and happens only when you click it: it reads the
  Open Vanilla Workshop's public list (`app.json addons.workshop_index_url`) and, when you press Install, downloads that one package over
  https. Nothing about you or your projects is sent. Package for the Workshop only writes files to `<assets>/addons/.packages`; sending
  them is up to you. See docs/ADDONS.md.
- No telemetry, analytics, accounts or update checks.

To remove everything: `uninstall.cmd`, then delete `%USERPROFILE%\.vanilla-agents` and this folder.
