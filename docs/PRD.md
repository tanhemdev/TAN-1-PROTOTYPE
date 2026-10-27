# TAN-1: Product Requirements

**Author:** Tanya Hemdev
**Status:** v1 prototype (October 2026): working caregiver demo on simulated data, Tan-Bot chat, open model pipeline. Not a medical device.

## Problem

A continuous glucose monitor (CGM) produces a reading every few minutes, hundreds a day. Follow apps show caregivers the number and a trend arrow. They don't say whether it matters, they don't tell the family who's handling it, and they don't help the person living with diabetes feel less alone.

The gap: **nothing turns raw glucose data into plain-English, early warnings and closes the loop between the person with diabetes and the people who care for them.**

## Users

| | Who | Needs |
|---|---|---|
| Primary | Caregivers without medical training: parents, partners, adult children | Know when it actually matters; stop checking when it doesn't; know who's handling it |
| Primary | People living with diabetes who use a CGM | Fewer, better alerts; control over who's told what, and when |
| Secondary | Parents of young children with type 1 | Overnight peace of mind |

**Not for now:** clinical teams, people without a CGM (no continuous data), insulin dosing.

### Personas

- **The worried parent.** Checks the follow app many times a day and sets a 2am alarm. Needs: confidence that silence means things are fine, and a calm morning summary.
- **The college student with type 1.** Silences alerts in class and dreads the "your sugar is 210" texts. Needs: alerts only when something needs attention, and a way to say "I've got it."
- **The long-distance daughter.** Her dad manages alone. Needs: escalation if no one nearby responds, and a record of who acknowledged what.

## v1 scope

| Priority | Feature | Status |
|---|---|---|
| P0 | Predict the glucose range 30 minutes ahead from the last hour of CGM | Built: `pipeline/`, runs in the browser (`web/src/model/`) |
| P0 | Plain-English alerts with context, no dosing advice | Built: `web/src/model/alerts.js` |
| P0 | One-tap acknowledge, visible to everyone | Built (demo) |
| P0 | Escalation when nobody acknowledges: after 5 minutes for an urgent low, 15 for a low, 30 for a high | Built (demo) |
| P0 | Patient self-acknowledge | Built (demo) |
| P1 | 7am overnight summary | Built (demo) |
| P1 | Tan-Bot: questions answered any time, with safety rules (no doses, emergencies to 911, crisis to 988) | Built: `chat/` |
| P1 | Accuracy shown openly next to simple baselines | Built (demo page and [METRICS.md](METRICS.md)) |
| P2 | Real CGM connection (Dexcom partner API) | Next |
| P2 | Push notifications to caregivers' phones | Next |
| P2 | Peer community: connect people living with the same condition | Next |
| P3 | Validation on real, consented CGM data | Before any real-world use |

## Success metrics

Measured today, on simulated data (details in [METRICS.md](METRICS.md)): tier accuracy, macro-F1, and recall and precision of low alerts on virtual patients the model never trained on, compared with two baselines.

To measure in a pilot with families (targets, not results):

| Metric | Target | Why |
|---|---|---|
| Recall of lows (below 70) 30 minutes ahead | 90%+ | Missing a low breaks trust instantly |
| False low alerts | Under 1 in 5 | Alert fatigue is why people mute apps |
| Median time to acknowledge | Under 10 minutes | Are alerts reaching someone? |
| Caregiver follow-app checks per day | Going down | Success is checking less |
| Caregiver-reported worry (short weekly survey) | Going down | The real outcome |

## Out of scope

- **Medical advice and dosing.** Alerts say something might need attention, never what to take. Tan-Bot refuses dose questions and points to the care team.
- **Diagnosis.** The model forecasts a glucose range; it doesn't diagnose anything.

## Risks

| Risk | Mitigation |
|---|---|
| Model trained on simulated data behaves differently on real data | Simulated data is labeled everywhere; real-world use requires validation on consented data first |
| Missed low | Low alerts fire on a 40 to 50% predicted chance (not only when "low" is the model's top pick), and on any reading under 70 |
| Alert fatigue | One active alert at a time; highs only after 30 minutes over 250 or 2 hours over 180 |
| Feeling surveilled | Patient self-acknowledge; caregivers see "they've got it" |
| Chatbot gives unsafe advice | System prompt rules (no doses, 911, 988), message limits, and tests on the input checks |

## Open questions

1. Should the patient be able to pause caregiver alerts for a window (class, a date)? Leaning yes, except for urgent lows.
2. Is 15 minutes the right first escalation for a predicted low, or should overnight be faster?
3. What's the minimum real-data validation before a family pilot?
