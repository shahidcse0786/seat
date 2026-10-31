import hashlib, hmac
FINGERPRINT_SECRET = "dev_hmac_fingerprint_secret_change_me"
def fingerprint(apaar_id: str) -> str:
    return hmac.new(FINGERPRINT_SECRET.encode(), apaar_id.encode(), hashlib.sha256).hexdigest()
def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()
