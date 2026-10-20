"""Copy Vanilla Agents' browser-access pieces into an Open Vanilla checkout (V-054). Nothing is pushed.

    python scripts/export_browser_access.py <path to OpenVanilla>

Writes there:
    www/agents/live/index.html, js/remote.js, js/remote-core.js, css/remote.css   the page a pairing link opens (GitHub Pages)
    hetzner/agents-relay/varelay/{__init__,relay,wsproto}.py                       the relay that agents_relay_up.sh runs on the server
Run it again after changing any of them here; it says which files changed.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
FILES = {
    "app/web/remote.html": "www/agents/live/index.html",
    "app/web/js/remote.js": "www/agents/live/js/remote.js",
    "app/web/js/remote-core.js": "www/agents/live/js/remote-core.js",
    "app/web/css/remote.css": "www/agents/live/css/remote.css",
    "vanilla_agents/remote/relay.py": "hetzner/agents-relay/varelay/relay.py",
    "vanilla_agents/remote/wsproto.py": "hetzner/agents-relay/varelay/wsproto.py",
}
STAMP = {".py": "# Copied from Vanilla Agents ({src}) by scripts/export_browser_access.py. Change it there, not here.\n",
         ".js": "// Copied from Vanilla Agents ({src}) by scripts/export_browser_access.py. Change it there, not here.\n",
         ".css": "/* Copied from Vanilla Agents ({src}) by scripts/export_browser_access.py. Change it there, not here. */\n",
         ".html": None}


def main(argv):
    if len(argv) != 1 or not (Path(argv[0]) / "www").is_dir():
        print(__doc__)
        return 1
    dest = Path(argv[0])
    changed = 0
    jobs = dict(FILES)
    for src, dst in jobs.items():
        text = (HERE / src).read_text(encoding="utf-8")
        stamp = STAMP[Path(src).suffix]
        if stamp:
            text = stamp.format(src=src) + text
        else:
            text = text.replace("<html lang=\"en\">", "<html lang=\"en\">\n<!-- Copied from Vanilla Agents (%s) by scripts/export_browser_access.py. Change it there, not here. -->" % src, 1)
        out = dest / dst
        old = out.read_text(encoding="utf-8") if out.is_file() else None
        if old != text:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8", newline="\n")
            print("updated " + dst)
            changed += 1
    init = dest / "hetzner/agents-relay/varelay/__init__.py"
    if not init.is_file():
        init.write_text('"""The Vanilla Agents relay, copied from vanilla_agents/remote (see relay.py)."""\n', encoding="utf-8", newline="\n")
        changed += 1
    print("%d file(s) changed" % changed if changed else "already up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
