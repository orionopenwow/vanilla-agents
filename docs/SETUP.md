# Vanilla Agents

Your AI coding sessions as heroes in a WoW 1.12 world. Every Claude Code session walks into the Goldshire Inn, sits at a desk
and works through quests (your tasks). A quest only counts as done after hidden checks verify it. The whole window is the
vanilla interface: quest log, character sheet, spellbook (checks), backpack, raid frames, world map (your code as zones), chat (audit log).

Click a hero to talk to it or whisper (`/w name`, `/p` for everyone), Inspect (N) its changes, Replay (R) the day, read the mailbox (O),
earn achievements (Y), watch the damage meter (U), post bounties (H), roll Need/Greed on finished quests, fly between projects (F),
and hearth everyone home. Pick the building in Options (13 inns and halls from the game, or your own GLB: `data/docs/OFFICE.md`),
add your own scripts (`data/docs/ADDONS.md`), or open `/phone.html` for a compact read-only view.

Everything you see comes from **your own** WoW 1.12 `Data` folder (`patch.MPQ`, `sound.MPQ`, ...), baked on your PC into
`~/.vanilla-agents/assets`. No game files are in this repository.

## Start (Windows)
1. Install Python 3.10 or newer (python.org; tick "Add to PATH").
2. Drag your WoW `Data` folder onto `setup.cmd` (or run `setup.cmd "C:\path\to\Data"`). It bakes the art (~1 minute),
   connects Claude (Claude Code hooks, plus Vanilla Agents tools for Claude Code and the desktop app; backups are kept)
   and puts a shortcut on the Desktop.
3. Double-click **Vanilla Agents** on the Desktop. If Claude is not connected yet, the **Connect Claude** window opens (also Esc > Connect Claude):
   one click per Claude you use (Claude Code, the Claude desktop app, claude.ai). Start any Claude Code session: it shows up in the inn.

Just looking? `demo.cmd` plays six pretend helpers, no agents needed.

## What is where
This folder only starts things: `setup.cmd` (once), `vanilla-agents.cmd` (the program), `demo.cmd` (a pretend run), `uninstall.cmd` (take it out of Claude again).
Everything else - code, settings, docs, tests and your `vanilla.local.json` - is in `data/`.

## Commands (run inside `data/`)
    python -m vanilla_agents.app.server --open            the program window (vanilla-agents.cmd does this)
    python -m vanilla_agents.assets bake [skin ui room models workers music voices inn buildings]   re-bake game art (all by default)
    python -m vanilla_agents.assets ls "sound\music\*.mp3"                     browse the game files
    python scripts/install_hooks.py [--remove]            connect / disconnect Claude Code events
    python scripts/install_mcp.py [--remove]              give / take back Claude's Vanilla Agents tools (docs/INTEGRATION.md)
    python scripts/onboard.py <repo>                      add a project (also: Esc > Add project)
    python -m unittest discover -s tests -t .             the test suite (stdlib only)

Per-PC settings (Data folder, ports, folders) go in `data/vanilla.local.json`; it overrides `app/config/app.json` and is not committed.

## Read next
`data/AGENTS.md` (for AI tools working on this repo), `data/docs/DESIGN.md` (look and metaphors), `data/docs/ASSETS.md` (the bake pipeline),
`data/docs/CHANGE-GUIDE.md` (where every text and setting lives), `data/docs/LIMITATIONS.md` (what it does not do).

Game art is Blizzard's and stays on your PC: private use only.
