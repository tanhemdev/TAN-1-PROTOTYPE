// Caregiver alert logic: when to alert, what to say, and the
// acknowledge / escalate loop. Pure functions over plain objects, so every
// rule is unit-tested (web/tests/alerts.test.mjs).
//
// Wording rules: plain English, no numbers without context, and no dosing
// advice. The app tells a caregiver *that* something needs attention; what
// to do stays with the family's care plan.

import { tierOf } from './features.js';

// Minutes an alert can go unacknowledged before it escalates:
// level 1 primary caregiver -> level 2 second caregiver -> level 3 phone call
export const ESCALATION_MINUTES = {
  urgent_low: [5, 10],
  low: [15, 30],
  high: [30, 60],
};

export const LEVEL_NAMES = ['', 'Primary caregiver notified', 'Second caregiver notified', 'Phone call to primary caregiver'];

// lowThreshold: the chance of going below 70 within 30 minutes that triggers a
// low alert. train.py picks it on the training patients (the highest value
// that still caught 95% of lows early) and ships it in model.json.
export const DEFAULT_LOW_THRESHOLD = 0.5;

export function createAlertState(name = 'They', { lowThreshold = DEFAULT_LOW_THRESHOLD } = {}) {
  return { name, lowThreshold, active: null, history: [], aboveSince180: null, aboveSince250: null, nextId: 1 };
}

function pct(p) {
  return `${Math.round(p * 100)}%`;
}

function hours(min) {
  const h = min / 60;
  return h >= 1.5 ? `${Math.round(h * 2) / 2} hours` : `${Math.round(min)} minutes`;
}

function decide(state, r) {
  const pUrgent = r.probs[0];
  const pLow = r.probs[0] + r.probs[1];
  if (r.glucose < 54 || pUrgent >= 0.4) {
    return {
      kind: 'urgent_low',
      text: `Urgent: ${state.name}'s glucose is ${Math.round(r.glucose)} and ${r.trend}. It may go below 54 soon. Check on them now.`,
    };
  }
  if (r.glucose < 70) {
    return { kind: 'low', text: `${state.name}'s glucose is low (${Math.round(r.glucose)}) and ${r.trend}. Worth checking in.` };
  }
  if (pLow >= state.lowThreshold) {
    return {
      kind: 'low',
      text: `${state.name}'s glucose is ${Math.round(r.glucose)} and ${r.trend}. It could go low in the next 30 minutes (${pct(pLow)} chance). Worth checking in.`,
    };
  }
  const over250 = state.aboveSince250 === null ? 0 : r.timeMin - state.aboveSince250;
  const over180 = state.aboveSince180 === null ? 0 : r.timeMin - state.aboveSince180;
  if (over250 >= 30) {
    return { kind: 'high', text: `${state.name}'s glucose has been over 250 for ${hours(over250)} (now ${Math.round(r.glucose)}). This might need attention.` };
  }
  if (over180 >= 120) {
    return { kind: 'high', text: `${state.name}'s glucose has been high for ${hours(over180)} (now ${Math.round(r.glucose)}). This might need attention.` };
  }
  return null;
}

function open(state, want, timeMin) {
  const alert = {
    id: state.nextId++,
    kind: want.kind,
    text: want.text,
    at: timeMin,
    level: 1,
    status: 'open',
    ackBy: null,
  };
  state.active = alert;
  return alert;
}

// r: { timeMin, glucose, trend, probs }  (probs = 5 tier probabilities)
// Returns a list of events that happened on this reading.
export function updateAlerts(state, r) {
  const events = [];
  state.aboveSince180 = r.glucose > 180 ? state.aboveSince180 ?? r.timeMin : null;
  state.aboveSince250 = r.glucose > 250 ? state.aboveSince250 ?? r.timeMin : null;

  const want = decide(state, r);
  const a = state.active;

  if (a) {
    // A high settles once glucose is back in range and likely to stay there. A
    // low settles once the chance of a low has dropped well below the alert
    // threshold (the margin stops an alert flapping on and off).
    const pLowNow = r.probs[0] + r.probs[1];
    const settled =
      tierOf(r.glucose) === 2 && (a.kind === 'high' ? r.probs[2] >= 0.5 : pLowNow < 0.75 * state.lowThreshold);
    if (settled || (a.kind !== 'high' && want?.kind === 'high')) {
      a.status = 'resolved';
      a.resolvedAt = r.timeMin;
      a.resolvedText = `Back in range (${Math.round(r.glucose)}).`;
      state.history.push(a);
      state.active = null;
      events.push({ type: 'resolved', alert: a });
    } else if (a.kind === 'low' && want?.kind === 'urgent_low') {
      // Upgrade: a low that turns urgent restarts the clock at the faster schedule.
      a.kind = 'urgent_low';
      a.text = want.text;
      a.at = r.timeMin;
      a.level = 1;
      if (a.status === 'acknowledged') a.status = 'open';
      events.push({ type: 'upgraded', alert: a });
      return events;
    } else {
      if (a.status === 'open') {
        const [toSecond, toCall] = ESCALATION_MINUTES[a.kind];
        const waited = r.timeMin - a.at;
        const level = waited >= toCall ? 3 : waited >= toSecond ? 2 : 1;
        if (level > a.level) {
          a.level = level;
          events.push({ type: 'escalated', alert: a, level });
        }
      }
      return events;
    }
  }

  if (want) {
    const alert = open(state, want, r.timeMin);
    events.push({ type: 'new', alert });
  }
  return events;
}

// who: 'caregiver' ("I'm on it") or 'patient' (the person with diabetes says "I'm aware").
export function acknowledge(state, who, timeMin) {
  const a = state.active;
  if (!a || a.status !== 'open') return null;
  a.status = 'acknowledged';
  a.ackBy = who;
  a.ackAt = timeMin;
  a.ackText = who === 'patient' ? `${state.name} is aware and handling it.` : 'A caregiver is on it.';
  return { type: 'acknowledged', alert: a };
}

// The 7am message: how the night went, in one calm sentence.
export function overnightSummary(name, nightReadings, nightAlerts) {
  if (!nightReadings.length) return null;
  const low = Math.min(...nightReadings);
  const high = Math.max(...nightReadings);
  const inRange = nightReadings.filter((g) => g >= 70 && g <= 180).length / nightReadings.length;
  if (nightAlerts === 0 && low >= 70 && high <= 180) {
    return `Good morning. ${name}'s night was quiet: glucose stayed in range (${Math.round(low)} to ${Math.round(high)}).`;
  }
  const parts = [`${pct(inRange)} of the night in range`, `lowest ${Math.round(low)}`, `highest ${Math.round(high)}`];
  const alerts = nightAlerts === 1 ? '1 alert' : `${nightAlerts} alerts`;
  return `Good morning. ${name}'s night: ${parts.join(', ')}, ${alerts}.`;
}
