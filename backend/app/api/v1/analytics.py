"""Analytics endpoints — dashboards for AICTE + Institution."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import (
    ApprovedIntake, ConcurrencyAlert, Enrolment, Finding, Institution, User,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/occupancy")
def occupancy(
    year: str = Query("2025-26"),
    institution_id: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Institution admins can only see their own
    if user.role == "institution_admin":
        institution_id = user.institution_id

    ai_q = db.query(ApprovedIntake).filter(ApprovedIntake.academic_year == year)
    if institution_id:
        ai_q = ai_q.filter(ApprovedIntake.institution_id == institution_id)
    ai_rows = ai_q.all()

    result = []
    for ai in ai_rows:
        eq = db.query(Enrolment).filter(
            Enrolment.institution_id == ai.institution_id,
            Enrolment.program_code == ai.program_code,
            Enrolment.academic_year == ai.academic_year,
        )
        total = eq.count()
        l3 = eq.filter(Enrolment.identity_status == "L3_INSTITUTION_ATTESTED").count()
        l1 = eq.filter(Enrolment.identity_status == "L1_FORMAT_VALID").count()
        l2 = eq.filter(Enrolment.identity_status == "L2_EXISTENCE_CONFIRMED").count()
        pending = eq.filter(Enrolment.identity_status == "APAAR_PENDING").count()
        quarantined = eq.filter(Enrolment.enrolment_status == "QUARANTINED").count()
        result.append({
            "institution_id": ai.institution_id,
            "program_code": ai.program_code,
            "sanctioned": int(ai.sanctioned_seats),
            "enrolled": int(total),
            "l3": int(l3),
            "l2": int(l2),
            "l1": int(l1),
            "pending": int(pending),
            "quarantined": int(quarantined),
            "vacancy": int(max(ai.sanctioned_seats - total, 0)),
            "occupancy_pct": round(total / ai.sanctioned_seats * 100, 1) if ai.sanctioned_seats else 0,
            "source": ai.source,
        })
    return result


@router.get("/by-rule")
def by_rule(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Finding.rule_id, Finding.severity, func.count(Finding.id))
    if user.role == "institution_admin":
        q = q.join(Enrolment, Finding.enrolment_id == Enrolment.id).filter(
            Enrolment.institution_id == user.institution_id
        )
    rows = q.group_by(Finding.rule_id, Finding.severity).all()
    return [
        {"rule_id": rule_id or "unknown", "severity": sev, "count": int(cnt)}
        for rule_id, sev, cnt in rows
    ]


@router.get("/institutions")
def institution_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "institution_admin":
        insts = db.query(Institution).filter(Institution.id == user.institution_id).all()
    else:
        insts = db.query(Institution).all()

    result = []
    for inst in insts:
        eq = db.query(Enrolment).filter(Enrolment.institution_id == inst.id)
        total = eq.count()
        l3 = eq.filter(Enrolment.identity_status == "L3_INSTITUTION_ATTESTED").count()
        findings = db.query(Finding).join(
            Enrolment, Finding.enrolment_id == Enrolment.id
        ).filter(Enrolment.institution_id == inst.id).count()
        alerts = db.query(ConcurrencyAlert).join(
            Enrolment, ConcurrencyAlert.enrolment_a == Enrolment.id
        ).filter(Enrolment.institution_id == inst.id).count()
        capacity = db.query(func.sum(ApprovedIntake.sanctioned_seats)).filter(
            ApprovedIntake.institution_id == inst.id,
        ).scalar() or 0
        result.append({
            "id": inst.id,
            "name": inst.name,
            "city": inst.city,
            "state": inst.state,
            "type": inst.type,
            "capacity": int(capacity),
            "enrolled": int(total),
            "l3": int(l3),
            "findings": int(findings),
            "concurrency_alerts": int(alerts),
            "occupancy_pct": round(total / capacity * 100, 1) if capacity else 0,
        })
    return result
