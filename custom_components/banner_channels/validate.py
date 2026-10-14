"""Validate Banner Channels editor payloads. No Home Assistant imports."""

from __future__ import annotations

import re

_SLUG = re.compile(r"[^a-z0-9]+")
_ICON = re.compile(r"^mdi:[a-z0-9-]+$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_OPERATORS = {"is", "is_not", "above", "at_or_above", "below", "at_or_below"}
_NUMERIC = {"above", "at_or_above", "below", "at_or_below"}
_ACTIONS = {"more-info", "navigate", "url", "toggle", "call-service", "none"}


def slugify(name: str) -> str:
    slug = _SLUG.sub("_", name.strip().lower()).strip("_")
    return slug or "channel"


def validate_channel(data: dict, taken_entity_ids: set[str]) -> dict[str, str]:
    errors: dict[str, str] = {}
    name = (data.get("name") or "").strip()
    if not name or len(name) > 64:
        errors["name"] = "Enter a name up to 64 characters."
    else:
        entity_id = data.get("entity_id") or f"sensor.banner_{slugify(name)}"
        if entity_id in taken_entity_ids:
            errors["entity_id"] = "A channel already uses that sensor id."
    interval = data.get("rotate_interval", 10)
    if isinstance(interval, bool) or not isinstance(interval, (int, float)) or interval < 0:
        errors["rotate_interval"] = "Rotation must be a number of seconds, zero or more."
    empty = data.get("empty", "hide")
    if empty not in ("hide", "all_clear"):
        errors["empty"] = "Choose hide or all clear."
    if empty == "all_clear":
        text = ((data.get("all_clear") or {}).get("text") or "").strip()
        if not text:
            errors["all_clear_text"] = "All clear needs text."
        icon = (data.get("all_clear") or {}).get("icon") or ""
        if icon and not _ICON.match(icon):
            errors["all_clear_icon"] = "Use an mdi icon."
    return errors


def _action_error(action: dict | None) -> str | None:
    if not action or not action.get("action") or action.get("action") == "none":
        return None
    act = action["action"]
    if act not in _ACTIONS:
        return "Unknown action."
    if act == "navigate" and not (action.get("navigation_path") or "").strip():
        return "Navigate needs a path."
    if act == "url":
        url = (action.get("url_path") or "").strip()
        if not (url.startswith("http://") or url.startswith("https://") or url.startswith("/")):
            return "URL must start with http://, https://, or /."
    if act == "call-service":
        service = action.get("service") or ""
        domain, _, name = service.partition(".")
        if not domain or not name or "." in name:
            return "Service must look like domain.service."
        data = action.get("data")
        if data is not None and not isinstance(data, dict):
            return "Service data must be a JSON object."
    return None


def validate_rule(data: dict) -> dict[str, str]:
    errors: dict[str, str] = {}
    headline = (data.get("headline") or "").strip()
    if not headline or len(headline) > 120:
        errors["headline"] = "Enter a headline up to 120 characters."
    subtext = data.get("subtext") or ""
    if len(subtext) > 240:
        errors["subtext"] = "Subtext can be at most 240 characters."
    if not _ICON.match(data.get("icon") or ""):
        errors["icon"] = "Use an mdi icon."
    for key in ("background", "color"):
        value = data.get(key) or ""
        if value and not _HEX.match(value):
            errors[key] = "Use a color like #c62828."
    match = data.get("match") or {}
    kind = match.get("kind")
    if match.get("operator") not in _OPERATORS:
        errors["match_operator"] = "Choose a comparison."
    elif match.get("operator") in _NUMERIC:
        try:
            number = float(match.get("value"))
            if number != number or number in (float("inf"), float("-inf")):
                raise ValueError
        except (TypeError, ValueError):
            errors["match_value"] = "Enter a number."
    if kind == "entity":
        if not (match.get("entity_id") or "").strip():
            errors["match_entity"] = "Choose an entity."
    elif kind == "filter":
        if not (match.get("pattern") or "").strip():
            errors["match_pattern"] = "Enter an entity id pattern."
    else:
        errors["match_entity"] = "Choose an entity or a filter."
    when = data.get("when")
    if when:
        if not _TIME.match(when.get("from") or "") or not _TIME.match(when.get("to") or ""):
            errors["when"] = "Use times like 20:00."
    also = data.get("also")
    if also:
        if not (also.get("entity_id") or "").strip():
            errors["also_entity"] = "Choose the extra entity."
        if also.get("operator") not in _OPERATORS:
            errors["also_operator"] = "Choose a comparison."
        elif also.get("operator") in _NUMERIC:
            try:
                number = float(also.get("value"))
                if number != number or number in (float("inf"), float("-inf")):
                    raise ValueError
            except (TypeError, ValueError):
                errors["also_value"] = "Enter a number."
    tap_error = _action_error(data.get("tap_action"))
    if tap_error:
        errors["tap_action"] = tap_error
    hold_error = _action_error(data.get("hold_action"))
    if hold_error:
        errors["hold_action"] = hold_error
    return errors
