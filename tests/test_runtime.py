"""Home Assistant runtime coverage for Banner Channels sensors."""

from unittest.mock import patch

import pytest
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.banner_channels.const import DOMAIN


async def _frontend_ready(hass, config):
    """The test harness has no hass_frontend package."""
    return True


def _channel(channel_id, name, entity_id, position):
    return {
        "id": channel_id,
        "name": name,
        "entity_id": entity_id,
        "position": position,
        "rotate_interval": 10,
        "show_badge": True,
        "empty": "hide",
        "all_clear": {"icon": "mdi:check", "text": "All clear"},
    }


def _door_rule(channels):
    return {
        "id": "door",
        "position": 0,
        "channels": channels,
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


def _open_door(hass, **kwargs):
    hass.states.async_set(
        "binary_sensor.front_door",
        "on",
        {"friendly_name": "Front Door"},
        **kwargs,
    )


@pytest.mark.asyncio
async def test_runtime_writes_watched_feeds_and_removes_deleted_channels(
    hass, enable_custom_integrations
):
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    with patch("homeassistant.components.frontend.async_setup", _frontend_ready):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    runtime = hass.data[DOMAIN][entry.entry_id]
    await runtime.async_update_record(
        "channel", _channel("tablets", "Tablets", "sensor.banner_tablets", 0)
    )
    await runtime.async_update_record("rule", _door_rule(["tablets"]))
    await hass.async_block_till_done()

    _open_door(hass)
    await hass.async_block_till_done()

    state = hass.states.get("sensor.banner_tablets")
    assert state.state == "1"
    assert state.attributes["alerts"][0]["primary"] == "Front Door"
    last_updated = state.last_updated
    last_reported = state.last_reported

    hass.states.async_set("sensor.unrelated", "1")
    await hass.async_block_till_done()
    state = hass.states.get("sensor.banner_tablets")
    assert state.last_updated == last_updated
    assert state.last_reported == last_reported

    _open_door(hass, force_update=True)
    await hass.async_block_till_done()
    state = hass.states.get("sensor.banner_tablets")
    assert state.last_updated == last_updated
    assert state.last_reported == last_reported

    phone = _channel("phones", "Phones", "sensor.banner_phones", 1)
    runtime.store.data["rules"][0] = _door_rule(["tablets", "phones"])
    runtime.store.data["channels"].append(phone)
    await runtime.async_refresh()
    await runtime.async_update_record("channel", phone)
    await hass.async_block_till_done()

    phone_state = hass.states.get("sensor.banner_phones")
    assert phone_state.state == "1"
    assert phone_state.attributes["alerts"][0]["primary"] == "Front Door"
    state = hass.states.get("sensor.banner_tablets")
    assert state.last_updated == last_updated
    assert state.last_reported == last_reported

    registry = er.async_get(hass)
    assert registry.async_get("sensor.banner_tablets") is not None
    await runtime.async_delete_record("channel", "tablets")
    await hass.async_block_till_done()
    assert registry.async_get("sensor.banner_tablets") is None
