# Alert Ticker Lite

A lightweight, HACS-installable Home Assistant custom card that shows a rotating
"ticker" of active alerts — a count badge, an mdi icon, a headline, and subtext —
and cycles through them client-side. It is built to run smoothly on low-power
**wall-mounted tablets** and the iOS app, where heavier alert cards lag.

**Why it exists.** The excellent but feature-packed
[AlertTicker-Card](https://github.com/djdevil/AlertTicker-Card) ships a ~488 KB
card (plus a ~520 KB editor) with hundreds of CSS animations, blur/`filter`
effects, live-camera backgrounds, a bundled `d3`, TTS, push, a music-player mode,
weather widgets, history and snooze. On weak tablet GPUs that combination causes
severe repaint/compositing lag. **Alert Ticker Lite** does one thing — render a
rotating list fed by a single sensor — in a single small file (**< 15 KB**, no
bundled libraries), using only `opacity` transitions. Your automation platform
(e.g. **Node-RED**) stays the source of truth for *which* alerts exist.

## Install

**HACS (custom repository):**
1. HACS → ⋮ → *Custom repositories* → add
   `https://github.com/sstratoti/alert-ticker-lite-card`, category **Lovelace**.
2. Install **Alert Ticker Lite**, then reload resources (HACS adds the resource
   automatically).

**Manual:** copy `alert-ticker-lite-card.js` and the `lib/` folder into
`config/www/alert-ticker-lite-card/`, then add a Lovelace resource:

```yaml
url: /local/alert-ticker-lite-card/alert-ticker-lite-card.js
type: module
```

## The sensor contract

The card is read-only. Point it at **one** sensor whose **state is the alert
count** and whose **`alerts` attribute is the array** to display:

```yaml
sensor.alert_ticker
  state: 3                         # active-alert count → the badge
  attributes:
    alerts:
      - icon: mdi:water-alert      # required (mdi:)
        primary: "Basement leak"   # required — headline
        secondary: "Leak Sensor 3 · 2m ago"   # optional — subtext
        color: "#e53935"           # optional — per-alert accent (icon tint)
        tap_action:                # optional — overrides the card-level tap
          action: navigate
          navigation_path: /lovelace/alerts
      - icon: mdi:garage-open
        primary: "Garage door open"
        secondary: "14 min"
```

- If the state is not numeric, the badge falls back to `alerts.length`.
- Items missing `icon` or `primary` are skipped defensively.
- An empty/missing `alerts` array shows the optional all-clear row.

See [`examples/node-red-sensor.md`](examples/node-red-sensor.md) for how to
populate this sensor from Node-RED.

## Card configuration

```yaml
type: custom:alert-ticker-lite-card
entity: sensor.alert_ticker         # required
rotate_interval: 5                  # seconds between alerts; 0 = static. default 5
transition: fade                    # fade | none. default fade
attribute: alerts                   # attribute holding the array. default 'alerts'
show_badge: true                    # show the count badge. default true
tap_action: { action: more-info }               # card-level default
hold_action: { action: navigate, navigation_path: /lovelace/alerts }
double_tap_action: { action: none }
all_clear:                          # shown when count = 0 (optional)
  icon: mdi:check-circle
  text: "All clear"
```

| Option | Default | Notes |
|---|---|---|
| `entity` | — | **Required.** The alert sensor. |
| `rotate_interval` | `5` | Seconds per alert. `0` = no rotation (static). |
| `transition` | `fade` | `fade` (opacity) or `none`. |
| `attribute` | `alerts` | Attribute holding the alert array. |
| `show_badge` | `true` | Hide with `false`; auto-hidden when count is 0. |
| `tap_action` / `hold_action` / `double_tap_action` | `more-info` / — / — | Standard HA actions: `more-info`, `navigate`, `url`, `call-service`, `toggle`, `none`. A per-alert `tap_action` overrides the card default. |
| `all_clear` | — | `{ icon, text }` shown when there are no alerts. Omit to render nothing. |

## How rotation works

Node-RED (or any automation) keeps the `alerts` list current on the sensor. The
card holds **one** timer and round-robins the array in order, fading between
items. There is no per-tick network traffic, the timer runs only when there is
more than one alert, it is cleared when the card leaves the DOM, and it pauses
while the tab/page is hidden — so a backgrounded tablet does no work.

## Performance notes

- Single file, **no bundled libraries** — reuses the LitElement that Home
  Assistant's frontend already loads, and HA's built-in `<ha-icon>`.
- **`opacity`-only** transitions; no `transform`, `box-shadow`, `filter`,
  `backdrop-filter`, or `@keyframes`.
- No layout reads (`getBoundingClientRect`/`offsetWidth`) → no forced reflow.

## Development

- `npm test` runs the pure-logic unit tests (`node:test`, no dependencies).
- Open `test/harness.html` in a browser (or serve the repo and visit
  `/test/harness.html`) to exercise rotation, actions, and the empty/unavailable
  states with a mock `hass`.

## Credit & license

Inspired by [AlertTicker-Card](https://github.com/djdevil/AlertTicker-Card) by
**djdevil** — this is a clean-room, lightweight reimplementation, not a fork of
its code. MIT licensed.
