"""Pure Banner Channels feed evaluation. No Home Assistant imports."""

from __future__ import annotations

import math
from datetime import datetime


def compare(state: str, operator: str, value: str) -> bool:
    if operator == "is":
        return state == value
    if operator == "is_not":
        return state != value
    try:
        left = float(state)
        right = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(left) or not math.isfinite(right):
        return False
    if operator == "above":
        return left > right
    if operator == "at_or_above":
        return left >= right
    if operator == "below":
        return left < right
    if operator == "at_or_below":
        return left <= right
    return False


def in_window(now: datetime, start: str, end: str) -> bool:
    def minutes(hhmm: str) -> int:
        hour, minute = hhmm.split(":")
        return int(hour) * 60 + int(minute)

    current = now.hour * 60 + now.minute
    start_m = minutes(start)
    end_m = minutes(end)
    if start_m == end_m:
        return True
    if start_m < end_m:
        return start_m <= current < end_m
    return current >= start_m or current < end_m
