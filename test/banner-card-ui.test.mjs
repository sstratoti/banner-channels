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
