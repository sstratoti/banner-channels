import { SEVERITIES, SEVERITY_ICONS, resolveIcon, severityLook } from "./banner-core.js";

export const HELP = {
  landing:
    "A channel is one banner. A rule is one alert. Tag a rule with every channel that should show it, then add a Banner Channel card and pick that channel's sensor.",
  emptyChannels: "No channels yet. Add one, then point a Banner Channel card at its sensor.",
  emptyRules: "No rules yet. An alert appears only on the channels you tag.",
  channel: {
    name: "Shown in the sidebar and as the sensor's friendly name. Renaming does not change the entity id.",
    rotate_interval: "Seconds between slides. 0 keeps the first slide on screen.",
    show_badge: "Shows which slide is on screen, such as 2/9, at the top right. Hidden when there is only one alert.",
    empty: "Hide removes the card when nothing matches. All clear shows a message instead.",
    all_clear_text: "Shown when this channel has no matching alerts.",
    all_clear_icon: "Optional icon beside the all-clear text.",
    severity_styles:
      "Default icon and color for each label on this channel. A rule's own icon or text color replaces them.",
  },
  rule: {
    headline:
      "Main line. {name} and {state} are replaced for each match. Text with {{ or {% is a Jinja template. Variables: state, entity_id, name, rule_id.",
    severity: "Optional label above the headline. Leave blank for none.",
    subtext: "Second line. Same replacements and templates as the headline.",
    icon:
      "An mdi icon, such as mdi:door-open. Leave blank to use the severity default. Text with {{ or {% is a Jinja template. Variables: state, entity_id, name, rule_id. It uses the text color.",
    background:
      "Banner color, such as #c62828. Text with {{ or {% is a Jinja template that must render a color like #c62828. Leave blank to use the dashboard theme.",
    color:
      "Text and icon color, such as #ffffff. Text with {{ or {% is a Jinja template that must render a color like #ffffff. Leave blank to use the severity color, or the dashboard theme.",
    channels: "This alert appears on every channel you check.",
    match: "One entity, or a pattern that becomes one slide per matching entity.",
    operator: "Compared with the entity state or selected attribute. Numeric operators need a number.",
    exclude: "Entity ids to skip when using a pattern, one per line.",
    when: "Optional daily window in Home Assistant's time. An overnight window is allowed.",
    also: "The primary match is always required. AND requires all additional conditions; OR requires at least one.",
    tap: "What a click does. Blank opens more-info for the matched entity.",
    hold: "What a long press does. Blank does nothing.",
    double_tap: "What a double tap does. Blank does nothing. When configured, single tap waits briefly.",
  },
};

const NUMERIC = new Set(["above", "at_or_above", "below", "at_or_below"]);
const OPERATORS = [
  ["is", "is"],
  ["is_not", "is not"],
  ["above", "above"],
  ["at_or_above", "at or above"],
  ["below", "below"],
  ["at_or_below", "at or below"],
];
const ACTIONS = [
  ["", ""],
  ["more-info", "more-info"],
  ["navigate", "navigate"],
  ["url", "url"],
  ["toggle", "toggle"],
  ["call-service", "call-service"],
  ["none", "none"],
];
const SEVERITY_OPTIONS = [["", ""], ...Object.entries(SEVERITIES).map(([value, level]) => [value, level.label])];

export function moveItem(list, from, to) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function comparisonValue(operator, raw) {
  if (!NUMERIC.has(operator)) return raw == null ? "" : String(raw);
  if (raw == null || String(raw).trim() === "") return raw ?? "";
  const number = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(number) ? number : raw;
}

function parseServiceData(text) {
  if (text == null || String(text).trim() === "") return { ok: true, omit: true };
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: "Service data must be a JSON object." };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Service data must be a JSON object." };
  }
  return { ok: true, value };
}

function actionRecord(action) {
  if (!action || !action.action) return undefined;
  const result = { action: action.action };
  if (action.action === "navigate") {
    result.navigation_path = action.navigation_path || "";
  } else if (action.action === "url") {
    result.url_path = action.url_path || "";
  } else if (action.action === "more-info" || action.action === "toggle") {
    const entity = (action.entity || "").trim();
    if (entity) result.entity = entity;
  } else if (action.action === "call-service") {
    result.service = (action.service || "").trim();
    const target = (action.target || "").trim();
    if (target) result.target = target;
    const parsed = parseServiceData(action.dataText);
    if (!parsed.ok) return { error: parsed.error };
    if (!parsed.omit) result.data = parsed.value;
  }
  return { value: result };
}

export function channelRecord(draft) {
  const interval = Number(draft.rotate_interval);
  const record = {
    name: draft.name ?? "",
    rotate_interval: Number.isFinite(interval) ? interval : draft.rotate_interval,
    show_badge: Boolean(draft.show_badge),
    empty: draft.empty || "hide",
  };
  if (draft.id) record.id = draft.id;
  if (record.empty === "all_clear") {
    record.all_clear = {
      text: draft.all_clear_text ?? "",
      icon: draft.all_clear_icon ?? "",
    };
  }
  record.severity_styles = stylesRecord(draft.severity_styles);
  return record;
}

export function stylesRecord(styles) {
  const source = styles || {};
  const result = {};
  for (const level of Object.keys(SEVERITIES)) {
    const item = source[level] || {};
    result[level] = {
      icon: String(item.icon || "").trim(),
      color: String(item.color || "").trim(),
    };
  }
  return result;
}

export function ruleRecord(draft) {
  const errors = {};
  const tap = actionRecord(draft.tap_action);
  const hold = actionRecord(draft.hold_action);
  const double = actionRecord(draft.double_tap_action);
  if (double && double.error) errors.double_tap_action = double.error;
  if (draft.visibility?.mode === "users" && !draft.visibility.user_ids?.length) errors.visibility = "Select at least one user.";
  if (tap && tap.error) errors.tap_action = tap.error;
  if (hold && hold.error) errors.hold_action = hold.error;
  if (Object.keys(errors).length) return { errors };

  const match = draft.match || {};
  const storedMatch = {
    kind: match.kind,
    operator: match.operator,
    value: comparisonValue(match.operator, match.value),
  };
  if (match.kind === "filter") {
    storedMatch.pattern = match.pattern || "";
    storedMatch.exclude = String(match.excludeText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } else {
    storedMatch.entity_id = match.entity_id || "";
  }

  if (match.attribute) storedMatch.attribute = match.attribute.trim();

  const record = {
    headline: draft.headline ?? "",
    subtext: draft.subtext ?? "",
    icon: draft.icon ?? "",
    background: (draft.background || "").trim(),
    color: (draft.color || "").trim(),
    severity: draft.severity || "",
    channels: draft.channels || [],
    match: storedMatch,
    secondary_position: draft.secondary_position || "below",
    visibility: draft.visibility?.mode === "users"
      ? { mode: "users", user_ids: [...new Set(draft.visibility.user_ids)] }
      : { mode: draft.visibility?.mode || "all" },
  };
  if (draft.id) record.id = draft.id;
  if (draft.whenEnabled) record.when = { from: draft.whenFrom || "", to: draft.whenTo || "" };
  record.conditions = (draft.conditions || []).map((condition) => ({
    entity_id: condition.entity_id || "",
    ...(condition.attribute ? { attribute: condition.attribute.trim() } : {}),
    operator: condition.operator || "is",
    value: comparisonValue(condition.operator, condition.value),
  }));
  record.conditions_logic = draft.conditions_logic || "and";
  if (tap && tap.value) record.tap_action = tap.value;
  if (hold && hold.value) record.hold_action = hold.value;
  if (double && double.value) record.double_tap_action = double.value;
  return { record };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function helpNode(text) {
  return text ? el("p", "help", text) : document.createTextNode("");
}

function errorNodes(messages) {
  return (messages || []).filter(Boolean).map((message) => el("p", "error", message));
}

function field(label, control, help, messages) {
  const wrap = el("div", "field");
  const title = el("span", "label", label);
  wrap.append(title, control, helpNode(help), ...errorNodes(messages));
  return wrap;
}

function input(type, value) {
  const node = document.createElement("input");
  node.type = type;
  node.value = value == null ? "" : String(value);
  return node;
}

export function displayValue(value) {
  const text = String(value || "").trim();
  if (text.includes("{{") || text.includes("{%")) return "";
  return text;
}

function textbox(value) {
  const node = document.createElement("textarea");
  node.value = value == null ? "" : String(value);
  return node;
}

function select(options, value) {
  const node = document.createElement("select");
  options.forEach(([optionValue, label]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    node.append(option);
  });
  node.value = value || "";
  return node;
}

function button(label, className) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  return node;
}

function blankAction() {
  return {
    action: "",
    navigation_path: "",
    url_path: "",
    entity: "",
    service: "",
    target: "",
    dataText: "",
  };
}

function actionDraft(action) {
  const source = action || {};
  const draft = blankAction();
  draft.action = source.action || "";
  draft.navigation_path = source.navigation_path || "";
  draft.url_path = source.url_path || "";
  draft.entity = source.entity || "";
  draft.service = source.service || "";
  draft.target = source.target || "";
  if (source.data && typeof source.data === "object") draft.dataText = JSON.stringify(source.data);
  return draft;
}

function channelDraft(record) {
  if (!record) {
    return {
      name: "",
      rotate_interval: 10,
      show_badge: true,
      empty: "hide",
      all_clear_text: "",
      all_clear_icon: "",
      severity_styles: stylesRecord(null),
    };
  }
  return {
    id: record.id,
    name: record.name || "",
    rotate_interval: record.rotate_interval ?? 10,
    show_badge: record.show_badge !== false,
    empty: record.empty || "hide",
    all_clear_text: (record.all_clear && record.all_clear.text) || "",
    all_clear_icon: (record.all_clear && record.all_clear.icon) || "",
    severity_styles: stylesRecord(record.severity_styles),
  };
}

function ruleDraft(record) {
  if (!record) {
    return {
      headline: "",
      subtext: "",
      secondary_position: "below",
      visibility: { mode: "all" },
      icon: "",
      background: "",
      color: "",
      severity: "",
      channels: [],
      match: { kind: "entity", entity_id: "", pattern: "", operator: "is", value: "", excludeText: "" },
      whenEnabled: false,
      whenFrom: "",
      whenTo: "",
      conditions: [],
      conditions_logic: "and",
      tap_action: blankAction(),
      hold_action: blankAction(),
      double_tap_action: blankAction(),
    };
  }
  const match = record.match || {};
  return {
    id: record.id,
    headline: record.headline || "",
    subtext: record.subtext || "",
    secondary_position: record.secondary_position || "below",
    visibility: { mode: record.visibility?.mode || "all", user_ids: [...(record.visibility?.user_ids || [])] },
    icon: record.icon || "",
    background: record.background || "",
    color: record.color || "",
    severity: record.severity || "",
    channels: (record.channels || []).slice(),
    match: {
      kind: match.kind || "entity",
      entity_id: match.entity_id || "",
      attribute: match.attribute || "",
      pattern: match.pattern || "",
      operator: match.operator || "is",
      value: match.value == null ? "" : String(match.value),
      excludeText: (match.exclude || []).join("\n"),
    },
    whenEnabled: Boolean(record.when),
    whenFrom: record.when ? record.when.from || "" : "",
    whenTo: record.when ? record.when.to || "" : "",
    conditions: (record.conditions ?? (record.also ? [record.also] : [])).map((condition) => ({
      ...condition, value: condition.value == null ? "" : String(condition.value),
    })),
    conditions_logic: record.conditions_logic || "and",
    tap_action: actionDraft(record.tap_action),
    hold_action: actionDraft(record.hold_action),
    double_tap_action: actionDraft(record.double_tap_action),
  };
}

const STYLE = `
:host { display: block; background: var(--primary-background-color, #f5f5f5); color: var(--primary-text-color, #212121); min-height: 100%; }
.page { max-width: 760px; margin: 0 auto; padding: 24px 20px 48px; box-sizing: border-box; }
h1 { font-size: 1.6rem; font-weight: 500; margin: 0 0 8px; }
h2 { font-size: 1.1rem; font-weight: 500; margin: 0; }
.help { color: var(--secondary-text-color, #727272); font-size: 0.85rem; margin: 4px 0 0; line-height: 1.4; }
.error { color: var(--error-color, #b00020); font-size: 0.85rem; margin: 4px 0 0; }
.section { margin-top: 28px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.list { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 8px; background: var(--card-background-color, #fff); border-radius: 8px; padding: 4px 8px; }
.row button.link { flex: 1; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: 10px 4px; cursor: pointer; }
.grip { cursor: grab; color: var(--secondary-text-color, #727272); padding: 0 4px; }
button.action, button.primary, button.warn { font: inherit; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
button.action { background: var(--card-background-color, #fff); color: inherit; border: 1px solid var(--divider-color, #e0e0e0); }
button.primary { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border: 0; }
button.warn { background: transparent; color: var(--error-color, #b00020); border: 1px solid var(--error-color, #b00020); }
.field { display: flex; flex-direction: column; margin-top: 16px; }
.label { font-weight: 500; }
.condition { margin: 12px 0; padding: 0 12px 12px; border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; }
ha-selector, ha-service-picker { display: block; width: 100%; margin-top: 6px; }
input[type="text"], input[type="number"], select, textarea { margin-top: 6px; font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--divider-color, #e0e0e0); background: var(--card-background-color, #fff); color: inherit; width: 100%; box-sizing: border-box; }
textarea { min-height: 72px; resize: vertical; }
textarea.compact { min-height: 40px; }
.color-row textarea { margin-top: 0; min-height: 40px; }
.check { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.check input { width: auto; }
.color-row { display: flex; gap: 8px; align-items: center; }
.color-row input[type="color"] { width: 48px; height: 36px; padding: 0; border: 0; background: transparent; }
.actions { display: flex; gap: 8px; margin-top: 24px; }
.preview { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 8px; min-height: 56px; box-sizing: border-box; background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, #e0e0e0); }
.preview.accent { border-left: 3px solid transparent; padding-left: 11px; }
.preview ha-icon { --mdc-icon-size: 28px; flex: 0 0 auto; }
.preview .copy { display: flex; flex-direction: column; min-width: 0; }
.preview .severity, .preview .headline, .preview .subtext { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preview .severity { font-size: 10px; font-weight: 700; line-height: 1.3; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 1px; }
.preview .headline { font-size: 16px; font-weight: 600; line-height: 1.3; }
.preview.secondary-right .copy { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, auto); align-items: center; gap: 0 8px; flex: 1; }
.preview.secondary-right .severity { grid-column: 1 / -1; }
.preview.secondary-right .subtext { max-width: 100%; }
.preview .subtext { font-size: 13px; line-height: 1.35; opacity: 0.75; }
.back { margin-bottom: 8px; }
`;

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class BannerChannelsPanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._hass = null;
      this._view = "list";
      this._data = { channels: [], rules: [] };
      this._draft = null;
      this._errors = {};
      this._started = false;
      this._loaded = false;
      this._loadError = "";
      this._users = null;
      this._usersError = "";
      this._usersPromise = null;
    }

    set hass(value) {
      this._hass = value;
      // Keep suggestions current without rebuilding the form or losing focus.
      this.shadowRoot.querySelectorAll("ha-selector, ha-service-picker").forEach((node) => {
        node.hass = value;
      });
      if (!this._started) {
        this._started = true;
        this._load().catch((err) => {
          this._loadError = (err && err.message) || "Banner Channels could not load.";
          this._render();
        });
      }
    }

    get hass() {
      return this._hass;
    }

    connectedCallback() {
      if (!this._started && this._hass) this.hass = this._hass;
      if (!this.shadowRoot.childElementCount) this._render();
    }

    async _load() {
      this._data = await this._hass.callWS({ type: "banner_channels/list" });
      this._loaded = true;
      this._loadError = "";
      if (this._view === "list") this._render();
    }

    _render() {
      const root = this.shadowRoot;
      root.replaceChildren();
      const style = document.createElement("style");
      style.textContent = STYLE;
      const page = el("div", "page");
      root.append(style, page);
      if (this._view === "channel") this._renderChannel(page);
      else if (this._view === "rule") this._renderRule(page);
      else this._renderList(page);
    }

    _renderList(page) {
      page.append(el("h1", null, "Banner Channels"), helpNode(HELP.landing));
      if (this._loadError) page.append(el("p", "error", this._loadError));
      if (!this._loaded) return;
      page.append(this._listSection("Channels", "channel", this._data.channels || [], HELP.emptyChannels, "Add channel"));
      page.append(this._listSection("Rules", "rule", this._data.rules || [], HELP.emptyRules, "Add rule"));
    }

    _listSection(title, kind, records, emptyText, addLabel) {
      const section = el("section", "section");
      const head = el("div", "section-head");
      head.append(el("h2", null, title));
      const add = button(addLabel, "action");
      add.addEventListener("click", () => this._openEditor(kind, null));
      head.append(add);
      section.append(head);
      if (!records.length) {
        section.append(el("p", "help", emptyText));
        return section;
      }
      const list = el("div", "list");
      records.forEach((record, index) => {
        const row = el("div", "row");
        row.append(el("span", "grip", "⋮⋮"));
        const open = button(kind === "channel" ? record.name || "" : record.headline || "", "link");
        open.addEventListener("click", () => this._openEditor(kind, record));
        row.append(open);
        this._bindDrag(row, kind, index);
        list.append(row);
      });
      section.append(list);
      return section;
    }

    _bindDrag(row, kind, index) {
      row.draggable = true;
      row.addEventListener("dragstart", (event) => {
        this._drag = { kind, index };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", kind);
      });
      row.addEventListener("dragover", (event) => {
        if (this._drag && this._drag.kind === kind) event.preventDefault();
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!this._drag || this._drag.kind !== kind || this._drag.index === index) return;
        const key = kind === "channel" ? "channels" : "rules";
        const ids = moveItem((this._data[key] || []).map((item) => item.id), this._drag.index, index);
        this._drag = null;
        this._hass.callWS({ type: "banner_channels/reorder", kind, ids }).then(
          () => this._load(),
          () => this._load(),
        );
      });
    }

    _openEditor(kind, record) {
      this._view = kind;
      this._errors = {};
      this._draft = kind === "channel" ? channelDraft(record) : ruleDraft(record);
      this._iconTemplate = Boolean(this._draft.icon && !displayValue(this._draft.icon));
      this._render();
      this._ensurePickers();
    }

    _ensurePickers() {
      if (this._pickerLoad || (customElements.get("ha-selector") && customElements.get("ha-service-picker"))) return;
      if (typeof window.loadCardHelpers !== "function" && !customElements.get("partial-panel-resolver")) return;
      // A sidebar can open before any Lovelace editor has registered its controls.
      // The button editor imports ha-selector and the service picker; ha-selector
      // then loads entity/icon controls on demand, using HA's own module paths.
      this._pickerLoad = (async () => {
        try {
          if (typeof window.loadCardHelpers !== "function") {
            // Resolve the dashboard bundle without mounting a dashboard or navigating.
            const resolver = document.createElement("partial-panel-resolver");
            const options = resolver._getRoutes({
              lovelace: { component_name: "lovelace", url_path: "lovelace" },
            });
            await options.routes.lovelace.load();
          }
          const helpers = await window.loadCardHelpers();
          const card = await helpers.createCardElement({ type: "button" });
          await card.constructor.getConfigElement();
          if (this._view === "rule" || this._view === "channel") this._render();
        } catch {
          // Leave the text controls usable on older HA versions or load failure.
          this._pickerLoad = null;
        }
      })();
    }

    _picker(type, value, label, placeholder, write) {
      const tag = type === "service" ? "ha-service-picker" : "ha-selector";
      if (!customElements.get(tag)) {
        const text = input("text", value);
        text.placeholder = placeholder;
        text.setAttribute("aria-label", label);
        text.addEventListener("input", () => write(text.value));
        return text;
      }
      const node = document.createElement(tag);
      node.hass = this._hass;
      node.value = value || "";
      node.label = label;
      node.placeholder = placeholder;
      node.required = false;
      if (type === "service") node.showServiceId = true;
      else node.selector = { [type]: {} };
      node.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        const next = event.detail.value ?? "";
        node.value = next;
        write(next);
      });
      return node;
    }

    _iconControl(value, label, placeholder, write, templates = false) {
      const wrap = el("div");
      const render = () => {
        wrap.replaceChildren();
        const templateMode = templates && this._iconTemplate;
        if (templateMode || !customElements.get("ha-selector")) {
          const text = textbox(value);
          text.classList.add("compact");
          text.placeholder = placeholder;
          text.setAttribute("aria-label", label);
          text.spellcheck = false;
          text.addEventListener("input", () => { value = text.value; write(value); });
          wrap.append(text);
        } else {
          wrap.append(this._picker("icon", value, label, placeholder, (next) => {
            value = next;
            write(next);
          }));
        }
        if (templates) {
          const toggle = input("checkbox", "");
          toggle.checked = Boolean(this._iconTemplate);
          toggle.addEventListener("change", () => {
            this._iconTemplate = toggle.checked;
            render();
          });
          const row = el("label", "check");
          row.append(toggle, el("span", null, "Use template"));
          wrap.append(row);
        }
      };
      render();
      return wrap;
    }

    _back() {
      this._view = "list";
      this._draft = null;
      this._errors = {};
      this._render();
    }

    _formChrome(page, title) {
      const back = button("Back", "action back");
      back.addEventListener("click", () => this._back());
      page.append(back, el("h1", null, title));
    }

    _saveBar(page, onSave, onDelete) {
      const bar = el("div", "actions");
      const save = button("Save", "primary");
      save.addEventListener("click", onSave);
      bar.append(save);
      if (onDelete) {
        const remove = button("Delete", "warn");
        remove.addEventListener("click", onDelete);
        bar.append(remove);
      }
      page.append(bar);
    }

    _renderChannel(page) {
      const draft = this._draft;
      const errors = this._errors || {};
      this._formChrome(page, draft.id ? "Edit channel" : "Add channel");

      const name = input("text", draft.name);
      name.addEventListener("input", () => { draft.name = name.value; });
      page.append(field("Name", name, HELP.channel.name, [errors.name, errors.entity_id]));

      const rotate = input("number", draft.rotate_interval);
      rotate.min = "0";
      rotate.step = "any";
      rotate.addEventListener("input", () => { draft.rotate_interval = rotate.value; });
      page.append(field("Rotate interval", rotate, HELP.channel.rotate_interval, [errors.rotate_interval]));

      const badge = document.createElement("input");
      badge.type = "checkbox";
      badge.checked = Boolean(draft.show_badge);
      badge.addEventListener("change", () => { draft.show_badge = badge.checked; });
      const badgeRow = el("label", "check");
      badgeRow.append(badge, el("span", null, "Show the slide counter"));
      page.append(field("Slide counter", badgeRow, HELP.channel.show_badge, []));

      const empty = select([["hide", "Hide"], ["all_clear", "All clear"]], draft.empty);
      empty.addEventListener("change", () => {
        draft.empty = empty.value;
        this._render();
      });
      page.append(field("When empty", empty, HELP.channel.empty, [errors.empty]));

      if (draft.empty === "all_clear") {
        const text = input("text", draft.all_clear_text);
        text.addEventListener("input", () => { draft.all_clear_text = text.value; });
        page.append(field("All-clear text", text, HELP.channel.all_clear_text, [errors.all_clear_text]));
        const icon = this._iconControl(draft.all_clear_icon, "All-clear icon", "mdi:check", (value) => { draft.all_clear_icon = value; });
        page.append(field("All-clear icon", icon, HELP.channel.all_clear_icon, [errors.all_clear_icon]));
      }

      page.append(el("h2", "section-head", "Severity defaults"));
      page.append(helpNode(HELP.channel.severity_styles));
      if (errors.severity_styles) page.append(el("p", "error", errors.severity_styles));
      for (const [level, meta] of Object.entries(SEVERITIES)) {
        const style = draft.severity_styles[level];
        const icon = this._iconControl(style.icon, `${meta.label} icon`, SEVERITY_ICONS[level], (value) => { style.icon = value; });
        page.append(field(`${meta.label} icon`, icon, "", [errors[`severity_${level}_icon`], errors[`severity_${level}`]]));
        page.append(this._styleColorField(level, `${meta.label} color`, errors[`severity_${level}_color`]));
      }

      this._saveBar(
        page,
        () => this._save("channel", channelRecord(draft)),
        draft.id ? () => this._delete("channel", draft.id) : null,
      );
    }

    _renderRule(page) {
      const draft = this._draft;
      const errors = this._errors || {};
      this._formChrome(page, draft.id ? "Edit rule" : "Add rule");
      page.append(this._preview(draft));

      const headline = textbox(draft.headline);
      headline.addEventListener("input", () => { draft.headline = headline.value; this._syncPreview(); });
      page.append(field("Headline", headline, HELP.rule.headline, [errors.headline]));

      const severity = select(SEVERITY_OPTIONS, draft.severity);
      severity.addEventListener("change", () => { draft.severity = severity.value; this._syncPreview(); });
      page.append(field("Severity", severity, HELP.rule.severity, [errors.severity]));

      const subtext = textbox(draft.subtext);
      subtext.addEventListener("input", () => { draft.subtext = subtext.value; this._syncPreview(); });
      page.append(field("Subtext", subtext, HELP.rule.subtext, [errors.subtext]));
      const position = select([["below", "Below headline"], ["right", "Right of headline"]], draft.secondary_position);
      position.addEventListener("change", () => { draft.secondary_position = position.value; this._syncPreview(); });
      page.append(field("Secondary value position", position, "", [errors.secondary_position]));

      const icon = this._iconControl(draft.icon, "Icon", "mdi:door-open", (value) => { draft.icon = value; this._syncPreview(); }, true);
      page.append(field("Icon", icon, HELP.rule.icon, [errors.icon]));

      page.append(this._colorField("Background", "background", HELP.rule.background, errors.background));
      page.append(this._colorField("Text color", "color", HELP.rule.color, errors.color));
      page.append(this._channelChecks(draft, errors));
      page.append(this._matchFields(draft, errors));
      page.append(this._windowFields(draft, errors));
      page.append(this._conditionsFields(draft, errors));
      page.append(this._visibilityFields(draft, errors));
      page.append(this._actionFields("Tap", draft.tap_action, HELP.rule.tap, errors.tap_action));
      page.append(this._actionFields("Hold", draft.hold_action, HELP.rule.hold, errors.hold_action));
      page.append(this._actionFields("Double tap", draft.double_tap_action, HELP.rule.double_tap, errors.double_tap_action));

      this._saveBar(
        page,
        () => {
          const built = ruleRecord(draft);
          if (built.errors) {
            this._errors = built.errors;
            this._render();
            return;
          }
          this._save("rule", built.record);
        },
        draft.id ? () => this._delete("rule", draft.id) : null,
      );
    }

    _preview(draft) {
      const row = el("div", `preview${draft.secondary_position === "right" ? " secondary-right" : ""}`);
      const icon = document.createElement("ha-icon");
      const copy = el("div", "copy");
      const background = displayValue(draft.background);
      const color = displayValue(draft.color);
      const styles = this._stylesFor(draft);
      const look = severityLook({ severity: draft.severity, background, color }, styles);
      if (look) {
        const label = el("div", "severity", look.label);
        label.style.color = look.color;
        copy.append(label);
        if (look.accent) {
          row.classList.add("accent");
          row.style.borderLeftColor = look.accent;
        }
      }
      copy.append(el("div", "headline"), el("div", "subtext"));
      row.append(icon, copy);
      if (background) row.style.background = background;
      if (color) {
        row.style.color = color;
        icon.style.color = color;
      } else if (look && look.iconColor) {
        icon.style.color = look.iconColor;
      }
      const iconName = resolveIcon(
        { icon: displayValue(draft.icon), severity: draft.severity },
        styles,
      ) || "mdi:information";
      icon.icon = iconName;
      icon.setAttribute("icon", iconName);
      copy.querySelector(".headline").textContent = (draft.headline || "").trim() || "Headline";
      copy.querySelector(".subtext").textContent = (draft.subtext || "").trim();
      copy.querySelector(".subtext").hidden = !copy.querySelector(".subtext").textContent;
      return row;
    }

    _syncPreview() {
      const preview = this.shadowRoot.querySelector(".preview");
      if (!preview || this._view !== "rule") return;
      const next = this._preview(this._draft);
      preview.replaceWith(next);
    }

    _stylesFor(draft) {
      const ids = draft.channels || [];
      const channels = (this._data && this._data.channels) || [];
      const match = channels.find((channel) => ids.includes(channel.id));
      return (match && match.severity_styles) || {};
    }

    _styleColorField(level, label, error) {
      const style = this._draft.severity_styles[level];
      const row = el("div", "color-row");
      const picker = document.createElement("input");
      picker.type = "color";
      const current = (style.color || "").trim();
      picker.value = /^#[0-9A-Fa-f]{6}$/.test(current) ? current : "#000000";
      const text = input("text", current);
      text.placeholder = "#c62828";
      text.spellcheck = false;
      const write = (value) => {
        style.color = value;
        if (/^#[0-9A-Fa-f]{6}$/.test(value.trim())) picker.value = value.trim();
      };
      picker.addEventListener("input", () => {
        text.value = picker.value;
        write(picker.value);
      });
      text.addEventListener("input", () => write(text.value));
      row.append(picker, text);
      return field(label, row, "", [error]);
    }

    _colorField(label, key, help, error) {
      const draft = this._draft;
      const row = el("div", "color-row");
      const picker = document.createElement("input");
      picker.type = "color";
      const current = (draft[key] || "").trim();
      picker.value = /^#[0-9A-Fa-f]{6}$/.test(current) ? current : "#000000";
      const text = textbox(current);
      text.classList.add("compact");
      text.placeholder = "#c62828";
      text.spellcheck = false;
      picker.addEventListener("input", () => {
        draft[key] = picker.value;
        text.value = picker.value;
        this._syncPreview();
      });
      text.addEventListener("input", () => {
        draft[key] = text.value;
        if (/^#[0-9A-Fa-f]{6}$/.test(text.value.trim())) picker.value = text.value.trim();
        this._syncPreview();
      });
      row.append(picker, text);
      return field(label, row, help, [error]);
    }

    _channelChecks(draft, errors) {
      const box = el("div");
      (this._data.channels || []).forEach((channel) => {
        const label = el("label", "check");
        const inputNode = document.createElement("input");
        inputNode.type = "checkbox";
        inputNode.checked = (draft.channels || []).includes(channel.id);
        inputNode.addEventListener("change", () => {
          const selected = new Set(draft.channels || []);
          if (inputNode.checked) selected.add(channel.id);
          else selected.delete(channel.id);
          draft.channels = (this._data.channels || []).map((item) => item.id).filter((id) => selected.has(id));
        });
        label.append(inputNode, el("span", null, channel.name || channel.entity_id || channel.id));
        box.append(label);
      });
      if (!(this._data.channels || []).length) box.append(el("p", "help", HELP.emptyChannels));
      return field("Channels", box, HELP.rule.channels, []);
    }

    _matchFields(draft, errors) {
      const wrap = el("div");
      const kind = select([["entity", "One entity"], ["filter", "Pattern"]], draft.match.kind);
      kind.addEventListener("change", () => {
        draft.match.kind = kind.value;
        this._render();
      });
      wrap.append(field("Match", kind, HELP.rule.match, []));

      if (draft.match.kind === "filter") {
        const pattern = input("text", draft.match.pattern);
        pattern.placeholder = "sensor.*battery*";
        pattern.addEventListener("input", () => { draft.match.pattern = pattern.value; });
        wrap.append(field("Pattern", pattern, "", [errors.match_pattern]));
        const attribute = input("text", draft.match.attribute);
        attribute.addEventListener("input", () => { draft.match.attribute = attribute.value; });
        wrap.append(field("Attribute (optional)", attribute, "Blank compares the entity state.", [errors.match_attribute]));
      } else {
        const attribute = this._attributeControl(draft.match);
        const entity = this._picker("entity", draft.match.entity_id, "Entity", "binary_sensor.front_door", (value) => {
          draft.match.entity_id = value;
          if (attribute.localName === "ha-selector") attribute.selector = { attribute: { entity_id: value } };
        });
        wrap.append(field("Entity", entity, "", [errors.match_entity]));
        wrap.append(field("Attribute (optional)", attribute, "Blank compares the entity state.", [errors.match_attribute]));
      }

      const pair = el("div", "color-row");
      const operator = select(OPERATORS, draft.match.operator);
      operator.addEventListener("change", () => { draft.match.operator = operator.value; });
      const value = input("text", draft.match.value);
      value.addEventListener("input", () => { draft.match.value = value.value; });
      pair.append(operator, value);
      wrap.append(field("Operator and value", pair, HELP.rule.operator, [errors.match_operator, errors.match_value]));

      if (draft.match.kind === "filter") {
        const exclude = document.createElement("textarea");
        exclude.value = draft.match.excludeText || "";
        exclude.addEventListener("input", () => { draft.match.excludeText = exclude.value; });
        wrap.append(field("Exclude", exclude, HELP.rule.exclude, []));
      }
      return wrap;
    }

    _windowFields(draft, errors) {
      const wrap = el("div");
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = Boolean(draft.whenEnabled);
      enabled.addEventListener("change", () => {
        draft.whenEnabled = enabled.checked;
        this._render();
      });
      const row = el("label", "check");
      row.append(enabled, el("span", null, "Limit to a daily window"));
      wrap.append(row);
      if (draft.whenEnabled) {
        const times = el("div", "color-row");
        const from = input("time", draft.whenFrom);
        const to = input("time", draft.whenTo);
        from.addEventListener("input", () => { draft.whenFrom = from.value; });
        to.addEventListener("input", () => { draft.whenTo = to.value; });
        times.append(from, to);
        wrap.append(times);
      }
      return field("Time window", wrap, HELP.rule.when, [errors.when]);
    }

    _attributeControl(condition) {
      const attribute = this._picker("attribute", condition.attribute, "Attribute (optional)", "Blank uses state", (value) => { condition.attribute = value; });
      if (attribute.localName === "ha-selector") attribute.selector = { attribute: { entity_id: condition.entity_id || "" } };
      return attribute;
    }

    _conditionsFields(draft, errors) {
      const wrap = el("div");
      const logic = select([["and", "AND — all must match"], ["or", "OR — at least one must match"]], draft.conditions_logic);
      logic.setAttribute("aria-label", "Additional condition logic");
      logic.addEventListener("change", () => { draft.conditions_logic = logic.value; });
      wrap.append(logic);
      draft.conditions.forEach((condition, index) => {
        const row = el("div", "condition");
        const attribute = this._attributeControl(condition);
        const entity = this._picker("entity", condition.entity_id, `Condition ${index + 1} entity`, "sensor.example", (value) => {
          condition.entity_id = value;
          if (attribute.localName === "ha-selector") attribute.selector = { attribute: { entity_id: value } };
        });
        row.append(field(`Condition ${index + 1} entity`, entity, "", [errors[`conditions_${index}_entity`]]));
        row.append(field("Attribute (optional)", attribute, "", [errors[`conditions_${index}_attribute`]]));
        const pair = el("div", "color-row");
        const operator = select(OPERATORS, condition.operator);
        operator.addEventListener("change", () => { condition.operator = operator.value; });
        const value = input("text", condition.value);
        value.setAttribute("aria-label", `Condition ${index + 1} value`);
        value.addEventListener("input", () => { condition.value = value.value; });
        pair.append(operator, value);
        row.append(field("Operator and value", pair, "", [errors[`conditions_${index}_operator`], errors[`conditions_${index}_value`]]));
        const remove = button("Remove", "action");
        remove.addEventListener("click", () => { draft.conditions.splice(index, 1); this._errors = {}; this._render(); });
        row.append(remove);
        wrap.append(row);
      });
      const add = button("Add condition", "action");
      add.addEventListener("click", () => {
        draft.conditions.push({ entity_id: "", attribute: "", operator: "is", value: "" });
        this._render();
      });
      wrap.append(add);
      return field("Additional conditions", wrap, HELP.rule.also, [errors.conditions, errors.conditions_logic]);
    }

    _loadUsers() {
      const draft = this._draft;
      if (!this._usersPromise) {
        this._usersError = "";
        this._usersPromise = this._hass.callWS({ type: "config/auth/list" }).then((users) => {
          this._users = users.filter((user) => user.is_active && !user.system_generated)
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        }).catch((error) => { this._usersError = error.message || "Could not load users."; })
          .finally(() => { this._usersPromise = null; });
      }
      return this._usersPromise.then(() => {
        if (this._draft === draft && this._view === "rule" && draft.visibility.mode === "users") this._render();
      });
    }

    _visibilityFields(draft, errors) {
      const wrap = el("div");
      const mode = select([["all", "Everyone"], ["admin", "Admins"], ["non_admin", "Non-admins"], ["users", "Specific users"]], draft.visibility.mode);
      mode.setAttribute("aria-label", "Visible to");
      mode.addEventListener("change", () => {
        draft.visibility.mode = mode.value;
        draft.visibility.user_ids ||= [];
        this._render();
      });
      wrap.append(mode);
      if (draft.visibility.mode === "users") {
        if (this._users === null && !this._usersError) {
          wrap.append(helpNode("Loading users…"));
          this._loadUsers();
        }
        if (this._usersError) {
          wrap.append(el("p", "error", this._usersError));
          const retry = button("Retry users", "action");
          retry.addEventListener("click", () => { this._loadUsers(); this._render(); });
          wrap.append(retry);
        }
        const ids = draft.visibility.user_ids || [];
        const users = [...(this._users || [])];
        for (const id of ids) if (!users.some((user) => user.id === id)) users.push({ id, name: `Unavailable user (${id})` });
        for (const user of users) {
          const sameName = users.filter((other) => other.name === user.name).length > 1;
          const label = el("label", "check");
          const check = input("checkbox", "");
          check.dataset.userId = user.id;
          check.checked = ids.includes(user.id);
          check.addEventListener("change", () => {
            const selected = new Set(draft.visibility.user_ids || []);
            if (check.checked) selected.add(user.id); else selected.delete(user.id);
            draft.visibility.user_ids = [...selected];
          });
          label.append(check, el("span", null, `${user.name || user.id}${sameName ? ` (${user.id})` : ""}${user.is_admin ? " — Admin" : ""}`));
          wrap.append(label);
        }
      }
      return field("Visible to", wrap, "Filters dashboard display. The shared sensor still contains all active alerts.", [errors.visibility]);
    }

    _actionFields(label, action, help, error) {
      const wrap = el("div");
      const kind = select(ACTIONS, action.action);
      kind.addEventListener("change", () => {
        action.action = kind.value;
        this._render();
      });
      wrap.append(kind);
      if (action.action === "navigate") {
        const path = input("text", action.navigation_path);
        path.placeholder = "/lovelace/home";
        path.addEventListener("input", () => { action.navigation_path = path.value; });
        wrap.append(el("span", "label", "Path"), path);
      } else if (action.action === "url") {
        const url = input("text", action.url_path);
        url.placeholder = "https://";
        url.addEventListener("input", () => { action.url_path = url.value; });
        wrap.append(el("span", "label", "URL"), url);
      } else if (action.action === "more-info" || action.action === "toggle") {
        const entity = this._picker("entity", action.entity, `${label} entity`, "Blank uses the matched entity", (value) => { action.entity = value; });
        wrap.append(el("span", "label", "Entity"), entity);
        wrap.append(helpNode("Blank uses the matched entity."));
      } else if (action.action === "call-service") {
        const service = this._picker("service", action.service, `${label} service`, "domain.service", (value) => { action.service = value; });
        const target = this._picker("entity", action.target, `${label} target`, "Optional target entity", (value) => { action.target = value; });
        const data = document.createElement("textarea");
        data.placeholder = "Optional JSON object";
        data.value = action.dataText || "";
        data.addEventListener("input", () => { action.dataText = data.value; });
        wrap.append(
          el("span", "label", "Service"),
          service,
          el("span", "label", "Target"),
          target,
          el("span", "label", "Data"),
          data,
        );
      }
      return field(label, wrap, help, [error]);
    }

    async _save(kind, record) {
      try {
        const result = await this._hass.callWS({ type: "banner_channels/save", kind, record });
        if (result && result.errors) {
          this._errors = result.errors;
          this._render();
          return;
        }
        this._view = "list";
        this._draft = null;
        this._errors = {};
        await this._load();
      } catch (err) {
        this._errors = { name: (err && err.message) || "Save failed." };
        this._render();
      }
    }

    async _delete(kind, id) {
      const noun = kind === "channel" ? "channel" : "rule";
      if (!confirm(`Delete this ${noun}?`)) return;
      await this._hass.callWS({ type: "banner_channels/delete", kind, record_id: id });
      this._view = "list";
      this._draft = null;
      this._errors = {};
      await this._load();
    }
  }

  if (!customElements.get("banner-channels-panel")) {
    customElements.define("banner-channels-panel", BannerChannelsPanel);
  }
}
