# Card Swipe Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a viewer swipe horizontally on a Banner Channel card to move to the next or previous alert when the card has 2+ alerts.

**Architecture:** Two pure helpers in `banner-core.js` decide swipe direction and the wrapped index. The card's existing pointer handlers (which already cancel tap/hold/double-tap after 10px of movement) are changed to keep the press alive after movement and, on release, navigate if the drag was a horizontal swipe. No backend changes.

**Tech Stack:** Vanilla JS ES modules, Lit (borrowed from Home Assistant at runtime; `lit` npm package in tests), `node --test` with `happy-dom`.

Spec: `docs/superpowers/specs/2026-11-15-card-swipe-navigation-design.md`

## Global Constraints

- Work on branch `feat/card-swipe-navigation` (already created; the spec is committed there).
- Frontend only. Do not touch any `.py` file, the panel (`banner-channels-panel.js`), or the card config schema. No new card option.
- Listeners stay on the card's `ha-card` element only. Do not add listeners to `window`, `document`, or any ancestor.
- A swipe is: horizontal travel `>= 40` px AND horizontal travel `>= 1.5 x` vertical travel, measured from press origin to release point.
- Swipe left = next alert, swipe right = previous alert, wrapping at both ends.
- Alert change is instant: no animation, no transition, no fade.
- Any drag past 10px must never run a tap, hold, or double-tap action.
- After a successful swipe the rotation timer restarts (full `rotate_interval` for the alert swiped to).
- `README.md` and `info.md` are byte-identical today and must stay identical: apply every docs edit to both.
- Run tests from the repo root: `npm test`. Baseline before this work: 59 tests, 0 failures.
- End every commit message with:
  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UcjyHeyGL3TJpX9sHeAK4S
  ```

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `custom_components/banner_channels/frontend/banner-core.js` | Modify (add after `nextIndex`, line ~232) | Pure helpers `swipeDirection`, `stepIndex` |
| `test/banner-core.test.mjs` | Modify | Unit tests for the helpers |
| `custom_components/banner_channels/frontend/banner-channel-card.js` | Modify (`_onPointerDown`, `_onPointerMove`, `_onPointerUp`, new `_swipe`, styles) | Gesture handling and navigation |
| `test/banner-card-ui.test.mjs` | Modify | UI tests for swipe |
| `README.md`, `info.md` | Modify | User docs |

---

### Task 1: Core helpers `swipeDirection` and `stepIndex`

**Files:**
- Modify: `custom_components/banner_channels/frontend/banner-core.js` (insert directly after the `nextIndex` function)
- Test: `test/banner-core.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `swipeDirection(dx: number, dy: number): 1 | -1 | 0` — `1` = next (leftward swipe), `-1` = previous (rightward swipe), `0` = not a swipe.
  - `stepIndex(current: number, length: number, delta: 1 | -1): number` — wrapped index; `0` when `length < 2`.

- [ ] **Step 1: Write the failing tests**

In `test/banner-core.test.mjs`, add `swipeDirection, stepIndex` to the existing import list from `banner-core.js` (line 4), so it reads:

```js
import {
  validateConfig, stubEntity, cardLayout, cardEditorLabel, CARD_EDITOR_SCHEMA, feedSignature, nextIndex, viewMode, showBadge, slideCounter, describeAction, resolveIcon, severityLook, swipeDirection, stepIndex,
} from "../custom_components/banner_channels/frontend/banner-core.js";
```

Append to the end of the file:

```js
test("swipeDirection needs 40px of mostly horizontal travel", () => {
  assert.equal(swipeDirection(-40, 0), 1);
  assert.equal(swipeDirection(-120, 30), 1);
  assert.equal(swipeDirection(40, 0), -1);
  assert.equal(swipeDirection(90, -20), -1);
  assert.equal(swipeDirection(-39, 0), 0);
  assert.equal(swipeDirection(39, 0), 0);
  assert.equal(swipeDirection(0, 0), 0);
  assert.equal(swipeDirection(-60, 41), 0);
  assert.equal(swipeDirection(-60, 40), 1);
  assert.equal(swipeDirection(50, -80), 0);
  assert.equal(swipeDirection(0, 200), 0);
  assert.equal(swipeDirection(NaN, 0), 0);
  assert.equal(swipeDirection(-60, NaN), 0);
  assert.equal(swipeDirection(undefined, undefined), 0);
  assert.equal(swipeDirection(-Infinity, 0), 0);
});

test("stepIndex moves both ways and wraps", () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(1, 3, -1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 2, -1), 1);
  assert.equal(stepIndex(0, 1, 1), 0);
  assert.equal(stepIndex(0, 1, -1), 0);
  assert.equal(stepIndex(4, 0, 1), 0);
  assert.equal(stepIndex(undefined, 3, 1), 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/banner-core.test.mjs`
Expected: FAIL. The file fails to load with `SyntaxError: The requested module ... does not provide an export named 'stepIndex'` (or `'swipeDirection'`).

- [ ] **Step 3: Implement the helpers**

In `custom_components/banner_channels/frontend/banner-core.js`, directly after the existing `nextIndex` function:

```js
export function nextIndex(current, length) {
  if (!length || length < 1) return 0;
  return (current + 1) % length;
}
```

insert:

```js

export function stepIndex(current, length, delta) {
  const count = Number(length);
  if (!Number.isFinite(count) || count < 2) return 0;
  const start = Number.isFinite(Number(current)) ? Number(current) : 0;
  return (((start + delta) % count) + count) % count;
}

export function swipeDirection(dx, dy) {
  const x = Number(dx);
  const y = Number(dy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  if (Math.abs(x) < 40 || Math.abs(x) < 1.5 * Math.abs(y)) return 0;
  return x < 0 ? 1 : -1;
}
```

Leave `nextIndex` unchanged; the rotation timer still uses it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/banner-core.test.mjs`
Expected: PASS, 0 failures.

Run: `npm test`
Expected: `# pass 61`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add custom_components/banner_channels/frontend/banner-core.js test/banner-core.test.mjs
git commit -m "feat: add swipe direction and step index helpers

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcjyHeyGL3TJpX9sHeAK4S"
```

---

### Task 2: Swipe navigation on the card, plus docs

**Files:**
- Modify: `custom_components/banner_channels/frontend/banner-channel-card.js`
- Test: `test/banner-card-ui.test.mjs`
- Modify: `README.md`, `info.md`

**Interfaces:**
- Consumes (from Task 1, exported by `./banner-core.js`):
  - `swipeDirection(dx, dy)` returns `1` (next), `-1` (previous), or `0`.
  - `stepIndex(current, length, delta)` returns the wrapped index.
- Produces: no new public API. Adds private method `_swipe(direction)` on `BannerChannelCard`.

**Background for the implementer.** The card tracks one press at a time in `this._press` (`{x, y, pointerId, alert, previousTap}`), set in `_onPointerDown`. Today `_onPointerMove` calls `_cancelGestures()` once the pointer moves more than 10px, which throws the press away. The change: keep the press, mark it `moved`, and let `_onPointerUp` decide whether it was a swipe. `this._index` is the shown alert; `this._rev` is a Lit state counter bumped to force a re-render; `_restartRotation()` clears and restarts the `setInterval` rotation timer.

- [ ] **Step 1: Write the failing tests**

In `test/banner-card-ui.test.mjs`, add these two helpers directly after the existing `release` function (around line 87):

```js
function move(card, x, y = 0, id = 1) {
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointermove", {pointerId: id, clientX: x, clientY: y}));
}
function swipe(card, dx, dy = 0, id = 1) {
  press(card, id);
  move(card, dx, dy, id);
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointerup", {button: 0, pointerId: id, clientX: dx, clientY: dy}));
}
```

Append these tests to the end of the file:

```js
test("swipe left shows the next alert and swipe right the previous, wrapping", async (t) => {
  const {card, services} = await cardFor(t, [alert("one"), alert("two"), alert("three")]);
  swipe(card, -60);
  await card.updateComplete;
  assert.equal(card.shadowRoot.querySelector(".primary").textContent, "two");
  assert.equal(card.shadowRoot.querySelector(".counter").textContent, "2/3");
  swipe(card, -60);
  swipe(card, -60);
  await card.updateComplete;
  assert.equal(card._currentAlert().id, "one");
  swipe(card, 60);
  await card.updateComplete;
  assert.equal(card.shadowRoot.querySelector(".primary").textContent, "three");
  swipe(card, 60);
  assert.equal(card._currentAlert().id, "two");
  assert.equal(services.length, 0);
});

test("swipe never runs tap, hold, or double-tap actions", async (t) => {
  const actions = {double_tap_action: {action: "toggle", entity: "light.double"}, hold_action: {action: "toggle", entity: "light.hold"}};
  const {card, services} = await cardFor(t, [alert("one", actions), alert("two", actions)]);
  const tick = clock(t);
  press(card); release(card);
  tick(100);
  press(card); move(card, -60); tick(600);
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointerup", {button: 0, pointerId: 1, clientX: -60, clientY: 0}));
  tick(1000);
  assert.equal(services.length, 0);
  assert.equal(card._currentAlert().id, "two");
});

test("swipe after a hold has fired does not navigate", async (t) => {
  const {card, services} = await cardFor(t, [alert("one", {hold_action: {action: "toggle", entity: "light.hold"}}), alert("two")]);
  const tick = clock(t);
  press(card);
  tick(500);
  move(card, -60);
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointerup", {button: 0, pointerId: 1, clientX: -60, clientY: 0}));
  assert.deepEqual(services.map((s) => s[2].entity_id), ["light.hold"]);
  assert.equal(card._currentAlert().id, "one");
});

test("swipe is a no-op with a single alert", async (t) => {
  const {card, services} = await cardFor(t, [alert("one")]);
  swipe(card, -60);
  swipe(card, 60);
  assert.equal(card._index, 0);
  assert.equal(card._currentAlert().id, "one");
  assert.equal(services.length, 0);
});

test("short and vertical drags neither navigate nor run actions", async (t) => {
  const {card, services} = await cardFor(t, [alert("one"), alert("two")]);
  swipe(card, -25);
  swipe(card, 39);
  swipe(card, -50, 80);
  swipe(card, 0, 120);
  assert.equal(card._currentAlert().id, "one");
  assert.equal(services.length, 0);
});

test("pointercancel during a drag does not navigate and frees the next press", async (t) => {
  const {card, services} = await cardFor(t, [alert("one"), alert("two")]);
  press(card); move(card, -60);
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointercancel", {pointerId: 1}));
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointerup", {button: 0, pointerId: 1, clientX: -60, clientY: 0}));
  assert.equal(card._currentAlert().id, "one");
  press(card); release(card);
  assert.deepEqual(services.map((s) => s[2].entity_id), ["light.one"]);
});

test("a drag whose release was lost does not block the next press", async (t) => {
  const {card, services} = await cardFor(t, [alert("one"), alert("two")]);
  press(card); move(card, -60);
  press(card, 2); release(card, 2);
  assert.deepEqual(services.map((s) => s[2].entity_id), ["light.one"]);
  assert.equal(card._currentAlert().id, "one");
});

test("swipe restarts the rotation timer", async (t) => {
  t.mock.timers.enable({apis: ["setTimeout", "setInterval", "Date"], now: 1000});
  const {card} = await cardFor(t, [alert("one"), alert("two"), alert("three")], {attributes: {rotate_interval: 2}});
  t.mock.timers.tick(1500);
  swipe(card, -60);
  assert.equal(card._currentAlert().id, "two");
  t.mock.timers.tick(1999);
  assert.equal(card._currentAlert().id, "two");
  t.mock.timers.tick(1);
  assert.equal(card._currentAlert().id, "three");
});

test("swipe works with rotation off and stays on the chosen alert", async (t) => {
  t.mock.timers.enable({apis: ["setTimeout", "setInterval", "Date"], now: 1000});
  const {card} = await cardFor(t, [alert("one"), alert("two")]);
  swipe(card, -60);
  t.mock.timers.tick(60000);
  assert.equal(card._currentAlert().id, "two");
});

test("card keeps vertical page scrolling and takes horizontal drags", () => {
  const styles = customElements.get("banner-channel").styles;
  const text = (Array.isArray(styles) ? styles : [styles]).map((sheet) => sheet.cssText).join("\n");
  assert.match(text, /touch-action:\s*pan-y/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/banner-card-ui.test.mjs`
Expected: FAIL. At minimum these fail: "swipe left shows the next alert..." (primary is still `one`), "swipe never runs..." (still on `one`), "a drag whose release was lost..." is allowed to pass already, "swipe restarts the rotation timer", "swipe works with rotation off...", and "card keeps vertical page scrolling..." (no `touch-action` in styles). All pre-existing tests still pass.

- [ ] **Step 3: Import the helpers in the card**

In `custom_components/banner_channels/frontend/banner-channel-card.js`, change the import at the top of the file to add `swipeDirection, stepIndex`:

```js
import {
  validateConfig, visibleFeed, stubEntity, cardLayout, CARD_EDITOR_SCHEMA, cardEditorLabel, cardEditorHelper, feedSignature, nextIndex, viewMode, slideCounter, describeAction, resolveIcon, severityLook, swipeDirection, stepIndex,
} from "./banner-core.js";
```

- [ ] **Step 4: Let a new press replace a stale dragged press**

In `_onPointerDown`, the first line is currently:

```js
    if (event.button !== 0 || this._press || this._mode !== "alerts") return;
```

Replace it with:

```js
    if (this._press?.moved) this._clearPointer();
    if (event.button !== 0 || this._press || this._mode !== "alerts") return;
```

Reason: a press now survives past 10px of movement. If its `pointerup`/`pointercancel` is ever lost, it must not block every later press.

- [ ] **Step 5: Keep the press alive after movement**

Replace the whole `_onPointerMove` method:

```js
  _onPointerMove(event) {
    if (!this._press || event.pointerId !== this._press.pointerId) return;
    const dx = event.clientX - this._press.x;
    const dy = event.clientY - this._press.y;
    if ((dx * dx) + (dy * dy) > 100) this._cancelGestures();
  }
```

with:

```js
  _onPointerMove(event) {
    const press = this._press;
    if (!press || press.moved || event.pointerId !== press.pointerId) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if ((dx * dx) + (dy * dy) <= 100) return;
    press.moved = true;
    press.previousTap = null;
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
  }
```

This has the same effect on actions as before (hold timer cancelled, the earlier tap carried in `previousTap` is dropped), but the press remains so the release point can be measured.

- [ ] **Step 6: Navigate on release, and add `_swipe`**

In `_onPointerUp`, the method currently starts:

```js
  _onPointerUp(event) {
    const pressed = this._press;
    if (!pressed || (event && event.pointerId !== pressed.pointerId)) return;
    const held = this._holdFired;
    this._clearPointer();
    if (held) return;
    const previous = pressed.previousTap;
```

Insert the `moved` branch between `if (held) return;` and `const previous = ...`, so it reads:

```js
  _onPointerUp(event) {
    const pressed = this._press;
    if (!pressed || (event && event.pointerId !== pressed.pointerId)) return;
    const held = this._holdFired;
    this._clearPointer();
    if (held) return;
    if (pressed.moved) {
      this._swipe(swipeDirection(event?.clientX - pressed.x, event?.clientY - pressed.y));
      return;
    }
    const previous = pressed.previousTap;
```

Leave the rest of `_onPointerUp` unchanged.

Add this new method directly after `_onPointerUp` (before `_currentAlert`):

```js
  _swipe(direction) {
    const alerts = this._attrs?.alerts || [];
    if (!direction || this._mode !== "alerts" || alerts.length < 2) return;
    this._index = stepIndex(this._index, alerts.length, direction);
    this._restartRotation();
    this._rev++;
  }
```

Do not change the `@pointercancel` binding in `render()`; it still calls `_cancelGestures()`, which discards the press without navigating.

- [ ] **Step 7: Add `touch-action: pan-y`**

In `static get styles()`, change the `ha-card` rule from:

```css
      ha-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }
```

to:

```css
      ha-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        touch-action: pan-y;
      }
```

Without this, touch browsers treat a horizontal drag as a possible pan and fire `pointercancel`, so the swipe never completes. `pan-y` keeps vertical page scrolling.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/banner-card-ui.test.mjs`
Expected: PASS, 0 failures. This includes the pre-existing test "movement pointercancel configuration and disconnect cancel pending gestures", which must still pass unmodified.

Run: `npm test`
Expected: `# pass 71`, `# fail 0`.

- [ ] **Step 9: Update the docs (both files, identical edit)**

In `README.md` and in `info.md`, find the paragraph that begins `Tap, Hold, and Double tap support more-info, toggle, navigate, URL, call-service, or none.` (line 93 in both). Add a blank line and this new paragraph immediately after it:

```markdown
When a channel shows more than one alert, swipe left on the card for the next alert or right for the previous one; the ends wrap around. Only swipes that start on the card count, and scrolling the page vertically over the card still works. A swipe never runs the tap, hold, or double-tap action. After a swipe, rotation starts a fresh interval from the alert you chose; with `rotate_interval` at `0` the card stays on it. Each card keeps its own position, so swiping on one dashboard does not change any other.
```

Verify the files are still identical:

Run: `diff README.md info.md && echo SAME`
Expected: `SAME`

- [ ] **Step 10: Check in a real browser**

happy-dom does not implement touch behaviour, so confirm in a browser once.

Run: `python3 -m http.server 8765` from the repo root, then open `http://localhost:8765/test/harness.html`.

In the "Live rotation" card (three alerts, 2-second rotation):
- Drag left with the mouse: the next alert appears at once and the counter advances; the log shows no `more-info` line.
- Drag right: the previous alert appears.
- Click without dragging: the log shows `more-info → ...` as before.
- In browser dev tools, switch on touch emulation and repeat the left/right swipes with the simulated finger; then drag vertically starting on the card and confirm the page scrolls.
- Click "one alert" and drag: nothing changes.

Stop the server (Ctrl+C). If any check fails, fix it before committing. If no browser is available to the worker, report this step as NOT DONE in the hand-back instead of marking it complete.

- [ ] **Step 11: Commit**

```bash
git add custom_components/banner_channels/frontend/banner-channel-card.js test/banner-card-ui.test.mjs README.md info.md
git commit -m "feat: swipe on the card to move between alerts

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UcjyHeyGL3TJpX9sHeAK4S"
```

---

## Not in this plan

- No version bump in `package.json` or `manifest.json`, and no release. Do that separately when shipping.
- No slide animation, position dots, keyboard navigation, config toggle, or cross-card syncing (out of scope in the spec).
