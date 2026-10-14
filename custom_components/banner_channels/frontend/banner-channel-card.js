import {
  validateConfig, stubEntity, CARD_EDITOR_SCHEMA, feedSignature, nextIndex, viewMode, slideCounter, describeAction, resolveIcon, severityLook,
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
    this._attrs = (stateObj && stateObj.attributes) || {};
    this._mode = viewMode(this._state, this._attrs);
    const sig = this._mode + feedSignature(this._attrs);
    if (sig !== this._sig) {
      this._sig = sig;
      const alerts = this._attrs.alerts || [];
      if (this._index >= alerts.length) this._index = 0;
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
    this._clearPointer();
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

  _onPointerDown(event) {
    if (event.button !== 0) return;
    this._clearPointer();
    this._holdFired = false;
    this._press = { x: event.clientX, y: event.clientY };
    this._holdTimer = setTimeout(() => {
      this._holdFired = true;
      this._runAction("hold");
    }, 500);
  }

  _onPointerMove(event) {
    if (!this._press) return;
    const dx = event.clientX - this._press.x;
    const dy = event.clientY - this._press.y;
    if ((dx * dx) + (dy * dy) > 100) this._clearPointer();
  }

  _onPointerUp() {
    const held = this._holdFired;
    const pressed = this._press;
    this._clearPointer();
    if (pressed && !held) this._runAction("tap");
  }

  _runAction(kind) {
    if (this._mode !== "alerts") return;
    const alert = (this._attrs.alerts || [])[this._index] || {};
    const action = alert[kind === "hold" ? "hold_action" : "tap_action"];
    performAction(this, this._hass, action);
  }

  _syncHost() {
    this.style.display = this._mode === "hide" ? "none" : "";
  }

  render() {
    if (!this._config || !this._hass) return html``;
    this._syncHost();
    if (this._mode === "unavailable") {
      return html`<ha-card><div class="row muted">Banner unavailable</div></ha-card>`;
    }
    if (this._mode === "hide") return html``;
    if (this._mode === "all_clear") {
      const clear = this._attrs.all_clear || {};
      return html`<ha-card><div class="row">
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
      @pointerup=${() => this._onPointerUp()}
      @pointercancel=${() => this._clearPointer()}
      style="cursor:pointer">
      <div class="row ${look && look.accent ? "accent" : ""} ${counter ? "has-counter" : ""} ${this._fading ? "fade-out" : ""}" style=${rowStyle}>
        <ha-icon icon="${icon}" style=${iconStyle}></ha-icon>
        <div class="text" style=${textStyle}>
          ${look ? html`<div class="severity" style="color:${look.color}">${look.label}</div>` : ""}
          <div class="primary">${alert.primary || ""}</div>
          ${alert.secondary ? html`<div class="secondary">${alert.secondary}</div>` : ""}
        </div>
        ${counter ? html`<div class="counter" style=${textStyle}>${counter}</div>` : ""}
      </div>
    </ha-card>`;
  }

  getCardSize() { return this._mode === "hide" ? 0 : 1; }

  static get styles() {
    return css`
      ha-card { overflow: hidden; }
      .row {
        position: relative;
        display: flex; align-items: center; gap: 12px; padding: 10px 14px;
        opacity: 1; transition: opacity 0.18s ease;
      }
      .row.accent { border-left: 3px solid transparent; padding-left: 11px; }
      .row.has-counter { padding-right: 46px; }
      .fade-out { opacity: 0; }
      .counter {
        position: absolute; top: 6px; right: 10px;
        font-size: 11px; font-weight: 700; letter-spacing: 0.04em; line-height: 1;
        color: var(--secondary-text-color, #727272);
        pointer-events: none; white-space: nowrap;
      }
      ha-icon { --mdc-icon-size: 28px; flex: 0 0 auto; display: flex; }
      .text { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
      .severity, .primary, .secondary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .severity {
        font-size: 10px; font-weight: 700; line-height: 1.3;
        letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 1px;
      }
      .primary { font-size: 16px; font-weight: 600; line-height: 1.3; }
      .secondary { font-size: 13px; line-height: 1.35; opacity: 0.75; }
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
    this._config = { entity: (config && config.entity) || "" };
  }

  render() {
    if (!this._config) return html``;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${CARD_EDITOR_SCHEMA}
        .computeLabel=${() => "Channel"}
        .computeHelper=${() => "Pick the sensor for this channel."}
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
