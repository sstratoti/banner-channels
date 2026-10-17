"""Pure Banner Channels feed evaluation. No Home Assistant imports."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime
from fnmatch import fnmatch
from typing import Callable, NamedTuple


class Snap(NamedTuple):
    state: str
    name: str
    attributes: dict | None = None


def compare(state: str, operator: str, value: str) -> bool:
    if operator == "is":
        return state == value
    if operator == "is_not":
        return state != value
    try:
        left = float(state)
        right = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(left) or not math.isfinite(right):
        return False
    if operator == "above":
        return left > right
    if operator == "at_or_above":
        return left >= right
    if operator == "below":
        return left < right
    if operator == "at_or_below":
        return left <= right
    return False


def in_window(now: datetime, start: str, end: str) -> bool:
    def minutes(hhmm: str) -> int:
        hour, minute = hhmm.split(":")
        return int(hour) * 60 + int(minute)

    current = now.hour * 60 + now.minute
    start_m = minutes(start)
    end_m = minutes(end)
    if start_m == end_m:
        return True
    if start_m < end_m:
        return start_m <= current < end_m
    return current >= start_m or current < end_m


_OFFLINE = frozenset({"unavailable", "unknown"})
SEVERITIES = ("info", "warning", "problem")
_ICON = re.compile(r"^mdi:[a-z0-9-]+$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _asks_about_offline(operator: str, value) -> bool:
    return operator in ("is", "is_not") and str(value) in _OFFLINE


def _comparable(state: str | None, operator: str, value) -> bool:
    if state is None:
        return False
    if state in _OFFLINE and not _asks_about_offline(operator, value):
        return False
    return True


def _fill(text: str, state: str, name: str) -> str:
    return (text or "").replace("{state}", state).replace("{name}", name)


def _is_template(text: str) -> bool:
    return "{{" in text or "{%" in text


def _line(text, state, name, entity_id, rule_id, render_template) -> str:
    source = text or ""
    plain = _fill(source, state, name)
    if not _is_template(source) or render_template is None:
        return plain
    try:
        return render_template(
            source,
            {
                "state": state,
                "name": name,
                "entity_id": entity_id,
                "rule_id": rule_id,
            },
        )
    except Exception:
        return plain


def _styled(text, pattern, state, name, entity_id, rule_id, render_template) -> str:
    source = text or ""
    if not _is_template(source):
        return source
    rendered = _line(source, state, name, entity_id, rule_id, render_template).strip()
    return rendered if pattern.match(rendered) else ""


def _resolve_action(action: dict | None, matched: str, kind: str) -> dict:
    act = (action or {}).get("action") or ""
    if not act:
        if kind == "tap":
            return {"action": "more-info", "entity": matched}
        return {"action": "none"}
    if act == "none":
        return {"action": "none"}
    if act == "more-info":
        return {"action": "more-info", "entity": action.get("entity") or matched}
    if act == "toggle":
        return {"action": "toggle", "entity": action.get("entity") or matched}
    if act == "navigate":
        return {"action": "navigate", "navigation_path": action.get("navigation_path") or ""}
    if act == "url":
        return {"action": "url", "url_path": action.get("url_path") or ""}
    if act == "call-service":
        resolved = {"action": "call-service", "service": action.get("service") or ""}
        if action.get("data"):
            resolved["data"] = action["data"]
        if action.get("target"):
            resolved["target"] = action["target"]
        return resolved
    return {"action": "none"}


def _condition_value(snap: Snap, condition: dict) -> str | None:
    attribute = condition.get("attribute")
    raw = (snap.attributes or {}).get(attribute) if attribute else snap.state
    if isinstance(raw, bool):
        return "true" if raw else "false"
    if isinstance(raw, (str, int, float)):
        return str(raw)
    return None


def _condition_matches(snap: Snap | None, condition: dict) -> bool:
    if snap is None:
        return False
    value = _condition_value(snap, condition)
    return _comparable(value, condition["operator"], condition["value"]) and compare(value, condition["operator"], condition["value"])


def _extra_conditions(rule: dict) -> list[dict]:
    if "conditions" in rule:
        return rule["conditions"]
    return [rule["also"]] if rule.get("also") else []


def _candidates(rule: dict, states: dict[str, Snap], skip: set[str]) -> list[str]:
    match = rule["match"]
    if match["kind"] == "entity":
        entity_id = match["entity_id"]
        snap = states.get(entity_id)
        if not _condition_matches(snap, match):
            return []
        return [entity_id]
    exclude = set(match.get("exclude") or []) | skip
    found = []
    for entity_id, snap in states.items():
        if entity_id in exclude or not fnmatch(entity_id, match["pattern"]):
            continue
        if _condition_matches(snap, match):
            found.append(entity_id)
    found.sort(key=lambda entity_id: ((states[entity_id].name or entity_id).casefold(), entity_id))
    return found


def _rule_active(rule: dict, states: dict[str, Snap], now: datetime) -> bool:
    when = rule.get("when")
    if when and not in_window(now, when["from"], when["to"]):
        return False
    conditions = _extra_conditions(rule)
    if not conditions:
        return True
    results = (_condition_matches(states.get(condition["entity_id"]), condition) for condition in conditions)
    return any(results) if rule.get("conditions_logic") == "or" else all(results)


def _slide(rule: dict, entity_id: str, states: dict[str, Snap], render_template) -> dict:
    snap = states[entity_id]
    name = snap.name or entity_id
    slide = {
        "id": f"{rule['id']}:{entity_id}",
        "icon": _styled(rule.get("icon"), _ICON, snap.state, name, entity_id, rule["id"], render_template),
        "primary": _line(rule.get("headline"), snap.state, name, entity_id, rule["id"], render_template),
        "secondary": _line(rule.get("subtext"), snap.state, name, entity_id, rule["id"], render_template),
        "tap_action": _resolve_action(rule.get("tap_action"), entity_id, "tap"),
        "hold_action": _resolve_action(rule.get("hold_action"), entity_id, "hold"),
        "double_tap_action": _resolve_action(rule.get("double_tap_action"), entity_id, "double_tap"),
        "secondary_position": rule.get("secondary_position", "below"),
        "visibility": rule.get("visibility", {"mode": "all"}),
    }
    background = _styled(rule.get("background"), _HEX, snap.state, name, entity_id, rule["id"], render_template)
    color = _styled(rule.get("color"), _HEX, snap.state, name, entity_id, rule["id"], render_template)
    if background:
        slide["background"] = background
    if color:
        slide["color"] = color
    if rule.get("severity") in SEVERITIES:
        slide["severity"] = rule["severity"]
    return slide


def evaluate(
    channels: list[dict],
    rules: list[dict],
    states: dict[str, Snap],
    now: datetime,
    render_template: Callable[[str, dict], str] | None = None,
    skip_entity_ids: set[str] | None = None,
) -> dict[str, dict]:
    skip = skip_entity_ids or set()
    ordered = sorted(rules, key=lambda rule: rule.get("position", 0))
    feeds = {}
    for channel in sorted(channels, key=lambda item: item.get("position", 0)):
        alerts = []
        for rule in ordered:
            if channel["id"] not in (rule.get("channels") or []):
                continue
            if not _rule_active(rule, states, now):
                continue
            for entity_id in _candidates(rule, states, skip):
                alerts.append(_slide(rule, entity_id, states, render_template))
        empty = channel.get("empty") or "hide"
        feeds[channel["id"]] = {
            "rotate_interval": channel.get("rotate_interval", 10),
            "show_badge": bool(channel.get("show_badge", True)),
            "empty": empty,
            "all_clear": channel.get("all_clear") if empty == "all_clear" else None,
            "severity_styles": _severity_styles(channel),
            "alerts": alerts,
        }
    return feeds


def feed_signature(feed: dict) -> str:
    alerts = []
    for alert in feed["alerts"]:
        alerts.append(
            [
                alert["id"],
                alert["icon"],
                alert["primary"],
                alert.get("secondary") or "",
                alert.get("background") or "",
                alert.get("color") or "",
                alert.get("severity") or "",
                alert.get("tap_action"),
                alert.get("hold_action"),
                alert.get("double_tap_action"),
                alert.get("secondary_position", "below"),
                alert.get("visibility", {"mode": "all"}),
            ]
        )
    return json.dumps(
        [
            feed["rotate_interval"],
            feed["show_badge"],
            feed["empty"],
            feed["all_clear"],
            _style_rows(feed.get("severity_styles")),
            alerts,
        ],
        sort_keys=True,
    )


def _severity_styles(channel: dict) -> dict:
    raw = channel.get("severity_styles") or {}
    styles = {}
    for level in SEVERITIES:
        item = raw.get(level) if isinstance(raw, dict) and isinstance(raw.get(level), dict) else {}
        styles[level] = {
            "icon": str(item.get("icon") or "").strip(),
            "color": str(item.get("color") or "").strip(),
        }
    return styles


def _style_rows(styles) -> list:
    source = styles if isinstance(styles, dict) else {}
    rows = []
    for level in SEVERITIES:
        item = source.get(level) if isinstance(source.get(level), dict) else {}
        rows.append([str(item.get("icon") or ""), str(item.get("color") or "")])
    return rows


def watched_entity_ids(
    rules: list[dict], states: dict[str, Snap], skip_entity_ids: set[str] | None = None
) -> set[str]:
    skip = skip_entity_ids or set()
    watched: set[str] = set()
    for rule in rules:
        match = rule["match"]
        if match["kind"] == "entity":
            watched.add(match["entity_id"])
        else:
            exclude = set(match.get("exclude") or []) | skip
            for entity_id in states:
                if entity_id not in exclude and fnmatch(entity_id, match["pattern"]):
                    watched.add(entity_id)
        for condition in _extra_conditions(rule):
            if condition.get("entity_id"):
                watched.add(condition["entity_id"])
    return watched


def changed_feeds(previous: dict[str, str], feeds: dict[str, dict]) -> tuple[dict[str, dict], dict[str, str]]:
    signatures = {channel_id: feed_signature(feed) for channel_id, feed in feeds.items()}
    changed = {
        channel_id: feeds[channel_id]
        for channel_id, signature in signatures.items()
        if previous.get(channel_id) != signature
    }
    return changed, signatures
