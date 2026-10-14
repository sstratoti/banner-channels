# Banner Channels evaluator implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure Python evaluator and validators that turn channels, rules, and entity states into Banner Channel sensor feeds.

**Architecture:** `evaluate.py` has no Home Assistant imports. It compares states, expands filters, fills placeholders, and returns one feed dict per channel. `validate.py` checks editor payloads and returns field errors. Jinja is injected as a callable so tests do not need Home Assistant.

**Tech Stack:** Python 3.13, pytest

## Global Constraints

- Home Assistant 2026.10.0 or newer is the product floor; this plan's code does not import Home Assistant.
- Domain `banner_channels`. Card type `custom:banner-channel`. Integration name Banner Channels. Card name Banner Channel.
- Operators are exactly `is`, `is_not`, `above`, `at_or_above`, `below`, `at_or_below`.
- `{state}` and `{name}` are plain replacements. `subtext_template` is optional Jinja passed to a callable.
- Slide id is `{rule_id}:{entity_id}`.
- Time windows use the passed-in timezone-aware datetime. Include `from`, exclude `to`, wrap midnight, and treat equal endpoints as all day.
- A missing or blank tap becomes `more-info` on the matched entity. A missing or `none` hold stays `none`.
- Feed order is rules by ascending `position`, then filter matches by friendly name, then entity id.
- Write a channel feed only when its signature changes. Signature covers display settings and the alert list.
- No snooze, blink, double-tap, themes, or AlertTicker import.

---

### Task 1: Operators and time windows

**Files:**
- Create: `custom_components/banner_channels/evaluate.py`
- Create: `tests/test_evaluate.py`
- Create: `pytest.ini`
- Test: `tests/test_evaluate.py`

**Interfaces:**
- Consumes: nothing
- Produces: `compare(state: str, operator: str, value: str) -> bool`, `in_window(now: datetime, start: str, end: str) -> bool`

- [x] **Step 1: Write the failing test** `d82547f`

Create `tests/test_evaluate.py`:

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from evaluate import compare, in_window

TZ = ZoneInfo("America/New_York")


def test_string_operators():
    assert compare("on", "is", "on") is True
    assert compare("on", "is", "off") is False
    assert compare("rdy", "is_not", "ccp") is True
    assert compare("ccp", "is_not", "ccp") is False


def test_numeric_operators():
    assert compare("21", "above", "20") is True
    assert compare("20", "above", "20") is False
    assert compare("20", "at_or_above", "20") is True
    assert compare("19", "below", "20") is True
    assert compare("20", "below", "20") is False
    assert compare("20", "at_or_below", "20") is True
    assert compare("open", "above", "1") is False
    assert compare("nan", "below", "1") is False


def test_window_includes_start_excludes_end_and_wraps():
    assert in_window(datetime(2026, 10, 13, 9, 0, tzinfo=TZ), "09:00", "17:00") is True
    assert in_window(datetime(2026, 10, 13, 17, 0, tzinfo=TZ), "09:00", "17:00") is False
    assert in_window(datetime(2026, 10, 13, 21, 0, tzinfo=TZ), "20:00", "04:00") is True
    assert in_window(datetime(2026, 10, 13, 3, 30, tzinfo=TZ), "20:00", "04:00") is True
    assert in_window(datetime(2026, 10, 13, 12, 0, tzinfo=TZ), "20:00", "04:00") is False
    assert in_window(datetime(2026, 10, 13, 4, 0, tzinfo=TZ), "20:00", "04:00") is False
    assert in_window(datetime(2026, 10, 13, 15, 0, tzinfo=TZ), "08:00", "08:00") is True
```

Create `pytest.ini`:

```ini
[pytest]
pythonpath = custom_components/banner_channels
```

- [x] **Step 2: Run test to verify it fails** `d82547f`

Run: `python -m pytest tests/test_evaluate.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'evaluate'`

- [x] **Step 3: Write minimal implementation** `9e7d39d`

Create `custom_components/banner_channels/evaluate.py`:

```python
"""Pure Banner Channels feed evaluation. No Home Assistant imports."""

from __future__ import annotations

import math
from datetime import datetime


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
```

- [x] **Step 4: Run test to verify it passes** `9e7d39d`

Run: `python -m pytest tests/test_evaluate.py -q`

Expected: `3 passed`

- [x] **Step 5: Commit** `9e7d39d`

```bash
git add pytest.ini custom_components/banner_channels/evaluate.py tests/test_evaluate.py
git commit -m "feat: compare alert operators and time windows"
```

---

### Task 2: Build a channel feed

**Files:**
- Modify: `custom_components/banner_channels/evaluate.py`
- Modify: `tests/test_evaluate.py`
- Test: `tests/test_evaluate.py`

**Interfaces:**
- Consumes: `compare`, `in_window`
- Produces: `Snap` named tuple `(state, name)`, `evaluate(channels, rules, states, now, render_template=None) -> dict[str, dict]`, `feed_signature(feed: dict) -> str`, `watched_entity_ids(rules, states) -> set[str]`

Feed dict keys: `rotate_interval`, `show_badge`, `empty`, `all_clear`, `alerts`. Each alert has `id`, `icon`, `primary`, `secondary`, optional `background`, optional `color`, `tap_action`, `hold_action`.

- [x] **Step 1: Write the failing test** `4433dfb`

Append to `tests/test_evaluate.py`:

```python
from evaluate import Snap, evaluate, feed_signature, watched_entity_ids


def _door_rule(**overrides):
    rule = {
        "id": "door",
        "position": 0,
        "channels": ["tablets"],
        "headline": "Front Door",
        "subtext": "Open",
        "subtext_template": "",
        "icon": "mdi:door-open",
        "background": "#c62828",
        "color": "#ffffff",
        "match": {
            "kind": "entity",
            "entity_id": "binary_sensor.front_door",
            "operator": "is",
            "value": "on",
        },
        "tap_action": {"action": "more-info"},
        "hold_action": {"action": "none"},
    }
    rule.update(overrides)
    return rule


def _channel():
    return {
        "id": "tablets",
        "name": "Tablets",
        "entity_id": "sensor.banner_tablets",
        "position": 0,
        "rotate_interval": 10,
        "show_badge": True,
        "empty": "hide",
        "all_clear": {"icon": "mdi:check", "text": "All clear"},
    }


def test_entity_match_builds_one_slide_and_defaults_tap():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    states = {"binary_sensor.front_door": Snap("on", "Front Door")}
    feeds = evaluate([_channel()], [_door_rule()], states, now)
    alerts = feeds["tablets"]["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["id"] == "door:binary_sensor.front_door"
    assert alerts[0]["primary"] == "Front Door"
    assert alerts[0]["secondary"] == "Open"
    assert alerts[0]["background"] == "#c62828"
    assert alerts[0]["tap_action"] == {
        "action": "more-info",
        "entity": "binary_sensor.front_door",
    }
    assert alerts[0]["hold_action"] == {"action": "none"}
    assert feeds["tablets"]["all_clear"] is None


def test_blank_tap_becomes_more_info_and_hold_blank_is_none():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    states = {"binary_sensor.front_door": Snap("on", "Front Door")}
    rule = _door_rule(tap_action={}, hold_action={})
    slide = evaluate([_channel()], [rule], states, now)["tablets"]["alerts"][0]
    assert slide["tap_action"]["action"] == "more-info"
    assert slide["tap_action"]["entity"] == "binary_sensor.front_door"
    assert slide["hold_action"] == {"action": "none"}


def test_unavailable_and_failed_also_suppress_the_slide():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    rule = _door_rule(also={"entity_id": "sensor.status", "operator": "is_not", "value": "ccp"})
    hidden = evaluate(
        [_channel()],
        [rule],
        {
            "binary_sensor.front_door": Snap("on", "Front Door"),
            "sensor.status": Snap("ccp", "Status"),
        },
        now,
    )
    assert hidden["tablets"]["alerts"] == []
    missing = evaluate(
        [_channel()],
        [_door_rule()],
        {"binary_sensor.front_door": Snap("unavailable", "Front Door")},
        now,
    )
    assert missing["tablets"]["alerts"] == []


def test_time_window_and_placeholders():
    rule = _door_rule(
        headline="{name}",
        subtext="{state}",
        when={"from": "20:00", "to": "04:00"},
    )
    states = {"binary_sensor.front_door": Snap("on", "Front Door")}
    day = evaluate([_channel()], [rule], states, datetime(2026, 10, 13, 12, 0, tzinfo=TZ))
    night = evaluate([_channel()], [rule], states, datetime(2026, 10, 13, 21, 0, tzinfo=TZ))
    assert day["tablets"]["alerts"] == []
    slide = night["tablets"]["alerts"][0]
    assert slide["primary"] == "Front Door"
    assert slide["secondary"] == "on"


def test_template_overrides_subtext_and_errors_fall_back():
    rule = _door_rule(subtext="plain", subtext_template="{{ name }}")
    states = {"binary_sensor.front_door": Snap("on", "Front Door")}
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)

    def render(template, variables):
        assert template == "{{ name }}"
        assert variables["entity_id"] == "binary_sensor.front_door"
        return variables["name"]

    ok = evaluate([_channel()], [rule], states, now, render_template=render)
    assert ok["tablets"]["alerts"][0]["secondary"] == "Front Door"

    def boom(template, variables):
        raise ValueError("bad template")

    bad = evaluate([_channel()], [rule], states, now, render_template=boom)
    assert bad["tablets"]["alerts"][0]["secondary"] == "plain"


def test_filter_orders_by_name_and_skips_excludes():
    rule = {
        "id": "bat",
        "position": 1,
        "channels": ["tablets"],
        "headline": "Low battery {state}",
        "subtext": "{name}",
        "subtext_template": "",
        "icon": "mdi:battery-alert",
        "match": {
            "kind": "filter",
            "pattern": "sensor.*battery*",
            "operator": "at_or_below",
            "value": "20",
            "exclude": ["sensor.phone_battery"],
        },
        "tap_action": {"action": "none"},
        "hold_action": {"action": "none"},
    }
    states = {
        "sensor.phone_battery": Snap("5", "Phone"),
        "sensor.lock_battery": Snap("12", "Lock"),
        "sensor.remote_battery_level": Snap("40", "Remote"),
        "sensor.sensor_battery": Snap("20", "Zoo Sensor"),
        "binary_sensor.front_door": Snap("on", "Front Door"),
    }
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    alerts = evaluate([_channel()], [_door_rule(), rule], states, now)["tablets"]["alerts"]
    assert [a["id"] for a in alerts] == [
        "door:binary_sensor.front_door",
        "bat:sensor.lock_battery",
        "bat:sensor.sensor_battery",
    ]
    assert alerts[1]["primary"] == "Low battery 12"
    assert alerts[1]["secondary"] == "Lock"


def test_signature_changes_when_visible_content_changes():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    on = evaluate(
        [_channel()],
        [_door_rule()],
        {"binary_sensor.front_door": Snap("on", "Front Door")},
        now,
    )["tablets"]
    off = evaluate(
        [_channel()],
        [_door_rule()],
        {"binary_sensor.front_door": Snap("off", "Front Door")},
        now,
    )["tablets"]
    assert feed_signature(on) != feed_signature(off)
    assert feed_signature(on) == feed_signature(dict(on))


def test_watched_ids_include_matches_and_also():
    rule = _door_rule(also={"entity_id": "sensor.status", "operator": "is", "value": "ok"})
    states = {
        "binary_sensor.front_door": Snap("on", "Front Door"),
        "sensor.lock_battery": Snap("10", "Lock"),
        "sensor.unrelated": Snap("1", "Nope"),
    }
    filt = {
        "id": "bat",
        "position": 1,
        "channels": ["tablets"],
        "headline": "Low",
        "subtext": "",
        "subtext_template": "",
        "icon": "mdi:battery-alert",
        "match": {
            "kind": "filter",
            "pattern": "sensor.*battery*",
            "operator": "below",
            "value": "20",
            "exclude": [],
        },
    }
    watched = watched_entity_ids([rule, filt], states)
    assert watched == {
        "binary_sensor.front_door",
        "sensor.status",
        "sensor.lock_battery",
    }


def test_filter_skips_the_channels_own_sensors():
    rule = {
        "id": "bat",
        "position": 0,
        "channels": ["tablets"],
        "headline": "{name}",
        "subtext": "",
        "subtext_template": "",
        "icon": "mdi:battery-alert",
        "match": {
            "kind": "filter",
            "pattern": "sensor.*",
            "operator": "below",
            "value": "50",
            "exclude": [],
        },
    }
    states = {
        "sensor.lock_battery": Snap("10", "Lock"),
        "sensor.banner_tablets": Snap("1", "Tablets"),
    }
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    alerts = evaluate(
        [_channel()], [rule], states, now, skip_entity_ids={"sensor.banner_tablets"}
    )["tablets"]["alerts"]
    assert [alert["id"] for alert in alerts] == ["bat:sensor.lock_battery"]
    watched = watched_entity_ids([rule], states, {"sensor.banner_tablets"})
    assert "sensor.banner_tablets" not in watched
    assert "sensor.lock_battery" in watched
```

- [x] **Step 2: Run test to verify it fails** `4433dfb`

Run: `python -m pytest tests/test_evaluate.py::test_entity_match_builds_one_slide_and_defaults_tap -q`

Expected: FAIL with `ImportError: cannot import name 'Snap'`

- [x] **Step 3: Write minimal implementation** `78ead71`

Replace `custom_components/banner_channels/evaluate.py` with:

```python
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
```

- [x] **Step 4: Run test to verify it passes** `446ac29`

Run: `python -m pytest tests/test_evaluate.py -q`

Expected: `12 passed` on `78ead71`. Follow-up commits `2a222e0` and `446ac29` add regression locks. Final count: `17 passed`.

- [x] **Step 5: Commit** `78ead71`

```bash
git add custom_components/banner_channels/evaluate.py tests/test_evaluate.py
git commit -m "feat: evaluate channel rules into banner feeds"
```

Follow-up test commits: `2a222e0`, `446ac29`.

---

### Task 3: Validate editor payloads

**Files:**
- Create: `custom_components/banner_channels/validate.py`
- Create: `tests/test_validate.py`
- Test: `tests/test_validate.py`

**Interfaces:**
- Consumes: nothing from evaluate
- Produces: `slugify(name: str) -> str`, `validate_channel(data: dict, taken_entity_ids: set[str]) -> dict[str, str]`, `validate_rule(data: dict) -> dict[str, str]`. An empty dict means valid. Error values are short human-readable strings.

- [x] **Step 1: Write the failing test** `817a1f9`

Create `tests/test_validate.py`:

```python
from validate import slugify, validate_channel, validate_rule


def test_slugify():
    assert slugify("Tablets") == "tablets"
    assert slugify("Front Door!") == "front_door"
    assert slugify("  Phone  2 ") == "phone_2"


def test_channel_requires_name_and_unique_entity():
    assert "name" in validate_channel({"name": "  "}, set())
    errors = validate_channel({"name": "Tablets"}, {"sensor.banner_tablets"})
    assert errors["entity_id"]
    ok = validate_channel(
        {
            "name": "Phone",
            "rotate_interval": 0,
            "show_badge": False,
            "empty": "all_clear",
            "all_clear": {"icon": "mdi:check", "text": "Clear"},
        },
        set(),
    )
    assert ok == {}


def test_channel_rejects_bad_interval_and_all_clear():
    errors = validate_channel(
        {"name": "Tablets", "rotate_interval": -1, "empty": "all_clear", "all_clear": {}},
        set(),
    )
    assert "rotate_interval" in errors
    assert "all_clear_text" in errors


def test_rule_requires_headline_icon_and_match():
    errors = validate_rule(
        {
            "headline": "",
            "icon": "door",
            "background": "red",
            "match": {"kind": "entity", "operator": "is", "value": "on"},
        }
    )
    assert "headline" in errors
    assert "icon" in errors
    assert "background" in errors
    assert "match_entity" in errors


def test_rule_accepts_a_filter_and_a_service_action():
    errors = validate_rule(
        {
            "headline": "Low battery {state}",
            "icon": "mdi:battery-alert",
            "channels": ["tablets"],
            "match": {
                "kind": "filter",
                "pattern": "sensor.*battery*",
                "operator": "at_or_below",
                "value": "20",
                "exclude": ["sensor.phone_battery"],
            },
            "when": {"from": "20:00", "to": "04:00"},
            "tap_action": {
                "action": "call-service",
                "service": "light.turn_on",
                "data": {"brightness": 10},
            },
            "hold_action": {"action": "none"},
        }
    )
    assert errors == {}


def test_rule_rejects_bad_service_data():
    errors = validate_rule(
        {
            "headline": "Door",
            "icon": "mdi:door",
            "match": {
                "kind": "entity",
                "entity_id": "binary_sensor.front_door",
                "operator": "is",
                "value": "on",
            },
            "tap_action": {"action": "call-service", "service": "light", "data": "nope"},
            "when": {"from": "25:00", "to": "04:00"},
        }
    )
    assert "tap_action" in errors
    assert "when" in errors


def test_rule_rejects_bad_url_and_non_numeric_threshold():
    errors = validate_rule(
        {
            "headline": "Low battery",
            "icon": "mdi:battery",
            "match": {
                "kind": "filter",
                "pattern": "sensor.*battery*",
                "operator": "below",
                "value": "low",
            },
            "tap_action": {"action": "url", "url_path": "javascript:alert(1)"},
        }
    )
    assert "match_value" in errors
    assert "tap_action" in errors
```

- [x] **Step 2: Run test to verify it fails** `817a1f9`

Run: `python -m pytest tests/test_validate.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'validate'`

- [x] **Step 3: Write minimal implementation** `d2cc117`

Create `custom_components/banner_channels/validate.py`:

```python
"""Validate Banner Channels editor payloads. No Home Assistant imports."""

from __future__ import annotations

import re

_SLUG = re.compile(r"[^a-z0-9]+")
_ICON = re.compile(r"^mdi:[a-z0-9-]+$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_OPERATORS = {"is", "is_not", "above", "at_or_above", "below", "at_or_below"}
_NUMERIC = {"above", "at_or_above", "below", "at_or_below"}
_ACTIONS = {"more-info", "navigate", "url", "toggle", "call-service", "none"}


def slugify(name: str) -> str:
    slug = _SLUG.sub("_", name.strip().lower()).strip("_")
    return slug or "channel"


def validate_channel(data: dict, taken_entity_ids: set[str]) -> dict[str, str]:
    errors: dict[str, str] = {}
    name = (data.get("name") or "").strip()
    if not name or len(name) > 64:
        errors["name"] = "Enter a name up to 64 characters."
    else:
        entity_id = data.get("entity_id") or f"sensor.banner_{slugify(name)}"
        if entity_id in taken_entity_ids:
            errors["entity_id"] = "A channel already uses that sensor id."
    interval = data.get("rotate_interval", 10)
    if isinstance(interval, bool) or not isinstance(interval, (int, float)) or interval < 0:
        errors["rotate_interval"] = "Rotation must be a number of seconds, zero or more."
    empty = data.get("empty", "hide")
    if empty not in ("hide", "all_clear"):
        errors["empty"] = "Choose hide or all clear."
    if empty == "all_clear":
        text = ((data.get("all_clear") or {}).get("text") or "").strip()
        if not text:
            errors["all_clear_text"] = "All clear needs text."
        icon = (data.get("all_clear") or {}).get("icon") or ""
        if icon and not _ICON.match(icon):
            errors["all_clear_icon"] = "Use an mdi icon."
    return errors


def _action_error(action: dict | None) -> str | None:
    if not action or not action.get("action") or action.get("action") == "none":
        return None
    act = action["action"]
    if act not in _ACTIONS:
        return "Unknown action."
    if act == "navigate" and not (action.get("navigation_path") or "").strip():
        return "Navigate needs a path."
    if act == "url":
        url = (action.get("url_path") or "").strip()
        if not (url.startswith("http://") or url.startswith("https://") or url.startswith("/")):
            return "URL must start with http://, https://, or /."
    if act == "call-service":
        service = action.get("service") or ""
        domain, _, name = service.partition(".")
        if not domain or not name or "." in name:
            return "Service must look like domain.service."
        data = action.get("data")
        if data is not None and not isinstance(data, dict):
            return "Service data must be a JSON object."
    return None


def validate_rule(data: dict) -> dict[str, str]:
    errors: dict[str, str] = {}
    headline = (data.get("headline") or "").strip()
    if not headline or len(headline) > 120:
        errors["headline"] = "Enter a headline up to 120 characters."
    subtext = data.get("subtext") or ""
    if len(subtext) > 240:
        errors["subtext"] = "Subtext can be at most 240 characters."
    if not _ICON.match(data.get("icon") or ""):
        errors["icon"] = "Use an mdi icon."
    for key in ("background", "color"):
        value = data.get(key) or ""
        if value and not _HEX.match(value):
            errors[key] = "Use a color like #c62828."
    match = data.get("match") or {}
    kind = match.get("kind")
    if match.get("operator") not in _OPERATORS:
        errors["match_operator"] = "Choose a comparison."
    elif match.get("operator") in _NUMERIC:
        try:
            number = float(match.get("value"))
            if number != number or number in (float("inf"), float("-inf")):
                raise ValueError
        except (TypeError, ValueError):
            errors["match_value"] = "Enter a number."
    if kind == "entity":
        if not (match.get("entity_id") or "").strip():
            errors["match_entity"] = "Choose an entity."
    elif kind == "filter":
        if not (match.get("pattern") or "").strip():
            errors["match_pattern"] = "Enter an entity id pattern."
    else:
        errors["match_entity"] = "Choose an entity or a filter."
    when = data.get("when")
    if when:
        if not _TIME.match(when.get("from") or "") or not _TIME.match(when.get("to") or ""):
            errors["when"] = "Use times like 20:00."
    also = data.get("also")
    if also:
        if not (also.get("entity_id") or "").strip():
            errors["also_entity"] = "Choose the extra entity."
        if also.get("operator") not in _OPERATORS:
            errors["also_operator"] = "Choose a comparison."
        elif also.get("operator") in _NUMERIC:
            try:
                number = float(also.get("value"))
                if number != number or number in (float("inf"), float("-inf")):
                    raise ValueError
            except (TypeError, ValueError):
                errors["also_value"] = "Enter a number."
    tap_error = _action_error(data.get("tap_action"))
    if tap_error:
        errors["tap_action"] = tap_error
    hold_error = _action_error(data.get("hold_action"))
    if hold_error:
        errors["hold_action"] = hold_error
    return errors
```

- [x] **Step 4: Run test to verify it passes** `aca8694`

Run: `python -m pytest tests/test_validate.py tests/test_evaluate.py -q`

Expected: `19 passed` assumed 12 evaluate tests. Actual after `d2cc117`: 24. After regression commit `aca8694`: 27 passed.

- [x] **Step 5: Commit** `d2cc117`

```bash
git add custom_components/banner_channels/validate.py tests/test_validate.py
git commit -m "feat: validate banner channels and rules"
```

Follow-up test commit: `aca8694`.
