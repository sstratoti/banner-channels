// Effectful HA action dispatch (verified via harness; pure choice lives in ticker-core).

export function fireEvent(node, type, detail) {
  const ev = new Event(type, { bubbles: true, composed: true, cancelable: false });
  ev.detail = detail || {};
  node.dispatchEvent(ev);
  return ev;
}

export function performAction(node, hass, action, fallbackEntity) {
  if (!action || action.action === "none") return;
  switch (action.action) {
    case "more-info": {
      const entityId = action.entity || (action.data && action.data.entity_id) || fallbackEntity;
      if (entityId) fireEvent(node, "hass-more-info", { entityId });
      break;
    }
    case "navigate": {
      if (action.navigation_path) {
        history.pushState(null, "", action.navigation_path);
        fireEvent(window, "location-changed", { replace: false });
      }
      break;
    }
    case "url": {
      if (action.url_path) window.open(action.url_path);
      break;
    }
    case "call-service":
    case "perform-action": {
      const svc = action.perform_action || action.service;
      if (svc && svc.includes(".") && hass) {
        const [domain, service] = svc.split(".");
        hass.callService(domain, service, action.data || action.service_data || {}, action.target);
      }
      break;
    }
    case "toggle": {
      const entityId = action.entity || fallbackEntity;
      if (entityId && hass) hass.callService("homeassistant", "toggle", { entity_id: entityId });
      break;
    }
    default:
      break;
  }
}
