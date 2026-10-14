# Banner Channel card implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Banner Channel dashboard card, which renders one channel sensor and does not evaluate rules.

**Architecture:** Pure decisions live in `banner-core.js` and are tested with `node:test`. The custom element borrows Home Assistant's LitElement, fades with opacity, and reads the sensor attribute contract from the design spec. This plan does not depend on the Python evaluator. A hand-built sensor that matches the contract is enough to try the card.

**Tech Stack:** JavaScript ES modules, `node:test`, Lit borrowed from `ha-panel-lovelace` at runtime

## Global Constraints

- Card picker name is Banner Channel. Custom element is `banner-channel-card`. Type is `custom:banner-channel`.
- The card's only config field is `entity`.
- Before the first `hass` value, render nothing. Missing, `unavailable`, or `unknown` shows `Banner unavailable`.
- `empty: hide` sets the host to `display: none`. Every other view clears that inline style.
- `empty: all_clear` shows `all_clear.icon` and `all_clear.text` and has no tap action.
- Badge shows only when `show_badge` is true and the numeric state is greater than 0.
- Apply `background` on the row and `color` on the text and icon when present.
- One interval. Clear it on disconnect, on a feed change, and while `document.hidden`. Opacity fade is 180ms. No other animation.
- Pointer movement over 10 pixels cancels tap and hold. Hold is 500ms. There is no double-tap.
- Do not bundle Lit and do not load a CDN.
- No snooze, blink, themes, or dashboard card editor.

---

### Task 1: Pure feed decisions

**Files:**
- Create: `custom_components/banner_channels/frontend/banner-core.js`
- Create: `test/banner-core.test.mjs`
- Test: `test/banner-core.test.mjs`

**Interfaces:**
- Consumes: sensor attributes defined in `docs/superpowers/specs/2026-10-13-banner-channels-design.md`
- Produces:
  - `validateConfig(config) -> { entity: string }` throws `Error` if `entity` is missing
  - `feedSignature(attributes) -> string`
  - `nextIndex(current: number, length: number) -> number`
  - `viewMode(state, attributes) -> "unavailable" | "hide" | "all_clear" | "alerts"`
  - `showBadge(state, attributes) -> boolean`

- [ ] **Step 1: Write the failing test**

Create `test/banner-core.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfig, feedSignature, nextIndex, viewMode, showBadge, describeAction,
} from "../custom_components/banner_channels/frontend/banner-core.js";

test("validateConfig requires an entity string", () => {
  assert.throws(() => validateConfig({}), /entity/);
  assert.equal(validateConfig({ entity: "sensor.banner_tablets" }).entity, "sensor.banner_tablets");
});

test("viewMode distinguishes unavailable, hide, all-clear, and alerts", () => {
  assert.equal(viewMode("unavailable", {}), "unavailable");
  assert.equal(viewMode("unknown", {}), "unavailable");
  assert.equal(viewMode("0", { empty: "hide", alerts: [] }), "hide");
  assert.equal(viewMode("0", { empty: "all_clear", alerts: [], all_clear: { text: "Clear" } }), "all_clear");
  assert.equal(viewMode("1", { empty: "hide", alerts: [{ id: "a" }] }), "alerts");
});

test("showBadge only when enabled and count is positive", () => {
  assert.equal(showBadge("2", { show_badge: true }), true);
  assert.equal(showBadge("0", { show_badge: true }), false);
  assert.equal(showBadge("2", { show_badge: false }), false);
  assert.equal(showBadge("nope", { show_badge: true }), false);
});

test("signature and index follow the visible feed", () => {
  const a = { rotate_interval: 10, alerts: [{ id: "a", primary: "A" }] };
  const b = { rotate_interval: 10, alerts: [{ id: "a", primary: "B" }] };
  assert.notEqual(feedSignature(a), feedSignature(b));
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(nextIndex(5, 0), 0);
});

test("describeAction chooses the side effect and ignores none", () => {
  assert.equal(describeAction({ action: "none" }), null);
  assert.deepEqual(describeAction({ action: "url", url_path: "https://example.com" }), {
    type: "url", url: "https://example.com",
  });
  assert.deepEqual(
    describeAction({ action: "call-service", service: "lock.lock", target: "lock.front" }),
    { type: "call-service", service: "lock.lock", data: {}, target: "lock.front" },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/banner-core.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Write minimal implementation**

Create `custom_components/banner_channels/frontend/banner-core.js`:

```javascript
export function validateConfig(config) {
  if (!config || typeof config.entity !== "string" || !config.entity) {
    throw new Error("You must define an entity");
  }
  return { entity: config.entity };
}

export function viewMode(state, attributes) {
  const attrs = attributes || {};
  if (state === "unavailable" || state === "unknown" || state == null) return "unavailable";
  const alerts = Array.isArray(attrs.alerts) ? attrs.alerts : [];
  if (!alerts.length) return attrs.empty === "all_clear" ? "all_clear" : "hide";
  return "alerts";
}

export function showBadge(state, attributes) {
  if (!attributes || attributes.show_badge === false) return false;
  const count = Number(state);
  return Number.isFinite(count) && count > 0;
}

export function feedSignature(attributes) {
  const attrs = attributes || {};
  const alerts = Array.isArray(attrs.alerts) ? attrs.alerts : [];
  return JSON.stringify([
    attrs.rotate_interval ?? 0,
    attrs.show_badge !== false,
    attrs.empty || "hide",
    attrs.all_clear || null,
    alerts.map((alert) => [
      alert.id, alert.icon, alert.primary, alert.secondary || "",
      alert.background || "", alert.color || "", alert.tap_action || null, alert.hold_action || null,
    ]),
  ]);
}

export function nextIndex(current, length) {
  if (!length || length < 1) return 0;
  return (current + 1) % length;
}

export function describeAction(action) {
  if (!action || !action.action || action.action === "none") return null;
  if (action.action === "more-info" && action.entity) return { type: "more-info", entity: action.entity };
  if (action.action === "navigate" && action.navigation_path) return { type: "navigate", path: action.navigation_path };
  if (action.action === "url" && action.url_path) return { type: "url", url: action.url_path };
  if (action.action === "toggle" && action.entity) return { type: "toggle", entity: action.entity };
  if (action.action === "call-service" && action.service && action.service.includes(".")) {
    return { type: "call-service", service: action.service, data: action.data || {}, target: action.target || null };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/banner-core.test.mjs`

Expected: `# fail 0` and five passing tests

- [ ] **Step 5: Commit**

```bash
git add custom_components/banner_channels/frontend/banner-core.js test/banner-core.test.mjs
git commit -m "feat: decide what a banner channel card should show"
```

---

### Task 2: Card element

**Files:**
- Create: `custom_components/banner_channels/frontend/banner-channel-card.js`
- Modify: `test/harness.html`
- Delete: `alert-ticker-lite-card.js`
- Delete: `lib/ticker-core.js`
- Delete: `lib/actions.js`
- Delete: `test/ticker-core.test.mjs`
- Test: `node --test` and `test/harness.html`

**Interfaces:**
- Consumes: `validateConfig`, `feedSignature`, `nextIndex`, `viewMode`, `showBadge` from `./banner-core.js`
- Produces: custom element `banner-channel-card`, registered on `window.customCards` as type `custom:banner-channel`, name `Banner Channel`

- [ ] **Step 1: Write the card**

Create `custom_components/banner_channels/frontend/banner-channel-card.js`:

```javascript
import {
  validateConfig, feedSignature, nextIndex, viewMode, showBadge, describeAction,
} from "./banner-core.js";

const Panel = customElements.get("ha-panel-lovelace") || customElements.get("hui-view");
if (!Panel) throw new Error("Banner Channel must load inside Lovelace");
const LitElement = Object.getPrototypeOf(Panel);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class BannerChannelCard extends LitElement {
  static get properties() {
    return { _index: { state: true }, _fading: { state: true }, _rev: { state: true } };
  }

  setConfig(config) {
    this._config = validateConfig(config);
    this._index = 0;
    this._sig = null;
    this._rev = 0;
  }

  static getStubConfig() {
    return { entity: "sensor.banner_tablets" };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const stateObj = hass && hass.states ? hass.states[this._config.entity] : undefined;
    this._state = stateObj ? stateObj.state : "unavailable";
    this._attrs = (stateObj && stateObj.attributes) || {};
    this._mode = viewMode(this._state, this._attrs);
    const sig = this._mode + feedSignature(this._attrs);
    if (sig !== this._sig) {
      this._sig = sig;
      const alerts = this._attrs.alerts || [];
      if (this._index >= alerts.length) this._index = 0;
      this._cancelFade();
      this._restartRotation();
      this._rev++;
    }
  }

  get hass() { return this._hass; }

  connectedCallback() {
    super.connectedCallback();
    this._visHandler = () => (document.hidden ? this._stopRotation() : this._restartRotation());
    document.addEventListener("visibilitychange", this._visHandler);
    this._restartRotation();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopRotation();
    this._cancelFade();
    this._clearPointer();
    if (this._visHandler) {
      document.removeEventListener("visibilitychange", this._visHandler);
      this._visHandler = null;
    }
  }

  _stopRotation() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._cancelFade();
  }

  _cancelFade() {
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
    this._fading = false;
  }

  _restartRotation() {
    this._stopRotation();
    if (document.hidden || this._mode !== "alerts") return;
    const alerts = this._attrs.alerts || [];
    const interval = Number(this._attrs.rotate_interval) || 0;
    if (interval > 0 && alerts.length > 1) {
      this._timer = setInterval(() => this._tick(), interval * 1000);
    }
  }

  _tick() {
    const advance = () => {
      this._index = nextIndex(this._index, (this._attrs.alerts || []).length);
      this._rev++;
    };
    this._fading = true;
    this._rev++;
    this._fadeTimer = setTimeout(() => {
      this._fadeTimer = null;
      this._fading = false;
      advance();
    }, 180);
  }

  _clearPointer() {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    this._press = null;
  }

  _onPointerDown(event) {
    if (event.button !== 0) return;
    this._clearPointer();
    this._holdFired = false;
    this._press = { x: event.clientX, y: event.clientY };
    this._holdTimer = setTimeout(() => {
      this._holdFired = true;
      this._runAction("hold");
    }, 500);
  }

  _onPointerMove(event) {
    if (!this._press) return;
    const dx = event.clientX - this._press.x;
    const dy = event.clientY - this._press.y;
    if ((dx * dx) + (dy * dy) > 100) this._clearPointer();
  }

  _onPointerUp() {
    const held = this._holdFired;
    const pressed = this._press;
    this._clearPointer();
    if (pressed && !held) this._runAction("tap");
  }

  _runAction(kind) {
    if (this._mode !== "alerts") return;
    const alert = (this._attrs.alerts || [])[this._index] || {};
    const action = alert[kind === "hold" ? "hold_action" : "tap_action"];
    performAction(this, this._hass, action);
  }

  _syncHost() {
    this.style.display = this._mode === "hide" ? "none" : "";
  }

  render() {
    if (!this._config || !this._hass) return html``;
    this._syncHost();
    if (this._mode === "unavailable") {
      return html`<ha-card><div class="row muted">Banner unavailable</div></ha-card>`;
    }
    if (this._mode === "hide") return html``;
    if (this._mode === "all_clear") {
      const clear = this._attrs.all_clear || {};
      return html`<ha-card><div class="row">
        ${clear.icon ? html`<ha-icon icon="${clear.icon}"></ha-icon>` : ""}
        <div class="text"><div class="primary">${clear.text || "All clear"}</div></div>
      </div></ha-card>`;
    }
    const alert = (this._attrs.alerts || [])[this._index] || {};
    const rowStyle = alert.background ? `background:${alert.background}` : "";
    const textStyle = alert.color ? `color:${alert.color}` : "";
    return html`<ha-card
      @pointerdown=${(event) => this._onPointerDown(event)}
      @pointermove=${(event) => this._onPointerMove(event)}
      @pointerup=${() => this._onPointerUp()}
      @pointercancel=${() => this._clearPointer()}
      style="cursor:pointer">
      <div class="row ${this._fading ? "fade-out" : ""}" style=${rowStyle}>
        ${showBadge(this._state, this._attrs) ? html`<div class="badge">${Number(this._state)}</div>` : ""}
        <ha-icon icon="${alert.icon || ""}" style=${textStyle}></ha-icon>
        <div class="text" style=${textStyle}>
          <div class="primary">${alert.primary || ""}</div>
          ${alert.secondary ? html`<div class="secondary">${alert.secondary}</div>` : ""}
        </div>
      </div>
    </ha-card>`;
  }

  getCardSize() { return this._mode === "hide" ? 0 : 1; }

  static get styles() {
    return css`
      .row {
        display: flex; align-items: center; gap: 12px; padding: 12px 16px;
        opacity: 1; transition: opacity 0.18s ease;
      }
      .fade-out { opacity: 0; }
      .badge {
        min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 600;
        background: var(--primary-color); color: var(--text-primary-color, #fff);
      }
      ha-icon { --mdc-icon-size: 26px; flex: 0 0 auto; }
      .text { display: flex; flex-direction: column; min-width: 0; }
      .primary, .secondary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .primary { font-size: 15px; font-weight: 600; }
      .secondary { font-size: 12.5px; opacity: 0.85; }
      .muted { color: var(--secondary-text-color); }
    `;
  }
}

function fireEvent(node, type, detail) {
  const event = new Event(type, { bubbles: true, composed: true });
  event.detail = detail || {};
  node.dispatchEvent(event);
}

function performAction(node, hass, action) {
  const choice = describeAction(action);
  if (!choice) return;
  if (choice.type === "more-info") {
    fireEvent(node, "hass-more-info", { entityId: choice.entity });
  } else if (choice.type === "navigate") {
    history.pushState(null, "", choice.path);
    fireEvent(window, "location-changed", { replace: false });
  } else if (choice.type === "url") {
    window.open(choice.url, "_blank", "noopener,noreferrer");
  } else if (choice.type === "toggle" && hass) {
    catchCall(hass.callService("homeassistant", "toggle", { entity_id: choice.entity }));
  } else if (choice.type === "call-service" && hass) {
    const [domain, service] = choice.service.split(".");
    catchCall(hass.callService(domain, service, choice.data, choice.target ? { entity_id: choice.target } : undefined));
  }
}

function catchCall(result) {
  if (result && typeof result.catch === "function") {
    result.catch((err) => console.warn("banner-channel", err));
  }
}

customElements.define("banner-channel-card", BannerChannelCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "banner-channel",
  name: "Banner Channel",
  description: "One channel of the Banner Channels feed.",
});
```

- [ ] **Step 2: Point the harness at the new card**

Replace `test/harness.html` so the module under test is `../custom_components/banner_channels/frontend/banner-channel-card.js`. `setConfig` receives only `{ entity: "sensor.banner_tablets" }`. The fake state object puts rotation, colors, alerts, `empty`, and `show_badge` on `attributes`. Buttons: three alerts, one alert, zero with `empty: "hide"`, zero with `empty: "all_clear"`, and `state: "unavailable"`. Keep the Lit prototype assignment and the `ha-icon` stub already in the harness. Log `hass-more-info` events.

- [ ] **Step 3: Remove the lite card files**

```bash
rm -f alert-ticker-lite-card.js lib/ticker-core.js lib/actions.js test/ticker-core.test.mjs
rmdir lib 2>/dev/null || true
```

In the same commit, replace `hacs.json` so it no longer names the deleted Lovelace file:

```json
{
  "name": "Banner Channels",
  "homeassistant": "2026.10.0",
  "render_readme": true
}
```

- [ ] **Step 4: Run tests**

Run: `node --test`

Expected: `# fail 0` and the five `banner-core` tests passing. `ticker-core` tests are gone.

- [ ] **Step 5: Check the harness**

Open `test/harness.html` through a local static server. Confirm the three-alert fixture fades between headlines, the count badge shows `3`, a color is visible on the first slide, zero alerts with `hide` removes the card, all-clear shows its text, and unavailable shows `Banner unavailable`. A click logs `more-info`. A drag of more than 10 pixels does not.

- [ ] **Step 6: Commit**

```bash
git add custom_components/banner_channels/frontend/banner-channel-card.js test/harness.html hacs.json
git add -u alert-ticker-lite-card.js lib test/ticker-core.test.mjs
git commit -m "feat: add the Banner Channel card"
```
