import {
  validateConfig, sanitizeAlerts, resolveCount, computeSignature,
} from "./lib/ticker-core.js";

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

  // Hook so Task 4 can restart rotation on data change without touching set hass.
  _onDataChanged() {}

  render() {
    if (!this._config) return html``;
    if (!this._available) {
      return html`<ha-card><div class="row unavail">Alert ticker unavailable</div></ha-card>`;
    }
    if (!this._alerts.length) {
      const ac = this._config.all_clear;
      if (!ac) return html`<ha-card style="display:none"></ha-card>`;
      return html`<ha-card>
        <div class="row clear">
          ${ac.icon ? html`<ha-icon icon="${ac.icon}"></ha-icon>` : ""}
          <div class="text"><div class="primary">${ac.text || "All clear"}</div></div>
        </div>
      </ha-card>`;
    }
    const a = this._alerts[this._index] || this._alerts[0];
    return html`<ha-card>
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
