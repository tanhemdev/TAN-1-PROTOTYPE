"""Generate simulated CGM data for TAN-1.

Uses the UVA/Padova Type 1 diabetes simulator (simglucose implementation,
vendored in third_party/) to simulate 30 virtual patients: 10 children,
10 adolescents and 10 adults, with randomized daily meals.

How each virtual patient is dosed, step by step:

- A bolus calculator like the ones in insulin pumps: meal insulin from the
  carb ratio, plus a correction above 150 mg/dL that subtracts insulin
  still on board (so corrections don't stack). The simulator's stock
  controller has no insulin-on-board, which drives some virtual patients
  to glucose of zero, a state no real person stays in.
- Lows get treated the way families are taught: 15 g of fast carbs when
  CGM drops below 70, re-checked after 15 minutes. People notice within
  minutes during the day and much later overnight, which is exactly the
  gap a caregiver alert is for.
- Titration: each patient gets the largest dose (100%, 85%, 70%, ...) that
  meets the international consensus targets for lows (under 4% of time
  below 70 mg/dL and under 1% below 54; Battelino et al., Diabetes Care
  2019) on a test day of mistake-free dosing, as a care team would adjust.
- The recorded days then add the dosing mistakes families describe:
  miscounted carbs, missed boluses, late boluses and day-to-day basal drift.

Every random choice is seeded, so the dataset is exactly reproducible.

    python pipeline/simulate.py --days 10 --out data/simulated_cgm.csv.gz

This is simulated data, not data from real people. Nothing here comes from
Tanisha or any interviewee.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import warnings
from datetime import datetime, timedelta
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "third_party"))

from simglucose.actuator.pump import InsulinPump  # noqa: E402
from simglucose.controller.base import Action  # noqa: E402
from simglucose.controller.basal_bolus_ctrller import BBController  # noqa: E402
from simglucose.patient.t1dpatient import T1DPatient  # noqa: E402
from simglucose.sensor.cgm import CGMSensor  # noqa: E402
from simglucose.simulation.env import T1DSimEnv  # noqa: E402
from simglucose.simulation.scenario_gen import RandomScenario  # noqa: E402
from simglucose.simulation.sim_engine import SimObj  # noqa: E402

COHORTS = ["child", "adolescent", "adult"]
PATIENTS = [f"{c}#{i:03d}" for c in COHORTS for i in range(1, 11)]
START = datetime(2026, 1, 5, 0, 0, 0)

# How often each dosing mistake happens. Chosen to be plausible, not measured.
P_MISSED_BOLUS = 0.08  # forgets a meal bolus entirely
P_LATE_BOLUS = 0.15  # boluses 15-45 minutes after eating
CARB_ERROR_SD = 0.25  # log-normal carb-counting error (about +/-25%)
BASAL_DRIFT = (0.85, 1.15)  # daily basal needs drift by +/-15%

# Titration: try these dose scales in order and keep the first that meets
# the consensus targets for time below range.
DOSE_STEPS = (1.0, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2)
TITRATION_DAYS = 1
MAX_BELOW_70 = 0.04
MAX_BELOW_54 = 0.01


TARGET = 120  # bolus calculator target, mg/dL
CORRECT_ABOVE = 150
IOB_MINUTES = 240  # insulin action time for insulin on board (linear decay)
RESCUE_GRAMS = 15
RESCUE_RECHECK_MIN = 15


class TreatableScenario(RandomScenario):
    """Random daily meals, plus any low treatments the patient eats."""

    def __init__(self, start_time, seed):
        self.extra: dict[datetime, float] = {}
        super().__init__(start_time=start_time, seed=seed)

    def add(self, when: datetime, grams: float):
        key = when.replace(second=0, microsecond=0)
        self.extra[key] = self.extra.get(key, 0.0) + grams

    def get_action(self, t):
        action = super().get_action(t)
        grams = self.extra.get(t.replace(second=0, microsecond=0), 0.0)
        return action._replace(meal=action.meal + grams) if grams else action


class EverydayController(BBController):
    """Pump-style dosing and low treatment, with the mistakes of everyday life."""

    def __init__(self, seed: int, sample_time: float, scenario: TreatableScenario,
                 dose_scale: float = 1.0, mistakes: bool = True):
        super().__init__()
        self.rng = np.random.default_rng(seed)
        self.sample_time = sample_time
        self.scenario = scenario
        self.dose_scale = dose_scale
        self.mistakes = mistakes
        self.step = 0
        self.day = -1
        self.basal_factor = 1.0
        self.boluses: list[tuple[int, float]] = []  # (step, units) delivered
        self.pending: list[tuple[int, float]] = []  # late boluses
        self.rescue_grams: dict[int, float] = {}  # step -> grams we added
        self.treat_at: int | None = None
        self.last_treat = -10_000
        self.params = None

    def _load(self, name):
        q = self.quest[self.quest.Name == name].iloc[0]
        p = self.patient_params[self.patient_params.Name == name].iloc[0]
        self.params = (p.u2ss * p.BW / 6000, float(q.CR), float(q.CF))  # basal U/min, CR, CF

    def insulin_on_board(self) -> float:
        span = IOB_MINUTES / self.sample_time
        return sum(u * max(0.0, 1 - (self.step - s) / span) for s, u in self.boluses)

    def _treat_lows(self, cgm: float, now: datetime):
        steps = lambda minutes: max(1, int(round(minutes / self.sample_time)))  # noqa: E731
        if cgm >= 70:
            self.treat_at = None
            return
        if self.treat_at is None and self.step - self.last_treat >= steps(RESCUE_RECHECK_MIN):
            if not self.mistakes:
                delay = 1
            elif now.hour >= 22 or now.hour < 7:
                delay = int(self.rng.integers(steps(10), steps(60) + 1))  # asleep
            else:
                delay = int(self.rng.integers(1, steps(15) + 1))
            self.treat_at = self.step + delay
        if self.treat_at is not None and self.step >= self.treat_at:
            self.scenario.add(now, RESCUE_GRAMS)
            self.rescue_grams[self.step + 1] = RESCUE_GRAMS  # shows up in next step's meal
            self.last_treat = self.step
            self.treat_at = None

    def policy(self, observation, reward, done, **kwargs):
        if self.params is None:
            self._load(kwargs["patient_name"])
        basal_rate, cr, cf = self.params
        st = self.sample_time
        cgm = observation.CGM
        now = kwargs.get("time") or START

        if self.mistakes:
            steps_per_day = int(round(24 * 60 / st))
            if self.step // steps_per_day != self.day:
                self.day = self.step // steps_per_day
                self.basal_factor = self.rng.uniform(*BASAL_DRIFT)

        # Carbs eaten in this step, minus low treatments (nobody boluses for those).
        grams = (kwargs.get("meal") or 0.0) * st - self.rescue_grams.pop(self.step, 0.0)
        units = 0.0
        if grams > 0.5:
            correction = max(0.0, (cgm - TARGET) / cf - self.insulin_on_board()) if cgm > CORRECT_ABOVE else 0.0
            meal_units = grams / cr
            if self.mistakes:
                choice = self.rng.random()
                meal_units *= float(np.exp(self.rng.normal(0, CARB_ERROR_SD)))
                delay = int(self.rng.integers(5, 16))
                if choice < P_MISSED_BOLUS:
                    meal_units, correction = 0.0, 0.0
                elif choice < P_MISSED_BOLUS + P_LATE_BOLUS:
                    self.pending.append((self.step + delay, (meal_units + correction) * self.dose_scale))
                    meal_units, correction = 0.0, 0.0
            units = (meal_units + correction) * self.dose_scale

        units += sum(u for s, u in self.pending if s <= self.step)
        self.pending = [(s, u) for s, u in self.pending if s > self.step]
        if units > 0:
            self.boluses.append((self.step, units))
            self.boluses = [(s, u) for s, u in self.boluses if self.step - s < IOB_MINUTES / st]

        self._treat_lows(cgm, now)
        self.step += 1
        return Action(basal=basal_rate * self.basal_factor * self.dose_scale, bolus=units / st)


def run(name: str, idx: int, days: int, dose_scale: float, mistakes: bool, scenario_seed: int) -> pd.DataFrame:
    sensor = CGMSensor.withName("Dexcom", seed=1000 + idx)
    scenario = TreatableScenario(start_time=START, seed=scenario_seed)
    env = T1DSimEnv(T1DPatient.withName(name), sensor, InsulinPump.withName("Insulet"), scenario)
    ctrl = EverydayController(seed=3000 + idx, sample_time=sensor.sample_time, scenario=scenario,
                              dose_scale=dose_scale, mistakes=mistakes)
    sim = SimObj(env, ctrl, timedelta(days=days), animate=False, path=None)
    sim.simulate()
    return sim.results().reset_index().rename(columns={"Time": "time"})


def titrate(name: str, idx: int) -> tuple[float, list[dict]]:
    """Largest dose scale whose mistake-free day meets the targets for lows.
    Uses different meals (seed) from the recorded days."""
    tried = []
    for scale in DOSE_STEPS:
        bg = run(name, idx, TITRATION_DAYS, scale, mistakes=False, scenario_seed=5000 + idx)["BG"]
        below70, below54 = float((bg < 70).mean()), float((bg < 54).mean())
        tried.append({"scale": scale, "below_70": round(below70, 4), "below_54": round(below54, 4)})
        if below70 <= MAX_BELOW_70 and below54 <= MAX_BELOW_54:
            return scale, tried
    return DOSE_STEPS[-1], tried


def simulate_patient(args) -> tuple[pd.DataFrame, dict]:
    idx, name, days = args
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    scale, tried = titrate(name, idx)
    df = run(name, idx, days, scale, mistakes=True, scenario_seed=2000 + idx)
    out = pd.DataFrame({
        "patient": name,
        "cohort": name.split("#")[0],
        "time": df["time"],
        "cgm": df["CGM"].round(1),
        "bg": df["BG"].round(1),
        "cho_g": df["CHO"].round(2),
        "insulin_u": df["insulin"].round(4),
    })
    return out, {"patient": name, "dose_scale": scale, "tried": tried}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--days", type=int, default=10)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--out", default="data/simulated_cgm.csv.gz")
    ap.add_argument("--titration-out", default="data/titration.json")
    ap.add_argument("--patients", type=int, default=len(PATIENTS), help="limit, for quick tests")
    args = ap.parse_args(argv)

    jobs = [(i, name, args.days) for i, name in enumerate(PATIENTS[: args.patients])]
    t0 = time.time()
    with Pool(args.workers) as pool:
        frames, doses = [], []
        for df, dose in pool.imap(simulate_patient, jobs):
            frames.append(df)
            doses.append(dose)
            print(f"  {dose['patient']}: dose x{dose['dose_scale']}, {len(df)} readings ({time.time() - t0:.0f}s)", flush=True)
    data = pd.concat(frames, ignore_index=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    data.to_csv(out, index=False)
    Path(args.titration_out).write_text(json.dumps(doses, indent=1) + "\n")
    print(f"wrote {len(data):,} readings for {data['patient'].nunique()} patients to {out}")


if __name__ == "__main__":
    main()
