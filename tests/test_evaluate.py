import copy
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


from evaluate import Snap, evaluate, feed_signature, watched_entity_ids


def _door_rule(**overrides):
    rule = {
        "id": "door",
        "position": 0,
        "channels": ["tablets"],
        "headline": "Front Door",
        "subtext": "Open",
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


def test_severity_is_copied_only_when_known():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    states = {"binary_sensor.front_door": Snap("on", "Front Door")}

    def slide(**overrides):
        return evaluate([_channel()], [_door_rule(**overrides)], states, now)["tablets"]["alerts"][0]

    assert slide(severity="warning")["severity"] == "warning"
    assert slide(severity="info")["severity"] == "info"
    assert slide(severity="problem")["severity"] == "problem"
    assert "severity" not in slide(severity="")
    assert "severity" not in slide()
    assert "severity" not in slide(severity="critical")
    assert "severity" not in slide(severity=["warning"])


def test_severity_styles_travel_with_the_channel_feed():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    channel = _channel()
    channel["severity_styles"] = {
        "warning": {"icon": " mdi:alert ", "color": " #ff8800 "},
        "info": "nope",
    }
    feed = evaluate(
        [channel],
        [_door_rule(icon="", severity="warning")],
        {"binary_sensor.front_door": Snap("on", "Front Door")},
        now,
    )["tablets"]
    assert feed["severity_styles"]["warning"] == {"icon": "mdi:alert", "color": "#ff8800"}
    assert feed["severity_styles"]["info"] == {"icon": "", "color": ""}
    assert feed["severity_styles"]["problem"] == {"icon": "", "color": ""}
    assert feed["alerts"][0]["icon"] == ""
    assert feed_signature(feed) != feed_signature({**feed, "severity_styles": {}})


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


def test_explicit_unavailable_match_shows_a_slide():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    vacuum = _door_rule(
        id="vacuum",
        headline="Roborock Vacuum",
        subtext="Unavailable — Check Dock",
        match={
            "kind": "entity",
            "entity_id": "vacuum.roborock_vacuum",
            "operator": "is",
            "value": "unavailable",
        },
    )
    shown = evaluate(
        [_channel()],
        [vacuum],
        {"vacuum.roborock_vacuum": Snap("unavailable", "Roborock")},
        now,
    )["tablets"]["alerts"]
    assert [alert["secondary"] for alert in shown] == ["Unavailable — Check Dock"]

    idle = evaluate(
        [_channel()],
        [vacuum],
        {"vacuum.roborock_vacuum": Snap("idle", "Roborock")},
        now,
    )
    assert idle["tablets"]["alerts"] == []
    assert evaluate([_channel()], [vacuum], {}, now)["tablets"]["alerts"] == []

    door = evaluate(
        [_channel()],
        [_door_rule()],
        {"binary_sensor.front_door": Snap("unavailable", "Front Door")},
        now,
    )
    assert door["tablets"]["alerts"] == []

    not_offline = _door_rule(
        match={
            "kind": "entity",
            "entity_id": "vacuum.roborock_vacuum",
            "operator": "is_not",
            "value": "unavailable",
        }
    )
    online = evaluate(
        [_channel()],
        [not_offline],
        {"vacuum.roborock_vacuum": Snap("docked", "Roborock")},
        now,
    )
    assert len(online["tablets"]["alerts"]) == 1
    offline = evaluate(
        [_channel()],
        [not_offline],
        {"vacuum.roborock_vacuum": Snap("unavailable", "Roborock")},
        now,
    )
    assert offline["tablets"]["alerts"] == []

    gated = _door_rule(
        also={"entity_id": "vacuum.roborock_vacuum", "operator": "is", "value": "unknown"}
    )
    waiting = evaluate(
        [_channel()],
        [gated],
        {
            "binary_sensor.front_door": Snap("on", "Front Door"),
            "vacuum.roborock_vacuum": Snap("unknown", "Roborock"),
        },
        now,
    )
    assert len(waiting["tablets"]["alerts"]) == 1

    pattern = _door_rule(
        id="offline",
        match={
            "kind": "filter",
            "pattern": "vacuum.*",
            "operator": "is",
            "value": "unavailable",
            "exclude": [],
        },
    )
    found = evaluate(
        [_channel()],
        [pattern],
        {
            "vacuum.roborock_vacuum": Snap("unavailable", "Roborock"),
            "vacuum.other": Snap("docked", "Other"),
        },
        now,
    )["tablets"]["alerts"]
    assert [alert["id"] for alert in found] == ["offline:vacuum.roborock_vacuum"]


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


def test_either_line_can_be_a_template_and_errors_fall_back():
    rule = _door_rule(headline="{{ name }} is {state}", subtext="{% if state == 'on' %}Open{% endif %}")
    states = {"binary_sensor.front_door": Snap("on", "Front Door")}
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)

    def render(template, variables):
        assert variables["entity_id"] == "binary_sensor.front_door"
        assert variables["rule_id"] == "door"
        if "{{" in template:
            return variables["name"]
        return "Open"

    ok = evaluate([_channel()], [rule], states, now, render_template=render)
    assert ok["tablets"]["alerts"][0]["primary"] == "Front Door"
    assert ok["tablets"]["alerts"][0]["secondary"] == "Open"

    def boom(template, variables):
        raise ValueError("bad template")

    bad = evaluate([_channel()], [rule], states, now, render_template=boom)
    assert bad["tablets"]["alerts"][0]["primary"] == "{{ name }} is on"
    assert bad["tablets"]["alerts"][0]["secondary"] == "{% if state == 'on' %}Open{% endif %}"

    plain = _door_rule(headline="{name}", subtext="{state}")

    def unused(template, variables):
        raise AssertionError(template)

    kept = evaluate([_channel()], [plain], states, now, render_template=unused)
    assert kept["tablets"]["alerts"][0]["primary"] == "Front Door"
    assert kept["tablets"]["alerts"][0]["secondary"] == "on"


def test_icon_and_colors_render_templates_and_drop_invalid_results():
    rule = _door_rule(
        icon="{{ 'mdi:door-open' if state == 'on' else 'mdi:door-closed' }}",
        background="{{ '#c62828' if state == 'on' else '#2e7d32' }}",
        color="{{ '#ffffff' if state == 'on' else '#000000' }}",
    )
    states = {"binary_sensor.front_door": Snap("on", "Front Door")}
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)

    def render(template, variables):
        if template.startswith("{{ 'mdi:"):
            return "mdi:door-open"
        if "#c62828" in template:
            return "#c62828"
        return "#ffffff"

    slide = evaluate([_channel()], [rule], states, now, render_template=render)["tablets"]["alerts"][0]
    assert slide["icon"] == "mdi:door-open"
    assert slide["background"] == "#c62828"
    assert slide["color"] == "#ffffff"

    def invalid(template, variables):
        return "nope"

    dropped = evaluate([_channel()], [rule], states, now, render_template=invalid)["tablets"]["alerts"][0]
    assert dropped["icon"] == ""
    assert "background" not in dropped
    assert "color" not in dropped

    def boom(template, variables):
        raise ValueError("bad template")

    failed = evaluate([_channel()], [rule], states, now, render_template=boom)["tablets"]["alerts"][0]
    assert failed["icon"] == ""
    assert "background" not in failed
    assert "color" not in failed


def test_filter_orders_by_name_and_skips_excludes():
    rule = {
        "id": "bat",
        "position": 1,
        "channels": ["tablets"],
        "headline": "Low battery {state}",
        "subtext": "{name}",
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


def test_feed_orders_rules_by_position_then_name_then_entity_id():
    early = {
        "id": "cells",
        "position": 0,
        "channels": ["tablets"],
        "headline": "{name}",
        "subtext": "",
        "icon": "mdi:battery-alert",
        "match": {
            "kind": "filter",
            "pattern": "sensor.*battery*",
            "operator": "at_or_below",
            "value": "20",
            "exclude": [],
        },
        "tap_action": {"action": "none"},
        "hold_action": {"action": "none"},
    }
    late = _door_rule(
        id="late",
        position=1,
        headline="Aaron",
        match={
            "kind": "entity",
            "entity_id": "binary_sensor.aaa_alert",
            "operator": "is",
            "value": "on",
        },
    )
    states = {
        "sensor.zulu_unit_battery": Snap("10", "Alpha"),
        "sensor.alpha_unit_battery": Snap("10", "Zulu"),
        "sensor.alpha_other_battery": Snap("10", "Alpha"),
        "binary_sensor.aaa_alert": Snap("on", "Aaron"),
    }
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    alerts = evaluate([_channel()], [late, early], states, now)["tablets"]["alerts"]
    assert [alert["id"] for alert in alerts] == [
        "cells:sensor.alpha_other_battery",
        "cells:sensor.zulu_unit_battery",
        "cells:sensor.alpha_unit_battery",
        "late:binary_sensor.aaa_alert",
    ]


def test_signature_changes_for_each_signed_field():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    channel = _channel()
    channel["empty"] = "all_clear"
    feed = evaluate(
        [channel],
        [_door_rule()],
        {"binary_sensor.front_door": Snap("on", "Front Door")},
        now,
    )["tablets"]
    alert = feed["alerts"][0]
    assert feed["rotate_interval"] == 10
    assert feed["show_badge"] is True
    assert feed["empty"] == "all_clear"
    assert feed["all_clear"] == {"icon": "mdi:check", "text": "All clear"}
    assert alert["icon"] == "mdi:door-open"
    assert alert["primary"] == "Front Door"
    assert alert["secondary"] == "Open"
    assert alert["background"] == "#c62828"
    assert alert["color"] == "#ffffff"
    assert alert["tap_action"] == {
        "action": "more-info",
        "entity": "binary_sensor.front_door",
    }
    assert alert["hold_action"] == {"action": "none"}

    original = feed_signature(feed)
    assert feed_signature(copy.deepcopy(feed)) == original

    def changed_feed(**updates):
        clone = copy.deepcopy(feed)
        clone.update(updates)
        return feed_signature(clone)

    def changed_alert(field, value):
        clone = copy.deepcopy(feed)
        clone["alerts"][0][field] = value
        return feed_signature(clone)

    assert changed_feed(rotate_interval=15) != original
    assert changed_feed(show_badge=False) != original
    assert changed_feed(empty="hide") != original
    assert changed_feed(all_clear={"icon": "mdi:check-all", "text": "All clear"}) != original
    assert changed_feed(all_clear={"icon": "mdi:check", "text": "Nothing to show"}) != original
    assert changed_alert("id", "door:other") != original
    assert changed_alert("icon", "mdi:door") != original
    assert changed_alert("primary", "Side Door") != original
    assert changed_alert("secondary", "Closed") != original
    assert changed_alert("background", "#000000") != original
    assert changed_alert("color", "#000000") != original
    assert changed_alert("severity", "warning") != original
    assert changed_alert("tap_action", {"action": "navigate", "navigation_path": "/lovelace"}) != original
    assert changed_alert("hold_action", {"action": "toggle", "entity": "light.hall"}) != original


def test_unusable_also_and_unknown_primary_suppress_the_slide():
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    rule = _door_rule(also={"entity_id": "sensor.status", "operator": "is_not", "value": "ccp"})
    door = {"binary_sensor.front_door": Snap("on", "Front Door")}

    def alerts_for(states):
        return evaluate([_channel()], [rule], states, now)["tablets"]["alerts"]

    assert alerts_for(dict(door)) == []
    assert alerts_for({**door, "sensor.status": Snap("unavailable", "Status")}) == []
    assert alerts_for({**door, "sensor.status": Snap("unknown", "Status")}) == []
    shown = alerts_for({**door, "sensor.status": Snap("ok", "Status")})
    assert [alert["id"] for alert in shown] == ["door:binary_sensor.front_door"]

    primary = _door_rule(
        match={
            "kind": "entity",
            "entity_id": "binary_sensor.front_door",
            "operator": "is_not",
            "value": "ccp",
        }
    )
    hidden = evaluate(
        [_channel()],
        [primary],
        {"binary_sensor.front_door": Snap("unknown", "Front Door")},
        now,
    )
    assert hidden["tablets"]["alerts"] == []


def test_watched_ids_include_filter_matches_that_fail_the_operator():
    rule = {
        "id": "bat",
        "position": 0,
        "channels": ["tablets"],
        "headline": "Low",
        "subtext": "",
        "icon": "mdi:battery-alert",
        "match": {
            "kind": "filter",
            "pattern": "sensor.*battery*",
            "operator": "below",
            "value": "20",
            "exclude": [],
        },
    }
    states = {
        "sensor.lock_battery": Snap("80", "Lock"),
        "sensor.unrelated": Snap("5", "Nope"),
    }
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    alerts = evaluate([_channel()], [rule], states, now)["tablets"]["alerts"]
    assert alerts == []
    watched = watched_entity_ids([rule], states)
    assert "sensor.lock_battery" in watched
    assert "sensor.unrelated" not in watched


def test_explicit_entity_match_keeps_skipped_channel_sensor():
    rule = _door_rule(
        match={
            "kind": "entity",
            "entity_id": "sensor.banner_tablets",
            "operator": "is",
            "value": "1",
        }
    )
    states = {"sensor.banner_tablets": Snap("1", "Tablets")}
    now = datetime(2026, 10, 13, 12, 0, tzinfo=TZ)
    alerts = evaluate(
        [_channel()],
        [rule],
        states,
        now,
        skip_entity_ids={"sensor.banner_tablets"},
    )["tablets"]["alerts"]
    assert [alert["id"] for alert in alerts] == ["door:sensor.banner_tablets"]
    watched = watched_entity_ids([rule], states, {"sensor.banner_tablets"})
    assert "sensor.banner_tablets" in watched


from evaluate import changed_feeds


def test_changed_feeds_skips_an_unchanged_channel():
    first = {"tablets": {"rotate_interval": 10, "show_badge": True, "empty": "hide", "all_clear": None, "alerts": []}}
    second = dict(first)
    second["phone"] = {"rotate_interval": 5, "show_badge": False, "empty": "hide", "all_clear": None, "alerts": []}
    _, sigs = changed_feeds({}, first)
    changed, sigs = changed_feeds(sigs, second)
    assert list(changed) == ["phone"]
    assert set(sigs) == {"tablets", "phone"}


def test_attribute_comparison_preserves_zero_false_and_missing_values():
    now = datetime(2026, 10, 16, 12, tzinfo=TZ)
    for actual, expected, operator, active in [(0, "0", "is", True), (False, "false", "is", True), (12, "10", "above", True), (None, "x", "is_not", False), ([], "x", "is_not", False), ({}, "x", "is_not", False)]:
        rule = _door_rule(match={"kind": "entity", "entity_id": "sensor.x", "attribute": "value", "operator": operator, "value": expected}, headline="{state}")
        feeds = evaluate([_channel()], [rule], {"sensor.x": Snap("ready", "X", {"value": actual})}, now)
        assert bool(feeds["tablets"]["alerts"]) is active
        if active:
            assert feeds["tablets"]["alerts"][0]["primary"] == "ready"
    rule["match"]["operator"] = "is_not"
    assert evaluate([_channel()], [rule], {"sensor.x": Snap("ready", "X", {})}, now)["tablets"]["alerts"] == []


def test_primary_is_required_with_and_or_extras():
    from itertools import product
    now = datetime(2026, 10, 16, 12, tzinfo=TZ)
    for logic, primary, first, second in product(("and", "or"), (False, True), (False, True), (False, True)):
        rule = _door_rule(conditions_logic=logic, conditions=[{"entity_id": "sensor.a", "attribute": "ready", "operator": "is", "value": "true"}, {"entity_id": "sensor.b", "operator": "is", "value": "on"}])
        states = {"binary_sensor.front_door": Snap("on" if primary else "off", "Door"), "sensor.a": Snap("idle", "A", {"ready": first}), "sensor.b": Snap("on" if second else "off", "B")}
        alerts = evaluate([_channel()], [rule], states, now)["tablets"]["alerts"]
        assert bool(alerts) == (primary and ((first and second) if logic == "and" else (first or second)))
        assert watched_entity_ids([rule], states) == {"binary_sensor.front_door", "sensor.a", "sensor.b"}
    rule.update(conditions=[], also={"entity_id": "sensor.missing", "operator": "is", "value": "on"})
    states["binary_sensor.front_door"] = Snap("on", "Door")
    assert len(evaluate([_channel()], [rule], states, now)["tablets"]["alerts"]) == 1
    rule["match"] = {"kind": "filter", "pattern": "sensor.*", "attribute": "ready", "operator": "is", "value": "true"}
    states["sensor.a"] = Snap("idle", "A", {"ready": True})
    assert len(evaluate([_channel()], [rule], states, now)["tablets"]["alerts"]) == 1


def test_feed_metadata_and_signatures_include_new_options():
    now = datetime(2026, 10, 16, 12, tzinfo=TZ)
    states = {"binary_sensor.front_door": Snap("on", "Door")}
    rule = _door_rule(secondary_position="right", visibility={"mode": "users", "user_ids": ["one"]}, double_tap_action={"action": "toggle"})
    feed = evaluate([_channel()], [rule], states, now)["tablets"]
    slide = feed["alerts"][0]
    assert slide["secondary_position"] == "right"
    assert slide["visibility"] == {"mode": "users", "user_ids": ["one"]}
    assert slide["double_tap_action"] == {"action": "toggle", "entity": "binary_sensor.front_door"}
    for key, value in [("secondary_position", "below"), ("visibility", {"mode": "all"}), ("double_tap_action", {"action": "none"})]:
        changed = copy.deepcopy(feed)
        changed["alerts"][0][key] = value
        assert feed_signature(changed) != feed_signature(feed)


def test_scalar_expected_values_compare_consistently_in_primary_and_extra_attributes():
    now = datetime(2026, 10, 16, 12, tzinfo=TZ)
    for actual in (0, 12, False, True):
        for operator, expected_active in (("is", True), ("is_not", False)):
            condition = {"entity_id": "sensor.x", "attribute": "value", "operator": operator, "value": actual}
            states = {"sensor.x": Snap("ready", "X", {"value": actual}), "binary_sensor.front_door": Snap("on", "Door")}
            primary = _door_rule(match={"kind": "entity", **condition})
            extra = _door_rule(conditions=[condition])
            for rule in (primary, extra):
                assert bool(evaluate([_channel()], [rule], states, now)["tablets"]["alerts"]) is expected_active
