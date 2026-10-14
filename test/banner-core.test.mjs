import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfig, feedSignature, nextIndex, viewMode, showBadge, describeAction,
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

test("viewMode distinguishes unavailable, hide, all-clear, and alerts", () => {
  assert.equal(viewMode("unavailable", {}), "unavailable");
  assert.equal(viewMode("unknown", {}), "unavailable");
  assert.equal(viewMode("0", { empty: "hide", alerts: [] }), "hide");
  assert.equal(viewMode("0", { empty: "all_clear", alerts: [], all_clear: { text: "Clear" } }), "all_clear");
  assert.equal(viewMode("1", { empty: "hide", alerts: [{ id: "a" }] }), "alerts");
  assert.equal(viewMode("unavailable", { alerts: [{ id: "a" }], empty: "hide" }), "unavailable");
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
    (feed) => { feed.alerts[0].secondary = "other"; },
    (feed) => { feed.alerts[0].tap_action = { action: "navigate", navigation_path: "/other" }; },
    (feed) => { feed.alerts[0].hold_action = { action: "toggle", entity: "switch.lamp" }; },
    (feed) => { feed.rotate_interval = 5; },
    (feed) => { feed.show_badge = false; },
    (feed) => { feed.empty = "all_clear"; },
    (feed) => { feed.all_clear = { text: "Quiet", icon: "mdi:check" }; },
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
