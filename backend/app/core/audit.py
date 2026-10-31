"""Hash-chained audit log. Serialised with a Postgres advisory lock."""
import hashlib
import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import AuditLog


def _canonical_json(data: dict) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def append_audit(
    db: Session,
    actor_id: str,
    actor_role: str,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    payload: dict[str, Any] | None = None,
    apaar_hmac: str | None = None,
) -> AuditLog:
    """Append a hash-chained audit entry. Serialises with advisory lock.

    Uses db.flush() before the query so that any earlier append_audit()
    calls in the SAME transaction are visible to the "latest entry"
    lookup. This is required because the session is configured with
    autoflush=False.
    """
    # Serialise concurrent appends so the chain cannot fork
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('seat.audit_log'))"))

    # Make previously-added-but-not-yet-committed entries visible
    db.flush()

    payload_json = _canonical_json(payload or {})
    payload_hash = hashlib.sha256(payload_json.encode()).hexdigest()

    last = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
    prev_hash = last.entry_hash if last else "GENESIS"

    entry_data = (
        f"{prev_hash}|{actor_id}|{actor_role}|{action}|"
        f"{target_type or ''}|{target_id or ''}|{payload_hash}"
    )
    entry_hash = hashlib.sha256(entry_data.encode()).hexdigest()

    entry = AuditLog(
        prev_hash=prev_hash,
        entry_hash=entry_hash,
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        target_type=target_type,
        target_id=target_id,
        payload_hash=payload_hash,
        apaar_hmac=apaar_hmac,
    )
    db.add(entry)
    return entry
