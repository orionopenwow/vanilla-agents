"""Vanilla Agents for any Claude that can run a shell on this PC, or is linked to it (a Claude Code session in the cloud started from the
Claude app with this PC linked: it runs commands through the PC's shell, so the PC's hooks never see it). It writes the same feed the hooks and
the MCP tools write, so the Claude walks into the inn as a helper.

    python3 va.py hello "what I am doing"          walk in (or say what you are doing now)
    python3 va.py quest "plain title" [--why ...]  put your task in the quest log (the owner approves it)
    python3 va.py progress "short plain line"      now and then while working
    python3 va.py ready <quest id>                 hand the quest in (only the owner's checker completes it)
    python3 va.py requests                         the owner's whispers and change requests for you
    python3 va.py reply "text"                     answer the owner
    python3 va.py bye ["note"]                     done for now
Options: --name <helper name> (default: "Cloud Claude" + a short id kept for this shell), --feed <path to feed.jsonl>.

The feed is found on its own: $VANILLA_FEED, else the .vanilla-agents folder next to this program's folder (in a linked session's shell this
PC's folders are mounted side by side), else ~/.vanilla-agents. Standard library only; exit code 1 with a plain
message when the feed cannot be found."""
import argparse
import json
import os
import secrets
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


def _real(folder):
    return os.path.isdir(folder) and any(os.path.exists(os.path.join(folder, n)) for n in ("feed.jsonl", "work", "assets"))


def find_feed(env=os.environ, home=None, here=HERE):
    if env.get("VANILLA_FEED"):
        return env["VANILLA_FEED"]
    # the program's own home first, looked for next to this program's folder: in a linked session's shell this PC's folders are mounted side by
    # side (<mnt>/<this program's folder>/data/scripts/va.py and <mnt>/.vanilla-agents); on the PC itself this finds C:\Users\<you>\.vanilla-agents
    p = here
    for _ in range(6):
        p = os.path.dirname(p)
        if _real(os.path.join(p, ".vanilla-agents")):
            return os.path.join(p, ".vanilla-agents", "feed.jsonl")
    own = os.path.join(home or os.path.expanduser("~"), ".vanilla-agents")
    if _real(own):
        return os.path.join(own, "feed.jsonl")
    return None


def default_name(home=None):
    """One name per shell home (a linked session keeps its own home), so two cloud Claudes are two helpers."""
    home = home or os.path.expanduser("~")
    f = os.path.join(home, ".va_cloud_name")
    try:
        with open(f, encoding="utf-8") as fh:
            name = fh.read().strip()
        if name:
            return name
    except OSError:
        pass
    name = "Cloud Claude " + secrets.token_hex(2)
    try:
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(name)
    except OSError:
        pass
    return name


def main(argv=None, out=sys.stdout):
    ap = argparse.ArgumentParser(prog="va.py", description=__doc__.split("\n")[0])
    ap.add_argument("--name")
    ap.add_argument("--feed")
    ap.add_argument("what", choices=["hello", "quest", "progress", "ready", "requests", "reply", "bye"])
    ap.add_argument("text", nargs="?", default="")
    ap.add_argument("--why")
    ap.add_argument("--quest", help="the quest this progress is for")
    a = ap.parse_args(argv)
    feed = a.feed or find_feed()
    if not feed:
        print("Vanilla Agents' folder (.vanilla-agents in the PC user's home) is not reachable from here. In a linked cloud session, connect "
              "that folder (C:\\Users\\<you>\\.vanilla-agents) to the session, then try again.", file=out)
        return 1
    from vanilla_agents.mcp import Tools
    t = Tools(feed_path=feed)
    name = a.name or default_name()
    if a.what in ("hello", "progress"):
        r = t.report_progress(a.text or "Getting started", quest=a.quest, agent=name)
    elif a.what == "quest":
        r = t.start_quest(a.text, why=a.why, agent=name)
        t.claim_quest(r["quest"], agent=name)
    elif a.what == "ready":
        r = t.quest_ready(a.text, agent=name)
    elif a.what == "requests":
        r = t.pending_requests(agent=name)
    elif a.what == "reply":
        r = t.reply(a.text, agent=name)
    else:
        r = t.done_for_now(a.text or None, agent=name)
    print(json.dumps(dict(r, helper=name) if isinstance(r, dict) else {"result": r, "helper": name}, ensure_ascii=False), file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
