import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfig, stubEntity, CARD_EDITOR_SCHEMA, feedSignature, nextIndex, viewMode, showBadge, slideCounter, describeAction, resolveIcon, severityLook,
} from "../custom_components/banner_channels/frontend/banner-core.js";

test("validateConfig requires an entity string", () => {
  assert.throws(() => validateConfig({}), /entity/);
  assert.throws(() => validateConfig({ entity: 1 }), /entity/);
  assert.equal(validateConfig({ entity: "sensor.banner_tablets" }).entity, "sensor.banner_tablets");
  assert.deepEqual(
    validateConfig({ entity: "sensor.banner_tablets", snooze: true }),
    { entity: "sensor.banner_tablets" },
  );
});

test("stubEntity prefers a Banner Channels sensor", () => {
  assert.equal(stubEntity(), "");
  assert.equal(
    stubEntity({
      entities: {
        "sensor.banner_basement": { platform: "banner_channels" },
        "sensor.other": { platform: "template" },
      },
    }),
    "sensor.banner_basement",
  );
  assert.equal(
    stubEntity({
      states: {
        "sensor.plain": { attributes: {} },
        "sensor.banner_front": { attributes: { alerts: [], rotate_interval: 10 } },
      },
    }),
    "sensor.banner_front",
  );
  assert.equal(CARD_EDITOR_SCHEMA[0].selector.entity.integration, "banner_channels");
  assert.equal(CARD_EDITOR_SCHEMA[0].name, "entity");
});

test("viewMode distinguishes unavailable, hide, all-clear, and alerts", () => {
  assert.equal(viewMode("unavailable", {}), "unavailable");
  assert.equal(viewMode("unknown", {}), "unavailable");
  assert.equal(viewMode("0", { empty: "hide", alerts: [] }), "hide");
  assert.equal(viewMode("0", { empty: "all_clear", alerts: [], all_clear: { text: "Clear" } }), "all_clear");
  assert.equal(viewMode("1", { empty: "hide", alerts: [{ id: "a" }] }), "alerts");
  assert.equal(viewMode("unavailable", { alerts: [{ id: "a" }], empty: "hide" }), "unavailable");
});

test("slideCounter is the current slide over the total", () => {
  assert.equal(slideCounter(0, 9), "1/9");
  assert.equal(slideCounter(2, 9), "3/9");
  assert.equal(slideCounter(0, 1), "");
  assert.equal(slideCounter(0, 0), "");
  assert.equal(slideCounter(20, 3), "1/3");
});

test("showBadge only when enabled and count is positive", () => {
  assert.equal(showBadge("2", { show_badge: true }), true);
  assert.equal(showBadge("0", { show_badge: true }), false);
  assert.equal(showBadge("2", { show_badge: false }), false);
  assert.equal(showBadge("nope", { show_badge: true }), false);
  assert.equal(showBadge("2", {}), true);
});

test("signature and index follow the visible feed", () => {
  const a = { rotate_interval: 10, alerts: [{ id: "a", primary: "A" }] };
  const b = { rotate_interval: 10, alerts: [{ id: "a", primary: "B" }] };
  assert.notEqual(feedSignature(a), feedSignature(b));
  const base = {
    rotate_interval: 10,
    show_badge: true,
    empty: "hide",
    all_clear: { text: "Clear", icon: "mdi:check" },
    alerts: [{
      id: "a",
      icon: "mdi:door",
      primary: "A",
      secondary: "sub",
      background: "#f00",
      color: "#fff",
      tap_action: { action: "more-info", entity: "binary_sensor.door" },
      hold_action: { action: "none" },
    }],
  };
  const baseSig = feedSignature(base);
  const changes = [
    (feed) => { feed.alerts[0].background = "#0f0"; },
    (feed) => { feed.alerts[0].color = "#000"; },
    (feed) => { feed.alerts[0].icon = "mdi:window"; },
    (feed) => { feed.alerts[0].severity = "warning"; },
    (feed) => { feed.alerts[0].secondary = "other"; },
    (feed) => { feed.alerts[0].tap_action = { action: "navigate", navigation_path: "/other" }; },
    (feed) => { feed.alerts[0].hold_action = { action: "toggle", entity: "switch.lamp" }; },
    (feed) => { feed.rotate_interval = 5; },
    (feed) => { feed.show_badge = false; },
    (feed) => { feed.empty = "all_clear"; },
    (feed) => { feed.all_clear = { text: "Quiet", icon: "mdi:check" }; },
    (feed) => { feed.severity_styles = { warning: { icon: "mdi:alert", color: "#ff8800" } }; },
  ];
  for (const change of changes) {
    const copy = structuredClone(base);
    change(copy);
    assert.notEqual(feedSignature(copy), baseSig);
  }
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(nextIndex(5, 0), 0);
});

test("severityLook labels three levels and defers to custom colors", () => {
  assert.equal(severityLook({}), null);
  assert.equal(severityLook({ severity: "" }), null);
  assert.equal(severityLook({ severity: "critical" }), null);
  assert.equal(severityLook({ severity: "toString" }), null);
  assert.equal(severityLook(undefined), null);

  const info = severityLook({ severity: "info" });
  const warning = severityLook({ severity: "warning" });
  const problem = severityLook({ severity: "problem" });
  assert.deepEqual([info.label, warning.label, problem.label], ["Information", "Warning", "Problem"]);
  assert.match(info.color, /--info-color/);
  assert.match(warning.color, /--warning-color/);
  assert.match(problem.color, /--error-color/);
  assert.equal(warning.accent, warning.color);

  const tinted = severityLook({ severity: "warning", color: "#ffffff" });
  assert.equal(tinted.color, "#ffffff");
  assert.equal(tinted.accent, warning.color);

  const filled = severityLook({ severity: "problem", background: "#c62828" });
  assert.equal(filled.accent, "");
  assert.equal(filled.color, problem.color);

  const styles = { warning: { icon: "mdi:alert-outline", color: "#ff8800" } };
  const themed = severityLook({ severity: "warning" }, styles);
  assert.equal(themed.color, "#ff8800");
  assert.equal(themed.accent, "#ff8800");
  assert.equal(themed.iconColor, "#ff8800");
  const overridden = severityLook({ severity: "warning", color: "#ffffff" }, styles);
  assert.equal(overridden.color, "#ffffff");
  assert.equal(overridden.accent, "#ff8800");
  assert.equal(overridden.iconColor, "");
});

test("resolveIcon prefers the alert, then the channel default, then a built-in", () => {
  const styles = { warning: { icon: "mdi:alert-outline", color: "" } };
  assert.equal(resolveIcon({ icon: "mdi:door-open", severity: "warning" }, styles), "mdi:door-open");
  assert.equal(resolveIcon({ icon: "", severity: "warning" }, styles), "mdi:alert-outline");
  assert.equal(resolveIcon({ severity: "info" }, styles), "mdi:information");
  assert.equal(resolveIcon({ severity: "problem" }, {}), "mdi:alert-circle");
  assert.equal(resolveIcon({ icon: "", severity: "" }, styles), "");
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
  assert.deepEqual(
    describeAction({ action: "more-info", entity: "binary_sensor.door" }),
    { type: "more-info", entity: "binary_sensor.door" },
  );
  assert.deepEqual(
    describeAction({ action: "navigate", navigation_path: "/lovelace/home" }),
    { type: "navigate", path: "/lovelace/home" },
  );
  assert.deepEqual(
    describeAction({ action: "toggle", entity: "switch.lamp" }),
    { type: "toggle", entity: "switch.lamp" },
  );
  assert.equal(describeAction({ action: "call-service", service: "lock" }), null);
});
