"""Public employer verification — no auth required.

Returns only role-masked claims. Logs every attempt to the audit chain.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.database import get_db
from app.core.manifest import build_manifest
from app.core.vtoken import decode_and_verify
from app.models import ConsentRecord, Enrolment, VTokenRegistry

router = APIRouter(prefix="/public", tags=["public"])


class VerifyIn(BaseModel):
    vtoken: str


def _safe(claims: dict) -> dict:
    return {
        "institution": claims.get("institution_id"),
        "programme": claims.get("program_code"),
        "academic_year": claims.get("academic_year"),
        "identity_level": claims.get("identity_level"),
        "credential_type": claims.get("credential_type"),
    }


def _fail(status: str, reason: str, claims: dict | None = None) -> dict:
    return {
        "status": status,
        "reason": reason,
        "assertions": {
            "a_exists": claims is not None,
            "b_identity_level": (claims or {}).get("identity_level"),
            "c_institution_signed": claims is not None,
            "d_currently_valid": False,
        },
        "claims": _safe(claims or {}),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/verify-credential")
def public_verify(body: VerifyIn, request: Request, db: Session = Depends(get_db)):
    checked_at = datetime.now(timezone.utc).isoformat()

    # 1. Signature + expiry + audience + issuer
    try:
        claims = decode_and_verify(body.vtoken, expected_audience="seat:employer-verify")
    except ValueError as e:
        msg = str(e)
        reason = "INVALID_SIGNATURE"
        if "expired" in msg.lower():
            reason = "EXPIRED"
        elif "audience" in msg.lower():
            reason = "AUDIENCE_MISMATCH"
        elif "issuer" in msg.lower():
            reason = "ISSUER_MISMATCH"
        elif "malformed" in msg.lower():
            reason = "MALFORMED_TOKEN"
        _log(db, request, reason, None)
        return _fail(reason, msg)

    jti = claims.get("jti")

    # 2. Revocation
    reg = db.query(VTokenRegistry).filter(VTokenRegistry.jti == jti).first()
    if not reg:
        _log(db, request, "UNKNOWN_JTI", jti)
        return _fail("UNKNOWN_JTI", "Token not in registry", claims)
    if reg.revoked_at:
        _log(db, request, "REVOKED", jti)
        return _fail("REVOKED", "Token has been revoked", claims)

    # 3. Consent
    consent_ref = claims.get("consent_ref")
    consent = None
    if consent_ref:
        try:
            consent = db.query(ConsentRecord).filter(
                ConsentRecord.id == UUID(consent_ref)
            ).first()
        except (ValueError, TypeError):
            consent = None
    if not consent:
        _log(db, request, "CONSENT_NOT_FOUND", jti)
        return _fail("CONSENT_NOT_FOUND", "Consent record missing", claims)
    if consent.withdrawn_at:
        _log(db, request, "CONSENT_WITHDRAWN", jti)
        return _fail("CONSENT_WITHDRAWN", "Consent withdrawn", claims)
    if consent.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        _log(db, request, "CONSENT_EXPIRED", jti)
        return _fail("CONSENT_EXPIRED", "Consent expired", claims)

    _log(db, request, "VALID", jti)
    return {
        "status": "VALID",
        "reason": None,
        "assertions": {
            "a_exists": True,
            "b_identity_level": claims.get("identity_level"),
            "c_institution_signed": True,
            "d_currently_valid": True,
        },
        "claims": _safe(claims),
        "checked_at": checked_at,
    }


def _log(db: Session, request: Request, result: str, jti: str | None):
    try:
        append_audit(
            db,
            actor_id="public:employer",
            actor_role="employer_verifier",
            action=f"PUBLIC_VERIFY_{result}",
            target_type="vtoken",
            target_id=jti,
            payload={"result": result, "ua": (request.headers.get("user-agent") or "")[:80]},
        )
        db.commit()
    except Exception:
        db.rollback()  # never let audit failure break verification


@router.get("/revocation-manifest")
def public_manifest(db: Session = Depends(get_db)):
    revoked = db.query(VTokenRegistry).filter(
        VTokenRegistry.revoked_at.isnot(None)
    ).all()
    return build_manifest([r.jti for r in revoked])


@router.get("/public-key")
def public_key():
    from app.core.keys import get_public_key_info
    return get_public_key_info()


@router.get("/info")
def info():
    return {
        "name": "SEAT Public Verification Gateway",
        "issuer": "seat:aicte-verifier",
        "credential_type": "ENROLMENT_VERIFICATION",
        "note": "Not a degree credential. Verification establishes enrolment record at L3, not graduation.",
    }
