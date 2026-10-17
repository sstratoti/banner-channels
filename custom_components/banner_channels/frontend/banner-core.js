const LAYOUT_FIELDS = [
  ["height", 80, 32, 320],
  ["headline_size", 22, 10, 96],
  ["subtext_size", 16, 10, 72],
];

export function validateConfig(config) {
  if (!config || typeof config.entity !== "string" || !config.entity) {
    throw new Error("You must define an entity");
  }
  const result = { entity: config.entity };
  for (const [key] of LAYOUT_FIELDS) {
    if (config[key] == null || config[key] === "") continue;
    const number = Number(config[key]);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error("Height and font sizes must be numbers of pixels");
    }
    result[key] = number;
  }
  if (config.align != null && config.align !== "") {
    const align = String(config.align);
    if (align !== "left" && align !== "center") {
      throw new Error("Alignment must be left or center.");
    }
    result.align = align;
  }
  return result;
}

export function cardLayout(config) {
  const source = config || {};
  const values = {};
  for (const [key, fallback, min, max] of LAYOUT_FIELDS) {
    const number = Number(source[key]);
    const chosen = Number.isFinite(number) && number > 0 ? number : fallback;
    values[key] = Math.min(max, Math.max(min, Math.round(chosen)));
  }
  return {
    height: values.height,
    headline: values.headline_size,
    subtext: values.subtext_size,
    icon: Math.max(24, Math.round(values.height * 0.5)),
    severity: Math.max(10, Math.round(values.headline_size * 0.5)),
    counter: Math.max(11, Math.round(values.headline_size * 0.45)),
    gap: Math.max(10, Math.round(values.height * 0.14)),
    align: source.align === "center" ? "center" : "left",
  };
}

export function stubEntity(hass) {
  const source = hass || {};
  const entities = source.entities || {};
  const registered = Object.keys(entities)
    .filter((id) => entities[id] && entities[id].platform === "banner_channels")
    .sort();
  if (registered.length) return registered[0];
  const states = source.states || {};
  const matched = Object.keys(states)
    .filter((id) => {
      const attributes = states[id] && states[id].attributes;
      return Boolean(attributes && Array.isArray(attributes.alerts) && Object.hasOwn(attributes, "rotate_interval"));
    })
    .sort();
  return matched[0] || "";
}

export const CARD_EDITOR_SCHEMA = [
  {
    name: "entity",
    required: true,
    selector: { entity: { domain: "sensor", integration: "banner_channels" } },
  },
  {
    name: "height",
    selector: { number: { min: 32, max: 320, step: 1, unit_of_measurement: "px", mode: "box" } },
  },
  {
    name: "headline_size",
    selector: { number: { min: 10, max: 96, step: 1, unit_of_measurement: "px", mode: "box" } },
  },
  {
    name: "subtext_size",
    selector: { number: { min: 10, max: 72, step: 1, unit_of_measurement: "px", mode: "box" } },
  },
  {
    name: "align",
    selector: {
      select: {
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
        ],
        mode: "dropdown",
      },
    },
  },
];

const CARD_EDITOR_LABELS = {
  entity: "Channel",
  height: "Height",
  headline_size: "Headline size",
  subtext_size: "Subtext size",
  align: "Alignment",
};

const CARD_EDITOR_HELPERS = {
  entity: "Pick the sensor for this channel.",
  height: "Minimum height of the banner. The icon grows with it. Leave blank for 80px.",
  headline_size: "Size of the main line. Leave blank for 22px.",
  subtext_size: "Size of the second line. Leave blank for 16px.",
  align: "Left keeps the icon and text at the start. Center places them in the middle. The slide counter stays at the top right.",
};

export function cardEditorLabel(schema) {
  return CARD_EDITOR_LABELS[schema && schema.name] || "";
}

export function cardEditorHelper(schema) {
  return CARD_EDITOR_HELPERS[schema && schema.name] || "";
}

export function alertVisible(alert, user) {
  if (!Object.hasOwn(alert, "visibility")) return true;
  const visibility = alert.visibility;
  if (!visibility || typeof visibility !== "object" || Array.isArray(visibility)) return false;
  if (visibility.mode === "all") return true;
  if (!user) return false;
  if (visibility.mode === "admin") return user.is_admin === true;
  if (visibility.mode === "non_admin") return user.is_admin === false;
  if (visibility.mode === "users") return typeof user.id === "string" && Array.isArray(visibility.user_ids) && visibility.user_ids.includes(user.id);
  return false;
}

export function visibleFeed(attributes, user) {
  const attrs = attributes || {};
  return { ...attrs, alerts: (Array.isArray(attrs.alerts) ? attrs.alerts : []).filter((alert) => alertVisible(alert, user)) };
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

export function slideCounter(index, length) {
  const count = Number(length);
  if (!Number.isFinite(count) || count < 2) return "";
  const current = Number(index);
  const safe = Number.isFinite(current) && current >= 0 && current < count ? current : 0;
  return `${safe + 1}/${count}`;
}

export function feedSignature(attributes) {
  const attrs = attributes || {};
  const alerts = Array.isArray(attrs.alerts) ? attrs.alerts : [];
  return JSON.stringify([
    attrs.rotate_interval ?? 0,
    attrs.show_badge !== false,
    attrs.empty || "hide",
    attrs.all_clear || null,
    styleSignature(attrs.severity_styles),
    alerts.map((alert) => [
      alert.id, alert.icon, alert.primary, alert.secondary || "",
      alert.background || "", alert.color || "", alert.severity || "",
      alert.tap_action || null, alert.hold_action || null, alert.double_tap_action || null,
      alert.secondary_position || "below", alert.visibility || null,
    ]),
  ]);
}

function styleSignature(styles) {
  const source = styles && typeof styles === "object" ? styles : {};
  return ["info", "warning", "problem"].map((level) => {
    const item = source[level] && typeof source[level] === "object" ? source[level] : {};
    return [item.icon || "", item.color || ""];
  });
}

export const SEVERITIES = {
  info: { label: "Information", color: "var(--info-color, #039be5)" },
  warning: { label: "Warning", color: "var(--warning-color, #ffa600)" },
  problem: { label: "Problem", color: "var(--error-color, #db4437)" },
};

export const SEVERITY_ICONS = {
  info: "mdi:information",
  warning: "mdi:alert",
  problem: "mdi:alert-circle",
};

function severityBucket(level, styles) {
  if (!Object.hasOwn(SEVERITIES, level) || !styles || typeof styles !== "object") return {};
  const bucket = styles[level];
  return bucket && typeof bucket === "object" ? bucket : {};
}

export function resolveIcon(alert, styles) {
  const source = alert || {};
  const own = String(source.icon || "").trim();
  if (own) return own;
  const chosen = String(severityBucket(source.severity, styles).icon || "").trim();
  if (chosen) return chosen;
  return Object.hasOwn(SEVERITY_ICONS, source.severity) ? SEVERITY_ICONS[source.severity] : "";
}

export function severityLook(alert, styles) {
  const source = alert || {};
  const level = Object.hasOwn(SEVERITIES, source.severity) ? SEVERITIES[source.severity] : null;
  if (!level) return null;
  const chosen = String(severityBucket(source.severity, styles).color || "").trim();
  const base = /^#[0-9A-Fa-f]{6}$/.test(chosen) ? chosen : level.color;
  return {
    label: level.label,
    color: source.color || base,
    accent: source.background ? "" : base,
    iconColor: source.color ? "" : (base === level.color ? "" : base),
  };
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
