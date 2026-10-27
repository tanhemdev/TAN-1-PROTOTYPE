"""Smoke tests for the simulator setup: one virtual day, a few seconds each."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import simulate  # noqa: E402


def test_one_day_is_complete_and_physiological():
    df = simulate.run("adult#001", 20, 1, 1.0, mistakes=True, scenario_seed=2020)
    assert len(df) == 24 * 60 // 3 + 1  # a reading every 3 minutes, both ends included
    assert df["BG"].min() > 20, "glucose should never collapse toward zero"
    assert df["BG"].max() < 600
    assert df["CHO"].sum() > 0, "meals happened"


def test_lows_get_treated_with_fast_carbs():
    # Double the insulin to force lows, then check 15 g treatments appear.
    df = simulate.run("adult#001", 20, 1, 2.0, mistakes=False, scenario_seed=2020)
    grams = (df["CHO"] * 3).round(1)  # CHO is g/min averaged over each 3-minute step
    assert (df["CGM"] < 70).any(), "the overdose should cause at least one low"
    assert np.isclose(grams, simulate.RESCUE_GRAMS).any(), "a low was treated with 15 g"


def test_simulation_is_reproducible():
    a = simulate.run("child#001", 0, 1, 1.0, mistakes=True, scenario_seed=2000)
    b = simulate.run("child#001", 0, 1, 1.0, mistakes=True, scenario_seed=2000)
    assert a["CGM"].equals(b["CGM"])
