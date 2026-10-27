// The same 14 features as pipeline/features.py, computed in the browser.
// tests/parity.test.mjs checks they match Python to 1e-9 on real windows.

export const SAMPLE_MINUTES = 3;
export const WINDOW = 20; // readings of history before "now": 60 minutes
export const HORIZON = 10; // readings ahead: 30 minutes

export const TIERS = ['urgent_low', 'low', 'in_range', 'high', 'very_high'];
export const TIER_NAMES = ['Urgent low', 'Low', 'In range', 'High', 'Very high'];

// Consensus cut-offs (Battelino et al., Diabetes Care 2019), mg/dL.
export function tierOf(g) {
  if (g < 54) return 0;
  if (g < 70) return 1;
  if (g <= 180) return 2;
  if (g <= 250) return 3;
  return 4;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// Least-squares slope in mg/dL per minute for readings 3 minutes apart.
export function slope(values) {
  const n = values.length;
  const x = values.map((_, i) => i * SAMPLE_MINUTES);
  const xm = mean(x);
  const ym = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - xm) * (values[i] - ym);
    den += (x[i] - xm) ** 2;
  }
  return num / den;
}

// window: the readings from 60 minutes ago up to and including now (21).
export function windowFeatures(window, minuteOfDay) {
  if (window.length !== WINDOW + 1) throw new Error(`need ${WINDOW + 1} readings, got ${window.length}`);
  const w = window;
  const n = w.length;
  const g = w[n - 1];
  const slope30 = slope(w.slice(-11));
  const slopePrev = slope(w.slice(-16, -5));
  const m = mean(w);
  const std = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / n);
  const angle = (2 * Math.PI * (minuteOfDay % 1440)) / 1440;
  return [
    g,
    g - w[n - 2],
    g - w[n - 6],
    g - w[n - 11],
    g - w[0],
    slope30,
    slope30 - slopePrev,
    m,
    std,
    Math.min(...w),
    Math.max(...w),
    g + slope30 * HORIZON * SAMPLE_MINUTES,
    Math.sin(angle),
    Math.cos(angle),
  ];
}

// Plain-English trend for alert text, from the 30-minute slope (mg/dL per minute).
export function trendWords(perMinute) {
  if (perMinute <= -2) return 'falling fast';
  if (perMinute <= -1) return 'falling';
  if (perMinute <= -0.5) return 'falling slowly';
  if (perMinute < 0.5) return 'steady';
  if (perMinute < 1) return 'rising slowly';
  if (perMinute < 2) return 'rising';
  return 'rising fast';
}
