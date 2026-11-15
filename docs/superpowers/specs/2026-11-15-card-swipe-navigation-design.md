# Card swipe navigation — design

Date: 2026-11-15
Status: approved in conversation, pending written-spec review

## Goal

When a Banner Channel card is showing more than one alert, let the viewer swipe
horizontally on the card to move to the next or previous alert, instead of
waiting for auto-rotation.

## Scope

- Frontend only: `custom_components/banner_channels/frontend/banner-channel-card.js`
  and a pure helper in `frontend/banner-core.js`.
- No backend, sensor attribute, config-flow, panel, or card-config changes.
  There is no new option; swipe is always available when there are 2+ alerts.
- Swipes are captured only when they start on the card itself. The listeners
  stay on the card's `ha-card` element; nothing is attached to the window,
  document, or dashboard view.
- Position is per card instance, as it is today. A swipe on one dashboard or
  device does not affect any other card.

Out of scope: slide/drag animation, position dots, keyboard navigation, syncing
position between cards, a config toggle to disable swipe.

## Behaviour

| Situation | Result |
|---|---|
| Swipe left on the card, 2+ alerts | Show the next alert; wraps from last to first |
| Swipe right on the card, 2+ alerts | Show the previous alert; wraps from first to last |
| Swipe with exactly 1 alert, or in all-clear / unavailable mode | Nothing happens |
| Vertical drag on the card | Page scrolls as normal; alert does not change |
| Any drag past 10px | Never fires tap, hold, or double-tap actions (as today) |
| After a successful swipe | Auto-rotation timer restarts, so the alert swiped to gets a full `rotate_interval`, then rotation continues from there |
| `rotate_interval` is 0 | Swipe still works; the card stays on the alert swiped to |

The change of alert is instant, with no animation, matching the existing
rotation behaviour. The existing "2/3" counter reflects the new position.

A swipe is recognised on pointer release when the total horizontal travel is at
least 40px and horizontal travel is at least 1.5x the vertical travel. Works
for touch, pen, and mouse drag (the card uses pointer events).

## Design

### `banner-core.js`

Two pure, unit-tested helpers:

- `swipeDirection(dx, dy)` returns `1` (next, for a leftward swipe, `dx <= -40`),
  `-1` (previous, `dx >= 40`), or `0` when the travel is too short or not
  horizontal enough (`|dx| < 1.5 * |dy|`). Non-finite input returns `0`.
- `stepIndex(index, length, delta)` returns the wrapped index after moving by
  `delta` (`1` or `-1`). Returns `0` when `length` is 0 or 1. `nextIndex` stays
  as is for the rotation timer.

### `banner-channel-card.js`

Pointer handling today: `pointerdown` records a press; `pointermove` beyond 10px
calls `_cancelGestures()`, dropping the press entirely.

Change:

- `pointermove` beyond 10px: cancel the hold timer and any pending tap (same
  effect on actions as today), but keep the press and mark it `moved`.
- `pointerup` on a `moved` press: clear the press, compute
  `swipeDirection(dx, dy)` from the press origin to the release point. If
  non-zero, the mode is `alerts`, and there are 2+ alerts: set `_index` with
  `stepIndex`, call `_restartRotation()`, bump `_rev`. No action is run in any
  case for a `moved` press.
- `pointercancel`: unchanged, discards the press. No navigation.
- CSS: add `touch-action: pan-y` to `ha-card` so the browser keeps vertical
  scrolling but delivers horizontal drags to the card instead of cancelling the
  pointer.

Existing safeguards stay: the `hass` setter already drops a press whose alert
left the feed, and already keeps the card on the currently viewed alert (by id)
when the feed changes.

### Known interaction

In the Home Assistant companion app, a swipe starting at the far left screen
edge opens the sidebar. That is the app's gesture and is not changed; swipes
that begin on the card are handled by the card.

## Testing

`test/banner-core.test.mjs`:
- `swipeDirection`: left/right past threshold, below threshold, diagonal that
  fails the ratio, vertical, non-finite input.
- `stepIndex`: forward, backward, wrap both ends, length 0 and 1.

`test/banner-card-ui.test.mjs`:
- Swipe left advances; swipe right goes back; wrap at both ends.
- Swipe fires no tap/hold/double-tap action, including when a tap was pending.
- Single alert: swipe is a no-op.
- Short drag (between 10px and 40px): no navigation and no action.
- Vertical drag: no navigation.
- Swipe restarts the rotation timer (next tick is a full interval later).
- `pointercancel` mid-drag: no navigation.

## Docs

Add a short "Swipe between alerts" note to `README.md` and `info.md` where card
behaviour is described.
