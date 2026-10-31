"""Signed revocation manifest — Ed25519-signed JSON."""
import base64
import json
from datetime import datetime, timedelta, timezone

from app.core.keys import get_kid, get_signing_key


def build_manifest(revoked_jtis: list[str]) -> dict:
    now = datetime.now(timezone.utc)
    body = {
        "issued_at": now.isoformat(),
        "next_expected": (now + timedelta(minutes=15)).isoformat(),
        "kid": get_kid(),
        "revoked_jtis": sorted(revoked_jtis),
    }
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    signature = get_signing_key().sign(canonical)
    body["signature"] = base64.b64encode(signature).decode()
    return body
