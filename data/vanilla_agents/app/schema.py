"""What every config file may contain. Data only plus one small shape checker. A key ending in '?' is optional; '*' means free names."""
import re

from ..events.schema import SPEC as EVENT_SPEC

from ..contracts import CLAIM_STATUSES as OUTCOMES   # noqa: F401  (check_app reads S.OUTCOMES)

STATUSES = ("new", "progress", "ready", "complete", "failed", "blocked")
FRAME_NAMES = ("dialog", "gold", "tooltip", "metal", "parchment", "scroll")
HOTKEY_NAMES = ("quest_log", "character_sheet", "chat", "esc_menu", "verify", "pause", "spellbook", "backpack", "world_map", "idea", "jukebox", "jukebox_next", "inspect", "replay", "talents", "flight_map", "auction", "mailbox", "achievements", "meters", "party", "help", "zones")
COLOR_NAMES = ("gold", "white", "grey", "red", "green", "panel_dark", "health", "mana", "bar_back", "chat_system", "chat_agent", "chat_verifier", "cast")
CHANNELS = ("system", "agent", "verifier", "whisper")
AGENT_STATES = ("working", "idle")
# placeholders a UI sentence may use (events use their own set from the event schema)
UI_VARS = {"note", "names", "n", "text", "done", "total", "pct", "count", "role", "passed", "activity", "title", "error", "check", "checks", "when", "seconds", "file", "tool", "commit", "result", "reason", "zones", "explored", "cleared", "lines", "files", "evidence", "word", "goal", "nots", "name", "usd", "rate", "added", "removed", "inns", "project", "inn", "branch", "worktree", "base", "path", "author", "version"}
PANEL_NAMES = ("unit_frames", "quest_log", "character_sheet", "chat", "action_bar", "cast_bar", "esc_menu", "sound_menu", "spellbook", "backpack", "world_map", "raid_frames", "idea", "game_settings", "monitor", "gossip", "inspect", "replay", "talents", "flight_map", "auction", "mailbox", "achievements", "meters", "party", "help", "zones", "guide", "contest", "addons")
# per panel: names allowed under text / tips / icons / options
PANEL_KEYS = {
    "addons": {"text": ('install', 'browse', 'reload', 'reload_hint', 'empty', 'folder', 'count', 'legacy', 'kind_folder', 'enabled', 'disabled', 'by', 'version', 'problem', 'details', 'pick', 'about', 'permissions', 'perm_state', 'perm_panel', 'perm_inn', 'perm_chat', 'perm_actions', 'perm_network', 'perm_none', 'perm_legacy', 'trust', 'license', 'no_license_file', 'homepage', 'source', 'enable', 'disable', 'remove', 'remove_sure', 'yes', 'cancel', 'removed', 'package', 'packaged', 'pkg_where', 'pkg_zip', 'pkg_yml', 'pkg_sha', 'pkg_rehost', 'pkg_link', 'submit_head', 'submit_1', 'submit_2', 'submit_3', 'back', 'installing', 'installed', 'exists', 'replace', 'too_big', 'error', 'browse_title', 'browse_note', 'browse_loading', 'browse_empty', 'get', 'have', 'link_only'),
               "tips": ("install", "browse", "reload", "toggle", "remove", "package", "replace", "trust"), "icons": ("legacy", "folder", "workshop"), "options": ()},
    "zones": {"text": ("ek", "kalimdor", "own", "own_zone", "own_empty", "inns", "here", "travel", "travelling", "no_photo", "not_baked", "no_inns", "remember", "remember_none", "faction_alliance", "faction_horde", "faction_contested", "count", "error", "tour"), "tips": ("travel", "remember", "photo", "tour"), "icons": ("alliance", "horde", "contested", "own"), "options": ()},
    "guide": {"text": ("search", "no_match", "open", "setting", "need_helper", "keys", "results"), "tips": ("search", "open", "setting"), "icons": ("book",), "options": ()},
    "help": {"text": ("keys", "moving", "start", "start_1", "start_2", "start_3", "about", "version", "disclaimer", "licences", "diag", "diag_saved", "diag_error", "diag_hint", "move_keys", "move_mouse", "low_quality", "guide", "guide_hint", "phone", "phone_text", "phone_open", "notify_open"), "tips": ("diag", "guide", "phone_open", "notify_open"), "icons": (), "options": ()},
    "party": {"text": ("host_title", "host_hint", "party_name", "your_name", "host", "join_title", "join_hint", "invite", "join", "copy", "copied", "leave", "members", "helpers", "agrees", "away", "plan", "plan_empty", "by", "owner", "mine", "nobody", "take", "remove", "propose_title", "item_title", "item_why", "propose", "size_small", "size_medium", "size_big", "agree", "agreed", "locked", "unlock", "need_name", "need_link", "need_title", "status_open", "status_quest", "status_progress", "status_ready", "status_complete", "status_failed", "status_blocked", "log", "error", "reach", "reach_local", "reach_network", "expires_label", "hours", "minutes", "expires_in", "expired", "renew", "host_badge", "kick", "kick_sure", "warn_http", "local_note", "invited", "invited_unknown", "join_as", "not_now", "link_lan", "link_vpn", "share_hint"), "tips": ("host", "join", "agree", "take", "item", "reach", "renew", "kick"), "icons": ("crown", "member"), "options": ("port", "log_lines", "invite_hours")},
    "inspect": {"text": ("count", "empty", "empty_agent", "filtered", "show_all", "pick", "loading", "added", "removed", "no_diff", "truncated", "error", "status_m", "status_a", "status_d", "status_r", "status_u", "place", "place_wt", "other_checkout", "branch_head"), "tips": ("slot", "filter", "show_all", "diff", "place"), "icons": ("modified", "added", "deleted", "renamed", "untracked", "bar", "bar_border"), "options": ("max_files", "medium", "large", "huge")},
    "replay": {"text": ("play", "pause", "speed", "live", "live_now", "at", "empty", "error"), "tips": ("slider", "play", "speed", "live", "when"), "icons": ("watch", "track", "track_border"), "options": ("tick_ms",)},
    "mailbox": {"text": ("empty", "count", "back", "delete"), "tips": ("button", "letter", "back", "delete"),
                "icons": ("button", "ring", "run_ok", "run_failed", "verified", "failed", "elsewhere", "whisper", "daily"), "options": ("max_letters",)},
    "achievements": {"text": ("count", "earned", "locked", "toast"), "tips": ("player_title",),
                     "icons": ("first_blood", "first_report", "green_streak", "clean_hands", "comeback", "flawless", "questmaster", "champion", "full_house",
                               "party_of_five", "busy_bee", "toolsmith", "scribe", "whisperer", "diplomat", "night_owl", "early_bird"),
                     "options": ("streak", "party", "busy_actions", "files", "whispers", "answers", "questmaster", "champion", "full_house", "tools", "flawless_checks", "max_toasts")},
    "meters": {"text": ("tab_rate", "tab_total", "tab_passed", "tab_log", "empty", "log_empty", "rate", "total", "passed", "bar_body", "tab_cost", "cost", "cost_rate", "cost_empty", "cost_body", "tab_tokens", "tokens", "tokens_empty", "tokens_body"),
               "tips": ("tab_rate", "tab_total", "tab_passed", "tab_log", "tab_cost", "tab_tokens"), "icons": (), "options": ("window_seconds", "max_bars", "max_log")},
    "unit_frames": {"text": ("player_name", "target_none", "health", "mana", "mana_unknown", "paused", "mana_plan", "mana_week"), "tips": ("player", "health", "mana", "target"), "icons": ("player", "target"), "options": ()},
    "raid_frames": {"text": ("empty", "quests", "no_quests", "working", "idle", "more", "mana", "group", "needs_permission", "needs_question", "needs_input", "stunned"), "tips": ("frame", "group"), "icons": (), "options": ("columns", "max_frames")},
    "raid_frames": {"text": ("empty", "quests", "no_quests", "working", "idle", "more", "mana", "group", "needs_permission", "needs_question", "needs_input", "stunned", "clash", "place", "place_wt", "left", "resurrect", "resurrect_ok", "resurrect_fail", "menu_talk", "menu_hint", "contest"), "tips": ("frame", "group", "menu_talk", "resurrect", "left"), "icons": (), "options": ("columns", "max_frames")},
    "quest_log": {"text": ("done_elsewhere", "empty", "objectives", "count", "route_fast", "route_full", "approve", "approved", "unapproved", "approve_error", "sent_back", "why", "size_small", "size_medium", "size_big", "risk_high", "needs_plain", "tier_ask", "tier_yes", "tier_change", "tier_explain", "tier_asked", "change_prompt", "change_send", "tier_never", "tier_auto", "tier_veto", "tier_vetoed", "answer", "waiting", "compete", "compete_tries", "competing", "compete_roll", "compete_won", "ci_passed", "ci_failed", "ci_running", "ci_cancelled", "ci_none", "ci_unknown", "ci_now", "ci_min", "ci_hour", "ci_day"), "tips": ("objective", "details", "needs_plain", "route_fast", "route_full", "approve", "approved", "sent_back", "tier_yes", "tier_change", "tier_explain", "tier_never", "tier_auto", "tier_veto", "compete", "compete_roll", "ci"), "icons": ("scroll",), "options": ("max_tasks",)},
    "character_sheet": {"text": ("none", "role", "work_done", "pass_rate", "pass_rate_none", "tools", "tools_none", "doing", "idle", "level", "xp", "rate", "rate_none", "past", "current", "next", "next_none", "force", "back", "forward"),
                        "tips": ("portrait", "pass_rate", "tools", "xp", "rate", "timeline", "force", "back", "forward"), "icons": ("portrait",), "options": ()},
    "chat": {"text": ("empty", "offline", "filter", "filter_all", "filter_agents", "filter_system", "filter_checker", "cmd_placeholder", "cmd_unknown", "cmd_no_helper", "cmd_empty", "cmd_error", "search", "filter_helper", "no_match",
                      "tab_general", "tab_community", "tabs", "community_none", "community_empty", "community_placeholder", "community_join", "community_leave",
                      "community_removed", "community_announce", "community_unread", "community_delete", "community_need_party"),
             "tips": ("window", "filter", "input", "search", "tab_general", "tab_community", "community_delete"), "icons": (),
             "options": ("community_sound", "community_volume_pct")},
    "monitor": {"text": ("heading", "agents", "feed", "checker", "load", "live", "offline", "idle", "running", "paused", "since", "ci", "ci_passed", "ci_failed", "ci_running", "ci_cancelled", "ci_none", "ci_unknown"), "tips": ("agents", "feed", "checker", "ci"), "icons": ("agents", "feed", "checker", "ci"), "options": ()},
    "action_bar": {"text": ("resume", "hearth_again", "nobody"), "tips": ("resume",), "icons": ("resume",), "options": ()},
    "cast_bar": {"text": ("casting", "done"), "tips": ("cast",), "icons": (), "options": ()},
    "spellbook": {"text": ("empty", "count", "never", "took", "last", "running", "not_registered", "paused", "problem"), "tips": ("default",), "icons": ("default",), "options": ("columns", "slots")},
    "backpack": {"text": ("empty", "count", "running_name", "file_name", "more"), "tips": ("empty_slot",), "icons": ("run", "run_failed", "running", "file"), "options": ("columns", "slots", "max_runs", "max_files")},
    "world_map": {"text": ("empty", "problem_not_git", "count", "files", "files_lines", "touched", "never", "state_line", "use_undiscovered", "use_explored", "use_cleared",
                           "edited", "here", "detail_empty", "legend_edited", "legend_here", "legend_heroes", "hero_file", "hero_seen", "hero_working", "hero_idle"), "tips": (), "icons": ("parchment", "fog"), "options": ()},
    "contest": {"text": ("head", "empty", "by", "branch", "worktree", "files", "verdict_none", "verdict_pass", "verdict_fail", "verdict_running", "check", "show", "need", "pass",
                         "confirm", "yes", "no", "need_roll", "greed_roll", "won", "told", "winner", "stopped", "stop", "error", "passed", "pick_quest"),
                "tips": ("item", "row", "check", "show", "need", "pass", "stop", "log"),
                "icons": ("item_unknown", "item_small", "item_medium", "item_big", "need", "need_down", "need_hl", "pass", "pass_down", "pass_hl", "swords"), "options": ("roll_ms",)},
    "idea": {"text": ("none", "missing", "draft", "goal", "non_goals", "done_means", "out_of_scope", "nothing", "approved", "unapproved", "changed", "approve", "approve_error", "draft_error", "needs_plain"),
             "tips": ("needs_plain", "goal", "non_goals", "done_means", "out_of_scope", "approved", "unapproved", "changed", "approve", "draft"), "icons": ("scroll",), "options": ("max_lines",)},
    "gossip": {"text": ("role", "greet_activity", "greet_doing", "greet_quest", "greet_idle", "greet_ready", "greet_failed", "greet_blocked", "greet_complete", "greet_checks", "opt_work", "opt_changes", "opt_explain", "opt_change", "opt_verify", "opt_whisper", "opt_bye", "work_recent", "work_none", "work_quest", "work_no_objectives", "files_head", "files_none", "files_more", "explain_asked", "answer", "change_prompt", "change_sent", "whisper_prompt", "whisper_sent", "verify_sent", "send", "back", "error", "thread", "thread_empty", "to", "from", "to_all", "close", "opt_follow", "opt_unfollow", "opt_rest", "opt_wake", "follow_on", "follow_off", "rest_ok", "rest_busy", "wake_text", "todo_head", "clash", "opt_resurrect", "resurrect_ok", "resurrect_fail", "greet_left", "place", "place_wt"), "tips": ("portrait", "greeting", "work", "changes", "explain", "change", "verify", "whisper", "bye", "thread", "close", "follow", "rest", "wake", "resurrect", "resurrect_cmd"), "icons": ("work", "changes", "explain", "change", "verify", "whisper", "bye", "divider", "bullet", "portrait", "follow", "rest", "wake", "resurrect"), "options": ("max_lines", "max_files", "max_thread", "voice_volume_pct")},
    "game_settings": {"text": ("guide", "game_note"), "tips": ("guide",), "icons": (), "options": ()},
    "talents": {"text": ("none", "who", "points", "tab_tools", "tab_trust", "tab_results", "tree_points", "rank", "rank_short", "count", "uses", "quests", "checks_of", "tools_none", "never", "ask", "auto", "yours", "passed", "failed", "checks", "ready", "footer"), "tips": ("tab", "tool", "never", "ask", "auto", "yours", "passed", "failed", "checks", "ready", "footer"), "icons": ("bg_tools_tl", "bg_tools_tr", "bg_tools_bl", "bg_tools_br", "bg_trust_tl", "bg_trust_tr", "bg_trust_bl", "bg_trust_br", "bg_results_tl", "bg_results_tr", "bg_results_bl", "bg_results_br", "rank", "tool_read", "tool_edit", "tool_write", "tool_bash", "tool_search", "tool_web", "tool_task", "tool_other", "never", "ask", "auto", "yours", "passed", "failed", "checks", "ready"), "options": ()},
    "flight_map": {"text": ("none", "count", "here", "pick", "ask", "fly", "cancel", "flying", "error", "error_list", "zones"), "tips": ("point", "here"), "icons": ("map", "point", "here", "highlight", "line"), "options": ()},
    "auction": {"text": ("tab_open", "tab_taken", "col_item", "col_size", "col_risk", "col_who", "col_status", "empty_open", "empty_taken", "count", "size_small", "size_medium", "size_big", "size_unknown", "risk_low", "risk_high", "risk_unknown", "post_title", "post_name", "post_why", "post", "posting", "posted", "post_error", "need_title", "loot_ready", "loot_need", "loot_greed", "loot_pass", "loot_note", "loot_send", "loot_error", "loot_more", "tab_imported", "src_all", "src_github", "src_jira", "src_linear", "kind_pr", "open_link", "make_quest", "making", "made", "make_error", "hide", "empty_imported", "count_imported", "settings"), "tips": ("tab", "row", "post", "loot_need", "loot_greed", "loot_pass", "loot_timer", "source", "link", "make", "hide", "imported", "settings"), "icons": ("item_unknown", "item_small", "item_medium", "item_big", "item_frame", "src_github", "src_jira", "src_linear", "loot_need", "loot_need_down", "loot_need_hl", "loot_greed", "loot_greed_down", "loot_greed_hl", "loot_pass", "loot_pass_down", "loot_pass_hl"), "options": ("max_rows", "loot_seconds", "loot_max")},
    "sound_menu": {"text": ("master", "mute", "enabled", "test", "saved", "error", "back", "helpers", "helpers_off", "helpers_ask", "helpers_on"), "tips": (), "icons": (), "options": ()},
    "esc_menu": {"text": ("settings", "sound", "character", "character_title", "project", "resume", "quit", "options", "support", "macros", "logout", "unavailable", "quit_hint", "project_title", "project_empty", "project_path", "project_open", "project_error", "project_add", "project_adding", "project_added", "project_add_error", "back", "zones", "guide", "addons"), "tips": ("project_add", "guide"), "icons": (), "options": ()},
}

APP = {"host": "str", "port": "int", "assets_dir": "str", "data_dir": "str", "feed_path": "str", "project_roots": ["str"], "chat_max_lines": "int",
       "sse_check_seconds": "num", "sse_keepalive_seconds": "num", "settings_path": "str", "window": {"width": "int", "height": "int"}, "browser_profile_dir": "str",
       "transcripts_dir": "str", "transcript_offsets_path": "str", "transcript_poll_seconds": "num", "transcript_idle_minutes": "num",
       "transcript_recent_minutes": "num", "transcript_max_agents": "int", "transcript_context_tokens": "int",
       "projects_path": "str", "trusted_root": "str", "ideas_root": "str", "verify_work_root": "str", "verify_min_free_bytes": "int", "verify_check_seconds": {"*": "num"}, "verify_default_seconds": "num",
       "verify_fake_seconds": "num", "approvals_path": "str", "approvals_max_tasks": "int", "approvals_max_projects": "int", "plan_approval_required": "bool", "tiers": {"enabled": "bool", "ask_sizes": ["str"], "risky_words": ["str"], "never": {"*": ["str"]}}, "route": {"max_fast_files": "int", "max_fast_lines": "int", "full_paths": ["str"], "trusted_paths": ["str"]}, "runs_path": "str", "runs_max_bytes": "int", "runs_api_limit": "int",
       "daily": {"enabled": "bool", "quests": [{"title": "str", "why": "str", "at": "str", "days": ["str"]}]},
       "background_sessions": {"enabled": "bool", "poll_seconds": "num", "timeout_seconds": "num"},
       "integrations": {"timeout_seconds": "num", "max_items": "int", "max_file_bytes": "int", "refresh_minutes": "int", "ci_seconds": "num", "excerpt_chars": "int"},
       "addons": {"workshop_index_url": "str", "timeout_seconds": "num", "max_zip_bytes": "int", "max_files": "int", "max_unpacked_bytes": "int"},
       "remote": {"relay_url": "str", "connector_base": "str", "page_url": "str", "invite_minutes": "num", "event_min_seconds": "num"}}
MAP = {"grid": {"cols": "int", "rows": "int"}, "zone_max": "int", "split_dirs": ["str"], "git_timeout_seconds": "num", "git_max_bytes": "int",
       "read_tools": ["str"], "edit_tools": ["str"], "activity_path": "str", "activity_keep_days": "num", "activity_max_zones": "int", "activity_max_projects": "int",
       "refresh_seconds": "num", "states": {"*": {"word": "uikey", "color": "str", "fill": "color"}}}
GLOSSARY = {"terms": {"*": "str"}}
# V-037 feature guide: chapters -> topics; keys = hotkey names shown as key caps, panel = a window to open, setting = an Options choice to jump to
GUIDE = {"chapters": [{"id": "str", "title": "uikey", "topics": [{"id": "str", "title": "uikey", "body": ["uikey"], "keys?": ["hotkey"], "panel?": "str", "setting?": "str"}]}]}
ACTION_SLOTS = ("verify", "pause", "needs", "quests", "changes", "hearth")     # what an action bar button can do (actionbar.js)
GUIDE_KEYS_CHAPTER = "keys"     # the Keyboard reference: every hotkey must be listed there
MAP_STATES = ("UNDISCOVERED", "EXPLORED", "CLEARED")
# edge = the game's 8-piece strip, or (nine: true) a ready 3x3 image whose corners are `cell` px; rolls = scroll ends drawn above and below; bg_tile 0 = stretch the background
FRAME = {"edge?": "asset", "nine?": "bool", "rolls?": {"top": "asset", "bottom": "asset"}, "cell": "int", "width": "int", "background?": "asset", "bg_tile": "int", "inset": "int", "bg_color": "color"}
THEME = {"fonts": {"*": {"family": "str", "file": "asset"}}, "sizes": {"text_px": "int", "title_px": "int", "small_px": "int"},
         "colors": {"*": "color"}, "frames": {"*": FRAME}, "buttons": {"up": "asset", "down": "asset", "highlight": "asset"},
         "bar_texture": "asset", "slot_texture": "asset", "markers": {"new": "asset", "ready": "asset", "progress": "asset"}, "skin?": {"*": "asset"}}
HOTKEYS = {"*": "str"}
METAPHORS = {
    "events": {"*": {"channel": "str", "task_status?": "str", "agent_state?": "str", "only_from?": ["str"], "toast?": "str"}},
    "task_states": {"*": {"marker": "str", "color": "str", "word": "uikey", "tip": "tipkey"}},
    "agent_states": {"*": {"pose": "str"}},
    "toasts": {"*": {"text": "uikey", "color": "str"}},
    "item_quality": {"*": {"border": "str", "color": "str", "word": "uikey", "outcomes": ["str"]}},
    "spell_marks": {"*": {"mark": "str", "color": "str", "word": "uikey"}},
    "work_products": {"file_tools": ["str"]},
    "auras": {"*": {"icon": "asset", "kind": "str", "word": "uikey", "tip": "tipkey"}},
}
WORKSHOP = {
    "scene": {"wall": "color", "floor": "color", "floor_line": "color", "horizon": "num", "window_glow": "color", "candle": "color"},
    "desks": [{"x": "num", "y": "num"}],
    "desk": {"w": "int", "h": "int", "top": "color", "front": "color", "edge": "color"},
    "monitor": {"w": "int", "h": "int", "bezel": "color", "glass": "color", "glow": "color", "text": "color", "lines": "int"},
    "roles": {"*": {"body": "color", "skin": "color", "hair": "color"}},
    "animation": {"typing_ms": "int", "arm_swing_px": "int"},
    "text": {"empty": "uikey", "screen_idle": "uikey"},
    "agent_tip": "tipkey",
    "renderer": "str",
    "scene3d": {
        "wall_z": "num", "camera": {"pos": ["num"], "look": ["num"], "fov": "num"},
        "lights": {"key": "color", "key_pos": ["num"], "key_intensity": "num", "flicker": "num", "ambient": "color", "ambient_intensity": "num",
                   "fog": "color", "fog_near": "num", "fog_far": "num"},
        "models": {"character": "asset", "chair": "asset", "desk": "asset"},
        "fit": {"max_agents": "int", "spacing": "num", "row_gap": "num", "arc": "num", "turn": "num", "pad": "num"},
        "layout": {"desk": {"pos": ["num"], "rot": "num", "scale": "num"}, "chair": {"pos": ["num"], "rot": "num", "scale": "num"},
                   "character": {"pos": ["num"], "rot": "num", "scale": "num"}, "monitor": {"pos": ["num"], "rot": "num"}},
        "monitor": {"h": "num", "radius": "num", "arc_deg": "num", "bezel_w": "num", "stand_h": "num", "bezel": "color", "glass": "color", "glow": "color"},
        "clips": {"sit": "str", "stand": "str", "walk?": "str"},
        "arrival?": {"speed": "num", "lane": "num", "door_u": "num", "sit_fade_s": "num"},
        "typing": [{"key": "int", "child": "int", "axis": ["num"], "deg": "num", "hz": "num", "phase": "num", "rest_deg": "num", "tap?": "bool"}],
    },
    # V-043: how helpers do their tasks in the inn (command patterns -> anvil / carrying to the crates) and the candle lights.
    # The patterns are shared by the browser (RegExp, flag i) and tests: keep to the common subset (no (?P, no inline flags, no \A \Z).
    "inn": {
        "tasks": {"test": ["str"], "ship": ["str"], "hold_s": "num", "back_s": "num", "anvil": "str", "drop": "str", "ask_every_s": "num"},
        "lights": {"names": "str", "max": ["int"], "merge": "num", "color": "color", "intensity": "num", "distance": "num", "flicker": "num", "pick_s": "num",
                   "time": {"day": "num", "dusk": "num", "night": "num"}, "fill": {"day": "num", "dusk": "num", "night": "num"}},
    },
}
PANEL = {
    "title?": "uikey", "frame": "frame", "anchor": {"left?": "int", "right?": "int", "top?": "int", "bottom?": "int", "center_x?": "bool"},
    "size": {"w": "int", "h": "int"}, "visible": "bool", "hotkey?": "hotkey", "text?": {"*": "uikey"}, "tips?": {"*": "tipkey"},
    "icons?": {"*": "asset"}, "options?": {"*": "int"},
    "slots?": [{"id": "str", "label": "uikey", "icon": "asset", "tip": "tipkey", "key?": "str"}],
    "spells?": [{"id": "str", "icon": "asset"}],
}
ITEM_STATES = ("VERIFIED", "FAILED", "BLOCKED", "RUNNING", "FILE")
AURAS = ("running", "paused", "failed", "blocked", "approved", "auto", "verified", "lease")     # same order as auras.ORDER
AURA_KINDS = ("buff", "debuff")
SPELL_MARKS = ("VERIFIED", "FAILED", "BLOCKED", "NEVER")
SOUND_EVENTS = ("agent_finished", "task_verified", "task_failed", "task_blocked", "usage_low", "agent_started", "quest_ready", "needs_you")
SOUNDS = {"master": {"volume": "num", "mute": "bool"}, "usage_low_pct": "int",
          "sounds": [{"id": "str", "label": "str", "path": "asset"}],
          "events": {"*": {"label": "str", "sound": "str", "volume": "num", "enabled": "bool"}}, "triggers": {"*": "str"}}
TOOLTIP = {"title": "str", "body": "str", "use?": "str"}

_COLOR = re.compile(r"^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\([0-9., ]+\))$")
_KINDS = {"str": lambda v: isinstance(v, str), "int": lambda v: isinstance(v, int) and not isinstance(v, bool),
          "num": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool), "bool": lambda v: isinstance(v, bool),
          "color": lambda v: isinstance(v, str) and bool(_COLOR.match(v))}
_HUMAN = {"int": "a whole number", "num": "a number", "bool": "true or false", "str": "text", "color": "a colour like #ffd100",
          "asset": "an image or font path", "uikey": "a name from strings/ui.json", "tipkey": "a name from strings/tooltips.json",
          "frame": "a frame name", "hotkey": "a name from hotkeys.json"}


def shape(value, spec, path, errs, refs):
    """Append plain-language problems to errs; append (path, kind, value) for every reference to refs."""
    if isinstance(spec, str):
        ok = _KINDS.get(spec, _KINDS["str"])(value)
        if not ok:
            errs.append("'%s' should be %s." % (path, _HUMAN[spec]))
        elif spec in ("asset", "uikey", "tipkey", "frame", "hotkey"):
            refs.append((path, spec, value))
        return
    if isinstance(spec, list):
        if not isinstance(value, list):
            return errs.append("'%s' should be a list." % path)
        for i, v in enumerate(value):
            shape(v, spec[0], "%s[%d]" % (path, i), errs, refs)
        return
    if not isinstance(value, dict):
        return errs.append("'%s' should be a group of settings { ... }." % path)
    if "*" in spec:
        for k, v in value.items():
            shape(v, spec["*"], "%s.%s" % (path, k) if path else k, errs, refs)
        return
    req = {k for k in spec if not k.endswith("?")}
    known = {k.rstrip("?") for k in spec}
    for k in sorted(req - set(value)):
        errs.append("'%s' is missing the setting '%s'." % (path or "(top)", k))
    for k in sorted(set(value) - known):
        errs.append("'%s' has a setting nobody uses: '%s'. Remove it or fix the spelling." % (path or "(top)", k))
    for k, v in value.items():
        if k in known:
            shape(v, spec.get(k, spec.get(k + "?")), "%s.%s" % (path, k) if path else k, errs, refs)


def flat_keys(value, path=""):
    """Every setting as a dotted path; lists end in []; used by CHANGE-GUIDE and its test."""
    if isinstance(value, dict) and value:
        for k, v in value.items():
            yield from flat_keys(v, "%s.%s" % (path, k) if path else k)
    elif isinstance(value, list) and value:
        if all(isinstance(v, dict) for v in value):
            seen = []
            for v in value:
                for p in flat_keys(v, path + "[]"):
                    if p not in seen:
                        seen.append(p)
            yield from seen
        else:
            yield path + "[]"
    else:
        yield path


EVENT_TYPES = tuple(EVENT_SPEC)
