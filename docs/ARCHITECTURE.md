# TAN-1: Architecture

TAN-1 v1 has three parts. All of them are in this repo and run without a server of mine.

```
pipeline/  (Python)                        web/  (React, static)                chat/  (Next.js)
┌──────────────────────────────┐          ┌───────────────────────────┐        ┌────────────────────────┐
│ simulate.py  UVA/Padova sim  │          │ features.js  same features │        │ Tan-Bot                │
│   30 virtual patients        │          │ model.js     tree evaluator│        │ /api/chat ──► Claude   │
│ features.py  60-min windows  │  model   │ alerts.js    alert rules,  │        │ safety system prompt,  │
│ train.py     gradient boosting├─.json──►│              ack, escalate │        │ input checks           │
│ export_model.py  trees → JSON│  traces  │ App.jsx      caregiver demo│        └────────────────────────┘
└──────────────────────────────┘          └───────────────────────────┘
```

## 1. Simulated data (`pipeline/simulate.py`)

Real CGM data from people is health data, so v1 is built entirely on simulation. It uses the **UVA/Padova type 1 diabetes simulator** through the open-source [simglucose](https://github.com/jxx123/simglucose) package (MIT), vendored in `pipeline/third_party/` with small fixes (no `gym` dependency, no `pkg_resources`).

| Setting | Value |
|---|---|
| Virtual patients | 30: 10 children, 10 adolescents, 10 adults |
| Length | 10 days each, a CGM reading every 3 minutes (Dexcom sensor model with noise) |
| Meals | Random daily meals and snacks (simglucose's random scenario) |

The simulator's stock controller is too perfect in one way and too dangerous in another, so `EverydayController` replaces it with what families and pumps actually do:

1. **Bolus calculator with insulin on board.** Meal insulin from each patient's carb ratio, plus a correction above 150 mg/dL that subtracts insulin still active (4-hour linear decay). Without this, back-to-back corrections stack, and some virtual patients fall to a glucose of zero and never recover.
2. **Lows get treated.** Below 70 mg/dL, the patient eats 15 g of fast carbs and re-checks after 15 minutes. During the day they notice within minutes; overnight it takes 10 to 60 minutes, which is the gap caregiver alerts are for.
3. **Titration.** Each patient gets the largest dose scale (100%, 85%, 70%, ...) that keeps a mistake-free test day within the consensus targets for lows: under 4% of time below 70 and under 1% below 54 (Battelino et al., *Diabetes Care* 2019). The chosen scale per patient is saved in `data/titration.json`.
4. **Everyday mistakes** on the recorded days: carb counts off by about 25%, 8% of meal boluses missed, 15% given 15 to 45 minutes late, and basal needs drifting up to 15% day to day.

Every random choice is seeded, so `python pipeline/simulate.py` reproduces `data/simulated_cgm.csv.gz` exactly.

## 2. The forecast (`pipeline/features.py`, `train.py`)

**Task:** from the last 60 minutes of CGM (20 readings), predict which range glucose will be in **30 minutes later**.

**Ranges** (the international consensus cut-offs):

| Tier | mg/dL |
|---|---|
| Urgent low | below 54 |
| Low | 54 to 69 |
| In range | 70 to 180 |
| High | 181 to 250 |
| Very high | above 250 |

**Features (14):** current glucose; change over the last 3, 15, 30 and 60 minutes; least-squares slope over 30 minutes; acceleration; mean, standard deviation, minimum and maximum over the hour; a straight-line projection 30 minutes ahead; time of day (as sine and cosine).

**Model:** scikit-learn `HistGradientBoostingClassifier` (250 trees per class, 24 leaves, learning rate 0.06).

**Evaluation:** split by patient, not by time. Patients #008 to #010 of each age group (9 of 30) are held out entirely, so every test window comes from a person the model never saw. The model is compared with two rules an app could use without any machine learning: *assume it stays in the same range*, and *follow the trend line*. Results: [METRICS.md](METRICS.md).

## 3. In the browser (`web/`)

- `export_model.py` writes the fitted trees to JSON (`web/public/model.json`). `model.js` walks the same trees in JavaScript, so the forecast runs on the visitor's device with no server.
- `features.js` recomputes the 14 features in JavaScript.
- **Parity tests** (`web/tests/parity.test.mjs`) check 300 held-out windows: JavaScript features equal Python's to 1e-9, the JavaScript tree evaluator equals scikit-learn to 1e-6, and the predicted range is identical end to end.
- `alerts.js` turns forecasts into caregiver alerts:
  - **urgent low** if glucose is under 54 or the model gives a 40%+ chance of under 54;
  - **low** if glucose is under 70 or there's a 50%+ chance of being under 70;
  - **high** after 30 minutes over 250, or 2 hours over 180;
  - one alert at a time, plain English, never dosing advice;
  - escalation if nobody acknowledges: to a second caregiver after 5 minutes (urgent low), 15 (low) or 30 (high), then a phone call;
  - the person with diabetes can acknowledge their own alert;
  - a 7am overnight summary.
- `useReplay.js` replays two days of a held-out virtual patient, scoring each forecast once its 30 minutes have passed.

## 4. Tan-Bot (`chat/`)

A Next.js app with one API route that streams replies from Claude (`claude-haiku-5-5` by default). The system prompt sets the rules: warm, plain language; no insulin doses or medication changes; emergencies go to 911 and crisis to 988; it's not a substitute for the care team. `lib/validate.js` checks and trims the conversation before it reaches the model (tested). The API key lives only on the server.

## What's not built yet

| Piece | Plan |
|---|---|
| Real CGM data | Dexcom partner API, behind consent |
| Push notifications | Web push or a small mobile app |
| Accounts and family sharing | Needed before any real data |
| Validation on real data | Required before any pilot |
