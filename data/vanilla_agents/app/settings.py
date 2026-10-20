"""the owner's own sound choices. Stored OUTSIDE the repo (app.json settings_path, or env VANILLA_SETTINGS); defaults come from sounds.json.
File shape: {"master": {"volume", "mute"}, "events": {name: {"sound", "volume", "enabled"}}} - only what the owner changed."""
import json
import os
import tempfile
import threading
from pathlib import Path

EVENT_KEYS = {"sound": str, "volume": (int, float), "enabled": bool}
MASTER_KEYS = {"volume": (int, float), "mute": bool}
HELPER_MODES = ("off", "ask", "on")   # helpers switch: off = never launch, ask = one click per launch, on = allowed
EXTRA = ("phone", "notify", "integrations", "chat", "addons", "remote")     # V-040 phone access, V-041 notifications, V-044 integrations, V-050 chat replies, V-051 which addons load, V-054 browser access: groups owned by their own modules (validated there), kept as they are here


def settings_path(cfg_app, env=os.environ):
    return Path(env.get("VANILLA_SETTINGS") or cfg_app["settings_path"]).expanduser()


def validate(body, sd):
    """Return a clean override dict or raise ValueError with a plain message. Unknown names/keys are errors."""
    if not isinstance(body, dict) or set(body) - {"master", "events", "paused", "helpers", *EXTRA}:
        raise ValueError("settings may only contain 'master', 'events', 'paused' and 'helpers'")
    ids = {s["id"] for s in sd["sounds"]}
    out = {k: body[k] for k in EXTRA if isinstance(body.get(k), dict)}
    if "paused" in body:
        out["paused"] = _val("paused", body["paused"], bool)
    if "helpers" in body:
        if body["helpers"] not in HELPER_MODES:
            raise ValueError("'helpers' must be off, ask or on")
        out["helpers"] = body["helpers"]
    for grp, keys in (("master", MASTER_KEYS),):
        g = body.get(grp, {})
        if not isinstance(g, dict) or set(g) - set(keys):
            raise ValueError("bad '%s' settings" % grp)
        out[grp] = {k: _val(grp + "." + k, v, keys[k]) for k, v in g.items()}
    evs = body.get("events", {})
    if not isinstance(evs, dict):
        raise ValueError("'events' must be a group")
    out["events"] = {}
    for n, e in evs.items():
        if n not in sd["events"]:
            raise ValueError("unknown sound event '%s'" % n)
        if not isinstance(e, dict) or set(e) - set(EVENT_KEYS):
            raise ValueError("bad settings for '%s'" % n)
        out["events"][n] = {k: _val("%s.%s" % (n, k), v, EVENT_KEYS[k]) for k, v in e.items()}
        if "sound" in e and e["sound"] not in ids:
            raise ValueError("unknown sound '%s'" % e["sound"])
    return out


def _val(name, v, kind):
    if not isinstance(v, kind) or (kind is not bool and isinstance(v, bool)) or (kind == (int, float) and not 0 <= v <= 1):
        raise ValueError("'%s' is not valid%s" % (name, " (volume must be 0 to 1)" if kind == (int, float) else ""))
    return v


def merge(base, over):
    out = {"master": {**base["master"], **over.get("master", {})}, "events": {}, "paused": bool(over.get("paused", False)), "helpers": over.get("helpers", "off")}
    for n, e in base["events"].items():
        out["events"][n] = {"label": e["label"], **{k: e[k] for k in EVENT_KEYS}, **over.get("events", {}).get(n, {})}
    return out


WRITE_LOCK = threading.RLock()      # V-049: every read-change-write of the settings file (sound, pause, phone, notify, integrations, chat, addons) one at a time


def load(path, sd):
    """Saved overrides; a missing or damaged file means 'no overrides' (defaults)."""
    try:
        return validate(json.loads(Path(path).read_text(encoding="utf-8")), sd)
    except (OSError, ValueError):
        return {"master": {}, "events": {}}


def save(path, over):
    """Atomic: write a temp file next to the target, then replace."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".settings-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(over, f, indent=1)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def update(path, patch, sd):
    """Apply a validated patch on top of the saved overrides, save, return the merged effective settings."""
    new = validate(patch, sd)
    with WRITE_LOCK:
        return _update(path, new, sd)


def _update(path, new, sd):
    old = load(path, sd)
    new = {k: v for k, v in new.items() if k not in EXTRA}      # only load_extra/save_extra change those groups
    keep = {k: load_extra(path, k) for k in EXTRA}       # V-048: from the file as saved, so a sound entry this version no longer knows cannot wipe the phone / notify / integrations groups
    over = {**{k: v for k, v in keep.items() if v}, "paused": new.get("paused", old.get("paused", False)), "helpers": new.get("helpers", old.get("helpers", "off")), "master": {**old["master"], **new["master"]}, "events": {n: {**old["events"].get(n, {}), **new["events"].get(n, {})} for n in {*old["events"], *new["events"]}}}
    save(path, over)
    return merge(sd, over)


def load_extra(path, name):
    """One of the EXTRA groups as saved ({} when missing or unreadable)."""
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        return d.get(name) if isinstance(d, dict) and isinstance(d.get(name), dict) else {}
    except (OSError, ValueError):
        return {}


def save_extra(path, name, value):
    """Replace one EXTRA group, keeping everything else in the file (sound choices, pause)."""
    if name not in EXTRA or not isinstance(value, dict):
        raise ValueError("unknown settings group")
    with WRITE_LOCK:
        _save_extra(path, name, value)


def _save_extra(path, name, value):
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        d = d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        d = {}
    d[name] = value
    save(path, d)
