# Vanilla Agents

**Your AI coding helpers as heroes in a cosy inn.** Every Claude Code session walks into the Goldshire Inn, sits at a laptop and works through quests: your tasks. You roam the inn freely as your own character; a quest only counts as done after hidden checks verify it.

![Vanilla Agents: helpers at their laptops in the inn](media/agents_hero.webp)

## What you get

- **The whole window is the vanilla interface:** quest log, character sheet, spellbook (the checks), backpack, raid frames, a world map of your code as zones, and chat as the audit log.
- **Talk to your helpers:** click one to talk or whisper (`/w name`, `/p` for everyone), Inspect (N) its changes, Replay (R) the day.
- **An action bar in the rack:** keys 1 to 6 for Verify, Pause, Needs you, Quest log, Changes and the Hearthstone.
- **Mailbox, achievements, a damage meter, bounties, Need/Greed on finished quests**, and fly between projects (F).
- **Pick your building:** 13 inns and halls from the game, or your own GLB.

| | |
|---|---|
| ![You roam, they work](media/agents_roam.webp) | ![A helper needs you](media/agents_needs.webp) |
| ![Talk to a helper](media/agents_talk.webp) | ![At the laptop](media/agents_laptop.webp) |

## Start (Windows)

1. Install Python 3.10 or newer (python.org; tick "Add to PATH").
2. Drag your WoW 1.12 `Data` folder onto `setup.cmd`. It bakes the art on your PC (about a minute), connects Claude Code, and puts a shortcut on the Desktop.
3. Double-click **Vanilla Agents**. Start any Claude Code session: it shows up in the inn.

Just looking? `demo.cmd` plays six pretend helpers, no agents needed.

Everything you see comes from **your own** game files, baked on your PC into `~/.vanilla-agents/assets`. No game files are in this repository; the art stays on your PC, for private use only.

Read next: `data/docs/DESIGN.md`, `data/docs/CHANGE-GUIDE.md`, `data/docs/LIMITATIONS.md`. More at [openvanilla.app/agents.html](https://openvanilla.app/agents.html).

## Part of Open Vanilla

[Open Vanilla](https://github.com/orionopenwow/OpenVanilla) is a free, open-source, community-built Vanilla project ([openvanilla.app](https://openvanilla.app/), [Discord](https://discord.gg/r6nj5p8U4)). Its products:

- [Vanilla Forge](https://github.com/orionopenwow/vanilla-forge): The Open Vanilla creator app: maps, models, creatures, quests, items and addons, tested in a copy of your game and published as a signed pack.
- [Vanilla Agents](https://github.com/orionopenwow/vanilla-agents) (this one): Your AI coding helpers as heroes in a cosy inn: you roam, they work, a checker verifies every quest.
- [Herald](https://github.com/orionopenwow/herald): The Open Vanilla Discord bot, the in-game World chat bridge, and Herald Autopilot: he plays a character for you, simulates gear and learns from play.
- [Open Vanilla Server](https://github.com/orionopenwow/openvanilla-server): Everything that runs a realm: the realm images and CMaNGOS patches, the web/asset service, Server Studio, Play Solo packs, the relay, and the turnkey Hetzner deployment.
- [Open Vanilla Launcher](https://github.com/orionopenwow/openvanilla-launcher): OpenVanilla.exe: play online, solo or in the browser, the Workshop, signed updates and live news; plus the release packaging.
- [Vanilla Remastered UI](https://github.com/orionopenwow/vanilla-remastered-ui): The in-game addon suite (WenillaCore, Quests, Transmog, Achievements, Guilds and the rest), Classic+ data, and the Workshop addon catalog.
- [openvanilla.app](https://github.com/orionopenwow/openvanilla-site): The Open Vanilla website (GitHub Pages) and the player manual.
- [Open Vanilla Devkit](https://github.com/orionopenwow/openvanilla-devkit): Test a change in seconds on your PC, try it against the live realm, and let a staging realm prove it first; plus the project's checks and tests.
- [Open Vanilla Agent Kit](https://github.com/orionopenwow/openvanilla-agent-kit): Let an AI coding agent change your copy of Open Vanilla for you: addons, interface, your own realm's rates and NPCs.
- [Open Vanilla Art & Tools](https://github.com/orionopenwow/openvanilla-art-tools): Art sources, UI kits and the generator scripts behind the launcher, site and addon artwork; plus the project's maintenance tools.

## License

MIT: see [LICENSE](LICENSE).

## About this repository

This repository is published from **vanilla-agents** (commit `15c7112a33`: Browser access: Options page, pairing page, docs, export to Open Vanilla, setup installs cryptography (V-054)). Changes are made there and arrive here with each release, so please open issues and pull requests on [Open Vanilla](https://github.com/orionopenwow/OpenVanilla/issues).

World of Warcraft is a trademark of Blizzard Entertainment, Inc. Open Vanilla is an independent fan project, not affiliated with or endorsed by Blizzard Entertainment. No Blizzard game files are included: you need your own.
