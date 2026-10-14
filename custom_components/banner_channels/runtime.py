"""Listen for entity changes and push channel feeds."""

from __future__ import annotations

from datetime import timedelta
from fnmatch import fnmatch
import logging

from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.template import Template
from homeassistant.util import dt as dt_util

from .evaluate import Snap, changed_feeds, evaluate, watched_entity_ids
from .sensor import BannerChannelSensor

_LOGGER = logging.getLogger(__name__)
_KIND_KEY = {"channel": "channels", "rule": "rules"}


class BannerRuntime:
    def __init__(self, hass, entry, store):
        self.hass = hass
        self.entry = entry
        self.store = store
        self.sensors = {}
        self._added = set()
        self._add_entities = None
        self._signatures = {}
        self._watched = frozenset()
        self._unsub_state = None
        self._unsub_time = None
        self._unsub_registry = None
        self._unsub_filter = None
        self._logged_template_errors = set()

    @callback
    def _schedule_refresh(self, _event):
        self.hass.async_create_task(self.async_refresh())

    @callback
    def _on_filter_state(self, event):
        entity_id = event.data.get("entity_id")
        if entity_id in self._watched:
            return
        if event.data.get("new_state") is None:
            return
        own = {
            channel["entity_id"]
            for channel in self.store.data["channels"]
            if channel.get("entity_id")
        }
        if entity_id in own:
            return
        for rule in self.store.data["rules"]:
            match = rule.get("match") or {}
            if match.get("kind") != "filter":
                continue
            pattern = match.get("pattern") or ""
            exclude = match.get("exclude") or []
            if pattern and entity_id not in exclude and fnmatch(entity_id, pattern):
                self._schedule_refresh(event)
                return

    def snapshot(self):
        return {"channels": list(self.store.data["channels"]), "rules": list(self.store.data["rules"])}

    def adopt_entity_id(self, channel_id, entity_id):
        for channel in self.store.data["channels"]:
            if channel["id"] == channel_id:
                channel["entity_id"] = entity_id
        self.hass.async_create_task(self.store.async_save())

    async def async_update_record(self, kind, record):
        key = _KIND_KEY[kind]
        records = self.store.data[key]
        for index, existing in enumerate(records):
            if existing["id"] == record["id"]:
                records[index] = record
                break
        else:
            records.append(record)
        if kind == "channel":
            sensor = self.sensors.get(record["id"])
            if sensor is not None:
                sensor.apply_channel(record)
            self._add_missing_sensors()
        await self.store.async_save()
        await self.async_refresh()
        return record

    async def async_delete_record(self, kind, record_id):
        key = _KIND_KEY[kind]
        if kind == "channel":
            channel = next(
                (item for item in self.store.data["channels"] if item["id"] == record_id),
                None,
            )
            for rule in self.store.data["rules"]:
                rule["channels"] = [
                    item for item in (rule.get("channels") or []) if item != record_id
                ]
            self.sensors.pop(record_id, None)
            self._added.discard(record_id)
            self._signatures.pop(record_id, None)
            entity_id = channel.get("entity_id") if channel else None
            if entity_id:
                registry = er.async_get(self.hass)
                if registry.async_get(entity_id):
                    registry.async_remove(entity_id)
        self.store.data[key] = [
            item for item in self.store.data[key] if item["id"] != record_id
        ]
        await self.store.async_save()
        await self.async_refresh()

    async def async_reorder(self, kind, ids):
        key = _KIND_KEY[kind]
        records = self.store.data[key]
        if len(ids) != len(records) or sorted(ids) != sorted(record["id"] for record in records):
            return False
        by_id = {record["id"]: record for record in records}
        ordered = []
        for index, record_id in enumerate(ids):
            record = by_id[record_id]
            record["position"] = index
            ordered.append(record)
        self.store.data[key] = ordered
        await self.store.async_save()
        await self.async_refresh()
        return True

    def bind_sensors(self, async_add_entities):
        self._add_entities = async_add_entities
        self._add_missing_sensors()

    def _add_missing_sensors(self):
        pending = []
        for channel in self.store.data["channels"]:
            sensor = self.sensors.get(channel["id"])
            if sensor is None:
                sensor = BannerChannelSensor(self, channel)
                self.sensors[channel["id"]] = sensor
            if channel["id"] not in self._added:
                pending.append(sensor)
        if pending and self._add_entities:
            self._add_entities(pending)
            self._added.update(sensor.channel_id for sensor in pending)
            self._schedule_refresh(None)

    async def async_start(self):
        self._unsub_registry = self.hass.bus.async_listen(
            "entity_registry_updated",
            self._schedule_refresh,
        )

    async def async_stop(self):
        for unsub in (
            self._unsub_state,
            self._unsub_time,
            self._unsub_registry,
            self._unsub_filter,
        ):
            if unsub:
                unsub()

    def _snapshot_states(self):
        states = {}
        for state in self.hass.states.async_all():
            states[state.entity_id] = Snap(state.state, state.attributes.get("friendly_name") or "")
        return states

    def _render(self, template, variables):
        key = (variables["rule_id"], variables["entity_id"], template)
        try:
            rendered = Template(template, self.hass).async_render(variables, parse_result=False)
            return "" if rendered is None else str(rendered)
        except Exception as err:
            if key not in self._logged_template_errors:
                self._logged_template_errors.add(key)
                _LOGGER.warning("Banner template failed for %s: %s", key, err)
            raise

    async def async_refresh(self):
        rules = self.store.data["rules"]
        channels = self.store.data["channels"]
        states = self._snapshot_states()
        own = {channel["entity_id"] for channel in channels}
        self._listen(rules, states, own)
        feeds = evaluate(channels, rules, states, dt_util.now(), self._render, own)
        changed, signatures = changed_feeds(self._signatures, feeds)
        for channel_id, feed in changed.items():
            sensor = self.sensors.get(channel_id)
            if sensor is None or channel_id not in self._added:
                signatures.pop(channel_id, None)
                continue
            sensor.set_feed(feed)
        self._signatures = signatures

    def _listen(self, rules, states, own):
        entity_ids = frozenset(watched_entity_ids(rules, states, own))
        if entity_ids != self._watched:
            if self._unsub_state:
                self._unsub_state()
                self._unsub_state = None
            self._watched = entity_ids
            if entity_ids:
                self._unsub_state = async_track_state_change_event(
                    self.hass, sorted(entity_ids), self._schedule_refresh
                )
        wants_timer = any(rule.get("when") for rule in rules)
        if wants_timer and self._unsub_time is None:
            self._unsub_time = async_track_time_interval(
                self.hass, self._schedule_refresh, timedelta(seconds=60)
            )
        elif not wants_timer and self._unsub_time:
            self._unsub_time()
            self._unsub_time = None
        wants_filter = any(
            (rule.get("match") or {}).get("kind") == "filter"
            and (rule.get("match") or {}).get("pattern")
            for rule in rules
        )
        if wants_filter and self._unsub_filter is None:
            self._unsub_filter = self.hass.bus.async_listen(
                EVENT_STATE_CHANGED, self._on_filter_state
            )
        elif not wants_filter and self._unsub_filter:
            self._unsub_filter()
            self._unsub_filter = None
