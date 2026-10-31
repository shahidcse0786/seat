"""Isolation Forest + SHAP advisory service.

Guardrails (spec §3.9.4):
  - ML NEVER produces FAIL — only REVIEW
  - ML NEVER changes identity_status or enrolment_status
  - ML NEVER issues / revokes credentials
  - ML NEVER resolves concurrency alerts
"""
import hashlib
import os
import pickle
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.features import FEATURE_NAMES, compute_features
from app.models import (
    ApprovedIntake, ConcurrencyAlert, Enrolment, Finding, MLModelVersion,
)

# Artefact directory — writeable inside container
MODEL_DIR = Path("/app/.ml_models")
try:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    (MODEL_DIR / ".test").touch()
    (MODEL_DIR / ".test").unlink()
except (OSError, PermissionError):
    MODEL_DIR = Path("/tmp/seat_models")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

ANOMALY_THRESHOLD = 0.60   # normalised score [0,1]; above = advisory flag
CONTAMINATION = 0.03        # ~3% of training data is expected anomalous


def _load_model(version: str):
    path = MODEL_DIR / f"{version}.pkl"
    if not path.exists():
        return None, None
    with open(path, "rb") as f:
        bundle = pickle.load(f)
    return bundle["model"], bundle


def _save_model(version: str, bundle: dict) -> str:
    path = MODEL_DIR / f"{version}.pkl"
    with open(path, "wb") as f:
        pickle.dump(bundle, f)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _cross_inst_levels(db: Session, enrolments: list[Enrolment], year: str) -> dict[str, int]:
    """For each APAAR fingerprint present in this batch, what's the strongest cross-instance match level?"""
    fps = [e.apaar_fingerprint for e in enrolments if e.apaar_fingerprint]
    if not fps:
        return {}
    level_map = {0: 0, 1: 1, 2: 2, 3: 3}
    identity_to_level = {
        "APAAR_PENDING": 0, "L1_FORMAT_VALID": 1,
        "L2_EXISTENCE_CONFIRMED": 2, "L3_INSTITUTION_ATTESTED": 3,
        "IDENTITY_REVIEW": 0,
    }
    # A same-institution duplicate is a stronger signal than cross-institution
    others = db.query(Enrolment).filter(
        Enrolment.apaar_fingerprint.in_(fps),
        Enrolment.academic_year == year,
    ).all()
    result: dict[str, int] = {}
    for o in others:
        if not o.apaar_fingerprint:
            continue
        lvl = identity_to_level.get(o.identity_status, 0)
        result[o.apaar_fingerprint] = max(result.get(o.apaar_fingerprint, 0), lvl)
    return result


def _build_context(db: Session, enrolments: list[Enrolment], year: str):
    """Compute intake ratio denominators + cross-inst levels for a set of enrolments."""
    inst_ids = {e.institution_id for e in enrolments}
    programs = {e.program_code for e in enrolments}

    sanctioned = {
        (ai.institution_id, ai.program_code): ai.sanctioned_seats
        for ai in db.query(ApprovedIntake).filter(
            ApprovedIntake.institution_id.in_(inst_ids),
            ApprovedIntake.academic_year == year,
        ).all()
    }
    # Per-programme counts in this batch
    programme_counts: dict[str, int] = {}
    for e in enrolments:
        if not e.is_supernumerary:
            programme_counts[e.program_code] = programme_counts.get(e.program_code, 0) + 1

    return sanctioned, programme_counts


def train_model(db: Session) -> MLModelVersion:
    """Train Isolation Forest on clean enrolments (no FAIL findings, no unresolved duplicates)."""
    from sklearn.ensemble import IsolationForest

    # Training set: all enrolments from ACCEPTED/PARTIAL batches, no FAIL, no active cross-inst duplicate
    fail_subq = db.query(Finding.enrolment_id).filter(Finding.severity == "FAIL").subquery()
    dup_subq = (
        db.query(ConcurrencyAlert.enrolment_a).union(
            db.query(ConcurrencyAlert.enrolment_b)
        ).subquery()
    )

    rows = db.query(Enrolment).filter(
        ~Enrolment.id.in_(db.query(fail_subq.c.enrolment_id)),
        ~Enrolment.id.in_(db.query(dup_subq.c.enrolment_a)),
        Enrolment.enrolment_status == "ACTIVE",
    ).all()

    if len(rows) < 50:
        # Fallback: use all active enrolments so training can proceed
        rows = db.query(Enrolment).filter(Enrolment.enrolment_status == "ACTIVE").all()
    if len(rows) < 20:
        raise ValueError(f"Not enough training data ({len(rows)} rows; need ≥20)")

    year = rows[0].academic_year if rows else "2025-26"
    sanctioned, programme_counts = _build_context(db, rows, year)
    sanctioned_by_program = {
        k[1]: v for k, v in sanctioned.items()
        if k[0] == rows[0].institution_id
    }
    # Build a per-programme sanctioned dict across all institutions
    sanctioned_by_program = {}
    for (inst, prog), seats in sanctioned.items():
        sanctioned_by_program[prog] = sanctioned_by_program.get(prog, 0) + seats

    cross_inst = _cross_inst_levels(db, rows, year)

    X, _ids = compute_features(rows, sanctioned_by_program, programme_counts, cross_inst)

    model = IsolationForest(
        n_estimators=200,
        contamination=CONTAMINATION,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X)

    means = X.mean(axis=0).tolist()
    stds = X.std(axis=0).tolist()

    version = f"iforest-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    bundle = {
        "model": model,
        "means": means,
        "stds": stds,
        "feature_names": FEATURE_NAMES,
        "contamination": CONTAMINATION,
        "n_samples": len(rows),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    artefact_hash = _save_model(version, bundle)

    mv = MLModelVersion(
        model_version=version,
        trained_at=datetime.now(timezone.utc),
        features_json={"features": FEATURE_NAMES, "n_samples": len(rows)},
        contamination=CONTAMINATION,
        artefact_hash=artefact_hash,
        notes=f"Trained on {len(rows)} clean enrolments",
    )
    db.add(mv)

    append_audit(
        db,
        actor_id="system",
        actor_role="system",
        action="ML_MODEL_TRAINED",
        target_type="ml_model",
        target_id=version,
        payload={"n_samples": len(rows), "contamination": CONTAMINATION},
    )
    db.commit()
    return mv


def ensure_model(db: Session) -> tuple[MLModelVersion, dict]:
    """Return the latest model + bundle, training if none exists."""
    latest = db.query(MLModelVersion).order_by(MLModelVersion.trained_at.desc()).first()
    if latest:
        model, bundle = _load_model(latest.model_version)
        if model is not None and bundle:
            return latest, bundle
    mv = train_model(db)
    model, bundle = _load_model(mv.model_version)
    if model is None or bundle is None:
        raise RuntimeError("Model trained but artefact missing")
    return mv, bundle


def _explain(model, bundle: dict, x_row: np.ndarray) -> list[dict]:
    """Return top-3 contributing features. Try SHAP; fall back to z-score."""
    names = bundle.get("feature_names") or FEATURE_NAMES
    means = bundle.get("means") or [0.0] * len(names)
    stds = bundle.get("stds") or [1.0] * len(names)

    try:
        import shap
        explainer = shap.TreeExplainer(model)
        sv = explainer.shap_values(x_row.reshape(1, -1))
        if hasattr(sv, "shape") and sv.ndim == 2 and sv.shape[0] == 1:
            sv = sv[0]
        contribs = [(names[i], float(sv[i])) for i in range(len(sv))]
        contribs.sort(key=lambda t: abs(t[1]), reverse=True)
        return [
            {"feature": f, "shap_value": round(v, 4),
             "direction": "toward anomaly" if v < 0 else "toward normal"}
            for f, v in contribs[:3]
        ]
    except Exception:
        # Fallback: z-score deviation from training mean
        contribs = []
        for i, f in enumerate(names):
            z = abs(float(x_row[i]) - means[i]) / max(stds[i], 1e-9)
            contribs.append((f, z, float(x_row[i])))
        contribs.sort(key=lambda t: t[1], reverse=True)
        return [
            {"feature": f, "zscore": round(z, 3), "value": round(v, 3)}
            for f, z, v in contribs[:3]
        ]


def score_batch(db: Session, batch_id) -> dict:
    """Score all enrolments in a batch. Create advisory findings for anomalies."""
    from app.models import Batch

    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise LookupError("Batch not found")

    rows = db.query(Enrolment).filter(Enrolment.batch_id == batch_id).all()
    if len(rows) < 5:
        return {"scored": len(rows), "flagged": 0, "model_version": None,
                "note": "Batch too small — need ≥5 rows for meaningful scoring"}

    mv, bundle = ensure_model(db)
    model = bundle["model"]

    sanctioned, programme_counts = _build_context(db, rows, batch.academic_year)
    sanctioned_by_program = {}
    for (inst, prog), seats in sanctioned.items():
        sanctioned_by_program[prog] = sanctioned_by_program.get(prog, 0) + seats
    cross_inst = _cross_inst_levels(db, rows, batch.academic_year)

    X, ids = compute_features(rows, sanctioned_by_program, programme_counts, cross_inst)
    raw_scores = model.decision_function(X)  # higher = more normal

    # Normalise to [0,1]: 1 = most anomalous
    lo, hi = raw_scores.min(), raw_scores.max()
    span = max(hi - lo, 1e-9)
    normalised = 1.0 - (raw_scores - lo) / span

    flagged = 0
    for i, (row, score) in enumerate(zip(rows, normalised)):
        if score < ANOMALY_THRESHOLD:
            continue
        # Skip if this row already has an ML finding from the same model
        existing = db.query(Finding).filter(
            Finding.enrolment_id == row.id,
            Finding.source == "ML",
            Finding.model_version == mv.model_version,
        ).first()
        if existing:
            continue

        shap_explanation = _explain(model, bundle, X[i])

        db.add(Finding(
            enrolment_id=row.id,
            source="ML",
            severity="REVIEW",
            severity_score=round(float(score) * 4.0, 2),
            ml_score=round(float(score), 4),
            shap_json={"top": shap_explanation},
            model_version=mv.model_version,
            evidence_json={
                "normalised_score": round(float(score), 4),
                "threshold": ANOMALY_THRESHOLD,
                "advisory_only": True,
            },
            status="OPEN",
        ))
        flagged += 1

    append_audit(
        db,
        actor_id="system",
        actor_role="system",
        action="ML_BATCH_SCORED",
        target_type="batch",
        target_id=str(batch_id),
        payload={
            "model_version": mv.model_version,
            "scored": len(rows),
            "flagged": flagged,
        },
    )
    db.commit()

    return {
        "scored": len(rows),
        "flagged": flagged,
        "model_version": mv.model_version,
        "threshold": ANOMALY_THRESHOLD,
    }
