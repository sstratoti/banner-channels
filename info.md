# Alert Ticker Lite

A tiny, fast rotating alert ticker for Home Assistant dashboards — built for
low-power wall tablets. Reads one sensor (state = count, `alerts` attribute =
the list) and cycles through the alerts with a simple opacity fade. No bundled
libraries, `opacity`-only effects, well under 15 KB.

```yaml
type: custom:alert-ticker-lite-card
entity: sensor.alert_ticker
rotate_interval: 5
tap_action: { action: more-info }
all_clear: { icon: mdi:check-circle, text: "All clear" }
```

Each item in the `alerts` array: `{ icon, primary, secondary?, color?, tap_action? }`.

Inspired by [AlertTicker-Card](https://github.com/djdevil/AlertTicker-Card) by
djdevil; clean-room lightweight reimplementation. MIT.
