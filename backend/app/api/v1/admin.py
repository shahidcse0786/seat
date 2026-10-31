"""Admin endpoints — demo seed reset + live stats + audit chain demo."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from uuid import uuid4

from app.api.deps import get_current_user
from app.core.audit import append_audit
from app.core.database import get_db
from app.models import (
    Institution, Programme, ApprovedIntake, Enrolment, Batch,
    ConcurrencyAlert, Finding, RuleVersion, ConfigSwitch, User,
    ConsentRecord, VTokenRegistry, AuditLog,
)
from app.seed import seed_all

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/reset")
def reset_data(confirm: bool = Query(False), db: Session = Depends(get_db)):
    if not confirm:
        return {"ok": False, "message": "Add ?confirm=true to perform reset."}
    summary = seed_all(db)
    return {"ok": True, "seeded": summary}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    by_identity = dict(db.execute(select(Enrolment.identity_status, func.count()).group_by(Enrolment.identity_status)).all())
    by_enrolment = dict(db.execute(select(Enrolment.enrolment_status, func.count()).group_by(Enrolment.enrolment_status)).all())
    by_consent = dict(db.execute(select(Enrolment.consent_status, func.count()).group_by(Enrolment.consent_status)).all())
    total_seats = db.scalar(select(func.sum(ApprovedIntake.sanctioned_seats))) or 0
    total_enrol = db.scalar(select(func.count()).select_from(Enrolment)) or 0
    return {
        "total_institutions": db.scalar(select(func.count()).select_from(Institution)) or 0,
        "total_programmes": db.scalar(select(func.count()).select_from(Programme)) or 0,
        "total_approved_seats": int(total_seats),
        "total_enrolments": int(total_enrol),
        "occupancy_rate": round((total_enrol / total_seats) * 100, 1) if total_seats else 0,
        "by_identity_status": by_identity,
        "by_enrolment_status": by_enrolment,
        "by_consent_status": by_consent,
        "total_batches": db.scalar(select(func.count()).select_from(Batch)) or 0,
        "total_findings": db.scalar(select(func.count()).select_from(Finding)) or 0,
        "open_findings": db.scalar(select(func.count()).select_from(Finding).where(Finding.status == "OPEN")) or 0,
        "concurrency_alerts": db.scalar(select(func.count()).select_from(ConcurrencyAlert)) or 0,
        "unresolved_alerts": db.scalar(select(func.count()).select_from(ConcurrencyAlert).where(ConcurrencyAlert.state == "UNRESOLVED")) or 0,
        "rule_versions": db.scalar(select(func.count()).select_from(RuleVersion)) or 0,
        "config_switches": db.scalar(select(func.count()).select_from(ConfigSwitch)) or 0,
        "users": db.scalar(select(func.count()).select_from(User)) or 0,
        "consent_records": db.scalar(select(func.count()).select_from(ConsentRecord)) or 0,
        "v_tokens_issued": db.scalar(select(func.count()).select_from(VTokenRegistry)) or 0,
    }


@router.post("/seed-audit-demo")
def seed_audit_demo(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Populate audit chain with realistic demo entries. Append-only."""
    if user.role not in ("aicte_admin", "seat_operator"):
        raise HTTPException(403, "Admin or operator role required")

    sample_rows = db.query(Enrolment).filter(Enrolment.enrolment_status == "ACTIVE").limit(3).all()
    enrolment_ids = [str(e.id) for e in sample_rows] or [str(uuid4()) for _ in range(3)]
    insts = [r.institution_id for r in sample_rows] or ["INST001", "INST002", "INST003"]
    progs = [r.program_code for r in sample_rows] or ["CSE", "ME", "MBA"]

    demo_events = [
        ("system", "system", "BATCH_FINALIZED", "batch", "b-" + uuid4().hex[:8], {"state": "ACCEPTED", "counts": {"submitted": 232, "accepted": 232}}),
        ("system", "system", "RULES_EVALUATED", "batch", "b-" + uuid4().hex[:8], {"rules_fired": 3, "severities": {"FAIL": 2, "WARN": 1}}),
        ("system", "system", "CONCURRENCY_ALERT_RAISED", "concurrency_alert", str(uuid4()), {"institutions": [insts[0], insts[1]], "gap_days": 5}),
        ("registrar@inst001.edu", "institution_admin", "VTOKEN_ISSUED", "enrolment", enrolment_ids[0], {"jti": str(uuid4()), "institution": insts[0], "program": progs[0]}),
        ("registrar@inst001.edu", "institution_admin", "VTOKEN_ISSUED", "enrolment", enrolment_ids[1], {"jti": str(uuid4()), "institution": insts[0], "program": progs[0]}),
        ("public:employer", "employer_verifier", "PUBLIC_VERIFY_VALID", "vtoken", str(uuid4()), {"result": "VALID"}),
        ("public:employer", "employer_verifier", "PUBLIC_VERIFY_VALID", "vtoken", str(uuid4()), {"result": "VALID"}),
        ("public:employer", "employer_verifier", "PUBLIC_VERIFY_REVOKED", "vtoken", str(uuid4()), {"result": "REVOKED"}),
        ("admin@aicte.gov.in", "aicte_admin", "CONCURRENCY_RESOLVED_LEGAL_TRANSFER", "concurrency_alert", str(uuid4()), {"state": "TRANSFER_RECONCILED"}),
        ("admin@aicte.gov.in", "aicte_admin", "ML_MODEL_TRAINED", "ml_model", "iforest-demo", {"n_samples": 725, "contamination": 0.03}),
        ("system", "system", "ML_BATCH_SCORED", "batch", "b-" + uuid4().hex[:8], {"scored": 232, "flagged": 12}),
        ("admin@aicte.gov.in", "aicte_admin", "RULE_VERSION_CREATED", "rule", "INTAKE_CAP_EXCEEDED", {"old_value": 60, "new_value": 70}),
        ("registrar@inst001.edu", "institution_admin", "CONSENT_GRANTED", "enrolment", enrolment_ids[2] if len(enrolment_ids) > 2 else enrolment_ids[0], {"purpose": "EMPLOYER_VERIFY", "expiry_days": 365}),
        ("operator@seat.local", "seat_operator", "CONFIG_SWITCH_TOGGLED", "config", "S2_L2_GATEWAY_ENABLED", {"old": "OFF", "new": "ON"}),
        ("registrar@inst002.edu", "institution_admin", "VTOKEN_REVOKED", "vtoken", str(uuid4()), {"reason": "data_correction"}),
    ]

    for actor_id, actor_role, action, target_type, target_id, payload in demo_events:
        append_audit(
            db,
            actor_id=actor_id,
            actor_role=actor_role,
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload=payload,
        )

    db.commit()

    total = db.query(func.count(AuditLog.id)).scalar() or 0
    return {"ok": True, "entries_added": len(demo_events), "total_entries_now": int(total)}


@router.post("/reset-audit-chain")
def reset_audit_chain(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """TRUNCATE audit_log + re-seed with 15 fresh chained entries.

    Use this after fixing the chain bug or before a fresh demo.
    Destroys ONLY the audit_log table; enrolments/batches/findings preserved.
    """
    if user.role not in ("aicte_admin", "seat_operator"):
        raise HTTPException(403, "Admin or operator role required")

    from sqlalchemy import text as _text
    db.execute(_text("TRUNCATE audit_log RESTART IDENTITY"))
    db.commit()

    return seed_audit_demo(db=db, user=user)
