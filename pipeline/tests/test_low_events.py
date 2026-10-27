"""The event-level alert metrics in train.py, on hand-made glucose traces."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from train import low_events, summarize_events  # noqa: E402


def trace(n=200, level=120.0):
    return np.full(n, level)


def test_alert_before_a_low_is_caught_with_its_warning_time():
    cgm = trace()
    cgm[100:110] = 60  # a low starts at step 100
    idx = np.arange(20, 190)
    flag = np.zeros(len(idx), bool)
    flag[idx == 95] = True  # alert 5 steps (15 minutes) earlier
    e = low_events(cgm, idx, flag)
    assert (e["lows"], e["caught"], e["leads"], e["alerts"], e["false"]) == (1, 1, [15], 1, 0)


def test_alert_with_no_low_after_it_is_a_false_alarm():
    cgm = trace()
    idx = np.arange(20, 190)
    flag = np.zeros(len(idx), bool)
    flag[(idx >= 50) & (idx <= 53)] = True  # one alert lasting 4 readings
    e = low_events(cgm, idx, flag)
    assert (e["lows"], e["alerts"], e["false"]) == (0, 1, 1)


def test_missed_low_and_merged_lows():
    cgm = trace()
    cgm[60:65] = 65
    cgm[68:72] = 62  # back below 70 within 30 minutes: same event
    idx = np.arange(20, 190)
    e = low_events(cgm, idx, np.zeros(len(idx), bool))
    assert (e["lows"], e["caught"]) == (1, 0)
    s = summarize_events([e])
    assert s["caught_early"] == 0 and s["false_alarms"] == 0
