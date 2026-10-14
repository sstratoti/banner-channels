# Banner Channels design

Date: 2026-10-13

Banner Channels is a Home Assistant integration. It decides which alerts are active. Banner Channel is the dashboard card. It only draws the feed for one channel.

The product replaces the in-progress Alert Ticker Lite card in this repository. User-facing names do not include "Lite" or "Ticker". Existing AlertTicker-Card dashboards are left as they are. Nothing imports those rules automatically.

## Names

| Surface | Name |
|---|---|
| Integration, sidebar page, HACS name | Banner Channels |
| Dashboard card (picker name) | Banner Channel |
| Card type | `custom:banner-channel` |
| Custom element | `banner-channel` (also registered as `banner-channel-card`) |
| Integration domain | `banner_channels` |
| Sidebar URL | `/banner-channels` |
| Sidebar icon | `mdi:billboard` |

Home Assistant 2026.10.0 or newer. One config entry per Home Assistant instance. MIT license stays.

## What people do

**Settings, once.** An admin opens **Banner Channels** in the sidebar. The page lists channels and rules. Devices & services is only where the integration is added, reloaded, or removed, and where each channel's sensor appears. There is no options flow and no config subentries. The stock configure dialog is not a second editor.

**A channel** is a feed. Saving it creates one sensor, for example `sensor.banner_tablets`. The card on a dashboard is pointed at that sensor and has no other options.

**A rule** is one alert definition. It is tagged with one or more channels. A rule with no channel tags produces no slides.

**A dashboard.** Add the Banner Channel card and pick the channel sensor. The card rotates whatever that sensor currently lists.

## Storage

Channels and rules are stored with Home Assistant's storage helper under the key `banner_channels`, version 1:

```json
{
  "channels": [],
  "rules": []
}
```

Ids are UUID strings. `position` is an integer. Lists are shown and rotated in ascending `position`. Reorder rewrites positions to `0..n-1` within that list.

### Channel

```json
{
  "id": "uuid",
  "name": "Tablets",
  "entity_id": "sensor.banner_tablets",
  "position": 0,
  "rotate_interval": 10,
  "show_badge": true,
  "empty": "hide",
  "all_clear": { "icon": "mdi:check-circle", "text": "All clear" },
  "severity_styles": {
    "info": { "icon": "mdi:information", "color": "#039be5" },
    "warning": { "icon": "", "color": "" },
    "problem": { "icon": "mdi:alert-circle", "color": "#db4437" }
  }
}
```

- `name` is required, trimmed, and at most 64 characters.
- `entity_id` is assigned when the channel is created: `sensor.banner_` plus a slug of the name (lowercase, any run of non-alphanumerics becomes one underscore, trimmed). It does not change when the channel is renamed. The sensor friendly name does change with the name, and that rename is written to the entity immediately. If Home Assistant assigns a different id because the suggestion was taken, the store is updated to the id actually registered. Save is rejected when the suggested id is already present in the state machine or the entity registry, other than this channel's own id. Deleting a channel removes its entity registry entry. `Entity.async_remove()` alone only marks the entity unavailable and leaves the registry row in place.
- Creating a channel whose slug collides with an existing `entity_id` is rejected.
- `rotate_interval` is a number of seconds, `>= 0`. Default `10`. `0` means the card shows the first slide and does not rotate.
- `show_badge` is a boolean. Default `true`.
- `empty` is `hide` (default) or `all_clear`.
- `all_clear.text` is required when `empty` is `all_clear`. `all_clear.icon` is optional. Both are ignored when `empty` is `hide`.
- `severity_styles` is optional. Each of `info`, `warning`, and `problem` may set an `icon` (`mdi:` plus lowercase letters, digits, and hyphens) and a `color` (`#` plus six hex digits). Blank fields are stored as empty strings. These are the channel defaults for that label.

### Rule

```json
{
  "id": "uuid",
  "position": 0,
  "channels": ["channel-uuid"],
  "headline": "Front Door",
  "subtext": "Open",
  "icon": "mdi:door-open",
  "background": "#c62828",
  "color": "#ffffff",
  "severity": "",
  "match": {
    "kind": "entity",
    "entity_id": "binary_sensor.front_door_is_open",
    "operator": "is",
    "value": "on"
  },
  "when": { "from": "20:00", "to": "04:00" },
  "also": {
    "entity_id": "sensor.litter_robot_right_status_code",
    "operator": "is_not",
    "value": "ccp"
  },
  "tap_action": { "action": "more-info" },
  "hold_action": { "action": "none" }
}
```

- `headline` is required, trimmed, at most 1000 characters.
- `subtext` is optional, trimmed, at most 1000 characters.
- Either field is plain text, or a Jinja template when it contains `{{` or `{%`. There is no separate template field.
- `icon` matches `mdi:` plus lowercase letters, digits, and hyphens, or it is a Jinja template of at most 1000 characters when it contains `{{` or `{%`. It is required when `severity` is blank. When `severity` is `info`, `warning`, or `problem`, a blank icon is allowed and the card uses that channel's default icon for the level, or `mdi:information`, `mdi:alert`, or `mdi:alert-circle` when the channel default is also blank.
- `background` and `color` are optional. A plain value is `#` plus six hex digits. A value containing `{{` or `{%` is a Jinja template of at most 1000 characters. A rule `color` replaces the severity default for the label, the icon, and the headline. When it is omitted, the label uses the channel's severity color if one is set, otherwise the theme color, and a channel severity color also tints the icon. The headline stays the theme text color until the rule sets `color`.
- `severity` is optional: empty, `info`, `warning`, or `problem`. The card shows it as a small label above the headline: Information, Warning, or Problem. Empty or missing means no label. Any other value is a save error under the key `severity`, and evaluation ignores it.
- `channels` is a list of channel ids. Unknown ids are dropped at evaluation time.
- `when` is optional. When present, both `from` and `to` are `HH:MM` in the Home Assistant timezone. The window includes `from` and excludes `to`. If `from` is later than `to`, the window wraps midnight (`20:00`–`04:00` matches late night). If `from` equals `to`, the window matches all day. A missing `when` means all day.
- `also` is optional. When present, it is a second comparison that must also be true. The entity may be the same as the main entity. If that entity is missing, the rule does not match. `unavailable` and `unknown` do not match unless that comparison is `is` or `is_not` against that same word.
- Deleting a channel removes that id from every rule.

### Match kinds

**Entity.** `entity_id`, `operator`, and `value` (string). If the entity is missing, the rule does not match. `unavailable` and `unknown` do not match either, unless the comparison is `is` or `is_not` and the value is that same word.

**Filter.** Used for "every battery at or under 20":

```json
{
  "kind": "filter",
  "pattern": "sensor.*battery*",
  "operator": "at_or_below",
  "value": "20",
  "exclude": ["sensor.phone_battery_level"]
}
```

`pattern` is an `fnmatch` pattern against `entity_id`. `exclude` is a list of exact entity ids. Each matching entity becomes its own slide. Slides inside one filter rule are ordered by friendly name, then by `entity_id`. Filter matches never include a Banner Channels channel sensor. An explicit entity match may still name one.

### Operators

| Stored value | Meaning |
|---|---|
| `is` | equal |
| `is_not` | not equal |
| `above` | `>` |
| `at_or_above` | `>=` |
| `below` | `<` |
| `at_or_below` | `<=` |

`is` and `is_not` compare the state string to `value`. The four numeric operators parse both sides with `float`. If either side is not a finite number, the comparison does not match. The editor rejects a numeric operator whose `value` is not a finite number, so that case is a form error rather than a rule that never appears.

### Placeholders and templates

`headline`, `subtext`, `icon`, `background`, and `color` each accept plain text or a Jinja template.

`{state}` and `{name}` are plain replacements when the field does not contain `{{` or `{%`.

- `{state}` is the matched entity's state string.
- `{name}` is the friendly name, or the entity id when there is no friendly name.

A field that contains `{{` or `{%` is rendered by Home Assistant's template engine with `parse_result` false, so the result stays a string. Variables: `state`, `entity_id`, `name`, and `rule_id`. A render error is logged once per rule id, slide entity, and template. A headline or subtext then falls back to the plain `{state}` and `{name}` substitution of the same field. A rendered icon is kept only when it matches `mdi:` plus lowercase letters, digits, and hyphens; otherwise the slide icon is blank and the severity default is used. A rendered background or text color is kept only when it is `#` plus six hex digits; otherwise that color is omitted. The editor checks that a template parses before save. The sidebar preview shows plain icons and colors, and leaves a template field on the severity or theme look. It does not render Jinja.

### Actions

`tap_action` and `hold_action` use Home Assistant's action names: `more-info`, `navigate`, `url`, `toggle`, `call-service`, `none`.

A missing tap, or a tap whose `action` is empty, becomes `more-info` on the matched entity. A missing hold, or `none`, does nothing.

| Action | Fields | Resolution |
|---|---|---|
| `more-info` | optional `entity` | Default entity is the matched entity |
| `navigate` | `navigation_path` required | Passed through |
| `url` | `url_path` required | Must start with `http://`, `https://`, or `/`. The card opens it with `noopener` and `noreferrer`. |
| `toggle` | optional `entity` | Default entity is the matched entity |
| `call-service` | `service` required (`domain.name`), optional `data` object, optional `target` entity id | Passed through |
| `none` | | Card ignores it |

The sensor stores the resolved action, including the filled-in entity, so the card does not look up rules.

## Evaluation

Evaluation is pure except for Jinja rendering, which receives an already-built template callable. Given channels, rules, a snapshot of entity states (`state` and `friendly_name`), and the current time in the Home Assistant timezone, it returns one feed per channel.

The integration:

- Subscribes only to entity ids that current rules and filter matches name, including `also` entities.
- Refreshes that subscription when the entity registry changes, so a new battery sensor can join a filter.
- Runs evaluation on those state changes.
- Runs evaluation every 60 seconds if any rule has a `when` window, so a window can open without a state change. If no rule has a window, that timer is not started.
- Writes a channel sensor only when that channel's feed signature changes.

The signature is a JSON string of `rotate_interval`, `show_badge`, `empty`, `all_clear`, `severity_styles`, and the alert list (`id`, `icon`, `primary`, `secondary`, `background`, `color`, `severity`, `tap_action`, `hold_action`).

Slide `id` is `{rule_id}:{entity_id}`.

A channel's alert list is built by walking rules in ascending `position` and keeping rules that tag that channel. An entity match emits one slide. A filter emits one slide per matching entity, ordered by friendly name, then entity id. That order is the rotation order.

### Sensor

Each channel is a `sensor` entity.

- Unique id: `banner_channel_{channel_id}`
- Entity id: the channel's stored `entity_id`
- State: the active slide count, as a string (`"0"`, `"2"`)
- Device: one device for the config entry, named Banner Channels
- These attributes are not recorded: `alerts`, `all_clear`, `rotate_interval`, `show_badge`, `empty`, `severity_styles`

```json
{
  "rotate_interval": 10,
  "show_badge": true,
  "empty": "hide",
  "all_clear": null,
  "alerts": [
    {
      "id": "rule-uuid:binary_sensor.front_door_is_open",
      "icon": "mdi:door-open",
      "primary": "Front Door",
      "secondary": "Open",
      "background": "#c62828",
      "color": "#ffffff",
      "severity": "warning",
      "tap_action": { "action": "more-info", "entity": "binary_sensor.front_door_is_open" },
      "hold_action": { "action": "none" }
    }
  ]
}
```

`background`, `color`, and `severity` are omitted when unset. `all_clear` is `null` when `empty` is `hide`.

## Sidebar editor

Admin only. Two lists on the landing page: channels, then rules. Each row shows the name or headline. **Add channel** and **Add rule** open a blank editor. Clicking a row opens that record. **Back** returns to the lists without saving. **Save** validates, writes storage, and re-evaluates. **Delete** asks for a confirm, then removes the record. Dragging a list reorders it and saves positions.

The rule editor shows a live banner at the top, then the fields. The preview uses the current form values. Empty headline, subtext, or icon display as `Headline`, `Subtext`, and `mdi:information`. A chosen severity shows the same label and accent as the card. The preview does not read live entity state. Color inputs are `<input type="color">` plus the hex text. Clearing the hex field clears that color.

The channel editor has no banner preview. It edits the channel fields above.

Action fields follow the selected action. `navigate` shows a path. `url` shows a URL. `toggle` and `more-info` show an optional entity, blank meaning the matched entity. `call-service` shows a `domain.service` field, an optional target entity, and an optional data field that must be a JSON object or empty. `none` shows no extra fields.

Validation errors are shown next to the fields. The server rejects an invalid save with the same error keys the form uses, so a stale page cannot write a bad record.

Help text is muted copy under the page title and under each field. Use these sentences verbatim.

Landing, under the title: "A channel is one banner. A rule is one alert. Tag a rule with every channel that should show it, then add a Banner Channel card and pick that channel's sensor."

Empty channels list: "No channels yet. Add one, then point a Banner Channel card at its sensor."

Empty rules list: "No rules yet. An alert appears only on the channels you tag."

Channel fields:

| Field | Help |
| --- | --- |
| Name | Shown in the sidebar and as the sensor's friendly name. Renaming does not change the entity id. |
| Rotate interval | Seconds between slides. 0 keeps the first slide on screen. |
| Slide counter | Shows which slide is on screen, such as 2/9, at the top right. Hidden when there is only one alert. |
| When empty | Hide removes the card when nothing matches. All clear shows a message instead. |
| All-clear text | Shown when this channel has no matching alerts. |
| All-clear icon | Optional icon beside the all-clear text. |

Rule fields:

| Field | Help |
| --- | --- |
| Headline | Main line. `{name}` and `{state}` are replaced for each match. Text with `{{` or `{%` is a Jinja template. Variables: `state`, `entity_id`, `name`, `rule_id`. |
| Severity | Optional label above the headline. Leave blank for none. |
| Subtext | Second line. Same replacements and templates as the headline. |
| Icon | An mdi icon, such as `mdi:door-open`. It uses the text color. |
| Background | Banner color. Leave blank to use the dashboard theme. |
| Text color | Text and icon color. Leave blank to use the dashboard theme. |
| Channels | This alert appears on every channel you check. |
| Match | One entity, or a pattern that becomes one slide per matching entity. |
| Operator and value | Compared with the entity state. Numeric operators need a number. |
| Exclude | Entity ids to skip when using a pattern, one per line. |
| Time window | Optional daily window in Home Assistant's time. An overnight window is allowed. |
| Also | Optional second condition. Both must match. |
| Tap | What a click does. Blank opens more-info for the matched entity. |
| Hold | What a long press does. Blank does nothing. |

## Banner Channel card

Configuration is `entity`, the channel sensor, plus optional `height`, `headline_size`, and `subtext_size` in pixels, and optional `align` of `left` or `center`. Blank sizes use 80, 22, and 16. Blank alignment is left. Center places the icon and text in the middle. The slide counter stays at the top right. The icon is half the height. `setConfig` throws if `entity` is missing or not a string, if a size is present and not a positive number, or if `align` is anything other than left or center.

The card reuses the LitElement Home Assistant has already loaded (`ha-panel-lovelace`'s prototype) and HA's `<ha-icon>`. It does not bundle Lit and does not load a CDN. Lovelace finds the card as the element `banner-channel`. The same class is also registered as `banner-channel-card`. The Add card dialog lists Banner Channel. Its visual editor is the channel sensor plus height, headline size, subtext size, and alignment. The suggested sensor is the first channel already created. YAML with `type: custom:banner-channel` and `entity` still works. Transitions are opacity only (180ms). No transform, filter, shadow, or keyframe animation.

Render:

- Before the first `hass` object, render nothing.
- Sensor missing, or state `unavailable` or `unknown`: a muted line, `Banner unavailable`.
- State available, `alerts` empty, `empty` is `hide`: set the host to `display: none`. Any other render clears that inline display so the card becomes visible again.
- State available, `alerts` empty, `empty` is `all_clear`: show that icon and text. A tap uses no action.
- Otherwise draw the current alert: icon, optional severity label, primary, optional secondary. Apply `background` on the row and `color` on the text and icon when those attributes are present. When `show_badge` is true and more than one alert is active, show `current/total` at the top right, such as `3/9`. One alert hides that counter.
- When the slide has a `severity`, a small uppercase label (Information, Warning, Problem) sits above the primary line. The icon is the slide's `icon` when that is set. Otherwise it is the channel `severity_styles` icon for that level, then `mdi:information`, `mdi:alert`, or `mdi:alert-circle`. The label color is the slide's `color` when set, otherwise the channel severity color, otherwise the theme's `--info-color`, `--warning-color`, or `--error-color`. A channel severity color also tints the icon. A slide `color` tints the icon, the label, and the headline, and leaves the accent on the severity color. Without a `background`, the row gets a 3px left accent in the severity color (the channel color when set, otherwise the theme color). A `background` replaces the accent.
- Layout uses the card's height, headline size, and subtext size. The icon is half the height. The severity label is half the headline size. Each line is one line with an ellipsis.

Rotation: one `setInterval` when `rotate_interval > 0`, the page is visible, and there is more than one alert. The interval is cleared on disconnect, when the feed signature changes, and while `document.hidden` is true. Visibility changes restart or stop the timer. A fade in progress is cancelled when the timer stops or the feed changes.

Pointer: primary-button pointer down starts a 500ms hold timer. Releasing before that fires a tap. Moving more than 10 pixels cancels both, so a scroll does not activate the banner. A non-primary button does not tap or hold. There is no double-tap. `set hass` before `setConfig` does nothing.

Actions are the resolved objects on the slide, handled as `more-info` (`hass-more-info`), `navigate` (`history.pushState` plus `location-changed`), `url` (`window.open` the URL), `toggle` (`homeassistant.toggle`), and `call-service` (`hass.callService`). `none` and an unknown action do nothing. Service calls that reject are ignored after logging.

The card re-renders when the feed signature changes, and when rotation advances the index. An index past the end of the list wraps to 0.

## Out of scope

Snooze, blink, double-tap, themes, sound, Node-RED rotation, and importing AlertTicker or button-card config.

## Testing

- Pure Python tests cover operators, time windows (including midnight wrap and the HA timezone), the extra condition, `{state}` and `{name}`, filter expansion and exclude, slide order, resolved tap defaults, feed signatures, and validation errors.
- Node tests cover the card's pure helpers: config validation, signature, index wrap, empty versus unavailable decisions, and action choice.
- A browser harness feeds a fake `hass` and checks rotation, hide, all-clear, unavailable, colors, and tap versus scroll.
- `tests/test_runtime.py` loads the integration under Home Assistant's test harness. A state change for a watched entity updates the sensor. An unrelated entity does not. An unchanged feed does not write again. A sensor added after the first refresh still receives its feed. Deleting a channel removes the registry entry.

## Repository shape

This repository becomes an integration:

```
custom_components/banner_channels/
  manifest.json
  __init__.py
  config_flow.py
  const.py
  evaluate.py
  validate.py
  store.py
  runtime.py
  sensor.py
  strings.json
  translations/en.json
  frontend/
    banner-channel-card.js
    banner-core.js
    banner-channels-panel.js
hacs.json
tests/test_evaluate.py
tests/test_validate.py
tests/test_runtime.py
package.json          # node --test for banner-core
```

The integration serves `frontend/` at `/banner_channels` and registers the card as a Lovelace module resource at `/banner_channels/banner-channel-card.js?v=` plus the integration version. The resource list is loaded before that check. In YAML resource mode the integration logs the URL instead of writing storage. The sidebar panel is `banner-channels-panel`, admin only, and it is added and removed with the config entry.

The current root `alert-ticker-lite-card.js`, `lib/`, and Node-RED example are removed as part of that move. `info.md` and `README.md` describe Banner Channels and the one-field card.

`hacs.json` names the integration `Banner Channels`, sets `homeassistant` to `2026.10.0`, and does not set a Lovelace `filename`. HACS installs it as an integration.
