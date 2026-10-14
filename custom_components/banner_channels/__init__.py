"""Banner Channels config entry."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import uuid4

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.components.lovelace.resources import ResourceYAMLCollection
from homeassistant.exceptions import TemplateError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.template import Template

from .const import DOMAIN, PLATFORMS
from .runtime import BannerRuntime
from .store import BannerStore
from .validate import slugify, validate_channel, validate_rule

_LOGGER = logging.getLogger(__name__)
_FRONTEND_DIR = Path(__file__).parent / "frontend"
_VERSION = json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8"))["version"]
CARD_PATH = "/banner_channels/banner-channel-card.js"
CARD_URL = f"{CARD_PATH}?v={_VERSION}"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


def _runtime(hass):
    records = hass.data.get(DOMAIN) or {}
    for value in records.values():
        if isinstance(value, BannerRuntime):
            return value
    return None


def _taken_entity_ids(hass, channels, current_entity_id):
    taken = {channel["entity_id"] for channel in channels if channel.get("entity_id")}
    taken.update(hass.states.async_entity_ids())
    taken.update(er.async_get(hass).entities)
    if current_entity_id:
        taken.discard(current_entity_id)
    return taken


def _coerce_interval(value):
    if isinstance(value, bool):
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    if isinstance(number, float) and number.is_integer():
        return int(number)
    return number


def _prepare_channel(hass, runtime, record):
    channels = runtime.store.data["channels"]
    record_id = record.get("id")
    existing = next((item for item in channels if record_id and item.get("id") == record_id), None)
    name = (record.get("name") or "").strip()
    if existing:
        channel_id = existing["id"]
        entity_id = existing["entity_id"]
        position = existing.get("position", 0)
        current_entity_id = entity_id
    else:
        channel_id = uuid4().hex
        entity_id = (record.get("entity_id") or "").strip() or f"sensor.banner_{slugify(name)}"
        position = len(channels)
        current_entity_id = None
    show_badge = record.get("show_badge", True)
    all_clear = record.get("all_clear") or {}
    prepared = {
        "id": channel_id,
        "name": name,
        "entity_id": entity_id,
        "position": position,
        "rotate_interval": _coerce_interval(record.get("rotate_interval", 10)),
        "show_badge": show_badge if isinstance(show_badge, bool) else bool(show_badge),
        "empty": record.get("empty") or "hide",
        "all_clear": {
            "icon": (all_clear.get("icon") or "").strip(),
            "text": (all_clear.get("text") or "").strip(),
        },
    }
    errors = validate_channel(prepared, _taken_entity_ids(hass, channels, current_entity_id))
    return (None, errors) if errors else (prepared, {})


def _prepare_rule(hass, runtime, record):
    rules = runtime.store.data["rules"]
    record_id = record.get("id")
    existing = next((item for item in rules if record_id and item.get("id") == record_id), None)
    if existing:
        rule_id = existing["id"]
        position = existing.get("position", 0)
    else:
        rule_id = uuid4().hex
        position = len(rules)
    match = dict(record.get("match") or {})
    if match.get("kind") == "filter":
        exclude = match.get("exclude") or []
        if isinstance(exclude, str):
            exclude = [line.strip() for line in exclude.splitlines() if line.strip()]
        else:
            exclude = [str(item).strip() for item in exclude if str(item).strip()]
        match["exclude"] = exclude
    prepared = {
        "id": rule_id,
        "position": position,
        "channels": [str(item) for item in (record.get("channels") or []) if str(item).strip()],
        "headline": (record.get("headline") or "").strip(),
        "subtext": (record.get("subtext") or "").strip(),
        "icon": (record.get("icon") or "").strip(),
        "background": (record.get("background") or "").strip(),
        "color": (record.get("color") or "").strip(),
        "match": match,
    }
    if record.get("when"):
        prepared["when"] = record["when"]
    if record.get("also"):
        prepared["also"] = record["also"]
    if record.get("tap_action"):
        prepared["tap_action"] = record["tap_action"]
    if record.get("hold_action"):
        prepared["hold_action"] = record["hold_action"]
    errors = validate_rule(prepared)
    for key in ("headline", "subtext"):
        text = prepared[key]
        if key in errors or ("{{" not in text and "{%" not in text):
            continue
        try:
            Template(text, hass).ensure_valid()
        except TemplateError as err:
            errors[key] = str(err) or "Template is invalid."
    return (None, errors) if errors else (prepared, {})


async def async_register_card_resource(hass):
    """Register the card module once, or refresh its version query."""
    lovelace = hass.data.get(LOVELACE_DATA)
    if lovelace is None:
        return
    resources = lovelace.resources
    await resources.async_get_info()
    matches = [
        item
        for item in (resources.async_items() or [])
        if (item.get("url") or "").split("?", 1)[0] == CARD_PATH
    ]
    if isinstance(resources, ResourceYAMLCollection):
        _LOGGER.warning(
            "Banner Channels cannot add Lovelace resources in YAML mode. Add this module resource: %s",
            CARD_URL,
        )
        return
    if not matches:
        await resources.async_create_item({"res_type": "module", "url": CARD_URL})
        return
    current = matches[0]
    if current.get("url") != CARD_URL:
        await resources.async_update_item(current["id"], {"res_type": "module", "url": CARD_URL})


@websocket_api.websocket_command({vol.Required("type"): "banner_channels/list"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list(hass, connection, msg):
    """Return stored channels and rules."""
    runtime = _runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Banner Channels is not set up")
        return
    connection.send_result(msg["id"], runtime.snapshot())


@websocket_api.websocket_command(
    {
        vol.Required("type"): "banner_channels/save",
        vol.Required("kind"): vol.In(("channel", "rule")),
        vol.Required("record"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    """Validate and store one channel or rule."""
    runtime = _runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Banner Channels is not set up")
        return
    record = dict(msg["record"])
    if msg["kind"] == "channel":
        prepared, errors = _prepare_channel(hass, runtime, record)
    else:
        prepared, errors = _prepare_rule(hass, runtime, record)
    if errors:
        connection.send_result(msg["id"], {"errors": errors})
        return
    saved = await runtime.async_update_record(msg["kind"], prepared)
    connection.send_result(msg["id"], {"record": saved})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "banner_channels/delete",
        vol.Required("kind"): vol.In(("channel", "rule")),
        # record_id, not id: the websocket command id already owns the "id" key.
        vol.Required("record_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete(hass, connection, msg):
    """Remove one channel or rule."""
    runtime = _runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Banner Channels is not set up")
        return
    await runtime.async_delete_record(msg["kind"], msg["record_id"])
    connection.send_result(msg["id"], {"id": msg["record_id"]})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "banner_channels/reorder",
        vol.Required("kind"): vol.In(("channel", "rule")),
        vol.Required("ids"): [str],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_reorder(hass, connection, msg):
    """Save display order. Reject anything that is not a permutation."""
    runtime = _runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "Banner Channels is not set up")
        return
    if not await runtime.async_reorder(msg["kind"], list(msg["ids"])):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_INVALID_FORMAT,
            "ids must be a permutation of the current ids",
        )
        return
    connection.send_result(msg["id"], {"ids": list(msg["ids"])})


async def async_setup(hass, config):
    hass.data.setdefault(DOMAIN, {})
    await hass.http.async_register_static_paths(
        [StaticPathConfig("/banner_channels", str(_FRONTEND_DIR), cache_headers=False)]
    )
    websocket_api.async_register_command(hass, ws_list)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_delete)
    websocket_api.async_register_command(hass, ws_reorder)
    return True


async def async_setup_entry(hass, entry):
    store = BannerStore(hass)
    await store.async_load()
    runtime = BannerRuntime(hass, entry, store)
    hass.data[DOMAIN][entry.entry_id] = runtime
    await runtime.async_start()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path="banner-channels",
        webcomponent_name="banner-channels-panel",
        sidebar_title="Banner Channels",
        sidebar_icon="mdi:billboard",
        module_url="/banner_channels/banner-channels-panel.js",
        require_admin=True,
    )
    await async_register_card_resource(hass)
    return True


async def async_unload_entry(hass, entry):
    frontend.async_remove_panel(hass, "banner-channels")
    runtime = hass.data[DOMAIN].pop(entry.entry_id)
    await runtime.async_stop()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
