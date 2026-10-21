# How Vanilla Agents connects to Claude

| Path | Direction | What it carries | Set up by |
|---|---|---|---|
| Hooks (`scripts/claude_hook.py`) | Claude Code -> window | every session start/stop, tool use, file edits, prompts; prints your open Change/Investigate requests into the session | `scripts/install_hooks.py` |
| Transcripts (`events/transcripts.py`) | Claude Code -> window | live sessions without hooks, read-only from `~/.claude/projects` | nothing (automatic) |
| **MCP tools** (`vanilla_agents/mcp.py`) | **both ways** | Claude reads status/quests and the checker's findings, starts quests, reports progress, hands quests in, answers your requests | `scripts/install_mcp.py` |
| Window buttons / `scripts/decide.py` | you -> program | approve, change, investigate, verify, pause, done elsewhere | - |

## MCP tools
`status`, `list_quests` (with check results and "sent back" evidence), `start_quest`, `report_progress`, `quest_ready`,
`pending_requests`, `answer_request`, `done_for_now`, `propose_fix` (V-045: a fix for a quest where you let several helpers try; proposals only). The server tells every session the working agreement (start or pick a
quest, report in plain words, hand in with the quest id in the commit message, check your requests).

Where it works:
- **Claude Code** on this PC: `claude mcp add --scope user vanilla-agents -- python <repo>/scripts/vanilla_mcp.py` (the installer does it).
- **Claude desktop app**: entry `vanilla-agents` in `claude_desktop_config.json` (the installer adds it with a backup; restart the app).
- **Cloud sessions linked to this PC** through the desktop app reach the same local tools.

Safety line (deliberate): agents can add and hand in quests and propose competing fixes, but cannot approve, verify, pause, mark work done, open a competition or pick the winning fix. A quest an
agent creates starts as "needs your decision"; only your click (the window key) or `scripts/decide.py` on your word approves it,
and only the trusted checker completes it.

## Feature check (2026-10-18)
Working end to end: quest log with approval tiers and the Change/Investigate loop, hooks + transcripts, Verify now with each
project's trusted checks and hidden checks, world map from git, inventory of reports and changed files, sounds, the inn with
30 heroes, options window, now the MCP tools.
Built but switched off: launching helper agents automatically (the durable scheduler/watchdog/recovery engine is tested, nothing
starts agents), helm/shoulder/weapon models on heroes. Not there yet: per-agent token use for the raid frames' blue bar, a
scheduled (automatic) Verify after `quest_ready`.


## A Claude in the cloud, linked to this PC (V-055)
A Claude Code session started in the Claude app with this PC linked runs in the cloud. It reaches this PC's shell and connected folders,
not the hooks, so it does not walk in by itself. Connect Claude (Esc) > "Claude in the cloud" copies a message to paste to it once. It then runs,
through the PC's shell, `python3 $HOME/mnt/<this folder>/data/scripts/va.py hello "what I am doing"` (also `quest`, `progress`, `ready`,
`requests`, `reply`, `bye`). The session needs two folders connected: this program's folder and `C:\Users\<you>\.vanilla-agents` (where the feed is).
