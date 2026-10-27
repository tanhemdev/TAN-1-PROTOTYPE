# TAN-1: User Research

**Researcher:** Tanya Hemdev

## Who I talked to

Interviews with more than 80 people touched by diabetes: pre-teens, college students, parents, caregivers and senior citizens, living with type 1 or type 2 or caring for someone who is. It started with my own family, after my twin sister Tanisha was diagnosed with type 1.

The findings below are the themes that came up again and again. They're written as themes rather than statistics.

## What I heard

### 1. The hardest part isn't the disease, it's feeling alone with it

People described the daily work (the mental math before meals, the 3am lows, changing sensors) as manageable. What wore them down was that even loving family couldn't fully understand it.

**Implication:** TAN-1 is also meant to connect people living with the same condition. v1 starts with Tan-Bot, a place to ask questions at any hour; a peer community is the next step (see the PRD).

### 2. Caregivers check far more often than they need to, and they know it

Parents and partners described opening the CGM follow app constantly, out of fear of missing the one reading that matters.

**Implication:** success means caregivers check *less*. Alerts must be trustworthy enough that "no alert" means "things are fine."

### 3. Numbers and arrows don't mean much to non-medical caregivers

"247" and a diagonal arrow left people unsure whether to worry.

**Implication:** alerts are written in plain English with context ("has been above 250 for 30 minutes"), never just a number.

### 4. Nobody knows who's handling it

In families with more than one caregiver, a bad reading meant everyone panicked at once, or everyone assumed someone else had it.

**Implication:** a one-tap "I'm on it" that everyone sees, and escalation to a second person if nobody answers.

### 5. People with diabetes feel watched

Especially younger people: a parent texting about every high reading felt like surveillance.

**Implication:** the patient can acknowledge an alert themselves ("I've got it"), and caregivers see that instead of a new alarm.

### 6. Overnight lows are the biggest fear

Caregivers set alarms to check during the night. A calm morning summary was something people asked for directly.

**Implication:** a 7am overnight summary, and alerts for lows that fire earlier and escalate faster than alerts for highs.

### 7. Trust is earned slowly and lost instantly

People said they'd keep checking the follow app until the system proved it wouldn't miss a bad low.

**Implication:** recall on lows matters more than precision, and the model's accuracy is shown openly next to simple baselines.

## How this shaped v1

| Theme | What's in the demo |
|---|---|
| Plain English | Alert text and trend words (`web/src/model/features.js`, `alerts.js`) |
| Nobody knows who's handling it | Acknowledge as caregiver or patient; escalation timers |
| Feeling watched | Patient self-acknowledge |
| Overnight fear | 7am overnight summary; lows escalate faster than highs |
| Trust | Low alerts tuned for recall; accuracy table on the demo page |
| Feeling alone | Tan-Bot (`chat/`) |

## Not done yet

- Testing the caregiver demo with families (planned next).
- Research on the peer community: how to match people, and moderation.
