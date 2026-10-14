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
