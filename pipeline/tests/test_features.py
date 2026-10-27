"""Feature and label checks on hand-made glucose traces."""

import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from features import FEATURES, HORIZON, SAMPLE_MINUTES, WINDOW, build_dataset, tier_of, window_features  # noqa: E402


def test_tier_boundaries_follow_consensus_cutoffs():
    readings = [39, 53.9, 54, 69.9, 70, 180, 180.1, 181, 250, 250.1, 400]
    assert list(tier_of(readings)) == [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4]
    assert tier_of(100) == 2


def test_slope_and_projection_on_a_straight_line():
    # Falling 2 mg/dL per reading = 2/3 mg/dL per minute.
    window = [200 - 2 * i for i in range(WINDOW + 1)]
    f = dict(zip(FEATURES, window_features(window, 600)))
    assert f["glucose"] == 160
    assert f["delta_3"] == -2 and f["delta_15"] == -10 and f["delta_30"] == -20 and f["delta_60"] == -40
    assert math.isclose(f["slope_30"], -2 / SAMPLE_MINUTES)
    assert math.isclose(f["accel"], 0, abs_tol=1e-12)
    assert math.isclose(f["projected_30"], 160 - 2 * HORIZON)
    assert (f["min_60"], f["max_60"], f["mean_60"]) == (160, 200, 180)


def test_time_of_day_is_cyclic():
    flat = [120] * (WINDOW + 1)
    late = dict(zip(FEATURES, window_features(flat, 1439)))
    early = dict(zip(FEATURES, window_features(flat, 0)))
    assert abs(late["tod_sin"] - early["tod_sin"]) < 0.01
    assert abs(late["tod_cos"] - early["tod_cos"]) < 0.01


def test_dataset_labels_look_exactly_horizon_steps_ahead():
    cgm = np.concatenate([np.full(40, 120.0), np.full(40, 60.0)])
    minutes = np.arange(len(cgm)) * SAMPLE_MINUTES
    X, y, cur, idx = build_dataset(cgm, minutes)
    assert X.shape == (len(cgm) - WINDOW - HORIZON, len(FEATURES))
    assert idx[0] == WINDOW and idx[-1] == len(cgm) - HORIZON - 1
    for k, t in enumerate(idx):
        assert y[k] == tier_of(cgm[t + HORIZON])
        assert cur[k] == tier_of(cgm[t])
    # The first window whose label is low is exactly HORIZON readings before the drop.
    first_low = idx[np.flatnonzero(y == 1)[0]]
    assert first_low == 40 - HORIZON
