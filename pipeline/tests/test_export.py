"""The JSON export must reproduce scikit-learn's predictions exactly."""

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from export_model import export_hgb, predict_proba_json  # noqa: E402


def test_json_evaluator_matches_sklearn_including_missing_values():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(600, 4))
    y = (X[:, 0] + 0.5 * X[:, 1] > 0).astype(int) + (X[:, 2] > 1).astype(int)  # 3 classes
    X[rng.random(X.shape) < 0.05] = np.nan  # some missing values, learned direction
    model = HistGradientBoostingClassifier(max_iter=30, max_leaf_nodes=8, random_state=0).fit(X, y)

    exported = json.loads(json.dumps(export_hgb(model, ["a", "b", "c", "d"], ["x", "y", "z"])))
    X_test = rng.normal(size=(200, 4))
    X_test[rng.random(X_test.shape) < 0.05] = np.nan
    ours = predict_proba_json(exported, X_test)
    theirs = model.predict_proba(X_test)
    assert np.abs(ours - theirs).max() < 1e-6
    assert (ours.argmax(1) == theirs.argmax(1)).all()
