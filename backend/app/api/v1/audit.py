"""Audit chain — verify, list, stats, demo tamper comparison."""
import hashlib

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import AuditLog, User

router = APIRouter(prefix="/audit", tags=["audit"])


def _compute_entry_hash(row: AuditLog) -> str:
    """Recompute entry_hash from stored fields — must match what append_audit wrote."""
    entry_data = (
        f"{row.prev_hash}|{row.actor_id}|{row.actor_role}|{row.action}|"
        f"{row.target_type or ''}|{row.target_id or ''}|{row.payload_hash}"
    )
    return hashlib.sha256(entry_data.encode()).hexdigest()


def _verify_chain(rows: list[AuditLog]) -> dict:
    """Walk the chain in order. Verify hash continuity + recomputed hash match."""
    if not rows:
        return {"chain_valid": True, "entries": 0, "first_invalid_id": None,
                "reason": "Empty chain (GENESIS only)", "broken_at_action": None}

    expected_prev = "GENESIS"
    for row in rows:
        if row.prev_hash != expected_prev:
            return {
                "chain_valid": False,
                "entries": len(rows),
                "first_invalid_id": row.id,
                "reason": f"prev_hash mismatch: expected {expected_prev[:16]}…, got {row.prev_hash[:16]}…",
                "broken_at_action": row.action,
            }
        recomputed = _compute_entry_hash(row)
        if recomputed != row.entry_hash:
            return {
                "chain_valid": False,
                "entries": len(rows),
                "first_invalid_id": row.id,
                "reason": f"entry_hash mismatch at #{row.id}: recomputed {recomputed[:16]}… vs stored {row.entry_hash[:16]}…",
                "broken_at_action": row.action,
            }
        expected_prev = row.entry_hash

    return {
        "chain_valid": True,
        "entries": len(rows),
        "first_invalid_id": None,
        "reason": "All hashes chain correctly",
        "broken_at_action": None,
    }


@router.get("/verify")
def verify(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).all()
    result = _verify_chain(rows)
    result["tail_hash"] = rows[-1].entry_hash if rows else "GENESIS"
    return result


@router.get("/stats")
def stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    total = db.query(func.count(AuditLog.id)).scalar() or 0
    by_action = dict(
        db.query(AuditLog.action, func.count(AuditLog.id))
        .group_by(AuditLog.action)
        .order_by(desc(func.count(AuditLog.id)))
        .all()
    )
    by_actor_role = dict(
        db.query(AuditLog.actor_role, func.count(AuditLog.id))
        .group_by(AuditLog.actor_role)
        .all()
    )
    tail = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
    return {
        "total_entries": int(total),
        "by_action": by_action,
        "by_actor_role": by_actor_role,
        "latest_hash": tail.entry_hash if tail else "GENESIS",
        "latest_created_at": tail.created_at.isoformat() if tail else None,
    }


@router.get("/entries")
def entries(
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    action_filter: str | None = Query(None, alias="action"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(AuditLog)
    if action_filter:
        q = q.filter(AuditLog.action == action_filter)
    total = q.count()
    rows = q.order_by(AuditLog.id.desc()).offset(offset).limit(limit).all()
    return {
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "entries": [
            {
                "id": r.id,
                "prev_hash": r.prev_hash[:16] + "…",
                "entry_hash": r.entry_hash[:16] + "…",
                "entry_hash_full": r.entry_hash,
                "prev_hash_full": r.prev_hash,
                "actor_id": r.actor_id,
                "actor_role": r.actor_role,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "payload_hash": r.payload_hash[:16] + "…",
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/demo/tamper-proof")
def tamper_proof(
    tamper_at_index: int = Query(3, ge=1, le=50, description="Index (0-based within first 50) to tamper"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Demo: compare real chain verification vs a tampered in-memory copy.

    Read-only — does NOT touch the real audit_log. Shows what happens
    when a mid-chain entry's payload_hash is modified.
    """
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).limit(50).all()
    if len(rows) < 3:
        return {
            "note": "Need at least 3 entries. Perform some actions first (verify tokens, train ML, resolve alerts).",
            "entries_available": len(rows),
        }

    # Original verification
    original = _verify_chain(rows)

    # Build in-memory tampered copy
    tamper_idx = min(tamper_at_index, len(rows) - 1)
    tampered_rows = list(rows)  # shallow copy of list, same objects
    # Deep-ish copy the one we'll mutate
    class _Row:
        def __init__(self, src):
            self.id = src.id
            self.prev_hash = src.prev_hash
            self.entry_hash = src.entry_hash
            self.actor_id = src.actor_id
            self.actor_role = src.actor_role
            self.action = src.action
            self.target_type = src.target_type
            self.target_id = src.target_id
            self.payload_hash = src.payload_hash

    clone = [_Row(r) for r in rows]
    # Tamper payload_hash of the chosen entry (simulating someone editing the DB)
    target = clone[tamper_idx]
    target.payload_hash = "f" * 64  # clearly not a real hash

    tampered_result = _verify_chain(clone)

    return {
        "original": {
            **original,
            "note": "Real chain in your database",
        },
        "tampered": {
            **tampered_result,
            "note": f"Simulated: payload_hash of entry #{target.id} ({target.action}) changed to all-f's",
            "tampered_entry_id": target.id,
            "tampered_action": target.action,
        },
        "entries_compared": len(rows),
        "tamper_index": tamper_idx,
    }
