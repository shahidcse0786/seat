"""Reports — CSV exports using stdlib only."""
import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import (
    ApprovedIntake, ConcurrencyAlert, Enrolment, Finding, Institution, User,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    if not rows:
        buf = io.StringIO()
        buf.write("(no data)\n")
    else:
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/occupancy.csv")
def occupancy_csv(
    year: str = Query("2025-26"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(ApprovedIntake).filter(ApprovedIntake.academic_year == year)
    if user.role == "institution_admin":
        q = q.filter(ApprovedIntake.institution_id == user.institution_id)
    rows = []
    for ai in q.all():
        eq = db.query(Enrolment).filter(
            Enrolment.institution_id == ai.institution_id,
            Enrolment.program_code == ai.program_code,
            Enrolment.academic_year == ai.academic_year,
        )
        total = eq.count()
        l3 = eq.filter(Enrolment.identity_status == "L3_INSTITUTION_ATTESTED").count()
        rows.append({
            "institution_id": ai.institution_id,
            "program_code": ai.program_code,
            "academic_year": ai.academic_year,
            "sanctioned_seats": ai.sanctioned_seats,
            "reported_enrolments": total,
            "l3_attested": l3,
            "vacancy": max(ai.sanctioned_seats - total, 0),
            "occupancy_pct": round(total / ai.sanctioned_seats * 100, 1) if ai.sanctioned_seats else 0,
            "capacity_source": ai.source,
        })
    return _csv_response(rows, f"seat-occupancy-{year}.csv")


@router.get("/findings.csv")
def findings_csv(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Finding, Enrolment).join(Enrolment, Finding.enrolment_id == Enrolment.id)
    if user.role == "institution_admin":
        q = q.filter(Enrolment.institution_id == user.institution_id)
    rows = [
        {
            "finding_id": str(f.id),
            "institution_id": e.institution_id,
            "program_code": e.program_code,
            "student_name": e.student_name,
            "rule_id": f.rule_id or f.source,
            "severity": f.severity,
            "severity_score": float(f.severity_score) if f.severity_score else "",
            "status": f.status,
            "created_at": f.created_at.isoformat(),
        }
        for f, e in q.order_by(Finding.severity_score.desc().nullslast()).limit(5000).all()
    ]
    return _csv_response(rows, f"seat-findings-{datetime.utcnow().strftime('%Y%m%d')}.csv")


@router.get("/concurrency.csv")
def concurrency_csv(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(ConcurrencyAlert).order_by(ConcurrencyAlert.created_at.desc())
    alerts = q.limit(2000).all()
    rows = []
    for a in alerts:
        ea = db.query(Enrolment).filter(Enrolment.id == a.enrolment_a).first()
        eb = db.query(Enrolment).filter(Enrolment.id == a.enrolment_b).first()
        if not (ea and eb):
            continue
        if user.role == "institution_admin" and user.institution_id not in (ea.institution_id, eb.institution_id):
            continue
        rows.append({
            "alert_id": str(a.id),
            "state": a.state,
            "match_level": a.match_level,
            "suspicion_label": a.suspicion_label,
            "time_gap_days": a.time_gap_days,
            "institution_a": ea.institution_id,
            "student_a": ea.student_name,
            "institution_b": eb.institution_id,
            "student_b": eb.student_name,
            "created_at": a.created_at.isoformat(),
            "resolved_by": a.resolved_by or "",
        })
    return _csv_response(rows, f"seat-concurrency-{datetime.utcnow().strftime('%Y%m%d')}.csv")


@router.get("/capacity-breaches.csv")
def capacity_breaches_csv(
    year: str = Query("2025-26"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Finding, Enrolment).join(Enrolment, Finding.enrolment_id == Enrolment.id)\
        .filter(Finding.rule_id == "INTAKE_CAP_EXCEEDED")
    if user.role == "institution_admin":
        q = q.filter(Enrolment.institution_id == user.institution_id)
    rows = [
        {
            "institution_id": e.institution_id,
            "program_code": e.program_code,
            "academic_year": e.academic_year,
            "sanctioned": f.evidence_json.get("sanctioned", ""),
            "reported": f.evidence_json.get("reported", ""),
            "overflow": f.evidence_json.get("overflow", ""),
            "capacity_source": f.evidence_json.get("capacity_source", ""),
            "finding_id": str(f.id),
            "created_at": f.created_at.isoformat(),
        }
        for f, e in q.limit(2000).all()
    ]
    return _csv_response(rows, f"seat-capacity-breaches-{year}.csv")
