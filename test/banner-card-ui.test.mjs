import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window();
for (const key of ["window", "document", "HTMLElement", "customElements", "Document", "CSSStyleSheet", "ShadowRoot", "Node"]) {
  globalThis[key] = key === "window" ? window : window[key];
}
const { LitElement, html, css } = await import("lit");
LitElement.prototype.html = html;
LitElement.prototype.css = css;
customElements.define("ha-panel-lovelace", class extends LitElement {});
await import("../custom_components/banner_channels/frontend/banner-channel-card.js");

const alert = (id, options = {}) => ({id, primary: id, icon: "mdi:door", tap_action: {action: "toggle", entity: `light.${id}`}, ...options});
async function cardFor(t, alerts, options = {}) {
  const card = document.createElement("banner-channel-card");
  card.setConfig({entity: "sensor.channel", ...options.config});
  const services = [];
  const attributes = {alerts, rotate_interval: 0, empty: "hide", ...options.attributes};
  const hass = {
    user: {id: "normal", is_admin: false},
    states: {"sensor.channel": {state: String(alerts.length), attributes}},
    callService: (...args) => { services.push(args); },
  };
  document.body.append(card);
  card.hass = hass;
  await card.updateComplete;
  t.after(() => card.remove());
  return {card, hass, attributes, services};
}

test("card identity changes recompute counters and empty mode with unchanged sensor", async (t) => {
  const {card, hass, attributes} = await cardFor(t, [alert("public"), alert("admin", {visibility: {mode: "admin"}})]);
  assert.equal(card.shadowRoot.querySelector(".primary").textContent, "public");
  assert.ok(!card.shadowRoot.querySelector(".counter"));
  card.hass = {...hass, user: {id: "admin", is_admin: true}};
  await card.updateComplete;
  assert.equal(card.shadowRoot.querySelector(".counter").textContent, "1/2");
  card._index = 1;
  card.hass = hass;
  await card.updateComplete;
  assert.equal(card._currentAlert().id, "public");
  attributes.alerts = [alert("admin", {visibility: {mode: "admin"}})];
  card.hass = {...hass};
  await card.updateComplete;
  assert.equal(card.style.display, "none");
  attributes.empty = "all_clear";
  attributes.all_clear = {text: "Quiet"};
  card.hass = {...hass};
  await card.updateComplete;
  assert.equal(card.style.display, "");
  assert.equal(card.shadowRoot.querySelector(".primary").textContent, "Quiet");
});

test("card retains visible slide by ID when earlier alerts become hidden", async (t) => {
  const {card, hass} = await cardFor(t, [alert("one"), alert("two"), alert("three")]);
  card._index = 2;
  const next = {...hass.states["sensor.channel"].attributes, alerts: [alert("two"), alert("three")]};
  card.hass = {...hass, states: {"sensor.channel": {state: "2", attributes: next}}};
  await card.updateComplete;
  assert.equal(card._currentAlert().id, "three");
  assert.equal(card.shadowRoot.querySelector(".counter").textContent, "2/2");
});

test("secondary position renders severity above headline and right value", async (t) => {
  for (const align of ["left", "center"]) {
    for (const position of ["below", "right"]) {
      const {card} = await cardFor(t, [alert("Door", {severity: "warning", secondary: "20%", secondary_position: position})], {config: {align}});
      const text = card.shadowRoot.querySelector(".text");
      assert.equal(text.classList.contains("secondary-right"), position === "right");
      assert.equal(text.firstElementChild.className, "severity");
      const row = text.querySelector(".headline-row");
      assert.equal(row.querySelector(".primary").textContent, "Door");
      assert.equal(row.querySelector(".secondary").textContent, "20%");
    }
  }
  const {card} = await cardFor(t, [alert("Door", {secondary_position: "right"})]);
  assert.ok(!card.shadowRoot.querySelector(".secondary"));
});

function press(card, id = 1) {
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointerdown", {button: 0, pointerId: id, clientX: 0, clientY: 0}));
}
function release(card, id = 1) {
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointerup", {button: 0, pointerId: id}));
}
function clock(t) {
  t.mock.timers.enable({apis: ["setTimeout", "Date"], now: 1000});
  return (milliseconds) => t.mock.timers.tick(milliseconds);
}

test("tap without double action runs immediately", async (t) => {
  const {card, services} = await cardFor(t, [alert("one")]);
  press(card); release(card);
  assert.equal(services.length, 1);
  assert.deepEqual(services[0], ["homeassistant", "toggle", {entity_id: "light.one"}]);
});

test("single tap with double action runs after 250 ms", async (t) => {
  const {card, services} = await cardFor(t, [alert("one", {double_tap_action: {action: "toggle", entity: "light.double"}})]);
  const tick = clock(t);
  press(card); release(card);
  assert.equal(services.length, 0);
  tick(249); assert.equal(services.length, 0);
  tick(1); assert.equal(services.length, 1);
  assert.equal(services[0][2].entity_id, "light.one");
});

test("two taps execute only double tap", async (t) => {
  const {card, services} = await cardFor(t, [alert("one", {double_tap_action: {action: "toggle", entity: "light.double"}})]);
  const tick = clock(t);
  press(card); release(card); tick(100); press(card); release(card); tick(1000);
  assert.deepEqual(services.map((s) => s[2].entity_id), ["light.double"]);
});

test("hold at 500 ms executes only hold including after an initial tap", async (t) => {
  const {card, services} = await cardFor(t, [alert("one", {double_tap_action: {action: "toggle", entity: "light.double"}, hold_action: {action: "toggle", entity: "light.hold"}})]);
  const tick = clock(t);
  press(card); release(card); tick(100); press(card);
  tick(499); assert.equal(services.length, 0);
  tick(1); release(card); tick(1000);
  assert.deepEqual(services.map((s) => s[2].entity_id), ["light.hold"]);
});

test("rotation between press and release uses captured alert action", async (t) => {
  const {card, services} = await cardFor(t, [alert("one"), alert("two")]);
  press(card); card._index = 1; release(card);
  assert.equal(services[0][2].entity_id, "light.one");
});

test("identity change cancels actions for newly hidden alert", async (t) => {
  const {card, hass, services} = await cardFor(t, [alert("one", {visibility: {mode: "users", user_ids: ["normal"]}, double_tap_action: {action: "toggle", entity: "light.double"}})]);
  const tick = clock(t);
  press(card); release(card);
  card.hass = {...hass, user: {id: "other", is_admin: false}};
  tick(1000);
  assert.equal(services.length, 0);
});

test("movement pointercancel configuration and disconnect cancel pending gestures", async (t) => {
  for (const cancel of [
    (card) => card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointercancel", {pointerId: 1})),
    (card) => card.setConfig({entity: "sensor.channel"}),
    (card) => card.remove(),
  ]) {
    const {card, services} = await cardFor(t, [alert("one", {double_tap_action: {action: "toggle", entity: "light.double"}})]);
    const tick = clock(t);
    press(card); release(card); cancel(card); tick(1000);
    assert.equal(services.length, 0);
    t.mock.timers.reset();
  }
  const {card, services} = await cardFor(t, [alert("one")]);
  const tick = clock(t);
  press(card);
  card.shadowRoot.querySelector("ha-card").dispatchEvent(new window.PointerEvent("pointermove", {pointerId: 1, clientX: 30}));
  tick(600); release(card);
  assert.equal(services.length, 0);
});

test("taps on different alerts never combine into a double tap", async (t) => {
  const {card, services} = await cardFor(t, [alert("one", {double_tap_action: {action: "toggle", entity: "light.double1"}}), alert("two", {double_tap_action: {action: "toggle", entity: "light.double2"}})]);
  const tick = clock(t);
  press(card); release(card); tick(50); card._index = 1; press(card); release(card); tick(300);
  assert.deepEqual(services.map((s) => s[2].entity_id), ["light.one", "light.two"]);
});
