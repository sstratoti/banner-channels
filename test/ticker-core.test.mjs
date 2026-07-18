import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS, validateConfig, sanitizeAlerts, resolveCount,
  computeSignature, nextIndex, resolveTapAction,
} from "../lib/ticker-core.js";

test("validateConfig requires an entity", () => {
  assert.throws(() => validateConfig({}), /entity/);
  assert.throws(() => validateConfig(null), /configuration/i);
});

test("validateConfig applies defaults", () => {
  const c = validateConfig({ entity: "sensor.x" });
  assert.equal(c.rotate_interval, 5);
  assert.equal(c.transition, "fade");
  assert.equal(c.attribute, "alerts");
  assert.equal(c.show_badge, true);
});

test("validateConfig rejects bad rotate_interval and transition", () => {
  assert.throws(() => validateConfig({ entity: "sensor.x", rotate_interval: -1 }), /rotate_interval/);
  assert.throws(() => validateConfig({ entity: "sensor.x", rotate_interval: "5" }), /rotate_interval/);
  assert.throws(() => validateConfig({ entity: "sensor.x", transition: "spin" }), /transition/);
});

test("validateConfig allows rotate_interval 0 (static)", () => {
  const c = validateConfig({ entity: "sensor.x", rotate_interval: 0 });
  assert.equal(c.rotate_interval, 0);
});

test("sanitizeAlerts keeps only items with icon + primary", () => {
  const raw = [
    { icon: "mdi:a", primary: "A" },
    { icon: "mdi:b" },                 // no primary
    { primary: "C" },                  // no icon
    null,
    "nope",
    { icon: "mdi:d", primary: "D", secondary: "d2" },
  ];
  const out = sanitizeAlerts(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((a) => a.primary), ["A", "D"]);
});

test("sanitizeAlerts returns [] for non-arrays", () => {
  assert.deepEqual(sanitizeAlerts(undefined), []);
  assert.deepEqual(sanitizeAlerts({}), []);
});

test("resolveCount uses numeric state, else array length", () => {
  assert.equal(resolveCount("3", [{}, {}]), 3);
  assert.equal(resolveCount("unavailable", [{}, {}]), 2);
  assert.equal(resolveCount("", []), 0);
});

test("computeSignature changes when visible content changes", () => {
  const a = [{ icon: "mdi:a", primary: "A" }];
  const b = [{ icon: "mdi:a", primary: "B" }];
  assert.notEqual(computeSignature(1, a), computeSignature(1, b));
  assert.equal(computeSignature(1, a), computeSignature(1, [{ icon: "mdi:a", primary: "A" }]));
});

test("nextIndex round-robins and is safe for len 0/1", () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(nextIndex(0, 1), 0);
  assert.equal(nextIndex(5, 0), 0);
});

test("resolveTapAction: per-alert tap overrides card default", () => {
  const alert = { tap_action: { action: "navigate", navigation_path: "/x" } };
  const cfg = { tap_action: { action: "more-info" }, hold_action: { action: "none" } };
  assert.deepEqual(resolveTapAction(alert, cfg, "tap"), { action: "navigate", navigation_path: "/x" });
  assert.deepEqual(resolveTapAction({}, cfg, "tap"), { action: "more-info" });
  assert.deepEqual(resolveTapAction(alert, cfg, "hold"), { action: "none" });
});
