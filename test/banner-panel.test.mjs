import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HELP, channelRecord, ruleRecord, moveItem, stylesRecord, displayValue,
} from "../custom_components/banner_channels/frontend/banner-channels-panel.js";

test("help sentences match the sidebar spec", () => {
  assert.equal(
    HELP.landing,
    "A channel is one banner. A rule is one alert. Tag a rule with every channel that should show it, then add a Banner Channel card and pick that channel's sensor.",
  );
  assert.equal(
    HELP.emptyChannels,
    "No channels yet. Add one, then point a Banner Channel card at its sensor.",
  );
  assert.equal(
    HELP.emptyRules,
    "No rules yet. An alert appears only on the channels you tag.",
  );
  assert.equal(
    HELP.channel.name,
    "Shown in the sidebar and as the sensor's friendly name. Renaming does not change the entity id.",
  );
  assert.equal(
    HELP.channel.rotate_interval,
    "Seconds between slides. 0 keeps the first slide on screen.",
  );
  assert.equal(
    HELP.channel.show_badge,
    "Shows which slide is on screen, such as 2/9, at the top right. Hidden when there is only one alert.",
  );
  assert.equal(
    HELP.channel.empty,
    "Hide removes the card when nothing matches. All clear shows a message instead.",
  );
  assert.equal(HELP.channel.all_clear_text, "Shown when this channel has no matching alerts.");
  assert.equal(HELP.channel.all_clear_icon, "Optional icon beside the all-clear text.");
  assert.equal(
    HELP.channel.severity_styles,
    "Default icon and color for each label on this channel. A rule's own icon or text color replaces them.",
  );
  assert.equal(
    HELP.rule.headline,
    "Main line. {name} and {state} are replaced for each match. Text with {{ or {% is a Jinja template. Variables: state, entity_id, name, rule_id.",
  );
  assert.equal(HELP.rule.severity, "Optional label above the headline. Leave blank for none.");
  assert.equal(HELP.rule.subtext, "Second line. Same replacements and templates as the headline.");
  assert.equal(
    HELP.rule.icon,
    "An mdi icon, such as mdi:door-open. Leave blank to use the severity default. Text with {{ or {% is a Jinja template. Variables: state, entity_id, name, rule_id. It uses the text color.",
  );
  assert.equal(
    HELP.rule.background,
    "Banner color, such as #c62828. Text with {{ or {% is a Jinja template that must render a color like #c62828. Leave blank to use the dashboard theme.",
  );
  assert.equal(
    HELP.rule.color,
    "Text and icon color, such as #ffffff. Text with {{ or {% is a Jinja template that must render a color like #ffffff. Leave blank to use the severity color, or the dashboard theme.",
  );
  assert.equal(HELP.rule.channels, "This alert appears on every channel you check.");
  assert.equal(HELP.rule.match, "One entity, or a pattern that becomes one slide per matching entity.");
  assert.equal(HELP.rule.operator, "Compared with the entity state. Numeric operators need a number.");
  assert.equal(HELP.rule.exclude, "Entity ids to skip when using a pattern, one per line.");
  assert.equal(
    HELP.rule.when,
    "Optional daily window in Home Assistant's time. An overnight window is allowed.",
  );
  assert.equal(HELP.rule.also, "Optional second condition. Both must match.");
  assert.equal(HELP.rule.tap, "What a click does. Blank opens more-info for the matched entity.");
  assert.equal(HELP.rule.hold, "What a long press does. Blank does nothing.");
});

test("channel record sends rotation as a number and omits entity id", () => {
  const record = channelRecord({
    name: "Tablets",
    rotate_interval: "10",
    show_badge: true,
    empty: "hide",
  });
  assert.equal(record.rotate_interval, 10);
  assert.equal(typeof record.rotate_interval, "number");
  assert.equal(record.show_badge, true);
  assert.equal(Object.hasOwn(record, "entity_id"), false);

  const allClear = channelRecord({
    name: "Tablets",
    rotate_interval: 0,
    show_badge: false,
    empty: "all_clear",
    all_clear_text: "Quiet",
    all_clear_icon: "mdi:check",
  });
  assert.equal(allClear.rotate_interval, 0);
  assert.deepEqual(allClear.all_clear, { text: "Quiet", icon: "mdi:check" });
  assert.deepEqual(stylesRecord(null), {
    info: { icon: "", color: "" },
    warning: { icon: "", color: "" },
    problem: { icon: "", color: "" },
  });

  const styled = channelRecord({
    name: "Tablets",
    rotate_interval: 10,
    show_badge: true,
    empty: "hide",
    severity_styles: {
      info: { icon: " mdi:information-outline ", color: " #039be5 " },
      warning: { icon: "", color: "" },
    },
  });
  assert.deepEqual(styled.severity_styles, {
    info: { icon: "mdi:information-outline", color: "#039be5" },
    warning: { icon: "", color: "" },
    problem: { icon: "", color: "" },
  });
});

test("rule record parses service data and numeric comparisons", () => {
  const built = ruleRecord({
    headline: "Low battery",
    subtext: "{state}",
    icon: "mdi:battery",
    background: "#c62828",
    color: "  ",
    channels: ["tablets"],
    match: {
      kind: "filter",
      pattern: "sensor.*battery*",
      operator: "at_or_below",
      value: "20",
      excludeText: "sensor.phone\n\nsensor.tablet",
    },
    whenEnabled: true,
    whenFrom: "20:00",
    whenTo: "04:00",
    alsoEnabled: false,
    tap_action: {
      action: "call-service",
      service: "light.turn_on",
      target: "",
      dataText: '{"brightness": 10}',
    },
    hold_action: { action: "", dataText: "" },
  });
  assert.equal(built.errors, undefined);
  assert.equal(built.record.match.value, 20);
  assert.equal(typeof built.record.match.value, "number");
  assert.deepEqual(built.record.match.exclude, ["sensor.phone", "sensor.tablet"]);
  assert.equal(built.record.color, "");
  assert.equal(built.record.background, "#c62828");
  assert.deepEqual(built.record.when, { from: "20:00", to: "04:00" });
  assert.equal(Object.hasOwn(built.record, "also"), false);
  assert.equal(built.record.tap_action.data.brightness, 10);
  assert.equal(Object.hasOwn(built.record.tap_action, "target"), false);
  assert.equal(built.record.hold_action, undefined);
  assert.equal(Object.hasOwn(built.record, "subtext_template"), false);
});

test("empty service data is omitted and invalid JSON stays on the form", () => {
  const base = {
    headline: "Door",
    subtext: "",
    icon: "mdi:door",
    background: "",
    color: "",
    channels: [],
    match: { kind: "entity", entity_id: "binary_sensor.front_door", operator: "is", value: "on" },
    hold_action: { action: "none", dataText: "" },
  };
  const empty = ruleRecord({
    ...base,
    tap_action: { action: "call-service", service: "light.turn_on", target: "light.kitchen", dataText: "  " },
  });
  assert.equal(Object.hasOwn(empty.record.tap_action, "data"), false);
  assert.equal(empty.record.tap_action.target, "light.kitchen");
  assert.equal(empty.record.match.value, "on");
  assert.equal(empty.record.severity, "");
  assert.equal(ruleRecord({ ...base, severity: "warning" }).record.severity, "warning");

  const bad = ruleRecord({
    ...base,
    tap_action: { action: "call-service", service: "light.turn_on", dataText: "[" },
  });
  assert.equal(bad.record, undefined);
  assert.match(bad.errors.tap_action, /JSON object/);
});

test("displayValue hides templates from the preview", () => {
  assert.equal(displayValue("mdi:door-open"), "mdi:door-open");
  assert.equal(displayValue("#c62828"), "#c62828");
  assert.equal(displayValue("{{ 'mdi:door-open' }}"), "");
  assert.equal(displayValue("{% if state == 'on' %}#ffffff{% endif %}"), "");
  assert.equal(displayValue("  "), "");
});

test("moveItem reorders within one list", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
});
