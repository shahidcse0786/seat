"""Certificate metadata for a single L3 enrolment."""
import base64
import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.keys import get_public_key_info
from app.models import Enrolment, Institution, User, VTokenRegistry

router = APIRouter(prefix="/certificate", tags=["certificate"])


@router.get("/{enrolment_id}")
def get_certificate_metadata(
    enrolment_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    e = db.query(Enrolment).filter(Enrolment.id == enrolment_id).first()
    if not e:
        raise HTTPException(404, "Enrolment not found")
    if user.role == "institution_admin" and e.institution_id != user.institution_id:
        raise HTTPException(403, "Not your institution's enrolment")
    if e.identity_status != "L3_INSTITUTION_ATTESTED":
        raise HTTPException(400, f"Cannot issue certificate for {e.identity_status} — must be L3 attested")

    reg = db.query(VTokenRegistry).filter(
        VTokenRegistry.enrolment_id == e.id,
        VTokenRegistry.revoked_at.is_(None),
    ).order_by(VTokenRegistry.issued_at.desc()).first()

    if not reg:
        raise HTTPException(400, "No active VToken — attest the enrolment first (issue a fresh token)")

    inst = db.query(Institution).filter(Institution.id == e.institution_id).first()

    pub = get_public_key_info()
    pub_raw = base64.b64decode(pub["public_key_b64"])
    fp = hashlib.sha256(pub_raw).hexdigest()[:16]

    apaar_display = "XXXX-XXXX-XXXX"
    if e.apaar_id and len(e.apaar_id) == 12:
        apaar_display = f"XXXX-XXXX-{e.apaar_id[-4:]}"
    elif e.provisional_id:
        apaar_display = "PROVISIONAL"

    return {
        "enrolment_id": str(e.id),
        "student_name": e.student_name,
        "student_id_inst": e.student_id_inst,
        "program_code": e.program_code,
        "academic_year": e.academic_year,
        "institution_id": e.institution_id,
        "institution_name": inst.name if inst else e.institution_id,
        "institution_city": inst.city if inst else "",
        "institution_state": inst.state if inst else "",
        "identity_status": e.identity_status,
        "credential_status": e.credential_status,
        "apaar_display_masked": apaar_display,
        "vtoken_jti": reg.jti,
        "kid": pub["kid"],
        "public_key_fingerprint": fp,
        "issued_at": reg.issued_at.isoformat(),
        "expires_at": reg.expires_at.isoformat(),
        "credential_type": "ENROLMENT_VERIFICATION",
    }
