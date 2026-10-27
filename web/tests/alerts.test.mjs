import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlertState, updateAlerts, acknowledge, overnightSummary, ESCALATION_MINUTES } from '../src/model/alerts.js';
import { trendWords, tierOf, slope } from '../src/model/features.js';

const P = {
  inRange: [0, 0.02, 0.96, 0.02, 0],
  lowLikely: [0.05, 0.6, 0.35, 0, 0],
  urgent: [0.55, 0.35, 0.1, 0, 0],
};
const read = (timeMin, glucose, probs = P.inRange, trend = 'steady') => ({ timeMin, glucose, probs, trend });

test('a predicted low raises one plain-English alert, not one per reading', () => {
  const s = createAlertState('Riley');
  const e1 = updateAlerts(s, read(0, 95, P.lowLikely, 'falling'));
  assert.equal(e1[0].type, 'new');
  assert.equal(s.active.kind, 'low');
  assert.match(s.active.text, /Riley's glucose is 95 and falling\. It could go low in the next 30 minutes \(65% chance\)/);
  const e2 = updateAlerts(s, read(3, 92, P.lowLikely, 'falling'));
  assert.deepEqual(e2, []);
});

test('the low-alert threshold comes from training, not a fixed 50%', () => {
  const maybe = [0.02, 0.2, 0.78, 0, 0]; // 22% chance of a low
  const strict = createAlertState('Riley');
  assert.deepEqual(updateAlerts(strict, read(0, 104, maybe)), []);
  const tuned = createAlertState('Riley', { lowThreshold: 0.2 });
  assert.equal(updateAlerts(tuned, read(0, 104, maybe))[0].alert.kind, 'low');
  // ...and it doesn't flap off on the next reading while the risk is still there.
  assert.deepEqual(updateAlerts(tuned, read(3, 103, maybe)), []);
  assert.equal(tuned.active.status, 'open');
});

test('unacknowledged alerts escalate on schedule, urgent lows faster', () => {
  const s = createAlertState();
  updateAlerts(s, read(0, 95, P.lowLikely));
  const [first, second] = ESCALATION_MINUTES.low;
  assert.equal(updateAlerts(s, read(first - 3, 90, P.lowLikely)).length, 0);
  assert.equal(updateAlerts(s, read(first, 88, P.lowLikely))[0].type, 'escalated');
  assert.equal(s.active.level, 2);
  updateAlerts(s, read(second, 85, P.lowLikely));
  assert.equal(s.active.level, 3);

  const u = createAlertState();
  updateAlerts(u, read(0, 75, P.urgent));
  assert.equal(u.active.kind, 'urgent_low');
  updateAlerts(u, read(ESCALATION_MINUTES.urgent_low[0], 70, P.urgent));
  assert.equal(u.active.level, 2);
  assert.ok(ESCALATION_MINUTES.urgent_low[0] < ESCALATION_MINUTES.low[0]);
  assert.ok(ESCALATION_MINUTES.low[0] < ESCALATION_MINUTES.high[0]);
});

test('"I\'m on it" stops escalation and tells everyone', () => {
  const s = createAlertState('Riley');
  updateAlerts(s, read(0, 95, P.lowLikely));
  const ev = acknowledge(s, 'caregiver', 3);
  assert.equal(ev.type, 'acknowledged');
  assert.equal(s.active.ackText, 'A caregiver is on it.');
  assert.deepEqual(updateAlerts(s, read(60, 90, P.lowLikely)), []);
  assert.equal(s.active.level, 1);
});

test('the person with diabetes can acknowledge their own alert', () => {
  const s = createAlertState('Sam');
  updateAlerts(s, read(0, 95, P.lowLikely));
  acknowledge(s, 'patient', 2);
  assert.equal(s.active.ackBy, 'patient');
  assert.equal(s.active.ackText, 'Sam is aware and handling it.');
});

test('a low that turns urgent is upgraded and re-opened', () => {
  const s = createAlertState('Riley');
  updateAlerts(s, read(0, 95, P.lowLikely));
  acknowledge(s, 'caregiver', 3);
  const ev = updateAlerts(s, read(6, 60, P.urgent, 'falling fast'));
  assert.equal(ev[0].type, 'upgraded');
  assert.equal(s.active.kind, 'urgent_low');
  assert.equal(s.active.status, 'open');
  assert.match(s.active.text, /^Urgent: Riley's glucose is 60 and falling fast/);
});

test('highs alert only after 30 minutes over 250 or 2 hours over 180', () => {
  const s = createAlertState('Riley');
  for (let t = 0; t < 30; t += 3) assert.deepEqual(updateAlerts(s, read(t, 260)), []);
  assert.equal(updateAlerts(s, read(30, 262))[0].alert.kind, 'high');
  assert.match(s.active.text, /over 250 for 30 minutes \(now 262\)\. This might need attention\./);

  const h = createAlertState('Riley');
  for (let t = 0; t < 120; t += 3) assert.deepEqual(updateAlerts(h, read(t, 200)), []);
  assert.match(updateAlerts(h, read(120, 205))[0].alert.text, /has been high for 2 hours/);
});

test('alerts resolve when glucose is back in range, and never give dosing advice', () => {
  const s = createAlertState('Riley');
  updateAlerts(s, read(0, 95, P.lowLikely));
  const ev = updateAlerts(s, read(30, 110, P.inRange));
  assert.equal(ev[0].type, 'resolved');
  assert.equal(s.active, null);
  assert.equal(s.history[0].resolvedText, 'Back in range (110).');
  for (const a of s.history) assert.doesNotMatch(a.text, /\bunits?\b|insulin|carbs|glucagon|take \d/i);
});

test('overnight summary, trend words and ranges', () => {
  assert.equal(overnightSummary('Riley', [100, 120, 140], 0), "Good morning. Riley's night was quiet: glucose stayed in range (100 to 140).");
  assert.equal(overnightSummary('Riley', [65, 100, 190, 120], 2), "Good morning. Riley's night: 50% of the night in range, lowest 65, highest 190, 2 alerts.");
  assert.equal(overnightSummary('Riley', [], 0), null);
  assert.equal(trendWords(slope([120, 117, 114, 111, 108, 105, 102, 99, 96, 93, 90])), 'falling'); // -1 mg/dL per minute
  assert.equal(trendWords(0.1), 'steady');
  assert.equal(trendWords(2.5), 'rising fast');
  assert.deepEqual([53.9, 54, 69.9, 70, 180, 180.1, 250, 250.1].map(tierOf), [0, 1, 1, 2, 2, 3, 3, 4]);
});
