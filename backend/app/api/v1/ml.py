"""ML advisory API — train, score, list."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.core.ml import ANOMALY_THRESHOLD, train_model, score_batch, ensure_model
from app.core.features import FEATURE_NAMES
from app.models import Enrolment, Finding, MLModelVersion, User

router = APIRouter(prefix="/ml", tags=["ml"])


@router.get("/model")
def current_model(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    latest = db.query(MLModelVersion).order_by(MLModelVersion.trained_at.desc()).first()
    if not latest:
        return {"trained": False, "note": "No model yet. Call POST /ml/train or /ml/score-batch/{id}"}
    return {
        "trained": True,
        "model_version": latest.model_version,
        "trained_at": latest.trained_at.isoformat(),
        "contamination": float(latest.contamination),
        "artefact_hash": latest.artefact_hash[:16] + "...",
        "notes": latest.notes,
        "features": FEATURE_NAMES,
        "threshold": ANOMALY_THRESHOLD,
    }


@router.post("/train")
def train(
    db: Session = Depends(get_db),
    user: User = Depends(require_role("aicte_admin", "seat_operator")),
):
    try:
        mv = train_model(db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "model_version": mv.model_version,
        "trained_at": mv.trained_at.isoformat(),
        "contamination": float(mv.contamination),
        "artefact_hash": mv.artefact_hash[:16] + "...",
        "notes": mv.notes,
    }


@router.post("/score-batch/{batch_id}")
def score(
    batch_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("aicte_admin", "seat_operator", "institution_admin")),
):
    try:
        result = score_batch(db, batch_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Scoring failed: {e}")
    return result


@router.get("/findings")
def list_ml_findings(
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Finding, Enrolment).join(Enrolment, Finding.enrolment_id == Enrolment.id)\
        .filter(Finding.source == "ML")
    if user.role == "institution_admin":
        q = q.filter(Enrolment.institution_id == user.institution_id)
    rows = q.order_by(desc(Finding.ml_score)).limit(limit).all()
    return [
        {
            "id": str(f.id),
            "enrolment_id": str(f.enrolment_id),
            "student_name": e.student_name,
            "institution_id": e.institution_id,
            "program_code": e.program_code,
            "ml_score": float(f.ml_score) if f.ml_score is not None else None,
            "severity": f.severity,
            "status": f.status,
            "model_version": f.model_version,
            "shap": f.shap_json,
            "evidence": f.evidence_json,
            "created_at": f.created_at.isoformat(),
        }
        for f, e in rows
    ]


@router.get("/stats")
def ml_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from sqlalchemy import func
    total = db.query(func.count(Finding.id)).filter(Finding.source == "ML").scalar() or 0
    open_ = db.query(func.count(Finding.id)).filter(
        Finding.source == "ML", Finding.status == "OPEN"
    ).scalar() or 0
    return {"total_ml_findings": int(total), "open": int(open_)}
