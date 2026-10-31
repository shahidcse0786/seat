"""Batches: create, append rows, finalize (L1 + rules + concurrency), inspect."""
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.concurrency import detect_overlaps
from app.core.crypto import fingerprint, sha256_hex
from app.core.database import get_db
from app.core.rules import evaluate_batch
from app.models import Batch, Enrolment, User

router = APIRouter(prefix="/batches", tags=["batches"])


class BatchCreate(BaseModel):
    academic_year: str = Field(default="2025-26")
    batch_reference: str | None = None


class RowIn(BaseModel):
    row_number: int
    student_id_inst: str
    student_name: str
    apaar_id: str | None = None
    program_code: str
    admission_date: str
    category: str | None = None


class RowsIn(BaseModel):
    rows: list[RowIn]


def _content_hash(r: RowIn) -> str:
    return sha256_hex(
        f"{r.row_number}|{r.student_id_inst}|{r.student_name}|"
        f"{r.apaar_id or ''}|{r.program_code}|{r.admission_date}|{r.category or ''}"
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_batch(
    body: BatchCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "institution_admin" or not user.institution_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only institution admins can create batches")
    b = Batch(
        institution_id=user.institution_id,
        academic_year=body.academic_year,
        batch_reference=body.batch_reference,
        state="OPEN",
        counts_json={},
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return {
        "batch_id": str(b.id),
        "state": b.state,
        "institution_id": b.institution_id,
        "academic_year": b.academic_year,
        "created_at": b.created_at.isoformat(),
    }


@router.put("/{batch_id}/rows")
def append_rows(
    batch_id: UUID,
    body: RowsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = db.query(Batch).filter(Batch.id == batch_id).first()
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    if user.role == "institution_admin" and b.institution_id != user.institution_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your batch")
    if b.state != "OPEN":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Batch state is {b.state}, not OPEN")

    existing_hashes = {
        h for (h,) in db.query(Enrolment.content_hash)
                        .filter(Enrolment.batch_id == batch_id).all() if h
    }

    receipts = []
    for r in body.rows:
        ch = _content_hash(r)
        if ch in existing_hashes:
            receipts.append({"row_number": r.row_number, "accepted": False, "reason": "DUPLICATE"})
            continue
        try:
            adm = date.fromisoformat(r.admission_date)
        except Exception:
            receipts.append({"row_number": r.row_number, "accepted": False, "reason": "BAD_DATE"})
            continue

        is_provisional = not (r.apaar_id and r.apaar_id.strip())
        prov_id = f"PROV-{b.institution_id}-{ch[:8].upper()}" if is_provisional else None

        e = Enrolment(
            institution_id=b.institution_id,
            academic_year=b.academic_year,
            apaar_id=(r.apaar_id.strip() if r.apaar_id and r.apaar_id.strip() else None),
            provisional_id=prov_id,
            identity_status="APAAR_PENDING",
            student_id_inst=r.student_id_inst,
            student_name=r.student_name,
            program_code=r.program_code,
            category=r.category,
            admission_date=adm,
            enrolment_status="SUBMITTED",
            batch_id=b.id,
            row_number=r.row_number,
            content_hash=ch,
        )
        db.add(e)
        existing_hashes.add(ch)
        receipts.append({"row_number": r.row_number, "accepted": True})

    db.commit()
    return {
        "batch_id": str(b.id),
        "received": len(body.rows),
        "accepted": sum(1 for r in receipts if r["accepted"]),
        "receipts": receipts,
    }


@router.post("/{batch_id}/finalize")
def finalize_batch(
    batch_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = db.query(Batch).filter(Batch.id == batch_id).first()
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found")
    if user.role == "institution_admin" and b.institution_id != user.institution_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your batch")
    if b.state != "OPEN":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Batch state is {b.state}, not OPEN")

    b.state = "PROCESSING"
    db.commit()

    rows = db.query(Enrolment).filter(Enrolment.batch_id == batch_id).all()

    # Step 1 — identity resolution (L1 / provisional)
    for e in rows:
        if not e.apaar_id:
            if not e.provisional_id:
                e.provisional_id = f"PROV-{b.institution_id}-{e.id.hex[:8].upper()}"
            e.identity_status = "APAAR_PENDING"
        elif len(e.apaar_id) == 12 and e.apaar_id.isdigit():
            e.apaar_fingerprint = fingerprint(e.apaar_id)
            if e.identity_status not in ("L3_INSTITUTION_ATTESTED", "L2_EXISTENCE_CONFIRMED"):
                e.identity_status = "L1_FORMAT_VALID"

    db.flush()

    # Step 2 — rules
    results = evaluate_batch(db, b, rows)
    quarantine_ids: set[str] = set()
    for e, finding, should_quarantine in results:
        db.add(finding)
        if should_quarantine:
            quarantine_ids.add(str(e.id))

    # Step 3 — apply quarantines
    counts = {"submitted": len(rows), "accepted": 0, "quarantined": 0,
              "pending": 0, "apaar_pending": 0, "l3_attested": 0}
    for e in rows:
        if str(e.id) in quarantine_ids:
            e.enrolment_status = "QUARANTINED"
            counts["quarantined"] += 1
        else:
            if e.enrolment_status != "ACTIVE":
                e.enrolment_status = "ACTIVE"
            counts["accepted"] += 1
        if e.identity_status == "APAAR_PENDING":
            counts["apaar_pending"] += 1
        elif e.identity_status == "L3_INSTITUTION_ATTESTED":
            counts["l3_attested"] += 1

    db.flush()

    # Step 4 — concurrency detection (creates ConcurrencyAlert records)
    new_alerts = detect_overlaps(db, b, rows)

    b.state = "ACCEPTED" if counts["quarantined"] == 0 else ("PARTIAL_SUCCESS" if counts["accepted"] > 0 else "REJECTED")
    b.counts_json = counts
    b.finalized_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "batch_id": str(b.id),
        "state": b.state,
        "counts": counts,
        "concurrency_alerts_created": len(new_alerts),
    }


def _batch_out(b: Batch) -> dict:
    return {
        "id": str(b.id),
        "institution_id": b.institution_id,
        "academic_year": b.academic_year,
        "batch_reference": b.batch_reference,
        "state": b.state,
        "counts": b.counts_json,
        "created_at": b.created_at.isoformat(),
        "finalized_at": b.finalized_at.isoformat() if b.finalized_at else None,
    }


@router.get("")
def list_batches(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Batch)
    if user.role == "institution_admin":
        q = q.filter(Batch.institution_id == user.institution_id)
    batches = q.order_by(Batch.created_at.desc()).limit(50).all()
    return [_batch_out(b) for b in batches]


@router.get("/{batch_id}")
def get_batch(batch_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    b = db.query(Batch).filter(Batch.id == batch_id).first()
    if not b:
        raise HTTPException(404, "Batch not found")
    if user.role == "institution_admin" and b.institution_id != user.institution_id:
        raise HTTPException(403, "Not your batch")
    return _batch_out(b)


@router.get("/{batch_id}/rows")
def get_rows(
    batch_id: UUID,
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = db.query(Batch).filter(Batch.id == batch_id).first()
    if not b:
        raise HTTPException(404, "Batch not found")
    if user.role == "institution_admin" and b.institution_id != user.institution_id:
        raise HTTPException(403, "Not your batch")
    q = db.query(Enrolment).filter(Enrolment.batch_id == batch_id)
    if status_filter:
        q = q.filter(Enrolment.enrolment_status == status_filter)
    rows = q.order_by(Enrolment.row_number).all()
    return [
        {
            "id": str(r.id),
            "row_number": r.row_number,
            "student_id_inst": r.student_id_inst,
            "student_name": r.student_name,
            "apaar_id": r.apaar_id,
            "provisional_id": r.provisional_id,
            "program_code": r.program_code,
            "identity_status": r.identity_status,
            "enrolment_status": r.enrolment_status,
            "admission_date": r.admission_date.isoformat(),
        }
        for r in rows
    ]
