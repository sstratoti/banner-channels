import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

let instance = 0;
async function editor(t, { native = true } = {}) {
  const window = new Window();
  for (const key of ["window", "document", "HTMLElement", "customElements"]) {
    globalThis[key] = key === "window" ? window : window[key];
  }
  t.after(() => {
    for (const key of ["window", "document", "HTMLElement", "customElements"]) delete globalThis[key];
    window.happyDOM.abort();
  });
  // Native controls belong to HA; test our property/event boundary with DOM elements.
  const register = () => {
    for (const tag of ["ha-selector", "ha-service-picker"]) {
      window.customElements.define(tag, class extends window.HTMLElement {});
    }
  };
  if (native) register();
  await import(`../custom_components/banner_channels/frontend/banner-channels-panel.js?ui=${++instance}`);
  const panel = document.createElement("banner-channels-panel");
  const saved = [];
  const hass = {
    states: {}, services: {},
    callWS: async (message) => {
      if (message.type === "banner_channels/save") saved.push(message);
      return { channels: [], rules: [] };
    },
  };
  panel.hass = hass;
  await panel._load();
  const change = (node, value) => node.dispatchEvent(new window.CustomEvent("value-changed", {
    detail: { value }, bubbles: true, composed: true,
  }));
  const selectors = (type) => [...panel.shadowRoot.querySelectorAll("ha-selector")]
    .filter((node) => type in node.selector);
  const save = async () => {
    [...panel.shadowRoot.querySelectorAll("button")].find((node) => node.textContent === "Save").click();
    await Promise.resolve();
    await Promise.resolve();
    return saved.at(-1)?.record;
  };
  return { window, panel, hass, change, selectors, save, register };
}

test("entity selections save and reopen, and clearing an action restores matched-entity behavior", async (t) => {
  const { panel, change, selectors, save } = await editor(t);
  panel._openEditor("rule", {
    headline: "Door", match: { kind: "entity", entity_id: "binary_sensor.door", operator: "is", value: "on" },
    also: { entity_id: "sensor.mode", operator: "is", value: "home" },
    tap_action: { action: "toggle", entity: "light.old" },
    hold_action: { action: "more-info", entity: "sensor.old" },
  });
  const entities = selectors("entity");
  assert.equal(entities.length, 4);
  assert.equal(entities[0].value, "binary_sensor.door");
  assert.equal(entities[2].value, "light.old");
  change(entities[0], "binary_sensor.window");
  change(entities[1], "sensor.new_mode");
  change(entities[2], "light.kitchen");
  change(entities[3], undefined);
  const record = await save();
  assert.equal(record.match.entity_id, "binary_sensor.window");
  assert.equal(record.also.entity_id, "sensor.new_mode");
  assert.deepEqual(record.tap_action, { action: "toggle", entity: "light.kitchen" });
  assert.deepEqual(record.hold_action, { action: "more-info" });
  panel._openEditor("rule", record);
  assert.equal(selectors("entity")[2].value, "light.kitchen");
  assert.equal(selectors("entity")[3].value, "");
});

test("both actions use service and target pickers without changing JSON service data", async (t) => {
  const { panel, change, selectors, save } = await editor(t);
  panel._openEditor("rule", {
    headline: "Door", match: { kind: "entity", entity_id: "binary_sensor.door", operator: "is", value: "on" },
    tap_action: { action: "call-service", service: "light.turn_on", target: "light.old", data: { brightness: 10 } },
    hold_action: { action: "call-service", service: "light.turn_off", target: "light.old" },
  });
  const services = panel.shadowRoot.querySelectorAll("ha-service-picker");
  assert.equal(services.length, 2);
  assert.equal(services[0].value, "light.turn_on");
  change(services[0], "light.toggle");
  change(selectors("entity")[1], "light.kitchen");
  change(selectors("entity")[2], null);
  const record = await save();
  assert.deepEqual(record.tap_action, {
    action: "call-service", service: "light.toggle", target: "light.kitchen", data: { brightness: 10 },
  });
  assert.deepEqual(record.hold_action, { action: "call-service", service: "light.turn_off" });
});

test("alert icon picker updates the preview and preserves template editing across reopening", async (t) => {
  const { panel, change, selectors, save, window } = await editor(t);
  panel._openEditor("rule", null);
  assert.equal(selectors("icon").length, 1);
  change(selectors("icon")[0], "mdi:door-open");
  assert.equal(panel.shadowRoot.querySelector(".preview ha-icon").icon, "mdi:door-open");
  const toggle = [...panel.shadowRoot.querySelectorAll("label")]
    .find((node) => node.textContent.includes("Use template")).querySelector("input");
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event("change"));
  const template = [...panel.shadowRoot.querySelectorAll("textarea")].find((node) => node.value === "mdi:door-open");
  template.value = "{{ 'mdi:door-open' }}";
  template.dispatchEvent(new window.Event("input"));
  const record = await save();
  assert.equal(record.icon, "{{ 'mdi:door-open' }}");
  panel._openEditor("rule", record);
  assert.equal(selectors("icon").length, 0);
  assert.ok([...panel.shadowRoot.querySelectorAll("textarea")].some((node) => node.value === record.icon));
});

test("channel icon pickers save all-clear and severity defaults, including clearing", async (t) => {
  const { panel, change, selectors, save } = await editor(t);
  panel._openEditor("channel", { name: "Hall", empty: "all_clear", all_clear: { text: "Clear", icon: "mdi:check" } });
  const icons = selectors("icon");
  assert.equal(icons.length, 4);
  change(icons[0], "mdi:check-circle");
  change(icons[1], "mdi:information");
  change(icons[2], undefined);
  const record = await save();
  assert.equal(record.all_clear.icon, "mdi:check-circle");
  assert.equal(record.severity_styles.info.icon, "mdi:information");
  assert.equal(record.severity_styles.warning.icon, "");
});

test("hass updates reach mounted controls without replacing the focused editor", async (t) => {
  const { panel, hass, selectors } = await editor(t);
  panel._openEditor("rule", null);
  const entity = selectors("entity")[0];
  const next = { ...hass, states: { "sensor.new": { state: "on" } } };
  panel.hass = next;
  assert.equal(selectors("entity")[0], entity);
  assert.equal(entity.hass, next);
});

test("native controls load on a fresh sidebar and retain edits made while loading", async (t) => {
  const { panel, window, register, selectors } = await editor(t, { native: false });
  let finish;
  window.loadCardHelpers = async () => ({
    createCardElement: (config) => {
      assert.equal(config.type, "button");
      return { constructor: { getConfigElement: () => new Promise((resolve) => {
        finish = () => { register(); resolve(); };
      }) } };
    },
  });
  panel._openEditor("rule", null);
  await Promise.resolve();
  await Promise.resolve();
  const entity = panel.shadowRoot.querySelector('input[placeholder="binary_sensor.front_door"]');
  entity.value = "binary_sensor.window";
  entity.dispatchEvent(new window.Event("input"));
  finish();
  await panel._pickerLoad;
  assert.equal(selectors("entity")[0].value, "binary_sensor.window");
});

test("failed picker loading leaves usable text fields", async (t) => {
  const { panel, window, save } = await editor(t, { native: false });
  window.loadCardHelpers = async () => { throw new Error("Unavailable"); };
  panel._openEditor("rule", null);
  await panel._pickerLoad;
  const entity = panel.shadowRoot.querySelector('input[placeholder="binary_sensor.front_door"]');
  entity.value = "sensor.manual";
  entity.dispatchEvent(new window.Event("input"));
  assert.equal((await save()).match.entity_id, "sensor.manual");
});

test("opening the sidebar before a dashboard loads bootstraps the HA picker modules", async (t) => {
  const { panel, window, register, selectors } = await editor(t, { native: false });
  window.customElements.define("partial-panel-resolver", class extends window.HTMLElement {
    _getRoutes(panels) {
      assert.deepEqual(panels, { lovelace: { component_name: "lovelace", url_path: "lovelace" } });
      return { routes: { lovelace: { load: async () => {
        window.loadCardHelpers = async () => ({
          createCardElement: async () => ({ constructor: { getConfigElement: async () => register() } }),
        });
      } } } };
    }
  });
  panel._openEditor("rule", null);
  await panel._pickerLoad;
  assert.equal(selectors("entity").length, 1);
  assert.equal(selectors("icon").length, 1);
});
