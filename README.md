# Banner Channels

Banner Channels is a Home Assistant integration. It decides which alerts are active. Banner Channel is the dashboard card. It draws the feed for one channel.

## Install

**HACS (custom repository):**

1. HACS → ⋮ → Custom repositories → add `https://github.com/sstratoti/alert-ticker-lite-card`, category **Integration**.
2. Install **Banner Channels**. Home Assistant **2026.10.0** or newer is required.

**Manual:** copy `custom_components/banner_channels` into the configuration `custom_components` directory and restart Home Assistant.

After the integration is added, the card module is:

`/banner_channels/banner-channel-card.js?v=0.1.0`

YAML-mode Lovelace adds that URL as a module resource:

```yaml
url: /banner_channels/banner-channel-card.js?v=0.1.0
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

`rotate_interval` is seconds between slides. `0` keeps the first slide on screen. `show_badge` shows the number of active alerts. `empty` is `hide` or `all_clear`.

Create a rule and tag it with one or more channels. A rule with no channel tags produces no slides. Fields: headline, subtext, icon, background and text colors, channels, match, an optional time window, an optional second condition, and tap and hold.

```json
{
  "id": "uuid",
  "position": 0,
  "channels": ["channel-uuid"],
  "headline": "Front Door",
  "subtext": "Open",
  "subtext_template": "",
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

Add a dashboard card of type `custom:banner-channel`. Its only field is `entity`, set to that channel's sensor:

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
