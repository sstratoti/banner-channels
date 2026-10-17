"""Validate Banner Channels editor payloads. No Home Assistant imports."""

from __future__ import annotations

import re
import math

_SLUG = re.compile(r"[^a-z0-9]+")
_ICON = re.compile(r"^mdi:[a-z0-9-]+$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_OPERATORS = {"is", "is_not", "above", "at_or_above", "below", "at_or_below"}
_NUMERIC = {"above", "at_or_above", "below", "at_or_below"}
_ACTIONS = {"more-info", "navigate", "url", "toggle", "call-service", "none"}
_SEVERITIES = ("", "info", "warning", "problem")


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
    _styles, style_errors = severity_styles(data.get("severity_styles"))
    errors.update(style_errors)
    return errors


def severity_styles(raw) -> tuple[dict, dict[str, str]]:
    """Return cleaned per-level icon and color, plus any field errors."""
    errors: dict[str, str] = {}
    styles = {level: {"icon": "", "color": ""} for level in ("info", "warning", "problem")}
    if raw in (None, ""):
        return styles, errors
    if not isinstance(raw, dict):
        return styles, {"severity_styles": "Severity defaults are invalid."}
    for level in styles:
        item = raw.get(level)
        if item in (None, ""):
            item = {}
        if not isinstance(item, dict):
            errors[f"severity_{level}"] = "Use an icon and a color."
            continue
        icon = str(item.get("icon") or "").strip()
        color = str(item.get("color") or "").strip()
        if icon and not _ICON.match(icon):
            errors[f"severity_{level}_icon"] = "Use an mdi icon."
        if color and not _HEX.match(color):
            errors[f"severity_{level}_color"] = "Use a color like #c62828."
        styles[level] = {"icon": icon, "color": color}
    return styles, errors


def _is_template(value: str) -> bool:
    return "{{" in value or "{%" in value


def _action_error(action: dict | None) -> str | None:
    if action is None:
        return None
    if not isinstance(action, dict):
        return "Choose an action."
    act = action.get("action", "")
    if act in (None, "", "none"):
        return None
    if not isinstance(act, str) or act not in _ACTIONS:
        return "Unknown action."
    if act in ("toggle", "more-info") and not isinstance(action.get("entity", ""), str):
        return "Use an entity id."
    if act == "navigate":
        path = action.get("navigation_path")
        if not isinstance(path, str) or not path.strip():
            return "Navigate needs a path."
    if act == "url":
        url = action.get("url_path")
        if not isinstance(url, str) or not url.strip().startswith(("http://", "https://", "/")):
            return "URL must start with http://, https://, or /."
    if act == "call-service":
        service = action.get("service")
        if not isinstance(service, str):
            return "Service must look like domain.service."
        domain, _, name = service.partition(".")
        if not domain or not name or "." in name:
            return "Service must look like domain.service."
        data = action.get("data")
        if data is not None and not isinstance(data, dict):
            return "Service data must be a JSON object."
        if "target" in action and not isinstance(action["target"], str):
            return "Use a target entity id."
    return None


def normalize_rule_options(data: dict) -> dict:
    result = dict(data)
    result.setdefault("conditions", [data["also"]] if data.get("also") else [])
    result.pop("also", None)
    result.setdefault("conditions_logic", "and")
    result.setdefault("secondary_position", "below")
    result.setdefault("visibility", {"mode": "all"})
    for key in ("match",):
        if isinstance(result.get(key), dict):
            result[key] = dict(result[key])
            if isinstance(result[key].get("attribute"), str):
                result[key]["attribute"] = result[key]["attribute"].strip()
    if isinstance(result["conditions"], list):
        result["conditions"] = [
            {**item, **({"attribute": item["attribute"].strip()} if isinstance(item.get("attribute"), str) else {})}
            if isinstance(item, dict) else item for item in result["conditions"]
        ]
    visibility = result["visibility"]
    if isinstance(visibility, dict):
        visibility = dict(visibility)
        ids = visibility.get("user_ids")
        if isinstance(ids, list) and all(isinstance(item, str) for item in ids):
            visibility["user_ids"] = list(dict.fromkeys(item.strip() for item in ids if item.strip()))
        if visibility.get("mode") != "users":
            visibility.pop("user_ids", None)
        result["visibility"] = visibility
    return result


def _condition_errors(condition, prefix):
    errors = {}
    if not isinstance(condition, dict):
        return {f"{prefix}_entity": "Choose an entity."}
    if not isinstance(condition.get("entity_id"), str) or not condition["entity_id"].strip():
        errors[f"{prefix}_entity"] = "Choose an entity."
    attribute = condition.get("attribute", "")
    if not isinstance(attribute, str):
        errors[f"{prefix}_attribute"] = "Use an attribute name."
    operator = condition.get("operator")
    if not isinstance(operator, str) or operator not in _OPERATORS:
        errors[f"{prefix}_operator"] = "Choose a comparison."
    elif operator in _NUMERIC:
        try:
            if isinstance(condition.get("value"), bool) or not math.isfinite(float(condition.get("value"))):
                raise ValueError
        except (TypeError, ValueError):
            errors[f"{prefix}_value"] = "Enter a number."
    elif not isinstance(condition.get("value"), (str, int, float, bool)):
        errors[f"{prefix}_value"] = "Enter a comparison value."
    return errors


def validate_rule(data: dict) -> dict[str, str]:
    errors: dict[str, str] = {}
    headline = (data.get("headline") or "").strip()
    if not headline or len(headline) > 1000:
        errors["headline"] = "Enter a headline up to 1000 characters."
    subtext = data.get("subtext") or ""
    if len(subtext) > 1000:
        errors["subtext"] = "Subtext can be at most 1000 characters."
    icon = (data.get("icon") or "").strip()
    severity = data.get("severity") or ""
    if _is_template(icon):
        if len(icon) > 1000:
            errors["icon"] = "Icon can be at most 1000 characters."
    elif icon and not _ICON.match(icon):
        errors["icon"] = "Use an mdi icon."
    elif not icon and severity not in ("info", "warning", "problem"):
        errors["icon"] = "Use an mdi icon."
    for key in ("background", "color"):
        value = data.get(key) or ""
        if _is_template(value):
            if len(value) > 1000:
                errors[key] = "Use a color like #c62828, or a template up to 1000 characters."
        elif value and not _HEX.match(value):
            errors[key] = "Use a color like #c62828."
    if (data.get("severity") or "") not in _SEVERITIES:
        errors["severity"] = "Choose Information, Warning, Problem, or none."
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
    if "also" in data and "conditions" not in data and data.get("also"):
        errors.update(_condition_errors(data["also"], "also"))
    options = normalize_rule_options(data)
    conditions = options["conditions"]
    if not isinstance(conditions, list):
        errors["conditions"] = "Use a list of additional conditions."
    else:
        for index, condition in enumerate(conditions):
            errors.update(_condition_errors(condition, f"conditions_{index}"))
    if options["conditions_logic"] not in ("and", "or"):
        errors["conditions_logic"] = "Choose AND or OR."
    if options["secondary_position"] not in ("below", "right"):
        errors["secondary_position"] = "Choose Below or Right."
    visibility = options["visibility"]
    if not isinstance(visibility, dict) or visibility.get("mode") not in ("all", "admin", "non_admin", "users"):
        errors["visibility"] = "Choose who can see this alert."
    elif visibility["mode"] == "users":
        ids = visibility.get("user_ids")
        if not isinstance(ids, list) or not ids or any(not isinstance(item, str) or not item.strip() for item in ids):
            errors["visibility"] = "Select at least one user."
    if not isinstance(match.get("attribute", ""), str):
        errors["match_attribute"] = "Use an attribute name."
    double_error = _action_error(data.get("double_tap_action"))
    if double_error:
        errors["double_tap_action"] = double_error
    tap_error = _action_error(data.get("tap_action"))
    if tap_error:
        errors["tap_action"] = tap_error
    hold_error = _action_error(data.get("hold_action"))
    if hold_error:
        errors["hold_action"] = hold_error
    return errors
