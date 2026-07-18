# Feeding `sensor.alert_ticker` from Node-RED

The card is a thin renderer — Node-RED decides *which* alerts exist and in what
order. Keep one sensor updated with the count (state) and the alert list
(`alerts` attribute). The card handles rotation entirely on the frontend via its
`rotate_interval`, so Node-RED only needs to publish the current list; it does
**not** need to rotate anything.

## Build the payload (function node)

```js
// Upstream nodes assemble `msg.alerts` from your alert sources (leak sensors,
// door/window, battery, etc.). Each item: { icon, primary, secondary?, color?, tap_action? }.
const alerts = msg.alerts || [];

msg.payload = {
  state: alerts.length,          // → the badge / count
  attributes: { alerts },        // → the card's rotating list
};
return msg;
```

## Push it to Home Assistant

Send `msg.payload` to whichever mechanism you already use to back an HA sensor:

- **`ha-entity` node** (node-red-contrib-home-assistant-websocket) configured as a
  `sensor` named `alert_ticker`, with *State* = `payload.state` and the
  attributes mapped from `payload.attributes`, **or**
- **MQTT** to an `mqtt` sensor (`state_topic` + `json_attributes_topic`).

## Example list

```json
{
  "state": 2,
  "attributes": {
    "alerts": [
      { "icon": "mdi:water-alert", "primary": "Basement leak", "secondary": "Sensor 3 · 2m ago", "color": "#e53935",
        "tap_action": { "action": "navigate", "navigation_path": "/lovelace/alerts" } },
      { "icon": "mdi:garage-open", "primary": "Garage door open", "secondary": "14 min" }
    ]
  }
}
```

## Migrating from the old button-card flow

If you previously drove a `custom:button-card` template from a Node-RED sensor,
that flow likely already assembles a list very close to this shape. Repoint it at
`sensor.alert_ticker` and reshape each item to `{ icon, primary, secondary }` —
no rotation logic needed in the flow anymore; the card owns that now.
