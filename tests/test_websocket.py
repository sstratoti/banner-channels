"""Websocket editor commands for Banner Channels. No live Home Assistant."""

from unittest.mock import patch

import pytest
from homeassistant.components.frontend import DATA_PANELS
from homeassistant.components.lovelace.resources import ResourceYAMLCollection
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.banner_channels import async_register_card_resource
from custom_components.banner_channels.const import DOMAIN

CARD_PATH = "/banner_channels/banner-channel-card.js"
CARD_URL = "/banner_channels/banner-channel-card.js?v=0.3.0"


async def _frontend_ready(hass, config):
    """The test harness has no hass_frontend package."""
    return True


def _card_items(hass):
    return [
        item
        for item in hass.data["lovelace"].resources.async_items()
        if (item.get("url") or "").split("?", 1)[0] == CARD_PATH
    ]


async def _setup(hass):
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    with patch("homeassistant.components.frontend.async_setup", _frontend_ready):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    return entry


async def _send(client, payload):
    await client.send_json_auto_id(payload)
    message = await client.receive_json()
    assert message["type"] == "result"
    return message


def _door_rule(**overrides):
    rule = {
        "headline": "Front Door",
        "subtext": "Open",
        "icon": "mdi:door-open",
        "background": "#c62828",
        "color": "#ffffff",
        "channels": [],
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


@pytest.mark.asyncio
async def test_list_save_keeps_entity_id_and_rejects_invalid_records(
    hass, hass_ws_client, enable_custom_integrations
):
    await _setup(hass)
    client = await hass_ws_client(hass)

    listed = await _send(client, {"type": "banner_channels/list"})
    assert listed["success"] is True
    assert listed["result"] == {"channels": [], "rules": []}

    invalid = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "channel",
            "record": {"name": "  ", "rotate_interval": "10"},
        },
    )
    assert invalid["success"] is True
    assert "name" in invalid["result"]["errors"]
    still_empty = await _send(client, {"type": "banner_channels/list"})
    assert still_empty["result"]["channels"] == []

    created = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "channel",
            "record": {"name": "Front Door!", "rotate_interval": "10", "show_badge": False},
        },
    )
    record = created["result"]["record"]
    assert record["entity_id"] == "sensor.banner_front_door"
    assert record["name"] == "Front Door!"
    assert record["rotate_interval"] == 10
    assert record["position"] == 0
    assert len(record["id"]) == 32
    await hass.async_block_till_done()

    renamed = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "channel",
            "record": {
                **record,
                "name": "Wall Tablets",
                "entity_id": "sensor.banner_other",
            },
        },
    )
    assert renamed["result"]["record"]["entity_id"] == "sensor.banner_front_door"
    assert renamed["result"]["record"]["name"] == "Wall Tablets"
    assert renamed["result"]["record"]["id"] == record["id"]


@pytest.mark.asyncio
async def test_reorder_rejects_a_non_permutation_and_delete_removes_the_registry_row(
    hass, hass_ws_client, enable_custom_integrations
):
    await _setup(hass)
    client = await hass_ws_client(hass)
    first = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "channel",
            "record": {"name": "Tablets", "rotate_interval": 10, "empty": "hide"},
        },
    )
    second = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "channel",
            "record": {"name": "Phones", "rotate_interval": 5},
        },
    )
    await hass.async_block_till_done()
    first_id = first["result"]["record"]["id"]
    second_id = second["result"]["record"]["id"]
    assert second["result"]["record"]["position"] == 1
    assert second["result"]["record"]["entity_id"] == "sensor.banner_phones"

    rejected = await _send(
        client,
        {"type": "banner_channels/reorder", "kind": "channel", "ids": [first_id]},
    )
    assert rejected["success"] is False
    listed = await _send(client, {"type": "banner_channels/list"})
    assert [item["id"] for item in listed["result"]["channels"]] == [first_id, second_id]
    assert [item["position"] for item in listed["result"]["channels"]] == [0, 1]

    moved = await _send(
        client,
        {
            "type": "banner_channels/reorder",
            "kind": "channel",
            "ids": [second_id, first_id],
        },
    )
    assert moved["success"] is True
    listed = await _send(client, {"type": "banner_channels/list"})
    assert [item["id"] for item in listed["result"]["channels"]] == [second_id, first_id]
    assert [item["position"] for item in listed["result"]["channels"]] == [0, 1]

    registry = er.async_get(hass)
    assert registry.async_get("sensor.banner_tablets") is not None
    deleted = await _send(
        client,
            {"type": "banner_channels/delete", "kind": "channel", "record_id": first_id},
    )
    assert deleted["success"] is True
    await hass.async_block_till_done()
    assert registry.async_get("sensor.banner_tablets") is None
    listed = await _send(client, {"type": "banner_channels/list"})
    assert [item["id"] for item in listed["result"]["channels"]] == [second_id]


@pytest.mark.asyncio
async def test_invalid_template_does_not_save_a_rule(
    hass, hass_ws_client, enable_custom_integrations
):
    await _setup(hass)
    client = await hass_ws_client(hass)
    invalid = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "rule",
            "record": _door_rule(headline="{{"),
        },
    )
    assert invalid["success"] is True
    assert "headline" in invalid["result"]["errors"]
    listed = await _send(client, {"type": "banner_channels/list"})
    assert listed["result"]["rules"] == []

    invalid_subtext = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "rule",
            "record": _door_rule(subtext="{{"),
        },
    )
    assert "subtext" in invalid_subtext["result"]["errors"]

    invalid_icon = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "rule",
            "record": _door_rule(icon="{{"),
        },
    )
    assert "icon" in invalid_icon["result"]["errors"]

    saved = await _send(
        client,
        {
            "type": "banner_channels/save",
            "kind": "rule",
            "record": _door_rule(
                headline="{{ name }}",
                subtext="{state}",
                icon="{{ 'mdi:door-open' if state == 'on' else 'mdi:door-closed' }}",
                background="{{ '#c62828' }}",
                color="{{ '#ffffff' }}",
            ),
        },
    )
    assert saved["success"] is True
    assert saved["result"]["record"]["headline"] == "{{ name }}"
    assert saved["result"]["record"]["subtext"] == "{state}"
    assert saved["result"]["record"]["icon"].startswith("{{ 'mdi:door-open'")
    assert saved["result"]["record"]["background"] == "{{ '#c62828' }}"
    assert saved["result"]["record"]["color"] == "{{ '#ffffff' }}"
    assert "subtext_template" not in saved["result"]["record"]
    assert saved["result"]["record"]["position"] == 0


@pytest.mark.asyncio
async def test_rule_save_keeps_severity_and_rejects_unknown_levels(
    hass, hass_ws_client, enable_custom_integrations
):
    await _setup(hass)
    client = await hass_ws_client(hass)
    bad = await _send(
        client,
        {"type": "banner_channels/save", "kind": "rule", "record": _door_rule(severity="critical")},
    )
    assert "severity" in bad["result"]["errors"]

    saved = await _send(
        client,
        {"type": "banner_channels/save", "kind": "rule", "record": _door_rule(severity="warning")},
    )
    assert saved["result"]["record"]["severity"] == "warning"

    blank = await _send(
        client,
        {"type": "banner_channels/save", "kind": "rule", "record": _door_rule()},
    )
    assert blank["result"]["record"]["severity"] == ""


@pytest.mark.asyncio
async def test_commands_require_admin(hass, hass_ws_client, hass_read_only_access_token, enable_custom_integrations):
    await _setup(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)
    denied = await _send(client, {"type": "banner_channels/list"})
    assert denied["success"] is False
    assert denied["error"]["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_panel_and_card_resource_follow_the_config_entry(
    hass, enable_custom_integrations, caplog
):
    entry = await _setup(hass)
    panel = hass.data[DATA_PANELS]["banner-channels"]
    assert panel.sidebar_title == "Banner Channels"
    assert panel.sidebar_icon == "mdi:billboard"
    assert panel.require_admin is True
    assert panel.frontend_url_path == "banner-channels"
    custom = panel.config["_panel_custom"]
    assert custom["name"] == "banner-channels-panel"
    assert custom["module_url"] == "/banner_channels/banner-channels-panel.js"
    assert len(_card_items(hass)) == 1
    assert _card_items(hass)[0]["url"] == CARD_URL

    storage_resources = hass.data["lovelace"].resources
    item = _card_items(hass)[0]
    storage_resources.data[item["id"]]["url"] = f"{CARD_PATH}?v=0.0.1"
    await async_register_card_resource(hass)
    assert len(_card_items(hass)) == 1
    assert _card_items(hass)[0]["url"] == CARD_URL

    yaml_resources = ResourceYAMLCollection([])
    hass.data["lovelace"].resources = yaml_resources
    await async_register_card_resource(hass)
    assert yaml_resources.data == []
    assert CARD_URL in caplog.text
    hass.data["lovelace"].resources = storage_resources

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "banner-channels" not in hass.data[DATA_PANELS]

    with patch("homeassistant.components.frontend.async_setup", _frontend_ready):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    assert "banner-channels" in hass.data[DATA_PANELS]
    assert len(_card_items(hass)) == 1
    assert _card_items(hass)[0]["url"] == CARD_URL
