import { HORIZON, TIER_NAMES } from './model/features.js';

const W = 800;
const H = 260;
const PAD = { l: 44, r: 100, t: 12, b: 26 };
const Y_MIN = 40;
const Y_MAX = 400;
const HISTORY = 120; // 6 hours of 3-minute readings

// Background bands for the five ranges (consensus cut-offs).
const BANDS = [
  { cls: 'band-urgent', from: Y_MIN, to: 54, label: '54' },
  { cls: 'band-low', from: 54, to: 70, label: '70' },
  { cls: 'band-range', from: 70, to: 180, label: '180' },
  { cls: 'band-high', from: 180, to: 250, label: '250' },
  { cls: 'band-vhigh', from: 250, to: Y_MAX, label: null },
];
const TIER_CENTER = [47, 62, 125, 215, 300];

const y = (g) => PAD.t + (1 - (Math.min(Y_MAX, Math.max(Y_MIN, g)) - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD.t - PAD.b);

function clock(minuteOfDay) {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

export function Chart({ trace, state }) {
  const end = state.i;
  const start = Math.max(0, end - HISTORY);
  const span = HISTORY + HORIZON;
  const x = (i) => PAD.l + ((i - (end - HISTORY)) / span) * (W - PAD.l - PAD.r);
  const pts = [];
  for (let i = start; i <= end; i++) pts.push(`${x(i).toFixed(1)},${y(trace.cgm[i]).toFixed(1)}`);
  const fx = x(end + HORIZON);
  const ticks = [];
  for (let i = start; i <= end; i++) if (trace.minuteOfDay[i] % 120 === 0) ticks.push(i);
  const meals = trace.meals.filter((m) => m >= start && m <= end);
  const treats = (trace.treatments ?? []).filter((m) => m >= start && m <= end);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Glucose over the last 6 hours, now ${Math.round(state.glucose)} mg/dL, predicted ${TIER_NAMES[state.predicted]} in 30 minutes`}>
      {BANDS.map((b) => (
        <rect key={b.cls} className={b.cls} x={PAD.l} width={W - PAD.l - PAD.r} y={y(b.to)} height={y(b.from) - y(b.to)} />
      ))}
      {BANDS.filter((b) => b.label).map((b) => (
        <text key={`t${b.cls}`} className="axis" x={PAD.l - 6} y={y(b.to) + 4} textAnchor="end">{b.label}</text>
      ))}
      {ticks.map((i) => (
        <text key={`x${i}`} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{clock(trace.minuteOfDay[i])}</text>
      ))}
      {meals.map((m) => (
        <g key={`m${m}`} transform={`translate(${x(m)},${H - PAD.b - 4})`}>
          <title>Meal</title>
          <circle r="4" className="meal" />
        </g>
      ))}
      {treats.map((m) => (
        <g key={`t${m}`} transform={`translate(${x(m)},${H - PAD.b - 4})`}>
          <title>Low treated with 15 g of fast carbs</title>
          <path d="M0 -5 L4.5 3 L-4.5 3 Z" className="treat" />
        </g>
      ))}
      <line className="now-line" x1={x(end)} x2={x(end)} y1={PAD.t} y2={H - PAD.b} />
      <rect className={`forecast tier-${state.predicted}`} x={x(end)} width={fx - x(end)} y={PAD.t} height={H - PAD.t - PAD.b} />
      <polyline className="trace" points={pts.join(' ')} />
      <circle className="now-dot" cx={x(end)} cy={y(state.glucose)} r="5" />
      <circle className={`forecast-dot tier-${state.predicted}`} cx={fx} cy={y(TIER_CENTER[state.predicted])} r="7" />
      <text className="forecast-label" x={fx + 10} y={y(TIER_CENTER[state.predicted]) + 4}>{TIER_NAMES[state.predicted]}</text>
      <text className="axis" x={(x(end) + fx) / 2} y={PAD.t + 12} textAnchor="middle">+30 min</text>
    </svg>
  );
}

export { clock };
