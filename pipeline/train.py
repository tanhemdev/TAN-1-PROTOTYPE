"""Train and evaluate TAN-1's 30-minute glucose risk model.

    python pipeline/train.py

Steps:
  1. Load the simulated CGM data (pipeline/simulate.py).
  2. Split by PATIENT, not by row: patients #001-#007 of each age group train
     the model, #008-#010 (9 people it has never seen) are the test set.
     Splitting rows instead would leak a person's own glucose patterns into
     the test set and inflate accuracy.
  3. Compare against two baselines a caregiver app could ship with no ML:
     "it'll stay in the same tier" and "follow the current trend line".
  4. Train a gradient-boosted tree classifier, evaluate once on the test
     patients, and write every number to results/metrics.json.
  5. Evaluate what a family would feel: of the times glucose dropped below
     70, how many got an alert beforehand, how early, and how many alerts
     were false alarms. The alert threshold is chosen on the training
     patients only (out-of-fold), never on the test patients.
  6. Export the model to JSON so the web demo can run it in the browser.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_model import export_hgb  # noqa: E402
from features import FEATURES, HORIZON, SAMPLE_MINUTES, TIERS, build_dataset, tier_of  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "simulated_cgm.csv.gz"
RESULTS = ROOT / "results"
MODEL_OUT = ROOT / "web" / "public" / "model.json"
TRACES_OUT = ROOT / "web" / "public" / "traces.json"
TEST_IDS = {"008", "009", "010"}
SEED = 7


def load():
    df = pd.read_csv(DATA, parse_dates=["time"])
    df["minute_of_day"] = df["time"].dt.hour * 60 + df["time"].dt.minute
    return df


def featurize(df):
    parts = []
    for name, g in df.groupby("patient", sort=True):
        X, y, cur, idx = build_dataset(g["cgm"].to_numpy(), g["minute_of_day"].to_numpy())
        parts.append((name, X, y, cur, idx, g))
    return parts


def stack(parts, keep):
    sel = [p for p in parts if keep(p[0])]
    return (
        np.vstack([p[1] for p in sel]),
        np.concatenate([p[2] for p in sel]),
        np.concatenate([p[3] for p in sel]),
    )


def scores(y_true, y_pred):
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=range(len(TIERS)), zero_division=0)
    low_true = y_true <= 1
    low_pred = y_pred <= 1
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "balanced_accuracy": round(float(balanced_accuracy_score(y_true, y_pred)), 4),
        "macro_f1": round(float(f1_score(y_true, y_pred, average="macro", zero_division=0)), 4),
        # Safety view: is a coming low (either low tier) flagged as some low?
        "low_alert_recall": round(float(low_pred[low_true].mean()), 4) if low_true.any() else None,
        "low_alert_precision": round(float(low_true[low_pred].mean()), 4) if low_pred.any() else None,
        "per_tier": {
            t: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4), "f1": round(float(f[i]), 4), "support": int(s[i])}
            for i, t in enumerate(TIERS)
        },
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=range(len(TIERS))).tolist(),
    }


# Low alerts, judged per event rather than per 3-minute window.
LEAD_STEPS = HORIZON  # an alert counts if it fired in the 30 minutes before glucose went below 70
FOLLOW_STEPS = 15  # an alert is a false alarm if glucose stays at or above 70 for the next 45 minutes
MERGE_STEPS = 10  # alerts or lows less than 30 minutes apart are one event
CATCH_TARGET = 0.95
THRESHOLDS = [round(x, 2) for x in np.arange(0.05, 0.61, 0.05)]


def low_events(cgm, idx, flag):
    """Event counts for one patient. flag[k] = alert at window idx[k]."""
    alert = np.zeros(len(cgm), bool)
    alert[idx] = flag
    seen = np.zeros(len(cgm), bool)
    seen[idx] = True
    low = cgm < 70
    lows, last_low = [], -10_000
    for s in range(1, len(cgm)):
        if low[s] and not low[s - 1] and seen[max(0, s - LEAD_STEPS):s].any():
            if s - last_low > MERGE_STEPS:
                lows.append(s)
        if low[s]:
            last_low = s
    caught, leads = 0, []
    for s in lows:
        before = [t for t in range(max(0, s - LEAD_STEPS), s) if alert[t] and not low[t]]
        if before:
            caught += 1
            leads.append((s - before[0]) * SAMPLE_MINUTES)
    onsets, last = [], -10_000
    for t in np.flatnonzero(alert & ~low):
        if t - last > MERGE_STEPS:
            onsets.append(t)
        last = t
    false = sum(1 for o in onsets if not low[o + 1:o + 1 + FOLLOW_STEPS].any())
    return {"lows": len(lows), "caught": caught, "leads": leads, "alerts": len(onsets), "false": false,
            "days": len(cgm) * SAMPLE_MINUTES / 1440}


def summarize_events(per_patient):
    lows = sum(e["lows"] for e in per_patient)
    caught = sum(e["caught"] for e in per_patient)
    alerts = sum(e["alerts"] for e in per_patient)
    false = sum(e["false"] for e in per_patient)
    days = sum(e["days"] for e in per_patient)
    leads = [x for e in per_patient for x in e["leads"]]
    return {
        "low_events": lows,
        "caught_early": round(caught / lows, 4) if lows else None,
        "median_warning_minutes": float(np.median(leads)) if leads else None,
        "alerts": alerts,
        "false_alarms": false,
        "false_alarms_per_day": round(false / days, 2),
        "alert_precision": round((alerts - false) / alerts, 4) if alerts else None,
        "patient_days": round(days, 1),
    }


def choose_threshold(parts, train_names):
    """Out-of-fold on training patients: the highest threshold that still
    catches CATCH_TARGET of lows early. Test patients are never touched."""
    names = sorted(train_names)
    folds = [names[i::3] for i in range(3)]
    oof = {}
    by_name = {p[0]: p for p in parts}
    for held in folds:
        X, y, _ = stack(parts, lambda n: n in train_names and n not in held)
        model = make_model().fit(X, y)
        for n in held:
            P = model.predict_proba(by_name[n][1])
            oof[n] = P[:, 0] + P[:, 1]
    table = []
    for th in THRESHOLDS:
        ev = summarize_events([low_events(by_name[n][5]["cgm"].to_numpy(), by_name[n][4], oof[n] >= th) for n in names])
        table.append({"threshold": th, **ev})
    ok = [r for r in table if r["caught_early"] is not None and r["caught_early"] >= CATCH_TARGET]
    best = max(ok, key=lambda r: r["threshold"]) if ok else table[0]
    return best["threshold"], table


def make_model():
    return HistGradientBoostingClassifier(
        max_iter=250,
        learning_rate=0.06,
        max_leaf_nodes=24,
        min_samples_leaf=40,
        l2_regularization=1.0,
        early_stopping=False,
        random_state=SEED,
    )


def main():
    df = load()
    parts = featurize(df)
    is_test = lambda name: name.split("#")[1] in TEST_IDS  # noqa: E731
    X_tr, y_tr, _ = stack(parts, lambda n: not is_test(n))
    X_te, y_te, cur_te = stack(parts, is_test)

    # Baselines a caregiver app could use without any model
    persistence = cur_te
    trend = tier_of(X_te[:, FEATURES.index("projected_30")])

    model = make_model().fit(X_tr, y_tr)
    pred = model.predict(X_te)

    train_names = {n for n, *_ in parts if not is_test(n)}
    threshold, cv_table = choose_threshold(parts, train_names)
    proj = FEATURES.index("projected_30")
    model_events, trend_events = [], []
    for name, X, _y, _cur, idx, g in parts:
        if not is_test(name):
            continue
        cgm = g["cgm"].to_numpy()
        P = model.predict_proba(X)
        model_events.append(low_events(cgm, idx, P[:, 0] + P[:, 1] >= threshold))
        trend_events.append(low_events(cgm, idx, X[:, proj] < 70))

    result = {
        "task": f"Predict the CGM risk tier {HORIZON * SAMPLE_MINUTES} minutes ahead from the last 60 minutes of CGM readings",
        "data": {
            "source": "Simulated with the UVA/Padova T1D simulator (simglucose): 30 virtual patients with pump-style dosing titrated to consensus targets, lows treated with 15 g carbs, and everyday dosing mistakes added. Not real patient data.",
            "readings_total": int(len(df)),
            "patients_total": int(df["patient"].nunique()),
            "train_patients": sorted(n for n, *_ in parts if not is_test(n)),
            "test_patients": sorted(n for n, *_ in parts if is_test(n)),
            "train_windows": int(len(y_tr)),
            "test_windows": int(len(y_te)),
            "test_label_distribution": {t: int((y_te == i).sum()) for i, t in enumerate(TIERS)},
        },
        "tiers": TIERS,
        "features": FEATURES,
        "model": {"type": "HistGradientBoostingClassifier", **{k: v for k, v in make_model().get_params().items() if k in ("max_iter", "learning_rate", "max_leaf_nodes", "min_samples_leaf", "l2_regularization")}},
        "test": {
            "model": scores(y_te, pred),
            "baseline_same_tier": scores(y_te, persistence),
            "baseline_trend_line": scores(y_te, trend),
        },
        "low_alerts": {
            "definition": {
                "alert": "the model's chance of glucose below 70 in 30 minutes reaches the threshold (glucose still 70 or above)",
                "low_event": "glucose drops below 70; lows less than 30 minutes apart count once",
                "caught_early": "an alert fired in the 30 minutes before glucose went below 70",
                "false_alarm": "glucose stayed at or above 70 for the 45 minutes after the alert",
            },
            "threshold": threshold,
            "threshold_chosen_on": f"out-of-fold predictions on the {len(train_names)} training patients: the highest threshold catching at least {CATCH_TARGET:.0%} of lows early",
            "threshold_search": cv_table,
            "test": {
                "model": summarize_events(model_events),
                "baseline_trend_line": summarize_events(trend_events),
            },
        },
    }

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "metrics.json").write_text(json.dumps(result, indent=2) + "\n")

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    exported = export_hgb(model, FEATURES, TIERS)
    exported["low_alert_threshold"] = threshold
    MODEL_OUT.write_text(json.dumps(exported, separators=(",", ":")))

    write_demo_traces(parts, is_test)
    write_parity_fixture(model, parts, is_test)
    plot_confusion(result)

    m, b1, b2 = result["test"]["model"], result["test"]["baseline_same_tier"], result["test"]["baseline_trend_line"]
    print(f"test windows: {len(y_te):,} from {len(result['data']['test_patients'])} unseen patients")
    for label, s in [("model", m), ("same tier", b1), ("trend line", b2)]:
        print(f"  {label:<10} accuracy {s['accuracy']:.3f}  macro-F1 {s['macro_f1']:.3f}  low-alert recall {s['low_alert_recall']:.3f}  precision {s['low_alert_precision']:.3f}")
    la = result["low_alerts"]
    print(f"low alerts (threshold {la['threshold']} chosen on training patients):")
    for label, e in [("model", la["test"]["model"]), ("trend line", la["test"]["baseline_trend_line"])]:
        print(f"  {label:<10} caught early {e['caught_early']:.1%} of {e['low_events']} lows, median warning {e['median_warning_minutes']:.0f} min, "
              f"{e['false_alarms_per_day']:.2f} false alarms/day, alert precision {e['alert_precision']:.1%}")


def write_demo_traces(parts, is_test):
    """Two days for three unseen test patients (one per age group) for the web demo."""
    out = []
    for name, *_rest, g in parts:
        if not is_test(name) or not name.endswith("#008"):
            continue
        g = g.iloc[: 2 * 24 * 60 // SAMPLE_MINUTES]
        # cho_g is grams per minute over each step; low treatments are exactly 15 g.
        grams = g["cho_g"].to_numpy() * SAMPLE_MINUTES
        treat = np.isclose(grams, 15.0, atol=0.05)
        out.append({
            "patient": name,
            "cohort": name.split("#")[0],
            "start": g["time"].iloc[0].isoformat(),
            "minuteOfDay": g["minute_of_day"].tolist(),
            "cgm": g["cgm"].round(1).tolist(),
            "meals": [int(i) for i in np.flatnonzero((grams > 0) & ~treat)],
            "treatments": [int(i) for i in np.flatnonzero(treat)],
        })
    TRACES_OUT.write_text(json.dumps({"sampleMinutes": SAMPLE_MINUTES, "patients": out}, separators=(",", ":")))


def write_parity_fixture(model, parts, is_test, n=300):
    """Windows + Python features + scikit-learn probabilities, for the JS parity test."""
    from features import WINDOW, window_features

    rng = np.random.default_rng(SEED)
    cases = []
    tests = [p for p in parts if is_test(p[0])]
    for _ in range(n):
        name, X, y, cur, idx, g = tests[rng.integers(len(tests))]
        k = int(rng.integers(len(idx)))
        t = int(idx[k])
        window = g["cgm"].to_numpy()[t - WINDOW : t + 1]
        mod = float(g["minute_of_day"].to_numpy()[t])
        feats = window_features(window, mod)
        assert np.allclose(feats, X[k])
        cases.append({"window": window.tolist(), "minuteOfDay": mod, "features": feats,
                      "proba": model.predict_proba(np.asarray([feats]))[0].tolist()})
    out = ROOT / "web" / "tests" / "fixtures" / "parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"cases": cases}))


def plot_confusion(result):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cm = np.array(result["test"]["model"]["confusion_matrix"], dtype=float)
    norm = cm / cm.sum(axis=1, keepdims=True).clip(min=1)
    fig, ax = plt.subplots(figsize=(6.2, 5.2), dpi=150)
    ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    names = ["urgent low", "low", "in range", "high", "very high"]
    ax.set_xticks(range(5), names, rotation=30, ha="right")
    ax.set_yticks(range(5), names)
    ax.set_xlabel("Predicted tier in 30 min")
    ax.set_ylabel("Actual tier in 30 min")
    for i in range(5):
        for j in range(5):
            ax.text(j, i, f"{norm[i, j]:.0%}\n({int(cm[i, j])})", ha="center", va="center",
                    fontsize=7, color="white" if norm[i, j] > 0.55 else "#1b1f24")
    ax.set_title("TAN-1 risk model on 9 unseen simulated patients\n(row-normalized)", fontsize=10)
    fig.tight_layout()
    fig.savefig(RESULTS / "confusion_matrix.png")


if __name__ == "__main__":
    main()
