import { useEffect, useMemo, useState } from 'react';
import { Chart, clock } from './Chart.jsx';
import { useReplay, SPEEDS } from './useReplay.js';
import { TIER_NAMES } from './model/features.js';
import { LEVEL_NAMES } from './model/alerts.js';

// The demo patients are simulated, so they get neutral names, never a real person's.
const NAMES = { child: 'Riley', adolescent: 'Sam', adult: 'Jordan' };
const COHORT_LABEL = { child: 'child', adolescent: 'teen', adult: 'adult' };

const pct = (p) => (p == null ? 'none' : `${(p * 100).toFixed(1)}%`);
const pct0 = (p) => `${Math.round(p * 100)}%`;

async function loadJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pi, setPi] = useState(0);

  useEffect(() => {
    Promise.all([loadJson('./model.json'), loadJson('./traces.json'), loadJson('./metrics.json')])
      .then(([model, traces, metrics]) => {
        // Open on the adult: their first alert is an early low warning, the core of the product.
        setPi(Math.max(0, traces.patients.findIndex((p) => p.cohort === 'adult')));
        setData({ model, traces, metrics });
      })
      .catch((e) => setError(e.message));
  }, []);

  const trace = useMemo(() => {
    if (!data) return null;
    const t = data.traces.patients[pi];
    return { ...t, sampleMinutes: data.traces.sampleMinutes };
  }, [data, pi]);
  const name = trace ? NAMES[trace.cohort] : '';
  const replay = useReplay(data?.model, trace, name);

  if (error) return <main className="wrap"><p className="error">Couldn't load the demo data ({error}).</p></main>;
  if (!data || !replay.ready) return <main className="wrap"><p className="muted">Loading the model…</p></main>;

  const s = replay.state;
  const day = Math.floor(s.timeMin / 1440) + 1;
  const m = data.metrics.test;
  const la = data.metrics.low_alerts;
  const active = replay.active;

  return (
    <>
      <main className="wrap">
        <header className="hero">
          <p className="eyebrow">TAN-1 · Caregiver alerts demo</p>
          <h1>See a low coming 30 minutes before it happens</h1>
          <p className="lead">
            Two days of CGM readings from a <b>simulated</b> patient the model never saw in training. Each 3-minute
            reading runs through the same risk model published in this repo, right here in your browser.
          </p>
          <p className="links">
            <a href="#accuracy">How accurate is it?</a>
            <a href="https://github.com/tanhemdev/TAN-1-PROTOTYPE" target="_blank" rel="noopener">Code ↗</a>
          </p>
        </header>

        <div className="controls" role="group" aria-label="Replay controls">
          <label className="patient">
            Patient
            <select value={pi} onChange={(e) => setPi(Number(e.target.value))}>
              {data.traces.patients.map((p, i) => (
                <option key={p.patient} value={i}>{NAMES[p.cohort]} (simulated {COHORT_LABEL[p.cohort]})</option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => replay.setPlaying(!replay.playing)}>
            {replay.playing ? 'Pause' : 'Play'}
          </button>
          <div className="seg" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((sp, i) => (
              <button key={sp.label} role="radio" aria-checked={replay.speed === i} className={replay.speed === i ? 'on' : ''}
                onClick={() => replay.setSpeed(i)}>{sp.label}</button>
            ))}
          </div>
          <button onClick={replay.skipToNextAlert}>Skip to next alert</button>
          <button className="ghost" onClick={replay.reset}>Restart</button>
        </div>

        <div className="grid two">
          <section className={`card now tier-bg-${s.predicted}`}>
            <p className="label">Day {day} · {clock(trace.minuteOfDay[s.i])}</p>
            <p className="reading">{Math.round(s.glucose)}<span>mg/dL</span></p>
            <p className="trend">{name}'s glucose is <b>{s.trend}</b></p>
          </section>

          <section className="card forecast-card">
            <p className="label">In 30 minutes</p>
            <p className={`tier-name tier-${s.predicted}`}>{TIER_NAMES[s.predicted]}</p>
            <ul className="bars" aria-label="Predicted chance of each range in 30 minutes">
              {TIER_NAMES.map((t, k) => (
                <li key={t}>
                  <span className="bar-label">{t}</span>
                  <span className="bar-track"><span className={`bar-fill tier-${k}`} style={{ width: `${s.probs[k] * 100}%` }} /></span>
                  <span className="bar-pct">{pct0(s.probs[k])}</span>
                </li>
              ))}
            </ul>
            <p className="fine">
              Scored as the replay runs: {replay.liveHits.total ? `${replay.liveHits.correct} of ${replay.liveHits.total} 30-minute forecasts right so far` : 'checking each forecast once its 30 minutes pass'}.
            </p>
          </section>

          <section className="card chart-card">
            <Chart trace={trace} state={s} />
            <p className="chart-legend">
              <span><i className="lg-meal" /> meal</span>
              <span><i className="lg-treat" /> low treated with 15 g of fast carbs</span>
              <span>shaded box: the model's 30-minute forecast</span>
            </p>
          </section>

          <section className={`card alert-card ${active ? `alert-${active.kind} alert-${active.status}` : ''}`} aria-live="assertive">
            <p className="label">Caregiver alert</p>
            {active ? (
              <>
                <p className="alert-text">{active.text}</p>
                {active.status === 'open' ? (
                  <>
                    <ol className="escalation">
                      {[1, 2, 3].map((lvl) => (
                        <li key={lvl} className={active.level >= lvl ? 'done' : ''}>{LEVEL_NAMES[lvl]}</li>
                      ))}
                    </ol>
                    <div className="actions">
                      <button className="primary" onClick={() => replay.ack('caregiver')}>I'm on it</button>
                      <button onClick={() => replay.ack('patient')}>{name}: "I'm aware"</button>
                    </div>
                  </>
                ) : (
                  <p className="acked">✓ {active.ackText} Escalation stopped.</p>
                )}
              </>
            ) : (
              <p className="calm">No alerts right now. Nothing to check.</p>
            )}
          </section>

          <section className="card feed-card">
            <p className="label">What the family's phones showed</p>
            {replay.feed.length ? (
              <ul className="feed">
                {replay.feed.map((f) => (
                  <li key={f.id} className={`feed-${f.kind}`}>
                    <span className="when">Day {Math.floor((f.at * trace.sampleMinutes) / 1440) + 1} · {clock(trace.minuteOfDay[f.at])}</span>
                    {f.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing yet. Press Play, or skip to the next alert.</p>
            )}
          </section>
        </div>

        <section className="accuracy" id="accuracy">
          <h2>How accurate is it?</h2>
          <p>
            Measured once, on <b>{data.metrics.data.test_patients.length} simulated patients the model never trained on</b>
            {' '}({data.metrics.data.test_windows.toLocaleString()} forecasts, {la.test.model.patient_days} days of CGM). The model
            predicts which range the reading 30 minutes from now will fall in, from the last hour of CGM data only.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Approach</th><th>Range right, 30 min ahead</th><th>Lows warned about beforehand</th><th>Median warning</th><th>False alarms per day</th></tr>
              </thead>
              <tbody>
                <tr className="ours"><td>TAN-1 model</td><td>{pct(m.model.accuracy)}</td><td>{pct(la.test.model.caught_early)}</td><td>{la.test.model.median_warning_minutes} min</td><td>{la.test.model.false_alarms_per_day}</td></tr>
                <tr><td>Follow the trend line</td><td>{pct(m.baseline_trend_line.accuracy)}</td><td>{pct(la.test.baseline_trend_line.caught_early)}</td><td>{la.test.baseline_trend_line.median_warning_minutes} min</td><td>{la.test.baseline_trend_line.false_alarms_per_day}</td></tr>
                <tr><td>Assume it stays in the same range</td><td>{pct(m.baseline_same_tier.accuracy)}</td><td>none</td><td>none</td><td>none</td></tr>
              </tbody>
            </table>
          </div>
          <p className="fine">
            {la.test.model.low_events} times in the test data, glucose dropped below 70. A low counts as warned about if an alert fired in the 30 minutes before;
            an alert is a false alarm if glucose then stayed at or above 70 for 45 minutes. The alert threshold ({pct0(la.threshold)} chance of a low) was picked on the
            training patients, never on these.
          </p>
          <p className="fine">
            The data is simulated with the UVA/Padova Type 1 diabetes simulator (open-source <a href="https://github.com/jxx123/simglucose" target="_blank" rel="noopener">simglucose</a>),
            with pump-style dosing, treated lows and everyday dosing mistakes added. It is not real patient data, and simulated glucose is smoother than real
            glucose, so expect real-world accuracy to be lower. This is a portfolio prototype, not a medical device. Full
            numbers: <a href="https://github.com/tanhemdev/TAN-1-PROTOTYPE/blob/main/results/metrics.json" target="_blank" rel="noopener">results/metrics.json</a>.
          </p>
        </section>
      </main>

      <footer className="wrap foot">
        Built by <a href="https://tanyahemdev.com" target="_blank" rel="noopener">Tanya Hemdev</a>. Started for my twin sister Tanisha, who has type 1 diabetes.
      </footer>
    </>
  );
}
