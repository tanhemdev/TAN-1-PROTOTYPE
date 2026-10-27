// Evaluates the gradient-boosted trees exported by pipeline/export_model.py.
// Mirrors predict_proba_json() there; parity is tested against scikit-learn.

function treeValue(tree, x) {
  let node = 0;
  while (!tree.leaf[node]) {
    const v = x[tree.f[node]];
    const left = Number.isNaN(v) ? tree.m[node] === 1 : v <= tree.t[node];
    node = left ? tree.l[node] : tree.r[node];
  }
  return tree.v[node];
}

export function predictProba(model, x) {
  const raw = model.baseline.slice();
  for (const trees of model.iterations) {
    for (let c = 0; c < trees.length; c++) raw[c] += treeValue(trees[c], x);
  }
  const max = Math.max(...raw);
  const e = raw.map((r) => Math.exp(r - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

export function argmax(a) {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}
