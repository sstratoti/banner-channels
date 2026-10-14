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
