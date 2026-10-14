# Banner Channels

Banner Channels is a Home Assistant integration. It decides which alerts are active. Banner Channel is the dashboard card. It draws the feed for one channel.

## Install

HACS custom repository: `https://github.com/sstratoti/banner-channels`, category **Integration**. Minimum Home Assistant **2026.10.0**.

Manual install: copy `custom_components/banner_channels` into the configuration `custom_components` directory and restart Home Assistant.

Card module: `/banner_channels/banner-channel-card.js?v=0.3.0`. YAML-mode Lovelace adds that URL as a module resource. Storage mode gets it from the integration.

```yaml
url: /banner_channels/banner-channel-card.js?v=0.3.0
type: module
```

## Use

Add Banner Channels once under **Settings → Devices & services**. Open the Banner Channels sidebar page.

Create a channel (name, rotate interval, badge, empty behavior). Saving it creates one sensor, for example `sensor.banner_tablets`.

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

Create a rule tagged with one or more channels: headline, subtext, icon, background and text colors, match, optional time window, optional second condition, tap and hold. In the headline or the subtext, `{name}` and `{state}` are replaced for each match. Text that contains `{{` or `{%` is a Jinja template, with variables `state`, `entity_id`, `name`, and `rule_id`. The icon, background, and text color accept the same templates. A rendered icon must be an `mdi:` name. A rendered color must look like `#c62828`.

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
  "also": {
    "entity_id": "sensor.litter_robot_right_status_code",
    "operator": "is_not",
    "value": "ccp"
  },
  "tap_action": { "action": "more-info" },
  "hold_action": { "action": "none" }
}
```

On a dashboard, choose Add card and pick Banner Channel. The editor asks for the channel sensor. The same card in YAML is:

```yaml
type: custom:banner-channel
entity: sensor.banner_tablets
```

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
