"""Verification: L3 attestation, VToken issuance, credential verify, revocation list."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.vtoken import issue_vtoken, decode_and_verify
from app.models import ConsentRecord, Enrolment, User, VTokenRegistry

router = APIRouter(tags=["verification"])


class AttestOut(BaseModel):
    enrolment_id: str
    identity_status: str
    vtoken: str
    jti: str
    expires_at: str
    kid: str


class VerifyIn(BaseModel):
    vtoken: str
    purpose: str = "EMPLOYER_VERIFY"


class VerifyOut(BaseModel):
    status: str
    assertions: dict
    claims: dict
    checked_at: str
    reason: str | None = None


# ---- L3 attestation: L1/L2 -> L3 + issue VToken ----

@router.post("/verification/attest/{enrolment_id}", response_model=AttestOut)
def attest_l3(
    enrolment_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    e = db.query(Enrolment).filter(Enrolment.id == enrolment_id).first()
    if not e:
        raise HTTPException(404, "Enrolment not found")
    if user.role == "institution_admin" and user.institution_id != e.institution_id:
        raise HTTPException(403, "Not your enrolment")
    if user.role not in ("institution_admin", "aicte_admin", "seat_operator"):
        raise HTTPException(403, "Attestation requires institution or admin role")

    if e.identity_status not in (
        "L1_FORMAT_VALID", "L2_EXISTENCE_CONFIRMED", "L3_INSTITUTION_ATTESTED",
    ):
        raise HTTPException(400, f"Cannot attest from {e.identity_status} — must be L1 or higher")
    if not e.apaar_fingerprint:
        raise HTTPException(400, "Row has no APAAR fingerprint (provisional) — cannot attest to L3")

    now = datetime.now(timezone.utc)
    consent = ConsentRecord(
        enrolment_id=e.id,
        purpose="EMPLOYER_VERIFY",
        scope_json={"fields": ["enrolment_status", "programme", "academic_year", "institution"]},
        granted_at=now,
        expires_at=now + timedelta(days=365),
        consent_jws="demo-consent-jws-" + str(e.id),
    )
    db.add(consent)
    db.flush()

    e.identity_status = "L3_INSTITUTION_ATTESTED"
    e.consent_status = "ACTIVE"
    e.credential_status = "ACTIVE"

    vtok = issue_vtoken(
        enrolment_id=str(e.id),
        institution_id=e.institution_id,
        program_code=e.program_code,
        academic_year=e.academic_year,
        consent_ref=str(consent.id),
        subject_fp=e.apaar_fingerprint,
        purpose="EMPLOYER_VERIFY",
    )

    db.add(VTokenRegistry(
        jti=vtok["jti"],
        enrolment_id=e.id,
        expires_at=datetime.fromisoformat(vtok["expires_at"]),
        rev_check_after=datetime.fromisoformat(vtok["rev_check_after"]),
        audience="seat:employer-verify",
    ))

    e.enrolment_vtoken = vtok["vtoken"]

    append_audit(
        db,
        actor_id=user.email,
        actor_role=user.role,
        action="VTOKEN_ISSUED",
        target_type="enrolment",
        target_id=str(e.id),
        payload={
            "jti": vtok["jti"],
            "institution_id": e.institution_id,
            "program_code": e.program_code,
            "kid": vtok["kid"],
        },
    )

    db.commit()

    return AttestOut(
        enrolment_id=str(e.id),
        identity_status=e.identity_status,
        vtoken=vtok["vtoken"],
        jti=vtok["jti"],
        expires_at=vtok["expires_at"],
        kid=vtok["kid"],
    )


# ---- Verify credential (public — employer calls this) ----

def _safe_claims(c: dict) -> dict:
    return {
        "institution": c.get("institution_id"),
        "programme": c.get("program_code"),
        "academic_year": c.get("academic_year"),
        "identity_level": c.get("identity_level"),
        "credential_type": c.get("credential_type"),
    }


def _fail(status_: str, checked_at: str, reason: str, claims: dict | None = None,
          b_level: str | None = None) -> VerifyOut:
    return VerifyOut(
        status=status_,
        assertions={
            "a_exists": claims is not None,
            "b_identity_level": b_level,
            "c_institution_signed": claims is not None,
            "d_currently_valid": False,
        },
        claims=_safe_claims(claims or {}),
        checked_at=checked_at,
        reason=reason,
    )


@router.post("/verify/credential", response_model=VerifyOut)
def verify_credential(body: VerifyIn, db: Session = Depends(get_db)):
    checked_at = datetime.now(timezone.utc).isoformat()

    # 1. Signature + expiry + audience
    try:
        claims = decode_and_verify(body.vtoken, expected_audience="seat:employer-verify")
    except ValueError as e:
        msg = str(e)
        reason = "INVALID_SIGNATURE"
        if "expired" in msg.lower() or "expir" in msg.lower():
            reason = "EXPIRED"
        elif "audience" in msg.lower():
            reason = "AUDIENCE_MISMATCH"
        elif "issuer" in msg.lower():
            reason = "ISSUER_MISMATCH"
        return _fail(reason, checked_at, msg)

    jti = claims.get("jti")

    # 2. Revocation lookup
    reg = db.query(VTokenRegistry).filter(VTokenRegistry.jti == jti).first()
    if not reg:
        return _fail("UNKNOWN_JTI", checked_at,
                     "Token JTI not in registry", claims, claims.get("identity_level"))
    if reg.revoked_at:
        return _fail("REVOKED", checked_at,
                     "Token has been revoked", claims, claims.get("identity_level"))

    # 3. Consent check
    consent_ref = claims.get("consent_ref")
    consent = None
    if consent_ref:
        try:
            consent = db.query(ConsentRecord).filter(ConsentRecord.id == UUID(consent_ref)).first()
        except (ValueError, TypeError):
            consent = None
    if not consent:
        return _fail("CONSENT_NOT_FOUND", checked_at,
                     "Consent record missing", claims, claims.get("identity_level"))
    if consent.withdrawn_at:
        return _fail("CONSENT_WITHDRAWN", checked_at,
                     "Consent withdrawn", claims, claims.get("identity_level"))
    if consent.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return _fail("CONSENT_EXPIRED", checked_at,
                     "Consent expired", claims, claims.get("identity_level"))

    # 4. All good
    return VerifyOut(
        status="VALID",
        assertions={
            "a_exists": True,
            "b_identity_level": claims.get("identity_level"),
            "c_institution_signed": True,
            "d_currently_valid": True,
        },
        claims=_safe_claims(claims),
        checked_at=checked_at,
        reason=None,
    )


# ---- Revocation manifest (simplified) ----

@router.get("/verify/revocation-list")
def revocation_list(db: Session = Depends(get_db)):
    revoked = db.query(VTokenRegistry).filter(VTokenRegistry.revoked_at.isnot(None)).all()
    now = datetime.now(timezone.utc)
    return {
        "issued_at": now.isoformat(),
        "next_expected": (now + timedelta(minutes=15)).isoformat(),
        "revoked_jtis": [r.jti for r in revoked],
        "note": "Prototype: unsigned manifest (Phase 11 adds Ed25519 signature)",
    }


# ---- Public key disclosure (for external verifiers) ----

@router.get("/verify/public-key")
def public_key():
    from app.core.keys import get_public_key_info
    return get_public_key_info()


# ==================== Revoke + list tokens ====================

from sqlalchemy import desc
from app.core.audit import append_audit


@router.post("/verify/revoke/{jti}")
def revoke_token(
    jti: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("institution_admin", "aicte_admin", "seat_operator"):
        raise HTTPException(403, "Revocation requires institution or admin role")
    reg = db.query(VTokenRegistry).filter(VTokenRegistry.jti == jti).first()
    if not reg:
        raise HTTPException(404, "Token not found")
    e = db.query(Enrolment).filter(Enrolment.id == reg.enrolment_id).first()
    if not e:
        raise HTTPException(404, "Enrolment not found")
    if user.role == "institution_admin" and e.institution_id != user.institution_id:
        raise HTTPException(403, "Not your institution's token")
    if reg.revoked_at:
        return {"jti": jti, "revoked_at": reg.revoked_at.isoformat(), "already_revoked": True}

    now = datetime.now(timezone.utc)
    reg.revoked_at = now
    if e.credential_status == "ACTIVE":
        e.credential_status = "REVOKED"
    append_audit(
        db,
        actor_id=user.email,
        actor_role=user.role,
        action="VTOKEN_REVOKED",
        target_type="vtoken",
        target_id=jti,
        payload={"enrolment_id": str(e.id), "institution_id": e.institution_id},
    )
    db.commit()
    return {"jti": jti, "revoked_at": now.isoformat(), "already_revoked": False}


@router.get("/verify/my-tokens")
def my_tokens(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(VTokenRegistry, Enrolment).join(
        Enrolment, VTokenRegistry.enrolment_id == Enrolment.id
    )
    if user.role == "institution_admin":
        q = q.filter(Enrolment.institution_id == user.institution_id)
    rows = q.order_by(desc(VTokenRegistry.issued_at)).limit(100).all()
    return [
        {
            "jti": reg.jti,
            "enrolment_id": str(reg.enrolment_id),
            "institution_id": e.institution_id,
            "programme": e.program_code,
            "student_name": e.student_name,
            "issued_at": reg.issued_at.isoformat(),
            "expires_at": reg.expires_at.isoformat(),
            "revoked_at": reg.revoked_at.isoformat() if reg.revoked_at else None,
            "status": "REVOKED" if reg.revoked_at else ("EXPIRED" if reg.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc) else "ACTIVE"),
        }
        for reg, e in rows
    ]
