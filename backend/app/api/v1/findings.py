"""Findings — list, filter, detail, status transitions."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Enrolment, Finding, User

router = APIRouter(prefix="/findings", tags=["findings"])


class FindingOut(BaseModel):
    id: str
    enrolment_id: str
    student_name: str | None
    program_code: str | None
    institution_id: str | None
    source: str
    rule_id: str | None
    severity: str
    severity_score: float | None
    confidence: str | None
    status: str
    evidence_json: dict
    created_at: str


class StatusUpdate(BaseModel):
    status: str  # ACKNOWLEDGED | RESOLVED | DISMISSED


def _out(f: Finding, e: Enrolment | None) -> FindingOut:
    return FindingOut(
        id=str(f.id),
        enrolment_id=str(f.enrolment_id),
        student_name=e.student_name if e else None,
        program_code=e.program_code if e else None,
        institution_id=e.institution_id if e else None,
        source=f.source,
        rule_id=f.rule_id,
        severity=f.severity,
        severity_score=float(f.severity_score) if f.severity_score is not None else None,
        confidence=f.confidence,
        status=f.status,
        evidence_json=f.evidence_json or {},
        created_at=f.created_at.isoformat(),
    )


@router.get("")
def list_findings(
    severity: str | None = Query(None),
    status: str | None = Query(None),
    source: str | None = Query(None),
    rule_id: str | None = Query(None),
    institution_id: str | None = Query(None),
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Finding, Enrolment).join(Enrolment, Finding.enrolment_id == Enrolment.id)

    # Institution scope — institution admins see only their own
    if user.role == "institution_admin":
        q = q.filter(Enrolment.institution_id == user.institution_id)
    elif institution_id:
        q = q.filter(Enrolment.institution_id == institution_id)

    if severity:
        q = q.filter(Finding.severity == severity)
    if status:
        q = q.filter(Finding.status == status)
    if source:
        q = q.filter(Finding.source == source)
    if rule_id:
        q = q.filter(Finding.rule_id == rule_id)

    rows = q.order_by(Finding.severity_score.desc().nullslast(), Finding.created_at.desc()).limit(limit).all()
    return [_out(f, e) for f, e in rows]


@router.get("/summary")
def summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    base = db.query(Finding, Enrolment).join(Enrolment, Finding.enrolment_id == Enrolment.id)
    if user.role == "institution_admin":
        base = base.filter(Enrolment.institution_id == user.institution_id)

    by_severity = dict(
        base.with_entities(Finding.severity, func.count(Finding.id))
        .group_by(Finding.severity).all()
    )
    by_status = dict(
        base.with_entities(Finding.status, func.count(Finding.id))
        .group_by(Finding.status).all()
    )
    by_rule = dict(
        base.with_entities(Finding.rule_id, func.count(Finding.id))
        .group_by(Finding.rule_id).all()
    )
    return {
        "by_severity": by_severity,
        "by_status": by_status,
        "by_rule": by_rule,
        "total": sum(by_status.values()),
    }


@router.get("/{finding_id}")
def get_finding(
    finding_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = db.query(Finding, Enrolment).join(Enrolment, Finding.enrolment_id == Enrolment.id)\
        .filter(Finding.id == finding_id).first()
    if not row:
        raise HTTPException(404, "Finding not found")
    f, e = row
    if user.role == "institution_admin" and e.institution_id != user.institution_id:
        raise HTTPException(403, "Not your finding")
    return _out(f, e)


@router.patch("/{finding_id}/status")
def update_status(
    finding_id: UUID,
    body: StatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.status not in ("ACKNOWLEDGED", "RESOLVED", "DISMISSED", "OPEN"):
        raise HTTPException(400, "Invalid status")
    row = db.query(Finding, Enrolment).join(Enrolment, Finding.enrolment_id == Enrolment.id)\
        .filter(Finding.id == finding_id).first()
    if not row:
        raise HTTPException(404, "Finding not found")
    f, e = row
    if user.role == "institution_admin" and e.institution_id != user.institution_id:
        raise HTTPException(403, "Not your finding")
    f.status = body.status
    db.commit()
    return _out(f, e)
