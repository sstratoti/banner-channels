from validate import severity_styles, slugify, validate_channel, validate_rule


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


def test_channel_severity_styles_keep_icon_and_color():
    styles, errors = severity_styles(
        {
            "info": {"icon": " mdi:information ", "color": "#039be5"},
            "warning": {"icon": "alert", "color": "orange"},
            "problem": [],
        }
    )
    assert errors["severity_warning_icon"]
    assert errors["severity_warning_color"]
    assert errors["severity_problem"]
    assert styles["info"] == {"icon": "mdi:information", "color": "#039be5"}
    assert validate_channel(
        {"name": "Tablets", "severity_styles": {"warning": {"icon": "mdi:alert", "color": "#ff8800"}}},
        set(),
    ) == {}
    assert "severity_styles" in validate_channel({"name": "Tablets", "severity_styles": "nope"}, set())


def test_rule_icon_can_be_blank_when_a_severity_is_set():
    base = {
        "headline": "Front Door",
        "icon": "",
        "match": {"kind": "entity", "entity_id": "binary_sensor.front_door", "operator": "is", "value": "on"},
    }
    assert "icon" in validate_rule(base)
    assert validate_rule({**base, "severity": "warning"}) == {}
    assert "icon" in validate_rule({**base, "severity": "warning", "icon": "door"})


def test_icon_and_colors_accept_templates():
    base = {
        "headline": "Front Door",
        "icon": "{{ 'mdi:door-open' if state == 'on' else 'mdi:door-closed' }}",
        "background": "{{ '#c62828' }}",
        "color": "{% if state == 'on' %}#ffffff{% else %}#000000{% endif %}",
        "match": {"kind": "entity", "entity_id": "binary_sensor.front_door", "operator": "is", "value": "on"},
    }
    assert validate_rule(base) == {}
    assert "icon" in validate_rule({**base, "icon": "{{ 'mdi:door' }}" + ("x" * 1000)})
    assert "background" in validate_rule({**base, "background": "red"})
    assert "color" in validate_rule({**base, "color": "#fff"})


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


def test_rule_severity_is_blank_or_one_of_three():
    base = {
        "headline": "Front Door",
        "icon": "mdi:door-open",
        "match": {"kind": "entity", "entity_id": "binary_sensor.front_door", "operator": "is", "value": "on"},
    }
    for value in (None, "", "info", "warning", "problem"):
        assert validate_rule({**base, "severity": value}) == {}
    assert validate_rule(base) == {}
    for value in ("critical", "Warning", "error", ["info"], 3):
        assert "severity" in validate_rule({**base, "severity": value})


def test_rule_accepts_a_template_longer_than_a_plain_headline():
    headline = "{{ name }} " + ("x" * 200)
    errors = validate_rule(
        {
            "headline": headline,
            "subtext": "{% if state == 'on' %}" + ("y" * 200) + "{% endif %}",
            "icon": "mdi:door-open",
            "match": {"kind": "entity", "entity_id": "binary_sensor.front_door", "operator": "is", "value": "on"},
        }
    )
    assert errors == {}
    too_long = validate_rule(
        {
            "headline": "x" * 1001,
            "subtext": "y" * 1001,
            "icon": "mdi:door-open",
            "match": {"kind": "entity", "entity_id": "binary_sensor.front_door", "operator": "is", "value": "on"},
        }
    )
    assert "headline" in too_long
    assert "subtext" in too_long


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


def test_rule_rejects_non_finite_numeric_match_values():
    def errors_for(value):
        return validate_rule(
            {
                "headline": "Low battery",
                "icon": "mdi:battery",
                "match": {
                    "kind": "filter",
                    "pattern": "sensor.*battery*",
                    "operator": "below",
                    "value": value,
                },
            }
        )

    assert "match_value" in errors_for("inf")
    assert "match_value" in errors_for("nan")
    assert "match_value" not in errors_for("5")


def test_rule_rejects_bad_also_numeric_values():
    def errors_for(value):
        return validate_rule(
            {
                "headline": "Door",
                "icon": "mdi:door",
                "match": {
                    "kind": "entity",
                    "entity_id": "binary_sensor.front_door",
                    "operator": "is",
                    "value": "on",
                },
                "also": {
                    "entity_id": "sensor.battery",
                    "operator": "below",
                    "value": value,
                },
            }
        )

    assert "also_value" in errors_for("inf")
    assert "also_value" not in errors_for("5")
    assert "also_value" in errors_for("low")


def test_rule_checks_service_data_when_the_service_name_is_valid():
    def errors_for(data):
        return validate_rule(
            {
                "headline": "Door",
                "icon": "mdi:door",
                "match": {
                    "kind": "entity",
                    "entity_id": "binary_sensor.front_door",
                    "operator": "is",
                    "value": "on",
                },
                "tap_action": {
                    "action": "call-service",
                    "service": "light.turn_on",
                    "data": data,
                },
            }
        )

    assert "tap_action" in errors_for("nope")
    assert "tap_action" not in errors_for({"brightness": 10})
