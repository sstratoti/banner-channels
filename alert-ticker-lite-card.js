import {
  validateConfig, sanitizeAlerts, resolveCount, computeSignature, nextIndex, resolveTapAction,
} from "./lib/ticker-core.js";
import { performAction } from "./lib/actions.js";

// Borrow the LitElement HA already loaded — no bundled Lit, no download.
const LitElement = Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class AlertTickerLiteCard extends LitElement {
  static get properties() {
    return { _index: { state: true }, _fading: { state: true }, _rev: { state: true } };
  }

  setConfig(config) {
    this._config = validateConfig(config);
    this._index = 0;
    this._sig = null;
    this._rev = 0;
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass && hass.states ? hass.states[this._config.entity] : undefined;
    const available = !!st && st.state !== "unavailable" && st.state !== "unknown";
    const alerts = available ? sanitizeAlerts(st.attributes[this._config.attribute]) : [];
    const count = available ? resolveCount(st.state, alerts) : 0;
    const sig = (available ? "ok" : "na") + computeSignature(count, alerts);

    this._alerts = alerts;
    this._count = count;
    this._available = available;

    if (sig !== this._sig) {
      this._sig = sig;
      if (this._index >= alerts.length) this._index = 0;
      this._onDataChanged();       // overridden in Task 4 to (re)start rotation
      this._rev++;                 // triggers a Lit re-render
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
    if (this._visHandler) {
      document.removeEventListener("visibilitychange", this._visHandler);
      this._visHandler = null;
    }
  }

  _onDataChanged() { this._restartRotation(); }

  _stopRotation() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _restartRotation() {
    this._stopRotation();
    if (document.hidden) return;
    const n = this._alerts ? this._alerts.length : 0;
    const ri = this._config ? this._config.rotate_interval : 0;
    if (ri > 0 && n > 1) {
      this._timer = setInterval(() => this._tick(), ri * 1000);
    }
  }

  _tick() {
    const advance = () => {
      this._index = nextIndex(this._index, this._alerts.length);
      this._rev++;
    };
    if (this._config.transition === "fade") {
      this._fading = true;
      this._rev++;
      setTimeout(() => { this._fading = false; advance(); }, 180);
    } else {
      advance();
    }
  }

  _currentAlert() {
    return (this._alerts && this._alerts[this._index]) || {};
  }

  _runAction(kind) {
    const action = resolveTapAction(this._currentAlert(), this._config, kind);
    performAction(this, this._hass, action, this._config.entity);
  }

  _onPointerDown() {
    this._holdFired = false;
    this._holdTimer = setTimeout(() => {
      this._holdFired = true;
      this._runAction("hold");
    }, 500);
  }

  _onPointerUp() {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (this._holdFired) return;
    if (this._clickTimer) {
      clearTimeout(this._clickTimer);
      this._clickTimer = null;
      this._runAction("double_tap");
    } else {
      this._clickTimer = setTimeout(() => {
        this._clickTimer = null;
        this._runAction("tap");
      }, 250);
    }
  }

  render() {
    if (!this._config) return html``;
    if (!this._available) {
      return html`<ha-card><div class="row unavail">Alert ticker unavailable</div></ha-card>`;
    }
    if (!this._alerts.length) {
      const ac = this._config.all_clear;
      if (!ac) return html`<ha-card style="display:none"></ha-card>`;
      return html`<ha-card
        @pointerdown=${() => this._onPointerDown()}
        @pointerup=${() => this._onPointerUp()}
        style="cursor:pointer">
        <div class="row clear">
          ${ac.icon ? html`<ha-icon icon="${ac.icon}"></ha-icon>` : ""}
          <div class="text"><div class="primary">${ac.text || "All clear"}</div></div>
        </div>
      </ha-card>`;
    }
    const a = this._alerts[this._index] || this._alerts[0];
    return html`<ha-card
      @pointerdown=${() => this._onPointerDown()}
      @pointerup=${() => this._onPointerUp()}
      style="cursor:pointer">
      <div class="row ${this._fading ? "fade-out" : ""}">
        ${this._config.show_badge && this._count > 0
          ? html`<div class="badge">${this._count}</div>` : ""}
        <ha-icon icon="${a.icon}" style=${a.color ? `color:${a.color}` : ""}></ha-icon>
        <div class="text">
          <div class="primary">${a.primary}</div>
          ${a.secondary ? html`<div class="secondary">${a.secondary}</div>` : ""}
        </div>
      </div>
    </ha-card>`;
  }

  getCardSize() { return 1; }

  static get styles() {
    return css`
      .row {
        display: flex; align-items: center; gap: 12px; padding: 12px 16px;
        opacity: 1; transition: opacity 0.18s ease;
      }
      .fade-out { opacity: 0; }
      .badge {
        min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 600;
        background: var(--primary-color); color: var(--text-primary-color, #fff);
      }
      ha-icon {
        --mdc-icon-size: 26px; flex: 0 0 auto;
        color: var(--paper-item-icon-color, var(--primary-text-color));
      }
      .text { display: flex; flex-direction: column; min-width: 0; }
      .primary {
        font-size: 15px; font-weight: 600; color: var(--primary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .secondary {
        font-size: 12.5px; color: var(--secondary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .unavail, .clear .primary { color: var(--secondary-text-color); }
    `;
  }
}

customElements.define("alert-ticker-lite-card", AlertTickerLiteCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "alert-ticker-lite-card",
  name: "Alert Ticker Lite",
  description: "Lightweight rotating alert ticker fed by a Node-RED sensor.",
});
