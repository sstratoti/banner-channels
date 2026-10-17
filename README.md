# Banner Channels

Banner Channels is a Home Assistant integration. It decides which alerts are active. Banner Channel is the dashboard card. It draws the feed for one channel.

## Install

**HACS (custom repository):**

1. HACS → ⋮ → Custom repositories → add `https://github.com/sstratoti/banner-channels`, category **Integration**.
2. Install **Banner Channels**. Home Assistant **2026.10.0** or newer is required.

**Manual:** copy `custom_components/banner_channels` into the configuration `custom_components` directory and restart Home Assistant.

After the integration is added, the card module is:

`/banner_channels/banner-channel-card.js?v=0.3.0`

YAML-mode Lovelace adds that URL as a module resource:

```yaml
url: /banner_channels/banner-channel-card.js?v=0.3.0
type: module
```

Storage mode gets the resource from the integration.

## Use

Add Banner Channels once under **Settings → Devices & services**. Open the Banner Channels sidebar page.

Create a channel: name, rotate interval, badge, and empty behavior. Saving it creates one sensor. The entity id is assigned from the name and does not change if you rename the channel.

```json
{
  "id": "uuid",
  "name": "Tablets",
  "entity_id": "sensor.banner_tablets",
  "position": 0,
  "rotate_interval": 10,
  "show_badge": true,
  "empty": "hide",
  "all_clear": { "icon": "mdi:check-circle", "text": "All clear" }
}
```

`rotate_interval` is seconds between slides. Rotation swaps directly to the next alert without fades or animations. `0` keeps the first slide on screen. `show_badge` shows which slide is on screen, such as `2/9`, at the top right, and hides that counter when only one alert is active. `empty` is `hide` or `all_clear`. `severity_styles` sets a default icon and color for Information, Warning, and Problem. A rule's own icon or text color replaces those defaults.

Create a rule and tag it with one or more channels. A rule with no channel tags produces no slides. Fields: headline, subtext, icon, background and text colors, channels, match, an optional time window, additional AND/OR conditions, visibility, secondary positioning, and tap/hold/double-tap actions. In the headline or the subtext, `{name}` and `{state}` are replaced for each match. Text that contains `{{` or `{%` is a Jinja template, with variables `state`, `entity_id`, `name`, and `rule_id`. The icon, background, and text color accept the same templates. A rendered icon must be an `mdi:` name. A rendered color must look like `#c62828`.

The sidebar uses Home Assistant's native entity, service, and icon pickers. Entity pickers also appear in additional conditions and in all three action editors, including service targets. Leave a Toggle or More-info entity blank to use the matched entity. For an alert icon template, enable **Use template**; existing icon templates open in that mode automatically. Channel all-clear and severity icons use the icon picker too. Text inputs remain available if the native controls cannot load.

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
  "match": {
    "kind": "entity",
    "entity_id": "binary_sensor.front_door_is_open",
    "operator": "is",
    "value": "on"
  },
  "when": { "from": "20:00", "to": "04:00" },
  "conditions_logic": "and",
  "conditions": [{
    "entity_id": "sensor.litter_robot_right_status_code",
    "operator": "is_not",
    "value": "ccp"
  }],
  "secondary_position": "right",
  "visibility": { "mode": "users", "user_ids": ["home-assistant-user-id"] },
  "tap_action": { "action": "more-info" },
  "hold_action": { "action": "none" },
  "double_tap_action": { "action": "toggle", "entity": "light.porch" }
}
```

The editor preview renders Jinja through Home Assistant and updates when referenced entities change, without saving the rule. The form retains the template source. Invalid templates show a preview error. Plain `{name}` and `{state}` replacements use the selected entity; pattern rules prefer the first entity that satisfies the primary condition, ordered by friendly name and respecting exclusions. If none currently satisfies it, the first candidate is used so inactive alerts remain previewable.

A condition compares the entity state unless its optional `attribute` names a direct entity attribute (for example `current_temperature`). Attribute-only updates are evaluated too. Missing/null attributes never match. Text comparisons use lowercase `true`/`false` for boolean attributes. `{state}` and the Jinja `state` variable still mean the entity's actual state.

The primary match is always required. `conditions_logic: and` requires every additional condition; `or` requires at least one. With no additional conditions, only the primary match and optional time window apply. Existing `also` rules open as one additional AND condition and are saved in the new format.

**Secondary value position** places the existing subtext below or to the right of the headline; severity stays above. **Visible to** offers Everyone, Admins, Non-admins, or Specific users. Specific users shows a selectable list of active Home Assistant users by name and stores their IDs, so renaming a user preserves the selection. This filters dashboard display only: the shared channel sensor still contains all active alerts. The dashboard counter and rotation count only visible alerts. If every alert is hidden for the logged-in user, the card uses the channel’s normal hide/all-clear setting.

Tap executes immediately unless Double tap has an enabled action. With Double tap configured, a single tap waits 250 ms; two taps run only Double tap. Hold uses a 500 ms press. Movement, card removal, or an alert becoming hidden cancels pending gestures. Actions remain tied to the pressed alert if the carousel rotates.

On a dashboard, choose Add card and pick Banner Channel. The editor asks for the channel sensor. The same card in YAML is:

```yaml
type: custom:banner-channel
entity: sensor.banner_tablets
height: 120
headline_size: 32
subtext_size: 20
```

`height`, `headline_size`, and `subtext_size` are optional pixels. Leave them out for 80, 22, and 16. The icon is half the height. A wall dashboard can use the larger numbers. A phone can use something like `height: 52`, `headline_size: 15`, and `subtext_size: 12`. `align` is `left` or `center`. Left is the default. Center places the icon and text in the middle, and the slide counter stays at the top right.

The sensor state is the active slide count. Rotation, colors, and the alert list come from the sensor:

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
      "tap_action": {
        "action": "more-info",
        "entity": "binary_sensor.front_door_is_open"
      },
      "hold_action": { "action": "none" }
    }
  ]
}
```

The card does not edit rules.

## Credit & license

Inspired by [AlertTicker-Card](https://github.com/djdevil/AlertTicker-Card) by **djdevil**. This repository is not a fork of AlertTicker-Card. MIT licensed.
