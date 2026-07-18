// Pure, DOM-free logic for the Alert Ticker Lite card. Unit-tested with node:test.

export const DEFAULTS = Object.freeze({
  rotate_interval: 5,
  transition: "fade",
  attribute: "alerts",
  show_badge: true,
});

export function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Invalid configuration");
  if (!config.entity || typeof config.entity !== "string") {
    throw new Error("You must define an entity");
  }
  const rotate_interval = config.rotate_interval ?? DEFAULTS.rotate_interval;
  if (typeof rotate_interval !== "number" || Number.isNaN(rotate_interval) || rotate_interval < 0) {
    throw new Error("rotate_interval must be a number >= 0");
  }
  const transition = config.transition ?? DEFAULTS.transition;
  if (transition !== "fade" && transition !== "none") {
    throw new Error("transition must be 'fade' or 'none'");
  }
  return {
    ...DEFAULTS,
    ...config,
    rotate_interval,
    transition,
    attribute: config.attribute ?? DEFAULTS.attribute,
    show_badge: config.show_badge ?? DEFAULTS.show_badge,
  };
}

// An alert is valid only if it has an mdi icon and primary text.
export function sanitizeAlerts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a) =>
      a && typeof a === "object" &&
      typeof a.icon === "string" && a.icon.length > 0 &&
      typeof a.primary === "string" && a.primary.length > 0
  );
}

// Badge count: numeric sensor state wins; otherwise fall back to array length.
export function resolveCount(state, alerts) {
  const n = Number(state);
  return Number.isFinite(n) ? n : alerts.length;
}

// Cheap signature of what is visible — re-render only when this changes.
export function computeSignature(count, alerts) {
  return JSON.stringify([
    count,
    alerts.map((a) => [a.icon, a.primary, a.secondary ?? "", a.color ?? ""]),
  ]);
}

// Round-robin; safe for length 0 or 1.
export function nextIndex(current, len) {
  if (!len || len < 1) return 0;
  return (current + 1) % len;
}

// Per-alert tap_action overrides the card-level default for taps.
export function resolveTapAction(alert, cardConfig, kind) {
  if (kind === "tap" && alert && alert.tap_action) return alert.tap_action;
  const key =
    kind === "tap" ? "tap_action" : kind === "hold" ? "hold_action" : "double_tap_action";
  return cardConfig[key];
}
