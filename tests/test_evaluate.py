from datetime import datetime
from zoneinfo import ZoneInfo

from evaluate import compare, in_window

TZ = ZoneInfo("America/New_York")


def test_string_operators():
    assert compare("on", "is", "on") is True
    assert compare("on", "is", "off") is False
    assert compare("rdy", "is_not", "ccp") is True
    assert compare("ccp", "is_not", "ccp") is False


def test_numeric_operators():
    assert compare("21", "above", "20") is True
    assert compare("20", "above", "20") is False
    assert compare("20", "at_or_above", "20") is True
    assert compare("19", "below", "20") is True
    assert compare("20", "below", "20") is False
    assert compare("20", "at_or_below", "20") is True
    assert compare("open", "above", "1") is False
    assert compare("nan", "below", "1") is False


def test_window_includes_start_excludes_end_and_wraps():
    assert in_window(datetime(2026, 10, 13, 9, 0, tzinfo=TZ), "09:00", "17:00") is True
    assert in_window(datetime(2026, 10, 13, 17, 0, tzinfo=TZ), "09:00", "17:00") is False
    assert in_window(datetime(2026, 10, 13, 21, 0, tzinfo=TZ), "20:00", "04:00") is True
    assert in_window(datetime(2026, 10, 13, 3, 30, tzinfo=TZ), "20:00", "04:00") is True
    assert in_window(datetime(2026, 10, 13, 12, 0, tzinfo=TZ), "20:00", "04:00") is False
    assert in_window(datetime(2026, 10, 13, 4, 0, tzinfo=TZ), "20:00", "04:00") is False
    assert in_window(datetime(2026, 10, 13, 15, 0, tzinfo=TZ), "08:00", "08:00") is True
