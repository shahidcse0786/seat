"""Concurrency queue — review, resolve, transfer-reconcile."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.concurrency import reconcile_transfer, resolve_alert
from app.core.database import get_db
from app.models import ConcurrencyAlert, Enrolment, User

router = APIRouter(prefix="/concurrency", tags=["concurrency"])


class ResolveIn(BaseModel):
    resolution: str  # LEGAL_TRANSFER | DUAL_STUDY_PERMITTED | ESCALATED
    notes: str = ""


class TransferIn(BaseModel):
    source_authenticated: bool = True
    event_id: str
    from_institution: str
    to_institution: str
    event_date: str | None = None
    source: str = "demo:manual_simulation"


def _enrich(alert: ConcurrencyAlert, a: Enrolment, b: Enrolment) -> dict:
    return {
        "id": str(alert.id),
        "apaar_fingerprint": alert.apaar_fingerprint[:16] + "…",
        "academic_year": alert.academic_year,
        "match_level": alert.match_level,
        "time_gap_days": alert.time_gap_days,
        "suspicion_label": alert.suspicion_label,
        "state": alert.state,
        "resolved_by": alert.resolved_by,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
        "created_at": alert.created_at.isoformat(),
        "evidence": alert.evidence_json,
        "a": {
            "enrolment_id": str(a.id),
            "institution_id": a.institution_id,
            "student_name": a.student_name,
            "program_code": a.program_code,
            "admission_date": a.admission_date.isoformat(),
            "identity_status": a.identity_status,
            "enrolment_status": a.enrolment_status,
            "student_id_inst": a.student_id_inst,
        },
        "b": {
            "enrolment_id": str(b.id),
            "institution_id": b.institution_id,
            "student_name": b.student_name,
            "program_code": b.program_code,
            "admission_date": b.admission_date.isoformat(),
            "identity_status": b.identity_status,
            "enrolment_status": b.enrolment_status,
            "student_id_inst": b.student_id_inst,
        },
    }


@router.get("/queue")
def queue(
    state: str | None = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # institution_admin sees alerts involving their institution (to supply evidence)
    # aicte_admin / seat_operator / regulator_auditor see all
    q = db.query(ConcurrencyAlert).order_by(desc(ConcurrencyAlert.created_at))
    if state:
        q = q.filter(ConcurrencyAlert.state == state)

    alerts = q.limit(limit).all()
    out = []
    for alert in alerts:
        a = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_a).first()
        b = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_b).first()
        if not a or not b:
            continue
        if user.role == "institution_admin":
            if user.institution_id not in (a.institution_id, b.institution_id):
                continue
        out.append(_enrich(alert, a, b))
    return out


@router.get("/summary")
def summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from sqlalchemy import func
    by_state = dict(
        db.query(ConcurrencyAlert.state, func.count(ConcurrencyAlert.id))
        .group_by(ConcurrencyAlert.state).all()
    )
    by_label = dict(
        db.query(ConcurrencyAlert.suspicion_label, func.count(ConcurrencyAlert.id))
        .group_by(ConcurrencyAlert.suspicion_label).all()
    )
    return {
        "by_state": by_state,
        "by_suspicion": by_label,
        "total": sum(by_state.values()),
    }


@router.get("/{alert_id}")
def detail(
    alert_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    alert = db.query(ConcurrencyAlert).filter(ConcurrencyAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(404, "Alert not found")
    a = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_a).first()
    b = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_b).first()
    if not a or not b:
        raise HTTPException(404, "One of the enrolments no longer exists")
    if user.role == "institution_admin" and user.institution_id not in (a.institution_id, b.institution_id):
        raise HTTPException(403, "Not your alert")
    return _enrich(alert, a, b)


@router.post("/{alert_id}/resolve")
def resolve(
    alert_id: UUID,
    body: ResolveIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("aicte_admin", "seat_operator"):
        raise HTTPException(403, "Resolution requires AICTE admin or operator role")
    try:
        alert = resolve_alert(db, alert_id, body.resolution, body.notes, user.email, user.role)
        db.commit()
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    a = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_a).first()
    b = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_b).first()
    return _enrich(alert, a, b)


@router.post("/{alert_id}/transfer")
def transfer(
    alert_id: UUID,
    body: TransferIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The one automatic reconciliation path. Authenticated transfer event only."""
    if user.role not in ("aicte_admin", "seat_operator"):
        raise HTTPException(403, "Transfer reconciliation requires AICTE admin or operator role")
    event = body.model_dump()
    try:
        alert = reconcile_transfer(db, alert_id, event, user.email, user.role)
        db.commit()
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    a = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_a).first()
    b = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_b).first()
    return _enrich(alert, a, b)
