"""Ed25519 key management for VToken signing. Persists to /app/.keys."""
import base64
import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

# Try /app/.keys, fall back to /tmp if mount is read-only
KEY_DIR = Path("/app/.keys")
try:
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    (KEY_DIR / ".write_test").touch()
    (KEY_DIR / ".write_test").unlink()
except (OSError, PermissionError):
    KEY_DIR = Path("/tmp/seat_keys")
    KEY_DIR.mkdir(parents=True, exist_ok=True)

PRIVATE_KEY_PATH = KEY_DIR / "ed25519.pem"
META_PATH = KEY_DIR / "meta.json"

_signing_key: Ed25519PrivateKey | None = None
_meta: dict | None = None


def _load_or_create() -> tuple[Ed25519PrivateKey, dict]:
    if PRIVATE_KEY_PATH.exists() and META_PATH.exists():
        pem = PRIVATE_KEY_PATH.read_bytes()
        key = serialization.load_pem_private_key(pem, password=None)
        meta = json.loads(META_PATH.read_text())
        return key, meta  # type: ignore

    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    PRIVATE_KEY_PATH.write_bytes(pem)

    pub_raw = key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    kid = hashlib.sha256(pub_raw).hexdigest()[:16]
    meta = {
        "kid": kid,
        "public_key_b64": base64.b64encode(pub_raw).decode(),
    }
    META_PATH.write_text(json.dumps(meta))
    return key, meta


def _ensure() -> None:
    global _signing_key, _meta
    if _signing_key is None:
        _signing_key, _meta = _load_or_create()


def get_signing_key() -> Ed25519PrivateKey:
    _ensure()
    return _signing_key  # type: ignore


def get_private_pem() -> bytes:
    _ensure()
    return _signing_key.private_bytes(  # type: ignore
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


def get_kid() -> str:
    _ensure()
    return _meta["kid"]  # type: ignore


def get_public_key_info() -> dict:
    _ensure()
    return {
        "kid": _meta["kid"],  # type: ignore
        "public_key_b64": _meta["public_key_b64"],  # type: ignore
    }
