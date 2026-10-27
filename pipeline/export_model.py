"""Export a scikit-learn HistGradientBoostingClassifier to plain JSON.

The web demo evaluates the exported trees in JavaScript, so the model runs in
the visitor's browser with no server. tests/test_export.py checks that this
pure-Python re-evaluation of the JSON matches scikit-learn's own predictions,
and web/tests/parity.test.mjs checks the JS evaluator against the same numbers.
"""

from __future__ import annotations

import numpy as np


def export_hgb(model, feature_names, class_names):
    if getattr(model, "is_categorical_", None) is not None and np.any(model.is_categorical_):
        raise ValueError("categorical features are not supported by this exporter")
    baseline = np.asarray(model._baseline_prediction, dtype=float).ravel().tolist()
    iterations = []
    for per_class in model._predictors:
        trees = []
        for predictor in per_class:
            n = predictor.nodes
            trees.append({
                # Parallel arrays keep the JSON compact.
                "f": n["feature_idx"].astype(int).tolist(),
                "t": [float(x) for x in n["num_threshold"]],
                "m": n["missing_go_to_left"].astype(int).tolist(),
                "l": n["left"].astype(int).tolist(),
                "r": n["right"].astype(int).tolist(),
                "leaf": n["is_leaf"].astype(int).tolist(),
                "v": [round(float(x), 7) for x in n["value"]],
            })
        iterations.append(trees)
    return {
        "format": "tan1-hgb-v1",
        "features": list(feature_names),
        "classes": list(class_names),
        "baseline": baseline,
        "iterations": iterations,
    }


def _tree_value(tree, x):
    node = 0
    while not tree["leaf"][node]:
        val = x[tree["f"][node]]
        if np.isnan(val):
            go_left = bool(tree["m"][node])
        else:
            go_left = val <= tree["t"][node]
        node = tree["l"][node] if go_left else tree["r"][node]
    return tree["v"][node]


def predict_proba_json(exported, X):
    """Reference evaluator for the exported JSON (mirrors web/src/model/model.js)."""
    X = np.asarray(X, dtype=float)
    k = len(exported["classes"])
    raw = np.tile(np.asarray(exported["baseline"], dtype=float), (len(X), 1))
    for trees in exported["iterations"]:
        for c, tree in enumerate(trees):
            raw[:, c] += [_tree_value(tree, x) for x in X]
    raw -= raw.max(axis=1, keepdims=True)
    e = np.exp(raw)
    return e / e.sum(axis=1, keepdims=True) if k > 1 else e
