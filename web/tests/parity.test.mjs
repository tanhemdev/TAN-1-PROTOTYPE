// The browser must compute the same features and probabilities as the
// Python pipeline that produced the published metrics. The fixture holds
// 300 real windows from the held-out test patients, written by train.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { windowFeatures } from '../src/model/features.js';
import { predictProba, argmax } from '../src/model/model.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/parity.json', import.meta.url)));
const model = JSON.parse(readFileSync(new URL('../public/model.json', import.meta.url)));

test('features match Python on every fixture window', () => {
  for (const c of fixture.cases) {
    const f = windowFeatures(c.window, c.minuteOfDay);
    f.forEach((v, k) => assert.ok(Math.abs(v - c.features[k]) < 1e-9, `feature ${k}: ${v} vs ${c.features[k]}`));
  }
});

test('the JS tree evaluator matches scikit-learn to 1e-6 on the same features', () => {
  let worst = 0;
  for (const c of fixture.cases) {
    const p = predictProba(model, c.features);
    p.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - c.proba[k])); });
  }
  assert.ok(worst < 1e-6, `max probability difference ${worst}`);
});

// End to end (JS features, then JS trees), the tier must be identical. The
// probabilities can differ slightly when a feature lands exactly on a split
// threshold, where a 1e-12 floating-point difference picks the other branch.
test('end to end in the browser, every predicted tier matches Python', () => {
  let worst = 0;
  for (const c of fixture.cases) {
    const p = predictProba(model, windowFeatures(c.window, c.minuteOfDay));
    assert.equal(argmax(p), argmax(c.proba));
    p.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - c.proba[k])); });
  }
  assert.ok(worst < 0.05, `max probability difference ${worst}`);
});
