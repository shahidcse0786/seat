"""VToken — Ed25519-signed JWT for L3 institution-attested enrolments.

Signed directly with `cryptography` (not python-jose, which doesn't support EdDSA).
JWT format: base64url(header) + "." + base64url(claims) + "." + base64url(sig)
"""
import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.core.keys import get_signing_key, get_kid, get_public_key_info

ISSUER = "seat:aicte-verifier"
DEFAULT_AUDIENCE = "seat:employer-verify"
DEFAULT_TTL_HOURS = 24
REV_CHECK_INTERVAL_MINUTES = 15


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def issue_vtoken(
    enrolment_id: str,
    institution_id: str,
    program_code: str,
    academic_year: str,
    consent_ref: str,
    subject_fp: str,
    purpose: str = "EMPLOYER_VERIFY",
    audience: str = DEFAULT_AUDIENCE,
) -> dict:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=DEFAULT_TTL_HOURS)
    rev_check_after = now + timedelta(minutes=REV_CHECK_INTERVAL_MINUTES)
    jti = str(uuid.uuid4())
    kid = get_kid()

    header = {"alg": "EdDSA", "typ": "JWT", "kid": kid}
    claims = {
        "iss": ISSUER,
        "sub": subject_fp,
        "aud": audience,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "enrolment_id": enrolment_id,
        "institution_id": institution_id,
        "program_code": program_code,
        "academic_year": academic_year,
        "identity_level": "L3_INSTITUTION_ATTESTED",
        "consent_ref": consent_ref,
        "consent_purpose": purpose,
        "credential_type": "ENROLMENT_VERIFICATION",
        "rev_check_after": int(rev_check_after.timestamp()),
    }

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    claims_b64 = _b64url_encode(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{claims_b64}".encode("ascii")
    signature = get_signing_key().sign(signing_input)
    sig_b64 = _b64url_encode(signature)
    token = f"{header_b64}.{claims_b64}.{sig_b64}"

    return {
        "vtoken": token,
        "jti": jti,
        "issued_at": now.isoformat(),
        "expires_at": exp.isoformat(),
        "rev_check_after": rev_check_after.isoformat(),
        "kid": kid,
    }


def decode_and_verify(token: str, expected_audience: str | None = None) -> dict:
    """Verify signature + expiry + issuer + audience. Returns claims, or raises ValueError."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed token — expected 3 parts")
    header_b64, claims_b64, sig_b64 = parts

    try:
        header = json.loads(_b64url_decode(header_b64))
        claims = json.loads(_b64url_decode(claims_b64))
        signature = _b64url_decode(sig_b64)
    except Exception as e:
        raise ValueError(f"Malformed token encoding: {e}")

    if header.get("alg") != "EdDSA":
        raise ValueError(f"Unexpected algorithm: {header.get('alg')}")

    pub_raw = base64.b64decode(get_public_key_info()["public_key_b64"])
    pub_key = Ed25519PublicKey.from_public_bytes(pub_raw)

    signing_input = f"{header_b64}.{claims_b64}".encode("ascii")
    try:
        pub_key.verify(signature, signing_input)
    except InvalidSignature:
        raise ValueError("Signature verification failed")

    now = int(datetime.now(timezone.utc).timestamp())
    if claims.get("exp", 0) < now:
        raise ValueError("Token expired")
    if claims.get("iat", 0) > now + 60:
        raise ValueError("Token not yet valid")

    if claims.get("iss") != ISSUER:
        raise ValueError(f"Unexpected issuer: {claims.get('iss')}")

    if expected_audience is not None and claims.get("aud") != expected_audience:
        raise ValueError(f"Audience mismatch: got {claims.get('aud')}, expected {expected_audience}")

    return claims
