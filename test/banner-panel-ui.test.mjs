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
  assert.equal(record.conditions[0].entity_id, "sensor.new_mode");
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

test("additional conditions add remove save and reopen without losing draft edits", async (t) => {
  const { panel, window, change, selectors, save } = await editor(t);
  panel._openEditor("rule", null);
  const click = (text) => [...panel.shadowRoot.querySelectorAll("button")].find((n) => n.textContent === text).click();
  const headline = panel.shadowRoot.querySelector("textarea");
  headline.value = "Keep me";
  headline.dispatchEvent(new window.Event("input"));
  for (let i = 0; i < 3; i++) {
    click("Add condition");
    const row = panel.shadowRoot.querySelectorAll(".condition")[i];
    change(row.querySelector("ha-selector"), `sensor.${i}`);
    const value = row.querySelector('input[type="text"]');
    value.value = "on";
    value.dispatchEvent(new window.Event("input"));
  }
  panel.shadowRoot.querySelectorAll(".condition button")[1].click();
  const logic = panel.shadowRoot.querySelector('[aria-label="Additional condition logic"]');
  logic.value = "or";
  logic.dispatchEvent(new window.Event("change"));
  const record = await save();
  assert.equal(record.headline, "Keep me");
  assert.equal(record.conditions_logic, "or");
  assert.deepEqual(record.conditions.map((c) => c.entity_id), ["sensor.0", "sensor.2"]);
  assert.equal(Object.hasOwn(record, "also"), false);
  panel._openEditor("rule", record);
  assert.equal(selectors("entity").length, 3);
  assert.equal(panel.shadowRoot.querySelectorAll(".condition").length, 2);
});

test("legacy also opens as one AND condition and is saved canonically", async (t) => {
  const { panel, save } = await editor(t);
  panel._openEditor("rule", { headline: "Door", also: {entity_id: "sensor.mode", operator: "is", value: "home"} });
  assert.equal(panel.shadowRoot.querySelectorAll(".condition").length, 1);
  assert.deepEqual((await save()).conditions, [{entity_id: "sensor.mode", operator: "is", value: "home"}]);
});

test("attribute selection follows its entity and preserves edits and indexed errors", async (t) => {
  const { panel, change, selectors, save } = await editor(t);
  panel._openEditor("rule", { headline: "Keep", match: {kind: "entity", entity_id: "sensor.old", operator: "is", value: "on"}, conditions: [{entity_id: "sensor.extra", operator: "is", value: "on"}] });
  change(selectors("entity")[0], "sensor.new");
  assert.equal(selectors("attribute")[0].selector.attribute.entity_id, "sensor.new");
  change(selectors("attribute")[0], "ready");
  panel._errors = {conditions_0_value: "Enter a number."};
  panel._render();
  assert.match(panel.shadowRoot.querySelector(".condition").textContent, /Enter a number/);
  const record = await save();
  assert.equal(record.match.attribute, "ready");
  assert.equal(record.headline, "Keep");
});

test("specific users displays names and saves stable selected IDs", async (t) => {
  const { panel, hass, window, save } = await editor(t);
  const call = hass.callWS;
  hass.callWS = async (m) => m.type === "config/auth/list" ? [
    {id: "one", name: "Sam", is_active: true}, {id: "two", name: "Sam", is_active: true},
    {id: "inactive", name: "Old", is_active: false}, {id: "system", name: "System", is_active: true, system_generated: true},
  ] : call(m);
  panel._openEditor("rule", {headline: "Users", visibility: {mode: "users", user_ids: ["one"]}});
  await panel._loadUsers();
  const choices = panel.shadowRoot.querySelectorAll('[data-user-id]');
  assert.equal(choices.length, 2);
  assert.notEqual(choices[0].parentElement.textContent, choices[1].parentElement.textContent);
  assert.equal(choices[0].checked, true);
  choices[1].checked = true;
  choices[1].dispatchEvent(new window.Event("change"));
  const record = await save();
  assert.deepEqual(record.visibility, {mode: "users", user_ids: ["one", "two"]});
  panel._users[0].name = "Renamed";
  panel._openEditor("rule", record);
  assert.equal(panel.shadowRoot.querySelector('[data-user-id="one"]').checked, true);
  assert.match(panel.shadowRoot.textContent, /Renamed/);
});

test("user loading retries without changing visibility or another draft", async (t) => {
  const { panel, hass, window } = await editor(t);
  let finish;
  let tries = 0;
  const call = hass.callWS;
  hass.callWS = (m) => m.type !== "config/auth/list" ? call(m) : ++tries === 1
    ? Promise.reject(new Error("Offline")) : new Promise((r) => { finish = r; });
  panel._openEditor("rule", {headline: "First", visibility: {mode: "users", user_ids: ["one"]}});
  await panel._loadUsers();
  assert.match(panel.shadowRoot.textContent, /Offline/);
  [...panel.shadowRoot.querySelectorAll("button")].find((n) => n.textContent === "Retry users").click();
  panel._openEditor("rule", {headline: "Second", visibility: {mode: "users", user_ids: ["two"]}});
  const pending = panel._loadUsers();
  finish([{id: "two", name: "Second user", is_active: true}]);
  await pending;
  assert.equal(panel._draft.headline, "Second");
  assert.equal(panel.shadowRoot.querySelector('[data-user-id="two"]').checked, true);
  assert.deepEqual(panel._draft.visibility.user_ids, ["two"]);
});

test("removed users remain selectable for removal and empty selection blocks save", async (t) => {
  const { panel, hass, window, save } = await editor(t);
  hass.callWS = async (m) => m.type === "config/auth/list" ? [] : {channels: [], rules: []};
  panel._openEditor("rule", {headline: "Gone", visibility: {mode: "users", user_ids: ["deleted"]}});
  await panel._loadUsers();
  const choice = panel.shadowRoot.querySelector('[data-user-id="deleted"]');
  assert.match(choice.parentElement.textContent, /Unavailable/);
  choice.checked = false;
  choice.dispatchEvent(new window.Event("change"));
  assert.equal(await save(), undefined);
  assert.match(panel.shadowRoot.textContent, /Select at least one user/);
});

test("secondary position and double tap round trip and preview", async (t) => {
  const { panel, change, selectors, save } = await editor(t);
  panel._openEditor("rule", {headline: "Door", subtext: "Open", secondary_position: "right", double_tap_action: {action: "more-info"}});
  assert.ok(panel.shadowRoot.querySelector(".preview.secondary-right"));
  assert.equal(selectors("entity").length, 2);
  change(selectors("entity")[1], "sensor.extra");
  const record = await save();
  assert.equal(record.secondary_position, "right");
  assert.deepEqual(record.double_tap_action, {action: "more-info", entity: "sensor.extra"});
  panel._openEditor("rule", {...record, double_tap_action: {action: "call-service", service: "light.turn_on", data: {}}});
  const data = [...panel.shadowRoot.querySelectorAll("textarea")].find((n) => n.placeholder === "Optional JSON object");
  data.value = "[";
  data.dispatchEvent(new window.Event("input"));
  assert.equal(await save(), record);
  assert.match(panel.shadowRoot.textContent, /JSON object/);
});
