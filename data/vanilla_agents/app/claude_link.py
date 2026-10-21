"""V-055 Connect Claude: one window that says, in plain words, which Claudes reach this inn and connects the missing ones with one click.

Three ways in:
- Claude Code on this PC: the hooks in ~/.claude/settings.json send its sessions here (scripts/install_hooks.py), and the Vanilla Agents
  tools are added to it (scripts/install_mcp.py, `claude mcp add --scope user`). "Start Claude Code" opens a new terminal running `claude`
  in the open project, so the owner can see a helper walk in.
- The Claude desktop app: the Vanilla Agents tools in claude_desktop_config.json (needs a restart of the app).
- Claude on the web (claude.ai): a connector address from Options > Browser access (remote_api), shown here as a status line.
- A Claude Code session in the cloud linked to this PC (started from the Claude app): it runs commands through this PC's shell, so the hooks
  never see it; the card gives a message to paste to it, and it joins with scripts/va.py (hello / quest / progress / bye).

Owner's clicks only (POST /api/claude with the window key); never an agent or MCP tool. Every edit goes through the installers, which keep a
timestamped backup and leave everything else in those files untouched. Status reads files only (no `claude` process is started for it)."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import resurrect

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts")


def _scripts():
    if SCRIPTS not in sys.path:
        sys.path.insert(0, SCRIPTS)
    import install_hooks  # noqa: E402
    import install_mcp  # noqa: E402
    return install_hooks, install_mcp


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        return json.loads(text) if text.strip() else {}
    except (OSError, ValueError):
        return None


class ClaudeLink:
    def __init__(self, home=None, desktop_config=None, which=shutil.which, run=subprocess.run, platform=None, runner=None):
        hooks, mcp = _scripts()
        self.hooks_mod, self.mcp_mod = hooks, mcp
        self.home = Path(home or os.path.expanduser("~"))
        self.settings = str(self.home / ".claude" / "settings.json")
        self.code_cfg = str(self.home / ".claude.json")              # Claude Code keeps `claude mcp add --scope user` servers here
        self.desktop = desktop_config or mcp.desktop_config_path()
        self.which, self.run, self.platform = which, run, platform or sys.platform
        self.runner = runner or resurrect._popen

    # ---- what is connected ----
    def _hooks_state(self):
        s = _load(self.settings)
        cmds = [h.get("command") or "" for evs in ((s or {}).get("hooks") or {}).values() if isinstance(evs, list)
                for e in evs if isinstance(e, dict) for h in e.get("hooks", []) if isinstance(h, dict)]
        ours = [c for c in cmds if self.hooks_mod.MARK in c]
        if not ours:
            return "off"
        here = os.path.normcase(os.path.join(self.hooks_mod.ROOT, "scripts", self.hooks_mod.MARK))
        return "on" if all(here in os.path.normcase(c) for c in ours) else "elsewhere"

    def _server_state(self, cfg):
        s = (((cfg or {}).get("mcpServers")) or {}).get(self.mcp_mod.NAME)
        if not s:
            return "off"
        args = [os.path.normcase(str(a)) for a in s.get("args", [])]
        return "on" if os.path.normcase(self.mcp_mod.SERVER) in args else "elsewhere"

    def status(self, snapshot=None, remote=None):
        cli = self.which("claude")
        desktop_dir = os.path.isdir(os.path.dirname(self.desktop))
        seen = 0
        sessions = 0
        for a in list((snapshot or {}).get("agents", [])) + list((snapshot or {}).get("departed", [])):
            if a.get("session"):
                sessions += 1
                seen = max(seen, a.get("seen") or 0)
        r = remote or {}
        return {
            "code": {"installed": bool(cli), "hooks": self._hooks_state(), "tools": self._server_state(_load(self.code_cfg)),
                     "sessions": sessions, "last_seen": seen},
            "desktop": {"installed": desktop_dir, "tools": self._server_state(_load(self.desktop))},
            "web": {"enabled": bool(r.get("enabled")), "online": bool(r.get("online")), "connectors": len(r.get("connectors") or [])},
            # a Claude Code session in the cloud, linked to this PC from the Claude app: it reaches this PC's shell and folders, not its hooks;
            # it joins with scripts/va.py through that shell once this program's folder and the .vanilla-agents folder are connected to it
            "cloud": {"folder": os.path.basename(os.path.dirname(self.hooks_mod.ROOT)), "home_dir": str(self.home / ".vanilla-agents")},
        }

    # ---- connect ----
    def connect_code(self):
        """Hooks (always) + the Vanilla Agents tools in Claude Code (when the `claude` command exists)."""
        if self.hooks_mod.main(["--settings", self.settings]) not in (0, None):
            raise RuntimeError("Claude Code's settings file could not be changed: %s" % self.settings)
        note = ""
        if self.which("claude"):
            py = sys.executable or "python"
            if self._server_state(_load(self.code_cfg)) == "elsewhere":
                self.run(self.mcp_mod.code_command(py, True), capture_output=True, text=True, timeout=60)
            r = self.run(self.mcp_mod.code_command(py, False), capture_output=True, text=True, timeout=60)
            out = ((r.stdout or "") + (r.stderr or "")).strip()
            if r.returncode != 0 and "already exists" not in out:
                note = out[:300]
        return {"ok": True, "note": note}

    def connect_desktop(self):
        if self.mcp_mod.write_desktop(self.desktop, sys.executable or "python", False, False) not in (0, None):
            raise RuntimeError("The Claude desktop app's settings file is not valid JSON, so it was left alone: %s" % self.desktop)
        return {"ok": True}

    def disconnect(self, way):
        py = sys.executable or "python"
        if way == "code":
            self.hooks_mod.main(["--settings", self.settings, "--remove"])
            if self.which("claude"):
                self.run(self.mcp_mod.code_command(py, True), capture_output=True, text=True, timeout=60)
        elif way == "desktop":
            self.mcp_mod.write_desktop(self.desktop, py, True, False)
        else:
            raise ValueError("unknown way: %s" % way)
        return {"ok": True}

    # ---- start a session to try it ----
    def command(self, folder):
        if self.platform.startswith("win"):
            return 'cd /d "%s" && claude' % folder.replace('"', "")
        import shlex
        return "cd %s && claude" % shlex.quote(folder)

    def start(self, folder):
        """A new terminal window running `claude` in the open project. Returns {"ok", "command"}; on trouble {"ok": False, "error", "command"}."""
        folder = str(folder or "")
        cmd = self.command(folder or ".")
        if not folder or not os.path.isdir(folder):
            return {"ok": False, "error": "Open a project first (Esc > Log Out picks one), so Claude knows which folder to work in.", "command": "claude"}
        claude = self.which("claude")
        if not claude:
            return {"ok": False, "error": "Claude Code is not installed on this PC (no `claude` command). Install it from claude.com/claude-code, then come back.", "command": cmd}
        claude = os.path.abspath(claude)
        if resurrect._inside(claude, folder):       # never a claude.bat planted in the project folder (as V-049)
            return {"ok": False, "error": "The `claude` command found is inside the project folder, so it is not started from here.", "command": cmd}
        if self.platform.startswith("win"):
            plans = [["cmd", "/c", "start", "", "cmd", "/k", claude]]
        elif self.platform == "darwin":
            script = self.command(folder)
            plans = [["osascript", "-e", 'tell application "Terminal" to do script %s' % resurrect._applescript_text(script), "-e", 'tell application "Terminal" to activate']]
        else:
            plans = [[self.which(t) or t] + pre + [claude] for t, pre in resurrect.LINUX_TERMINALS if self.which(t)]
        last = "no terminal program was found"
        for argv in plans:
            try:
                self.runner(argv, folder)
                return {"ok": True, "command": cmd}
            except OSError as e:
                last = str(e)
        return {"ok": False, "error": "The terminal could not be opened (%s)." % last, "command": cmd}

    def action(self, body, folder=None):
        way = body.get("connect") or body.get("disconnect") or body.get("start")
        if body.get("start"):
            return self.start(folder)
        if body.get("disconnect"):
            return self.disconnect(body["disconnect"])
        if way == "code":
            return self.connect_code()
        if way == "desktop":
            return self.connect_desktop()
        raise ValueError("unknown request")
