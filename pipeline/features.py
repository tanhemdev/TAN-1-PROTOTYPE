"""Features for TAN-1's 30-minute glucose forecast.

Every forecast looks only at the last 60 minutes of CGM readings, the same
information a caregiver app has in real time. web/src/model/features.js
computes exactly the same numbers in the browser; web/tests/parity.test.mjs
checks the two agree to 1e-9.
"""

from __future__ import annotations

import math

import numpy as np

SAMPLE_MINUTES = 3  # one CGM reading every 3 minutes
WINDOW = 20  # readings of history before "now": 60 minutes
HORIZON = 10  # readings ahead: 30 minutes

# Glucose ranges, using the international consensus cut-offs
# (Battelino et al., Diabetes Care 2019), in mg/dL.
TIERS = ["urgent_low", "low", "in_range", "high", "very_high"]

FEATURES = [
    "glucose",  # the reading now
    "delta_3",  # change since 3 minutes ago
    "delta_15",
    "delta_30",
    "delta_60",
    "slope_30",  # least-squares trend over the last 30 minutes, mg/dL per minute
    "accel",  # that trend minus the trend over the 30 minutes ending 15 minutes ago
    "mean_60",
    "std_60",
    "min_60",
    "max_60",
    "projected_30",  # where the 30-minute trend line says glucose will be in 30 minutes
    "tod_sin",  # time of day, as a point on a circle so 23:59 sits next to 00:00
    "tod_cos",
]


def tier_of(glucose):
    """Range index for a reading (or an array of readings):
    0 below 54, 1 for 54-69, 2 for 70-180, 3 for 181-250, 4 above 250."""
    g = np.asarray(glucose, dtype=float)
    out = np.select([g < 54, g < 70, g <= 180, g <= 250], [0, 1, 2, 3], default=4)
    return int(out) if out.ndim == 0 else out


def _slope(values) -> float:
    """Least-squares slope in mg/dL per minute for readings 3 minutes apart."""
    y = np.asarray(values, dtype=float)
    x = np.arange(len(y)) * SAMPLE_MINUTES
    xm, ym = x.mean(), y.mean()
    return float(((x - xm) * (y - ym)).sum() / ((x - xm) ** 2).sum())


def window_features(window, minute_of_day) -> list[float]:
    """The 14 features for one moment. `window` holds the readings from 60
    minutes ago up to and including now (WINDOW + 1 = 21 readings)."""
    w = np.asarray(window, dtype=float)
    if len(w) != WINDOW + 1:
        raise ValueError(f"need {WINDOW + 1} readings, got {len(w)}")
    g = float(w[-1])
    slope_30 = _slope(w[-11:])
    slope_prev = _slope(w[-16:-5])
    angle = 2 * math.pi * (float(minute_of_day) % 1440) / 1440
    return [
        g,
        g - float(w[-2]),
        g - float(w[-6]),
        g - float(w[-11]),
        g - float(w[0]),
        slope_30,
        slope_30 - slope_prev,
        float(w.mean()),
        float(w.std()),
        float(w.min()),
        float(w.max()),
        g + slope_30 * HORIZON * SAMPLE_MINUTES,
        math.sin(angle),
        math.cos(angle),
    ]


def build_dataset(cgm: np.ndarray, minute_of_day: np.ndarray):
    """Features (n, len(FEATURES)), labels (n,), current tiers (n,), index of each row.

    Rows exist only where a full 60-minute history and a 30-minute-ahead
    label are both available. Call once per patient so no window ever spans
    two different people.
    """
    cgm = np.asarray(cgm, dtype=float)
    rows, labels, current, idx = [], [], [], []
    for t in range(WINDOW, len(cgm) - HORIZON):
        rows.append(window_features(cgm[t - WINDOW : t + 1], minute_of_day[t]))
        labels.append(int(tier_of(cgm[t + HORIZON])))
        current.append(int(tier_of(cgm[t])))
        idx.append(t)
    return (
        np.asarray(rows, dtype=float),
        np.asarray(labels, dtype=int),
        np.asarray(current, dtype=int),
        np.asarray(idx, dtype=int),
    )
