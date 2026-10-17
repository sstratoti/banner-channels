import {
  validateConfig, visibleFeed, stubEntity, cardLayout, CARD_EDITOR_SCHEMA, cardEditorLabel, cardEditorHelper, feedSignature, nextIndex, viewMode, slideCounter, describeAction, resolveIcon, severityLook,
} from "./banner-core.js";

const Panel = customElements.get("ha-panel-lovelace") || customElements.get("hui-view");
if (!Panel) throw new Error("Banner Channel must load inside Lovelace");
const LitElement = Object.getPrototypeOf(Panel);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class BannerChannelCard extends LitElement {
  static get properties() {
    return { _index: { state: true }, _fading: { state: true }, _rev: { state: true } };
  }

  setConfig(config) {
    this._cancelGestures();
    this._config = validateConfig(config);
    this._index = 0;
    this._sig = null;
    this._rev = 0;
  }

  static getConfigElement() {
    return document.createElement("banner-channel-card-editor");
  }

  static getStubConfig(hass) {
    return { entity: stubEntity(hass) };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const stateObj = hass && hass.states ? hass.states[this._config.entity] : undefined;
    this._state = stateObj ? stateObj.state : "unavailable";
    const previousID = this._currentAlert()?.id;
    this._attrs = visibleFeed(stateObj && stateObj.attributes, hass?.user);
    this._mode = viewMode(this._state, this._attrs);
    const remainsVisible = (alert) => this._mode === "alerts" && this._attrs.alerts.some((item) => item.id === alert.id);
    if (this._press && !remainsVisible(this._press.alert)) this._clearPointer();
    if (this._pendingTap && !remainsVisible(this._pendingTap.alert)) this._cancelPendingTap();
    const sig = this._mode + feedSignature(this._attrs);
    if (sig !== this._sig) {
      this._sig = sig;
      const alerts = this._attrs.alerts || [];
      const retained = alerts.findIndex((alert) => alert.id === previousID);
      this._index = retained >= 0 ? retained : 0;
      this._cancelFade();
      this._restartRotation();
      this._rev++;
    }
  }

  get hass() { return this._hass; }

  connectedCallback() {
    super.connectedCallback();
    this._visHandler = () => (document.hidden ? this._stopRotation() : this._restartRotation());
    document.addEventListener("visibilitychange", this._visHandler);
    this._restartRotation();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopRotation();
    this._cancelFade();
    this._cancelGestures();
    if (this._visHandler) {
      document.removeEventListener("visibilitychange", this._visHandler);
      this._visHandler = null;
    }
  }

  _stopRotation() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._cancelFade();
  }

  _cancelFade() {
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
    this._fading = false;
  }

  _restartRotation() {
    this._stopRotation();
    if (document.hidden || this._mode !== "alerts") return;
    const alerts = this._attrs.alerts || [];
    const interval = Number(this._attrs.rotate_interval) || 0;
    if (interval > 0 && alerts.length > 1) {
      this._timer = setInterval(() => this._tick(), interval * 1000);
    }
  }

  _tick() {
    const advance = () => {
      this._index = nextIndex(this._index, (this._attrs.alerts || []).length);
      this._rev++;
    };
    this._fading = true;
    this._rev++;
    this._fadeTimer = setTimeout(() => {
      this._fadeTimer = null;
      this._fading = false;
      advance();
    }, 180);
  }

  _clearPointer() {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    this._press = null;
  }

  _cancelPendingTap() {
    if (this._tapTimer) { clearTimeout(this._tapTimer); this._tapTimer = null; }
    this._pendingTap = null;
  }

  _cancelGestures() {
    this._clearPointer();
    this._cancelPendingTap();
  }

  _onPointerDown(event) {
    if (event.button !== 0 || this._press || this._mode !== "alerts") return;
    const alert = this._currentAlert();
    if (!alert) return;
    let previousTap = this._pendingTap;
    this._cancelPendingTap();
    if (previousTap && previousTap.alert.id !== alert.id) {
      this._runAction("tap", previousTap.alert);
      previousTap = null;
    }
    this._holdFired = false;
    const press = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, alert, previousTap };
    this._press = press;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      if (this._press !== press) return;
      this._holdFired = true;
      this._runAction("hold", press.alert);
    }, 500);
  }

  _onPointerMove(event) {
    if (!this._press || event.pointerId !== this._press.pointerId) return;
    const dx = event.clientX - this._press.x;
    const dy = event.clientY - this._press.y;
    if ((dx * dx) + (dy * dy) > 100) this._cancelGestures();
  }

  _onPointerUp(event) {
    const pressed = this._press;
    if (!pressed || (event && event.pointerId !== pressed.pointerId)) return;
    const held = this._holdFired;
    this._clearPointer();
    if (held) return;
    const previous = pressed.previousTap;
    if (previous && Date.now() - previous.at < 250) {
      this._runAction("double_tap", pressed.alert);
      return;
    }
    if (previous) this._runAction("tap", previous.alert);
    if (!describeAction(pressed.alert.double_tap_action)) {
      this._runAction("tap", pressed.alert);
      return;
    }
    this._pendingTap = { alert: pressed.alert, at: Date.now() };
    this._tapTimer = setTimeout(() => {
      this._tapTimer = null;
      const pending = this._pendingTap;
      this._pendingTap = null;
      if (pending) this._runAction("tap", pending.alert);
    }, 250);
  }

  _currentAlert() {
    return (this._attrs?.alerts || [])[this._index];
  }

  _runAction(kind, alert = this._currentAlert()) {
    if (this._mode !== "alerts" || !alert || !this._attrs.alerts.some((item) => item.id === alert.id)) return;
    const key = kind === "hold" ? "hold_action" : kind === "double_tap" ? "double_tap_action" : "tap_action";
    performAction(this, this._hass, alert[key]);
  }

  _syncHost() {
    this.style.display = this._mode === "hide" ? "none" : "";
  }

  render() {
    if (!this._config || !this._hass) return html``;
    this._syncHost();
    const layout = cardLayout(this._config);
    const sized = `--banner-height:${layout.height}px;--banner-headline:${layout.headline}px;--banner-subtext:${layout.subtext}px;--banner-icon:${layout.icon}px;--banner-severity:${layout.severity}px;--banner-counter:${layout.counter}px;--banner-gap:${layout.gap}px`;
    if (this._mode === "unavailable") {
      return html`<ha-card style=${sized}><div class="row muted ${layout.align === "center" ? "center" : ""}">Banner unavailable</div></ha-card>`;
    }
    if (this._mode === "hide") return html``;
    if (this._mode === "all_clear") {
      const clear = this._attrs.all_clear || {};
      return html`<ha-card style=${sized}><div class="row ${layout.align === "center" ? "center" : ""}">
        ${clear.icon ? html`<ha-icon icon="${clear.icon}"></ha-icon>` : ""}
        <div class="text"><div class="primary">${clear.text || "All clear"}</div></div>
      </div></ha-card>`;
    }
    const alerts = this._attrs.alerts || [];
    const alert = alerts[this._index] || {};
    const styles = this._attrs.severity_styles || {};
    const look = severityLook(alert, styles);
    const icon = resolveIcon(alert, styles);
    const accent = look && look.accent ? `border-left-color:${look.accent}` : "";
    const rowStyle = alert.background ? `background:${alert.background}` : accent;
    const textStyle = alert.color ? `color:${alert.color}` : "";
    const iconStyle = textStyle || (look && look.iconColor ? `color:${look.iconColor}` : "");
    const counter = this._attrs.show_badge === false ? "" : slideCounter(this._index, alerts.length);
    return html`<ha-card
      @pointerdown=${(event) => this._onPointerDown(event)}
      @pointermove=${(event) => this._onPointerMove(event)}
      @pointerup=${(event) => this._onPointerUp(event)}
      @pointercancel=${() => this._cancelGestures()}
      style="cursor:pointer;${sized}">
      <div class="row ${layout.align === "center" ? "center" : ""} ${look && look.accent ? "accent" : ""} ${counter ? "has-counter" : ""} ${this._fading ? "fade-out" : ""}" style=${rowStyle}>
        <ha-icon icon="${icon}" style=${iconStyle}></ha-icon>
        <div class="text ${alert.secondary_position === "right" ? "secondary-right" : ""}" style=${textStyle}>
          ${look ? html`<div class="severity" style="color:${look.color}">${look.label}</div>` : ""}
          <div class="headline-row">
            <div class="primary">${alert.primary || ""}</div>
            ${alert.secondary ? html`<div class="secondary">${alert.secondary}</div>` : ""}
          </div>
        </div>
        ${counter ? html`<div class="counter" style=${textStyle}>${counter}</div>` : ""}
      </div>
    </ha-card>`;
  }

  getCardSize() {
    if (this._mode === "hide") return 0;
    return Math.max(1, Math.ceil(cardLayout(this._config).height / 50));
  }

  static get styles() {
    return css`
      ha-card { overflow: hidden; }
      .row {
        position: relative;
        display: flex; align-items: center;
        gap: var(--banner-gap, 12px);
        min-height: var(--banner-height, 80px);
        padding: 8px 16px;
        box-sizing: border-box;
        opacity: 1; transition: opacity 0.18s ease;
      }
      .row.center { justify-content: center; }
      .row.center .text { flex: 0 1 auto; align-items: center; text-align: center; }
      .row.accent { border-left: 3px solid transparent; padding-left: 13px; }
      .row.has-counter { padding-right: calc(var(--banner-counter, 12px) * 3.4); }
      .fade-out { opacity: 0; }
      .counter {
        position: absolute; top: 8px; right: 12px;
        font-size: var(--banner-counter, 12px); font-weight: 700; letter-spacing: 0.04em; line-height: 1;
        color: var(--secondary-text-color, #727272);
        pointer-events: none; white-space: nowrap;
      }
      ha-icon { --mdc-icon-size: var(--banner-icon, 40px); flex: 0 0 auto; display: flex; }
      .text { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
      .headline-row { display: flex; flex-direction: column; min-width: 0; max-width: 100%; }
      .secondary-right .headline-row { flex-direction: row; align-items: center; gap: 8px; width: 100%; }
      .secondary-right .primary { flex: 1 1 0; min-width: 0; }
      .secondary-right .secondary { flex: 0 1 auto; max-width: 60%; min-width: 0; }
      .row.center .headline-row { text-align: center; }
      .row.center .secondary-right .headline-row { text-align: left; }
      .severity, .primary, .secondary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .severity {
        font-size: var(--banner-severity, 11px); font-weight: 700; line-height: 1.3;
        letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 1px;
      }
      .primary { font-size: var(--banner-headline, 22px); font-weight: 600; line-height: 1.25; }
      .secondary { font-size: var(--banner-subtext, 16px); line-height: 1.3; opacity: 0.75; }
      .muted { color: var(--secondary-text-color); }
    `;
  }
}

function fireEvent(node, type, detail) {
  const event = new Event(type, { bubbles: true, composed: true });
  event.detail = detail || {};
  node.dispatchEvent(event);
}

function performAction(node, hass, action) {
  const choice = describeAction(action);
  if (!choice) return;
  if (choice.type === "more-info") {
    fireEvent(node, "hass-more-info", { entityId: choice.entity });
  } else if (choice.type === "navigate") {
    history.pushState(null, "", choice.path);
    fireEvent(window, "location-changed", { replace: false });
  } else if (choice.type === "url") {
    window.open(choice.url, "_blank", "noopener,noreferrer");
  } else if (choice.type === "toggle" && hass) {
    catchCall(hass.callService("homeassistant", "toggle", { entity_id: choice.entity }));
  } else if (choice.type === "call-service" && hass) {
    const [domain, service] = choice.service.split(".");
    catchCall(hass.callService(domain, service, choice.data, choice.target ? { entity_id: choice.target } : undefined));
  }
}

function catchCall(result) {
  if (result && typeof result.catch === "function") {
    result.catch((err) => console.warn("banner-channel", err));
  }
}

class BannerChannelCardEditor extends LitElement {
  static get properties() {
    return { hass: {}, _config: { state: true } };
  }

  setConfig(config) {
    const source = config || {};
    this._config = {
      entity: source.entity || "",
      height: source.height,
      headline_size: source.headline_size,
      subtext_size: source.subtext_size,
      align: source.align || "left",
    };
  }

  render() {
    if (!this._config) return html``;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${CARD_EDITOR_SCHEMA}
        .computeLabel=${(schema) => cardEditorLabel(schema)}
        .computeHelper=${(schema) => cardEditorHelper(schema)}
        @value-changed=${(event) => {
          fireEvent(this, "config-changed", { config: event.detail.value });
        }}
      ></ha-form>
    `;
  }
}

if (!customElements.get("banner-channel-card-editor")) {
  customElements.define("banner-channel-card-editor", BannerChannelCardEditor);
}
if (!customElements.get("banner-channel")) {
  customElements.define("banner-channel", BannerChannelCard);
}
if (!customElements.get("banner-channel-card")) {
  customElements.define("banner-channel-card", class extends BannerChannelCard {});
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "banner-channel")) {
  window.customCards.push({
    type: "banner-channel",
    name: "Banner Channel",
    preview: true,
    description: "One channel of the Banner Channels feed.",
  });
}
