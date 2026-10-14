# Banner Channels integration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Banner Channels inside Home Assistant: store channels and rules, publish one sensor per channel, and edit them from a sidebar page with a live banner preview.

**Architecture:** One config entry. Records live in a storage helper, not in subentries and not in an options flow. A runtime listens to the entity ids the evaluator names, renders Jinja, and writes a sensor only when `changed_feeds` says the signature moved. The sidebar page is plain DOM, so it does not need Lovelace to be open. It talks to admin-only websocket commands.

**Tech Stack:** Home Assistant 2026.10 custom component, `panel_custom`, Lovelace resource storage, the evaluator and card from the earlier plans

Depends on `docs/superpowers/plans/2026-10-13-banner-channels-evaluator.md` and `docs/superpowers/plans/2026-10-13-banner-channel-card.md`.

## Global Constraints

- Home Assistant 2026.10.0 or newer. Domain `banner_channels`. One config entry.
- Sidebar title Banner Channels, URL `/banner-channels`, icon `mdi:billboard`, admin only.
- Card resource URL `/banner_channels/banner-channel-card.js`, module type.
- Channel `entity_id` is chosen at creation and does not change on rename. Friendly name does.
- Sensors share one device named Banner Channels. State is the slide count. Do not record attributes `alerts`, `all_clear`, `rotate_interval`, `show_badge`, `empty`.
- Subscribe only to watched entities. Refresh that set when the entity registry changes. A 60 second timer runs only when some rule has a `when` window.
- Write a sensor only when its feed signature changes.
- Template failures log once per `rule_id` plus `entity_id`, then the evaluator's plain subtext is what gets stored.
- Deleting a channel removes its id from every rule and removes its sensor.
- No options flow, no config subentries, no Node-RED, no AlertTicker import.

---

### Task 1: Skip unchanged feeds

**Files:**
- Modify: `custom_components/banner_channels/evaluate.py`
- Modify: `tests/test_evaluate.py`
- Test: `tests/test_evaluate.py`

**Interfaces:**
- Consumes: `feed_signature`
- Produces: `changed_feeds(previous: dict[str, str], feeds: dict[str, dict]) -> tuple[dict[str, dict], dict[str, str]]`. The first item is the feeds to write. The second is the full new signature map, including channels whose signature did not change.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_evaluate.py`:

```python
from evaluate import changed_feeds


def test_changed_feeds_skips_an_unchanged_channel():
    first = {"tablets": {"rotate_interval": 10, "show_badge": True, "empty": "hide", "all_clear": None, "alerts": []}}
    second = dict(first)
    second["phone"] = {"rotate_interval": 5, "show_badge": False, "empty": "hide", "all_clear": None, "alerts": []}
    _, sigs = changed_feeds({}, first)
    changed, sigs = changed_feeds(sigs, second)
    assert list(changed) == ["phone"]
    assert set(sigs) == {"tablets", "phone"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_evaluate.py::test_changed_feeds_skips_an_unchanged_channel -q`

Expected: FAIL with `ImportError: cannot import name 'changed_feeds'`

- [ ] **Step 3: Write minimal implementation**

Append to `custom_components/banner_channels/evaluate.py`:

```python
def changed_feeds(previous: dict[str, str], feeds: dict[str, dict]) -> tuple[dict[str, dict], dict[str, str]]:
    signatures = {channel_id: feed_signature(feed) for channel_id, feed in feeds.items()}
    changed = {
        channel_id: feeds[channel_id]
        for channel_id, signature in signatures.items()
        if previous.get(channel_id) != signature
    }
    return changed, signatures
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_evaluate.py -q`

Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add custom_components/banner_channels/evaluate.py tests/test_evaluate.py
git commit -m "feat: publish a banner feed only when it changes"
```

---

### Task 2: Config entry, storage, and sensors

**Files:**
- Create: `custom_components/banner_channels/manifest.json`
- Create: `custom_components/banner_channels/const.py`
- Create: `custom_components/banner_channels/strings.json`
- Create: `custom_components/banner_channels/config_flow.py`
- Create: `custom_components/banner_channels/store.py`
- Create: `custom_components/banner_channels/runtime.py`
- Create: `custom_components/banner_channels/sensor.py`
- Create: `custom_components/banner_channels/__init__.py`
- Test: install as a custom component and add the integration once

**Interfaces:**
- Consumes: `evaluate`, `changed_feeds`, `watched_entity_ids`, `Snap`, `slugify`, `validate_channel`, `validate_rule`
- Produces: `hass.data["banner_channels"][entry_id]` is a `BannerRuntime` with `store`, `async_update_record(kind, record)`, `async_delete_record(kind, record_id)`, `async_reorder(kind, ids)`, and `snapshot()` returning `{"channels": [...], "rules": [...]}`

- [ ] **Step 1: Write the manifest, constants, and strings**

`custom_components/banner_channels/manifest.json`:

```json
{
  "domain": "banner_channels",
  "name": "Banner Channels",
  "codeowners": ["@sstratoti"],
  "config_flow": true,
  "dependencies": ["http", "frontend", "lovelace", "panel_custom"],
  "single_config_entry": true,
  "documentation": "https://github.com/sstratoti/alert-ticker-lite-card",
  "integration_type": "hub",
  "iot_class": "local_push",
  "version": "0.1.0"
}
```

`custom_components/banner_channels/const.py`:

```python
DOMAIN = "banner_channels"
PLATFORMS = ["sensor"]
UNRECORDED = frozenset({"alerts", "all_clear", "rotate_interval", "show_badge", "empty"})
```

`custom_components/banner_channels/strings.json`:

```json
{
  "config": {
    "step": {
      "user": {
        "title": "Banner Channels",
        "description": "Create the Banner Channels editor and its channel sensors."
      }
    },
    "abort": {
      "single_instance_allowed": "Banner Channels is already set up."
    }
  }
}
```

- [ ] **Step 2: Write the config flow and store**

`custom_components/banner_channels/config_flow.py`:

```python
from homeassistant.config_entries import ConfigFlow

from .const import DOMAIN


class BannerChannelsConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title="Banner Channels", data={})
```

`custom_components/banner_channels/store.py`:

```python
from homeassistant.helpers.storage import Store

from .const import DOMAIN


class BannerStore:
    def __init__(self, hass):
        self._store = Store(hass, 1, DOMAIN)
        self.data = {"channels": [], "rules": []}

    async def async_load(self):
        loaded = await self._store.async_load()
        self.data = loaded or {"channels": [], "rules": []}
        self.data.setdefault("channels", [])
        self.data.setdefault("rules", [])
        return self.data

    async def async_save(self):
        await self._store.async_save(self.data)
```

- [ ] **Step 3: Write the runtime and sensor**

Create `custom_components/banner_channels/runtime.py`:

```python
"""Listen for entity changes and push channel feeds."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.core import callback
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.template import Template
from homeassistant.util import dt as dt_util

from .evaluate import Snap, changed_feeds, evaluate, watched_entity_ids
from .sensor import BannerChannelSensor

_LOGGER = logging.getLogger(__name__)


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
        self._logged_template_errors = set()

    @callback
    def _schedule_refresh(self, _event):
        self.hass.async_create_task(self.async_refresh())

    def snapshot(self):
        return {"channels": list(self.store.data["channels"]), "rules": list(self.store.data["rules"])}

    def adopt_entity_id(self, channel_id, entity_id):
        for channel in self.store.data["channels"]:
            if channel["id"] == channel_id:
                channel["entity_id"] = entity_id
        self.hass.async_create_task(self.store.async_save())

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
        for unsub in (self._unsub_state, self._unsub_time, self._unsub_registry):
            if unsub:
                unsub()

    def _snapshot_states(self):
        states = {}
        for state in self.hass.states.async_all():
            states[state.entity_id] = Snap(state.state, state.attributes.get("friendly_name") or "")
        return states

    def _render(self, template, variables):
        key = (variables["rule_id"], variables["entity_id"])
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
```

`async_setup_entry` in `sensor.py` calls `runtime.bind_sensors(async_add_entities)`. Sensors created before that call stay out of `self._added` and are added when the platform binds. Deleting a channel calls `entity_registry.async_remove(entity_id)`, which drops the registry row. Do not rely on `sensor.async_remove()` for that. On this Home Assistant version, `async_remove()` without `force_remove` only marks the entity unavailable and leaves the registry entry, so recreating the channel would be assigned `sensor.banner_tablets_2`.

`custom_components/banner_channels/sensor.py`:

```python
from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import EntityPlatformState

from .const import DOMAIN, UNRECORDED


class BannerChannelSensor(SensorEntity):
    _attr_should_poll = False
    _attr_icon = "mdi:billboard"
    _unrecorded_attributes = UNRECORDED

    def __init__(self, runtime, channel):
        self._runtime = runtime
        self.channel_id = channel["id"]
        self._requested_entity_id = channel["entity_id"]
        self._attr_unique_id = f"banner_channel_{channel['id']}"
        self._attr_name = channel["name"]
        self.entity_id = channel["entity_id"]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, runtime.entry.entry_id)},
            name="Banner Channels",
        )
        self._attr_native_value = "0"
        self._attr_extra_state_attributes = {
            "rotate_interval": channel["rotate_interval"],
            "show_badge": channel["show_badge"],
            "empty": channel["empty"],
            "all_clear": None,
            "alerts": [],
        }

    def _added_to_platform(self):
        return self.hass is not None and self._platform_state == EntityPlatformState.ADDED

    def set_feed(self, feed):
        self._attr_native_value = str(len(feed["alerts"]))
        self._attr_extra_state_attributes = feed
        if self._added_to_platform():
            self.async_write_ha_state()

    def apply_channel(self, channel):
        self._attr_name = channel["name"]
        if self._added_to_platform():
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        if self.entity_id != self._requested_entity_id:
            self._runtime.adopt_entity_id(self.channel_id, self.entity_id)
        self.async_write_ha_state()
```

`adopt_entity_id` writes the assigned id into the stored channel and saves. Listeners passed to `async_listen`, `async_track_state_change_event`, and `async_track_time_interval` are the `@callback` method `_schedule_refresh`. A plain lambda is an executor job on this Home Assistant version, and `async_create_task` from that thread raises `RuntimeError`.

Websocket schemas use `voluptuous` as Home Assistant re-exports it. Do not install a separate voluptuous into the test environment. `async_setup` defines `CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)`. Copy `strings.json` to `translations/en.json`. Home Assistant loads the translations directory at runtime, not `strings.json`.

Add `translations/en.json` to the commit in step 6.

- [ ] **Step 4: Write setup and unload**

`custom_components/banner_channels/__init__.py` loads the store, starts the runtime, forwards the sensor platform, and on unload stops listeners and unloads the platform. Refuse a second entry by the config flow, not here.

- [ ] **Step 5: Install and add the integration**

Steve installs this. Reading Home Assistant config, logs, and state is allowed. Do not copy files into the Home Assistant config, change Lovelace or the entity registry, call services, restart Home Assistant, or otherwise write to a production service. A `docker exec` that only prints information is allowed. After the code commit, stop and tell Steve to copy `custom_components/banner_channels` into Home Assistant's `custom_components` directory and restart. Steve adds Banner Channels from Settings, Devices & services. Expected once Steve reports back: the entry exists, a second add aborts with "Banner Channels is already set up", and no sensors exist until a channel is saved from the sidebar in Task 3.

- [ ] **Step 6: Commit**

```bash
git add custom_components/banner_channels/manifest.json \
  custom_components/banner_channels/const.py \
  custom_components/banner_channels/strings.json \
  custom_components/banner_channels/translations/en.json \
  custom_components/banner_channels/config_flow.py \
  custom_components/banner_channels/store.py \
  custom_components/banner_channels/runtime.py \
  custom_components/banner_channels/sensor.py \
  custom_components/banner_channels/__init__.py
git commit -m "feat: publish one sensor per banner channel"
```

---

### Task 2b: Runtime test

**Files:**
- Create: `tests/test_runtime.py`
- Test: `tests/test_runtime.py`

**Interfaces:**
- Consumes: the config entry, `BannerRuntime`, and `BannerChannelSensor` from Task 2
- Produces: proof that a watched state writes the sensor, an unrelated state does not, an unchanged feed does not write again, a late-added sensor still receives its feed, and delete removes the registry entry

- [ ] **Step 1: Add the Home Assistant test dependency**

Add `pytest-homeassistant-custom-component` to a `requirements-test.txt`. The test module uses the `hass` fixture from that package.

- [ ] **Step 2: Write the test**

Create `tests/test_runtime.py`. Set up a `MockConfigEntry` for `banner_channels`, call `hass.config_entries.async_setup`, then `await hass.async_block_till_done()`. Save a Tablets channel and a Front Door rule through the runtime. Set `binary_sensor.front_door` to `on` with friendly name `Front Door` and block till done. Assert `sensor.banner_tablets` state is `"1"` and `alerts[0].primary` is `Front Door`. Record `last_updated`. Set `sensor.unrelated` to `"1"` and assert `last_updated` is unchanged. Set the door to `on` again with the same attributes and assert `last_updated` is unchanged. Delete the channel and assert `entity_registry.async_get(hass).async_get("sensor.banner_tablets")` is `None`.

- [ ] **Step 3: Run it**

Run: `python -m pytest tests/test_runtime.py -q`

Expected: `1 passed`

- [ ] **Step 4: Commit**

```bash
git add tests/test_runtime.py requirements-test.txt
git commit -m "test: cover banner runtime updates"
```

---

### Task 3: Sidebar editor

**Files:**
- Create: `custom_components/banner_channels/frontend/banner-channels-panel.js`
- Modify: `custom_components/banner_channels/__init__.py`
- Test: the sidebar page against a running Home Assistant

**Interfaces:**
- Consumes: `BannerRuntime.snapshot`, `async_update_record`, `async_delete_record`, `async_reorder`, `validate_channel`, `validate_rule`, `slugify`
- Produces: websocket commands `banner_channels/list`, `banner_channels/save`, `banner_channels/delete`, `banner_channels/reorder`. Each requires admin. `save` takes `kind` (`channel` or `rule`) and `record`. Invalid records return `{ "errors": { field: message } }` and do not write. `delete` takes `kind` and `id`. `reorder` takes `kind` and `ids` in display order.

- [ ] **Step 1: Register static files, the card resource, and the panel**

In `async_setup`, register `StaticPathConfig("/banner_channels", frontend_dir, cache_headers=False)`. Register websocket commands here too.

Register and remove the sidebar panel in `async_setup_entry` and `async_unload_entry`, not in `async_setup`. `async_setup` runs once per process, so a panel removed on unload would not come back when the entry is added again.

```python
await panel_custom.async_register_panel(
    hass,
    frontend_url_path="banner-channels",
    webcomponent_name="banner-channels-panel",
    sidebar_title="Banner Channels",
    sidebar_icon="mdi:billboard",
    module_url="/banner_channels/banner-channels-panel.js",
    require_admin=True,
)
```

Card resource URL is `/banner_channels/banner-channel-card.js?v=0.1.0`. Before checking for an existing resource, `await resources.async_get_info()` so storage is loaded. `async_items()` on an unloaded collection is empty and would register a duplicate on every boot, and the second import throws in `customElements.define`. If `resources` is a `ResourceYAMLCollection`, do not call `async_create_item`. Log the module URL and tell the user to add it in YAML. If a storage resource already points at the same path with a different `v`, update that item instead of creating another.

- [ ] **Step 2: Add the websocket commands**

Register `banner_channels/list`, `banner_channels/save`, `banner_channels/delete`, and `banner_channels/reorder`. Each uses `@websocket_api.require_admin` and `@websocket_api.async_response`.

`save` body is `{ "kind": "channel" | "rule", "record": { ... } }`. A new channel gets `id` `uuid4().hex`, `position` at the end, and `entity_id` `sensor.banner_{slug}` when the client omitted it. An edit keeps the stored `entity_id` even if the client sends a different one. `taken_entity_ids` is every other channel id, plus `hass.states.async_entity_ids()` and every entity registry id, minus this channel's current id. Success returns `{ "record": saved }`. Failure returns `{ "errors": { "<field>": "<message>" } }` and does not write. Coerce `rotate_interval` with `float` before validation, because the panel's number input arrives as a number only after the panel converts it, and the server does it again.

`delete` body is `{ "kind": "channel" | "rule", "id": "..." }`. Deleting a channel removes that id from every rule, calls `entity_registry.async_get(hass).async_remove(entity_id)`, drops the sensor from `self.sensors` and `self._added`, then saves and refreshes.

`reorder` body is `{ "kind": "channel" | "rule", "ids": ["..."] }`. Reject the call unless `ids` is a permutation of the current ids. Then set `position` to the index and refresh.

Show server errors on these fields: `name`, `entity_id` (under the channel name), `rotate_interval`, `empty`, `all_clear_text`, `all_clear_icon`, `headline`, `subtext`, `icon`, `background`, `color`, `match_operator`, `match_entity`, `match_pattern`, `match_value`, `when`, `also_entity`, `also_operator`, `also_value`, `tap_action`, `hold_action`, `subtext_template`. `subtext_template` is checked with `Template(template, hass).ensure_valid()` when the string is non-empty.

- [ ] **Step 3: Write the panel**

Create `custom_components/banner_channels/frontend/banner-channels-panel.js` as a vanilla custom element `banner-channels-panel`. Home Assistant sets `hass` and `panel`. Do not import Lit.

The landing view has two lists, Channels and Rules. Each row is the name or headline. Buttons: Add channel, Add rule. Dragging a row within its list calls `banner_channels/reorder` with the new id order. Under the page title, and under every field, show the help sentences from the spec's Sidebar editor section, verbatim, as muted text. An empty list shows its empty-list sentence in place of the rows.

The channel form edits name, rotation seconds, show badge, and empty mode. All-clear text and icon show only when empty mode is all clear. Save and Delete sit at the bottom. Back returns to the lists without saving.

Rows are `draggable`. On drop within the same list, call `banner_channels/reorder` with the new id order. Numeric fields are sent as numbers, not strings. Service data is parsed as JSON before send. An empty data field is omitted.

The rule form shows a preview banner first: a flex row with an `<ha-icon>`, a headline, and a subtext. Empty fields display `mdi:information`, `Headline`, and `Subtext`. Background and text color update the preview as the inputs change. Use `<input type="color">` plus a hex text field. Clearing the hex field clears that color. Then the fields from the spec: headline, subtext, subtext template, icon, channel checkboxes, match kind, entity or pattern, operator, value, exclude list (one entity id per line), optional time window, optional extra condition, tap action, and hold action. Show the extra action fields named in the spec for the selected action. Service data is a textarea that must be empty or a JSON object. Save sends the record. If the response contains `errors`, show each string under its field and stay on the form.

- [ ] **Step 4: Verify on a dashboard**

Steve performs this step after installing the integration. Do not restart Home Assistant or drive the live dashboard. The landing page shows the sentence that a channel is one banner and a rule is one alert. Create a Tablets channel that hides when empty and rotates every 10 seconds. The channel form shows the help line under Rotate interval and under When empty. Create a Front Door rule tagged with that channel, red background, white text, entity comparison `is` / `on`. Add the Banner Channel card to a dashboard and pick `sensor.banner_tablets`. Expected: with the door shut the card is gone; with the door open the red banner shows and a tap opens more-info. Turn the door off and on with no other change and the sensor's `last_updated` stays put while an unrelated entity changes. Add a second channel, tag the same rule with both, and confirm both sensors show the slide.

- [ ] **Step 5: Commit**

```bash
git add custom_components/banner_channels/__init__.py \
  custom_components/banner_channels/frontend/banner-channels-panel.js
git commit -m "feat: edit banner channels from the sidebar"
```

---

### Task 4: Docs and HACS metadata

**Files:**
- Modify: `hacs.json`
- Modify: `README.md`
- Modify: `info.md`
- Modify: `package.json`
- Delete: `examples/node-red-sensor.md`
- Test: `python -m pytest -q` and `node --test`

**Interfaces:**
- Consumes: the finished integration and card
- Produces: HACS integration metadata and a README that matches the spec

- [ ] **Step 1: Replace the user-facing docs**

Set `hacs.json` to:

```json
{
  "name": "Banner Channels",
  "homeassistant": "2026.10.0",
  "render_readme": true
}
```

`hacs.json` replaces the Alert Ticker Lite Lovelace metadata. `homeassistant` rises from `2023.6.0` to `2026.10.0`. Delete the `filename` key. HACS installs this as an integration.

Rewrite `README.md` and `info.md`. Remove the Node-RED contract and the Alert Ticker Lite name. Keep the MIT credit and the note that this repository is not a fork of AlertTicker-Card. The README has these sections:

**Install.** HACS custom repository `https://github.com/sstratoti/alert-ticker-lite-card`, category Integration. Minimum Home Assistant `2026.10.0`. Manual install is copying `custom_components/banner_channels` into the config `custom_components` directory and restarting. After adding the integration, the card module is `/banner_channels/banner-channel-card.js?v=0.1.0`. YAML-mode Lovelace adds that URL as a module resource. Storage mode gets it from the integration.

**Use.** Add Banner Channels once under Settings, Devices & services. Open the Banner Channels sidebar page. Create a channel (name, rotate interval, badge, empty behavior). Create a rule: headline, subtext, icon, background and text colors, one or more channels, match, optional time window, optional second condition, tap and hold. Add a dashboard card of type `custom:banner-channel` whose only field is `entity`, set to that channel's sensor, for example `sensor.banner_tablets`. Include one channel example and one entity-match rule. State that rotation, colors, and the alert list come from the sensor. The card does not edit rules.

Set `package.json` `name` to `banner-channels` and `description` to `Banner Channels for Home Assistant`. Leave the test script as `node --test`.

Delete `examples/node-red-sensor.md`.

- [ ] **Step 2: Run both test suites**

Run: `python -m pytest -q && node --test`

Expected: pytest reports the evaluate and validate tests passed, and node reports the banner-core tests passed with `# fail 0`.

- [ ] **Step 3: Commit**

```bash
git add hacs.json README.md info.md package.json
git add -u examples/node-red-sensor.md
git commit -m "docs: describe Banner Channels"
```
