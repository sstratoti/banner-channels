export function validateConfig(config) {
  if (!config || typeof config.entity !== "string" || !config.entity) {
    throw new Error("You must define an entity");
  }
  return { entity: config.entity };
}

export function viewMode(state, attributes) {
  const attrs = attributes || {};
  if (state === "unavailable" || state === "unknown" || state == null) return "unavailable";
  const alerts = Array.isArray(attrs.alerts) ? attrs.alerts : [];
  if (!alerts.length) return attrs.empty === "all_clear" ? "all_clear" : "hide";
  return "alerts";
}

export function showBadge(state, attributes) {
  if (!attributes || attributes.show_badge === false) return false;
  const count = Number(state);
  return Number.isFinite(count) && count > 0;
}

export function feedSignature(attributes) {
  const attrs = attributes || {};
  const alerts = Array.isArray(attrs.alerts) ? attrs.alerts : [];
  return JSON.stringify([
    attrs.rotate_interval ?? 0,
    attrs.show_badge !== false,
    attrs.empty || "hide",
    attrs.all_clear || null,
    alerts.map((alert) => [
      alert.id, alert.icon, alert.primary, alert.secondary || "",
      alert.background || "", alert.color || "", alert.tap_action || null, alert.hold_action || null,
    ]),
  ]);
}

export function nextIndex(current, length) {
  if (!length || length < 1) return 0;
  return (current + 1) % length;
}

export function describeAction(action) {
  if (!action || !action.action || action.action === "none") return null;
  if (action.action === "more-info" && action.entity) return { type: "more-info", entity: action.entity };
  if (action.action === "navigate" && action.navigation_path) return { type: "navigate", path: action.navigation_path };
  if (action.action === "url" && action.url_path) return { type: "url", url: action.url_path };
  if (action.action === "toggle" && action.entity) return { type: "toggle", entity: action.entity };
  if (action.action === "call-service" && action.service && action.service.includes(".")) {
    return { type: "call-service", service: action.service, data: action.data || {}, target: action.target || null };
  }
  return null;
}
