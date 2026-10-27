# TAN-1: Build Log

## Where it started

My twin sister Tanisha's type 1 diagnosis, and more than 80 conversations with people living with diabetes and the people caring for them ([USER_RESEARCH.md](USER_RESEARCH.md)). The concept, PRD and story went up on GitHub in August 2026.

## October 2026: v1 as working code

This repository is the product built for real, with every number reproducible from the code.

### 1. Data I could actually publish

Real CGM data is health data, so v1 runs on the UVA/Padova type 1 simulator (open-source simglucose), vendored with small fixes so it runs on current Python.

**What went wrong first:** with the simulator's stock basal-bolus controller, several virtual patients spent most of their time below 54 mg/dL, and some fell to a glucose of zero and stayed there. A model trained on that would look accurate for the wrong reason: "stays low" is easy to predict.

**Fix:** dose the way people actually do. A pump-style bolus calculator that accounts for insulin on board, 15 g of fast carbs for any low (slower overnight), per-patient titration to the consensus targets for lows, then everyday mistakes on top. The result looks like real life: about 76% of readings in range, under 5% below 70.

### 2. A model, and the right way to score it

- 14 features from the last hour of CGM; gradient-boosted trees forecasting the range 30 minutes ahead.
- Split by patient, never by time: 9 of 30 virtual patients held out completely.
- Two baselines any app could ship without machine learning: "stays the same" and "follow the trend line".

**What I learned:** tier accuracy (87.2%) looked great but hid the real question. On the realistic data, lows are rare, and the model's top answer for an upcoming low was often "in range". So I scored it the way a family would: of the 117 lows in the test data, how many got a warning beforehand, how early, and how many false alarms per day. Then I picked the alert threshold on the training patients only (out-of-fold), aiming to warn about 95% of lows.

**Result:** 96.6% of lows warned about, median 21 minutes ahead, 1.41 false alarms a day, against 94.9%, 30 minutes and 2.66 for the trend line. Fewer false alarms for a little less warning. Details in [METRICS.md](METRICS.md).

### 3. The caregiver experience

- The trees are exported to JSON and run in the browser, with tests proving the browser and Python give the same answer.
- Plain-English alerts with context and no dosing advice, one at a time.
- "I'm on it" for caregivers, "I'm aware" for the person with diabetes, escalation if nobody answers, and a 7am overnight summary, each one traced to a research theme.

### 4. Tan-Bot

A Next.js chat on Claude with safety rules in the system prompt (no doses, 911, 988) and tested input checks.

### 5. Quality

29 automated tests across Python and JavaScript plus a browser test of the demo, CI on every push, and the demo deployed to GitHub Pages automatically.

## Next

1. Validation on real, consented CGM data (required before any pilot).
2. Dexcom partner API and push notifications.
3. The peer community: connecting people living with the same condition.
