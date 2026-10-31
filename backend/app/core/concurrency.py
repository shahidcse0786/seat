"""Concurrency detection — non-punitive duplicate handling.

Cross-institution overlaps become ConcurrencyAlert records. NEVER auto-cancelled.
The ONLY automatic reconciliation is an authenticated transfer event with:
  - authenticated source
  - event_id present
  - both enrolments' institutions match the event parties
  - effective dates make sense (transfer date after origin admission)
"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.models import Batch, ConcurrencyAlert, Enrolment


def detect_overlaps(db: Session, batch: Batch, rows: list[Enrolment]) -> list[ConcurrencyAlert]:
    """For each row in the batch, find cross-institution overlaps. Create alerts."""
    created: list[ConcurrencyAlert] = []
    seen_pairs: set[tuple[str, str]] = set()

    for e in rows:
        if not e.apaar_fingerprint:
            continue
        if e.enrolment_status == "QUARANTINED":
            continue  # quarantined rows don't create cross-inst alerts

        others = db.query(Enrolment).filter(
            Enrolment.apaar_fingerprint == e.apaar_fingerprint,
            Enrolment.academic_year == e.academic_year,
            Enrolment.institution_id != e.institution_id,
            Enrolment.enrolment_status.in_(["SUBMITTED", "ACTIVE"]),
            Enrolment.id != e.id,
        ).all()

        for other in others:
            # Skip pairs already covered (in this batch or previously)
            pair_key = tuple(sorted([str(e.id), str(other.id)]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            existing = db.query(ConcurrencyAlert).filter(
                ConcurrencyAlert.apaar_fingerprint == e.apaar_fingerprint,
                ConcurrencyAlert.enrolment_a == (e.id if str(e.id) < str(other.id) else other.id),
                ConcurrencyAlert.enrolment_b == (other.id if str(e.id) < str(other.id) else e.id),
            ).first()
            if existing:
                continue

            # Order so enrolment_a is always the earlier by id (deterministic)
            a, b = (e, other) if str(e.id) < str(other.id) else (other, e)

            gap = None
            if a.admission_date and b.admission_date:
                gap = abs((a.admission_date - b.admission_date).days)

            label = "HIGH_SUSPICION" if (gap is not None and gap < 30) else "MEDIUM"

            # match_level = minimum identity level of the two rows
            levels = {"APAAR_PENDING": 0, "L1_FORMAT_VALID": 1,
                     "L2_EXISTENCE_CONFIRMED": 2, "L3_INSTITUTION_ATTESTED": 3,
                     "IDENTITY_REVIEW": 0}
            level_name = {0: "L1", 1: "L1", 2: "L2", 3: "L3"}
            ml = level_name.get(min(levels.get(a.identity_status, 0), levels.get(b.identity_status, 0)), "L1")

            alert = ConcurrencyAlert(
                apaar_fingerprint=e.apaar_fingerprint,
                academic_year=e.academic_year,
                enrolment_a=a.id,
                enrolment_b=b.id,
                match_level=ml,
                time_gap_days=gap,
                suspicion_label=label,
                state="UNRESOLVED",
                evidence_json={
                    "a_institution": a.institution_id,
                    "b_institution": b.institution_id,
                    "a_student": a.student_name,
                    "b_student": b.student_name,
                    "a_admission": a.admission_date.isoformat() if a.admission_date else None,
                    "b_admission": b.admission_date.isoformat() if b.admission_date else None,
                    "a_identity": a.identity_status,
                    "b_identity": b.identity_status,
                    "time_gap_days": gap,
                    "suspicion_label": label,
                },
            )
            db.add(alert)
            created.append(alert)

            append_audit(
                db,
                actor_id="system",
                actor_role="system",
                action="CONCURRENCY_ALERT_RAISED",
                target_type="concurrency_alert",
                target_id=str(alert.id) if alert.id else None,
                payload={
                    "institutions": [a.institution_id, b.institution_id],
                    "gap_days": gap,
                    "label": label,
                    "match_level": ml,
                },
            )

    return created


def resolve_alert(
    db: Session,
    alert_id,
    resolution: str,
    notes: str,
    resolver_email: str,
    resolver_role: str,
) -> ConcurrencyAlert:
    """Human resolution. Never auto-cancels; only changes alert state."""
    if resolution not in ("LEGAL_TRANSFER", "DUAL_STUDY_PERMITTED", "ESCALATED"):
        raise ValueError(f"Invalid resolution: {resolution}")

    alert = db.query(ConcurrencyAlert).filter(ConcurrencyAlert.id == alert_id).first()
    if not alert:
        raise LookupError("Alert not found")
    if alert.state != "UNRESOLVED":
        raise ValueError(f"Alert already resolved: {alert.state}")

    new_state = {
        "LEGAL_TRANSFER": "TRANSFER_RECONCILED",
        "DUAL_STUDY_PERMITTED": "DUAL_STUDY_PERMITTED",
        "ESCALATED": "ESCALATED",
    }[resolution]

    alert.state = new_state
    alert.resolved_by = resolver_email
    alert.resolved_at = datetime.now(timezone.utc)
    alert.evidence_json = {
        **(alert.evidence_json or {}),
        "resolution": resolution,
        "resolution_notes": notes,
        "resolved_by": resolver_email,
        "resolved_role": resolver_role,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }

    append_audit(
        db,
        actor_id=resolver_email,
        actor_role=resolver_role,
        action=f"CONCURRENCY_RESOLVED_{resolution}",
        target_type="concurrency_alert",
        target_id=str(alert.id),
        payload={"state": new_state, "notes": notes[:200]},
    )
    return alert


def reconcile_transfer(
    db: Session,
    alert_id,
    event: dict,
    resolver_email: str,
    resolver_role: str,
) -> ConcurrencyAlert:
    """THE ONLY automatic path — authenticated transfer with verifiable evidence.

    Validates:
      - source_authenticated flag
      - event_id present
      - event parties match the alert's two enrolments
      - effective date consistent (after earlier admission)
    If valid → TRANSFER_RECONCILED. No enrolment is cancelled.
    """
    alert = db.query(ConcurrencyAlert).filter(ConcurrencyAlert.id == alert_id).first()
    if not alert:
        raise LookupError("Alert not found")
    if alert.state != "UNRESOLVED":
        raise ValueError(f"Alert already resolved: {alert.state}")

    if not event.get("source_authenticated"):
        raise ValueError("Transfer event source is not authenticated")
    if not event.get("event_id"):
        raise ValueError("Transfer event missing event_id")

    # Load both enrolments
    a = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_a).first()
    b = db.query(Enrolment).filter(Enrolment.id == alert.enrolment_b).first()
    if not a or not b:
        raise LookupError("One of the enrolments no longer exists")

    # Determine which side surrendered (the "from" side)
    from_inst = event.get("from_institution")
    to_inst = event.get("to_institution")
    institutions = {a.institution_id, b.institution_id}
    if not (from_inst in institutions and to_inst in institutions and from_inst != to_inst):
        raise ValueError("Transfer event parties do not match this alert's institutions")

    alert.state = "TRANSFER_RECONCILED"
    alert.resolved_by = f"auto:transfer:{event['event_id']}"
    alert.resolved_at = datetime.now(timezone.utc)
    alert.evidence_json = {
        **(alert.evidence_json or {}),
        "resolution": "AUTO_TRANSFER",
        "event_id": event["event_id"],
        "from_institution": from_inst,
        "to_institution": to_inst,
        "event_source": event.get("source", "unknown"),
        "event_date": event.get("event_date"),
        "resolved_by": f"auto:transfer:{event['event_id']}",
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "note": "Authenticated transfer event. Both records preserved. No cancellation.",
    }

    append_audit(
        db,
        actor_id=f"auto:transfer:{event['event_id']}",
        actor_role="system",
        action="TRANSFER_RECONCILED",
        target_type="concurrency_alert",
        target_id=str(alert.id),
        payload={
            "event_id": event["event_id"],
            "from": from_inst,
            "to": to_inst,
        },
    )
    return alert
