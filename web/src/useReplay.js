// Replays a simulated patient's CGM trace through the model and the alert
// rules, one 3-minute reading at a time, the way a caregiver's phone would
// see it. State lives in a ref and React re-renders on a counter, so the
// replay can jump ahead (skip to the next alert) without side effects
// inside state updaters.

import { useCallback, useEffect, useRef, useState } from 'react';
import { WINDOW, HORIZON, windowFeatures, slope, trendWords, tierOf } from './model/features.js';
import { predictProba, argmax } from './model/model.js';
import { createAlertState, updateAlerts, acknowledge, overnightSummary, LEVEL_NAMES } from './model/alerts.js';

export const SPEEDS = [
  { label: 'Slow', ms: 700 },
  { label: 'Normal', ms: 260 },
  { label: 'Fast', ms: 60 },
];

const NIGHT_START = 22 * 60; // 10pm
const MORNING = 7 * 60; // 7am summary

function evaluate(model, trace, i) {
  const w = trace.cgm.slice(i - WINDOW, i + 1);
  const probs = predictProba(model, windowFeatures(w, trace.minuteOfDay[i]));
  return {
    i,
    timeMin: i * trace.sampleMinutes,
    glucose: trace.cgm[i],
    trend: trendWords(slope(w.slice(-11))),
    probs,
    predicted: argmax(probs),
    actual: i + HORIZON < trace.cgm.length ? tierOf(trace.cgm[i + HORIZON]) : null,
  };
}

function freshReplay(model, trace, name) {
  return {
    cur: evaluate(model, trace, WINDOW),
    alerts: createAlertState(name, { lowThreshold: model.low_alert_threshold }),
    feed: [],
    night: [],
    nightAlerts: 0,
    log: [], // every reading's prediction, for the live hit-rate counter
  };
}

const isNight = (minute) => minute >= NIGHT_START || minute < MORNING;

// One reading forward. Returns the alert events it produced.
function advance(r, model, trace) {
  if (r.cur.i + 1 >= trace.cgm.length) return [];
  const cur = evaluate(model, trace, r.cur.i + 1);
  r.cur = cur;
  r.log.push({ i: cur.i, predicted: cur.predicted });
  const minute = trace.minuteOfDay[cur.i];

  const events = updateAlerts(r.alerts, cur);
  for (const e of events) {
    const text =
      e.type === 'resolved' ? e.alert.resolvedText : e.type === 'escalated' ? `Escalated: ${LEVEL_NAMES[e.level]}` : e.alert.text;
    r.feed.unshift({ id: `${e.alert.id}-${e.type}-${cur.i}`, at: cur.i, kind: e.type === 'resolved' ? 'ok' : e.alert.kind, text });
    if ((e.type === 'new' || e.type === 'upgraded') && isNight(minute)) r.nightAlerts += 1;
  }

  if (isNight(minute)) r.night.push(cur.glucose);
  if (minute === MORNING && r.night.length) {
    const text = overnightSummary(r.alerts.name, r.night, r.nightAlerts);
    r.feed.unshift({ id: `summary-${cur.i}`, at: cur.i, kind: 'summary', text });
    r.night = [];
    r.nightAlerts = 0;
  }
  r.feed = r.feed.slice(0, 40);
  return events;
}

function hits(r, trace) {
  let correct = 0;
  let total = 0;
  for (const p of r.log) {
    const target = p.i + HORIZON;
    if (target > r.cur.i) break;
    total += 1;
    if (p.predicted === tierOf(trace.cgm[target])) correct += 1;
  }
  return { correct, total };
}

export function useReplay(model, trace, name) {
  const ref = useRef(null);
  const [, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!model || !trace) return;
    ref.current = freshReplay(model, trace, name);
    setPlaying(false);
    rerender();
  }, [model, trace, name, rerender]);

  useEffect(() => {
    if (!playing || !model || !trace) return undefined;
    const id = setInterval(() => {
      const r = ref.current;
      if (!r || r.cur.i + 1 >= trace.cgm.length) {
        setPlaying(false);
        return;
      }
      advance(r, model, trace);
      rerender();
    }, SPEEDS[speed].ms);
    return () => clearInterval(id);
  }, [playing, speed, model, trace, rerender]);

  const skipToNextAlert = useCallback(() => {
    const r = ref.current;
    if (!r) return;
    while (r.cur.i + 1 < trace.cgm.length) {
      const events = advance(r, model, trace);
      if (events.some((e) => e.type === 'new' || e.type === 'upgraded')) break;
    }
    setPlaying(false);
    rerender();
  }, [model, trace, rerender]);

  const reset = useCallback(() => {
    ref.current = freshReplay(model, trace, name);
    setPlaying(false);
    rerender();
  }, [model, trace, name, rerender]);

  const ack = useCallback(
    (who) => {
      const r = ref.current;
      const e = r && acknowledge(r.alerts, who, r.cur.timeMin);
      if (e) r.feed.unshift({ id: `${e.alert.id}-ack`, at: r.cur.i, kind: 'ack', text: e.alert.ackText });
      rerender();
    },
    [rerender],
  );

  const r = ref.current;
  return {
    ready: Boolean(r),
    state: r?.cur,
    active: r?.alerts.active ?? null,
    feed: r?.feed ?? [],
    liveHits: r ? hits(r, trace) : { correct: 0, total: 0 },
    playing,
    setPlaying,
    speed,
    setSpeed,
    skipToNextAlert,
    reset,
    ack,
  };
}
