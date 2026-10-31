"""Public verify-by-jti — used by QR codes on printed certificates."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import ConsentRecord, Enrolment, VTokenRegistry

router = APIRouter(prefix="/public", tags=["public"])


def _fail(status: str, reason: str) -> dict:
    return {
        "status": status,
        "reason": reason,
        "assertions": {
            "a_exists": False,
            "b_identity_level": None,
            "c_institution_signed": False,
            "d_currently_valid": False,
        },
        "claims": {},
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/verify-jti/{jti}")
def verify_by_jti(jti: str, request: Request, db: Session = Depends(get_db)):
    """Verify a token by jti — QR on printed certificate points here.

    Safe by design: jti alone cannot forge a token. Server does the checks.
    """
    reg = db.query(VTokenRegistry).filter(VTokenRegistry.jti == jti).first()
    if not reg:
        return _fail("UNKNOWN_JTI", "Token not in registry")
    if reg.revoked_at:
        return _fail("REVOKED", "Token has been revoked")
    if reg.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return _fail("EXPIRED", "Token has expired")

    e = db.query(Enrolment).filter(Enrolment.id == reg.enrolment_id).first()
    if not e:
        return _fail("ENROLMENT_NOT_FOUND", "Enrolment no longer exists")

    consent = db.query(ConsentRecord).filter(
        ConsentRecord.enrolment_id == e.id,
        ConsentRecord.purpose == "EMPLOYER_VERIFY",
        ConsentRecord.withdrawn_at.is_(None),
    ).order_by(ConsentRecord.granted_at.desc()).first()

    if not consent:
        return _fail("CONSENT_NOT_FOUND", "No active consent")
    if consent.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return _fail("CONSENT_EXPIRED", "Consent expired")

    return {
        "status": "VALID",
        "reason": None,
        "assertions": {
            "a_exists": True,
            "b_identity_level": e.identity_status,
            "c_institution_signed": True,
            "d_currently_valid": True,
        },
        "claims": {
            "institution": e.institution_id,
            "programme": e.program_code,
            "academic_year": e.academic_year,
            "identity_level": e.identity_status,
            "credential_type": "ENROLMENT_VERIFICATION",
        },
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
