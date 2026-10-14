"""Pure Banner Channels feed evaluation. No Home Assistant imports."""

from __future__ import annotations

import json
import math
from datetime import datetime
from fnmatch import fnmatch
from typing import Callable, NamedTuple


class Snap(NamedTuple):
    state: str
    name: str


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


def _usable(states: dict[str, Snap], entity_id: str) -> bool:
    snap = states.get(entity_id)
    return snap is not None and snap.state not in ("unavailable", "unknown")


def _fill(text: str, state: str, name: str) -> str:
    return (text or "").replace("{state}", state).replace("{name}", name)


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


def _secondary(rule: dict, state: str, name: str, entity_id: str, render_template) -> str:
    plain = _fill(rule.get("subtext") or "", state, name)
    template = (rule.get("subtext_template") or "").strip()
    if not template or render_template is None:
        return plain
    try:
        return render_template(
            template,
            {
                "state": state,
                "name": name,
                "entity_id": entity_id,
                "rule_id": rule["id"],
            },
        )
    except Exception:
        return plain


def _candidates(rule: dict, states: dict[str, Snap], skip: set[str]) -> list[str]:
    match = rule["match"]
    if match["kind"] == "entity":
        entity_id = match["entity_id"]
        if not _usable(states, entity_id):
            return []
        if not compare(states[entity_id].state, match["operator"], match["value"]):
            return []
        return [entity_id]
    exclude = set(match.get("exclude") or []) | skip
    found = []
    for entity_id, snap in states.items():
        if entity_id in exclude or not fnmatch(entity_id, match["pattern"]):
            continue
        if snap.state in ("unavailable", "unknown"):
            continue
        if compare(snap.state, match["operator"], match["value"]):
            found.append(entity_id)
    found.sort(key=lambda entity_id: ((states[entity_id].name or entity_id).casefold(), entity_id))
    return found


def _rule_active(rule: dict, states: dict[str, Snap], now: datetime) -> bool:
    when = rule.get("when")
    if when and not in_window(now, when["from"], when["to"]):
        return False
    also = rule.get("also")
    if not also:
        return True
    entity_id = also["entity_id"]
    if not _usable(states, entity_id):
        return False
    return compare(states[entity_id].state, also["operator"], also["value"])


def _slide(rule: dict, entity_id: str, states: dict[str, Snap], render_template) -> dict:
    snap = states[entity_id]
    name = snap.name or entity_id
    slide = {
        "id": f"{rule['id']}:{entity_id}",
        "icon": rule["icon"],
        "primary": _fill(rule.get("headline") or "", snap.state, name),
        "secondary": _secondary(rule, snap.state, name, entity_id, render_template),
        "tap_action": _resolve_action(rule.get("tap_action"), entity_id, "tap"),
        "hold_action": _resolve_action(rule.get("hold_action"), entity_id, "hold"),
    }
    if rule.get("background"):
        slide["background"] = rule["background"]
    if rule.get("color"):
        slide["color"] = rule["color"]
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
                alert.get("tap_action"),
                alert.get("hold_action"),
            ]
        )
    return json.dumps(
        [
            feed["rotate_interval"],
            feed["show_badge"],
            feed["empty"],
            feed["all_clear"],
            alerts,
        ],
        sort_keys=True,
    )


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
        also = rule.get("also")
        if also and also.get("entity_id"):
            watched.add(also["entity_id"])
    return watched
