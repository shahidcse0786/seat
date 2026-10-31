"""SEAT seed data — realistic demo dataset with injected anomalies."""
import hashlib
import hmac
import random
from datetime import datetime, date, timedelta, timezone
from sqlalchemy.orm import Session
from app.models import (
    Institution, Programme, ApprovedIntake, Batch, Enrolment,
    ConcurrencyAlert, Finding, RuleVersion, ConfigSwitch, User,
    ConsentRecord, VTokenRegistry, AuditLog, MLModelVersion,
)

ACADEMIC_YEAR = "2025-26"
SESSION_START = date(2025, 7, 1)
FINGERPRINT_SECRET = "dev_hmac_fingerprint_secret_change_me"
AUDIT_SECRET = "dev_hmac_audit_secret_change_me"

rng = random.Random(42)

INDIAN_FIRST = ["Aarav", "Vivaan", "Aditya", "Diya", "Ananya", "Ishaan", "Krishna",
                "Saanvi", "Myra", "Aadhya", "Reyansh", "Vihaan", "Anika", "Arjun",
                "Sai", "Pari", "Aryan", "Riya", "Kabir", "Prisha", "Rohan",
                "Aanya", "Rudra", "Sara", "Atharv", "Nitya", "Dev", "Meera"]
INDIAN_LAST = ["Sharma", "Verma", "Patel", "Reddy", "Nair", "Iyer", "Gupta",
               "Kumar", "Singh", "Mehta", "Joshi", "Desai", "Rao", "Pillai",
               "Bansal", "Choudhary", "Agarwal", "Bhat", "Shetty", "Khanna"]

INSTITUTIONS = [
    ("INST001", "National Institute of Technology", "Mumbai", "MH", "engineering"),
    ("INST002", "Rajasthan Engineering College",     "Jaipur", "RJ", "engineering"),
    ("INST003", "Symbiosis Business School",         "Pune",   "MH", "management"),
    ("INST004", "St. Xavier's Arts & Science",       "Kolkata","WB", "arts"),
    ("INST005", "JSS College of Pharmacy",           "Mysore", "KA", "pharmacy"),
]

PROGRAMMES = [
    ("INST001", "CSE",    "Computer Science Engineering",       "UG", 120, 105),
    ("INST001", "ECE",    "Electronics & Communication Engg",   "UG",  90,  78),
    ("INST001", "ME",     "Mechanical Engineering",             "UG",  60,  48),
    ("INST002", "CSE",    "Computer Science Engineering",       "UG",  60,  55),
    ("INST002", "ME",     "Mechanical Engineering",             "UG",  60,  63),
    ("INST003", "MBA",    "Master of Business Administration",  "PG", 120, 124),
    ("INST003", "PGDM",   "Post Graduate Diploma in Management","PG",  60,  55),
    ("INST004", "BSC-CS", "B.Sc Computer Science",              "UG",  60,  50),
    ("INST004", "BCOM",   "Bachelor of Commerce",               "UG", 120,  95),
    ("INST005", "BPHARM", "Bachelor of Pharmacy",               "UG", 100,  88),
]

def fingerprint(a): return hmac.new(FINGERPRINT_SECRET.encode(), a.encode(), hashlib.sha256).hexdigest()
def apaar_hmac(a): return hmac.new(AUDIT_SECRET.encode(), a.encode(), hashlib.sha256).hexdigest()
def gen_apaar(): return "".join(str(rng.randint(0, 9)) for _ in range(12))
def pick_name(): return f"{rng.choice(INDIAN_FIRST)} {rng.choice(INDIAN_LAST)}"
def random_admission_date(): return SESSION_START + timedelta(days=rng.randint(0, 55))

def _mk(inst_id, prog_code, seq, apaar=None, identity_status="L3_INSTITUTION_ATTESTED",
        consent="ACTIVE", credential="ACTIVE"):
    if apaar is None:
        return Enrolment(
            institution_id=inst_id, academic_year=ACADEMIC_YEAR, apaar_id=None,
            provisional_id=f"PROV-{inst_id}-{prog_code}-{seq:04d}",
            identity_status="APAAR_PENDING", apaar_fingerprint=None,
            student_id_inst=f"{inst_id}-{prog_code}-{seq:04d}",
            student_name=pick_name(), program_code=prog_code,
            category=rng.choice(["GEN","OBC","SC","ST","EWS"]),
            is_nri=False, is_oci=False, is_foreign_national=False,
            is_supernumerary=False, supernumerary_kind=None,
            admission_date=random_admission_date(), enrolment_status="ACTIVE",
            consent_status="NOT_GRANTED", credential_status="NOT_ISSUED",
        )
    return Enrolment(
        institution_id=inst_id, academic_year=ACADEMIC_YEAR, apaar_id=apaar,
        apaar_fingerprint=fingerprint(apaar), identity_status=identity_status,
        student_id_inst=f"{inst_id}-{prog_code}-{seq:04d}",
        student_name=pick_name(), program_code=prog_code,
        category=rng.choice(["GEN","OBC","SC","ST","EWS"]),
        is_nri=False, is_oci=False, is_foreign_national=False,
        is_supernumerary=False, supernumerary_kind=None,
        admission_date=random_admission_date(), enrolment_status="ACTIVE",
        consent_status=consent, credential_status=credential,
    )

def seed_all(db: Session) -> dict:
    from sqlalchemy import text
    tables = ["audit_log","findings","concurrency_alerts","consent_records","vtoken_registry",
              "enrolments","batches","approved_intake","programmes","institutions",
              "rule_versions","config_switches","ml_model_versions","users"]
    db.execute(text(f"TRUNCATE TABLE {', '.join(tables)} RESTART IDENTITY CASCADE"))
    db.commit()

    for iid, name, city, state, typ in INSTITUTIONS:
        db.add(Institution(id=iid, name=name, city=city, state=state, type=typ))

    for inst_id, code, name, level, seats, _t in PROGRAMMES:
        db.add(Programme(institution_id=inst_id, code=code, name=name, level=level))
        db.add(ApprovedIntake(
            institution_id=inst_id, program_code=code, academic_year=ACADEMIC_YEAR,
            sanctioned_seats=seats,
            supernumerary_json={"TFW": 3, "EWS": int(seats * 0.10), "NRI": 5},
            source="ONOD_MOCK",
            effective_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
        ))

    batches = {}
    for iid, *_ in INSTITUTIONS:
        b = Batch(institution_id=iid, academic_year=ACADEMIC_YEAR,
                  batch_reference=f"SEED-{iid}-{ACADEMIC_YEAR}",
                  state="ACCEPTED", counts_json={},
                  finalized_at=datetime.now(timezone.utc))
        db.add(b); db.flush(); batches[iid] = b.id

    total = 0
    for inst_id, code, _n, _l, _s, target in PROGRAMMES:
        for seq in range(target):
            r = rng.random()
            if r < 0.05:
                e = _mk(inst_id, code, seq+1, apaar=None)
            elif r < 0.15:
                e = _mk(inst_id, code, seq+1, apaar=gen_apaar(), identity_status="L1_FORMAT_VALID", consent="NOT_GRANTED", credential="NOT_ISSUED")
            elif r < 0.30:
                e = _mk(inst_id, code, seq+1, apaar=gen_apaar(), identity_status="L2_EXISTENCE_CONFIRMED", consent="NOT_GRANTED", credential="NOT_ISSUED")
            else:
                e = _mk(inst_id, code, seq+1, apaar=gen_apaar())
            e.batch_id = batches[inst_id]; e.row_number = seq+1
            db.add(e); total += 1
    db.flush()

    dup_specs = [
        ("INST001","CSE","INST002","CSE","HIGH_SUSPICION",5),
        ("INST002","ME","INST003","MBA","HIGH_SUSPICION",12),
        ("INST004","BCOM","INST005","BPHARM","MEDIUM",90),
    ]
    dup_pairs = []
    for a_i, a_p, b_i, b_p, label, gap in dup_specs:
        apaar = gen_apaar(); fp = fingerprint(apaar)
        a = _mk(a_i, a_p, 9001, apaar=apaar); a.batch_id = batches[a_i]; a.row_number = 9001; a.admission_date = SESSION_START
        db.add(a); db.flush()
        b = _mk(b_i, b_p, 9002, apaar=apaar); b.batch_id = batches[b_i]; b.row_number = 9002; b.admission_date = SESSION_START + timedelta(days=gap)
        db.add(b); db.flush()
        db.add(ConcurrencyAlert(
            apaar_fingerprint=fp, academic_year=ACADEMIC_YEAR,
            enrolment_a=a.id, enrolment_b=b.id, match_level="L3",
            time_gap_days=gap, suspicion_label=label, state="UNRESOLVED",
            evidence_json={"a": str(a.id), "b": str(b.id), "gap_days": gap, "label": label},
        ))
        dup_pairs.append((a, b))
    db.flush()

    for inst_id, code, _n, _l, seats, target in PROGRAMMES:
        if target > seats:
            e = db.query(Enrolment).filter_by(institution_id=inst_id, program_code=code).first()
            if e:
                db.add(Finding(
                    enrolment_id=e.id, source="RULE", rule_id="INTAKE_CAP_EXCEEDED",
                    rule_version=datetime(2025, 1, 1, tzinfo=timezone.utc),
                    severity="FAIL", severity_score=5.0,
                    evidence_json={"sanctioned": seats, "reported": target, "overflow": target - seats},
                    status="OPEN",
                ))

    for a, b in dup_pairs:
        db.add(Finding(
            enrolment_id=a.id, source="RULE", rule_id="APAAR_DUPLICATE_CROSS_INSTITUTION",
            rule_version=datetime(2025, 1, 1, tzinfo=timezone.utc),
            severity="REVIEW", severity_score=4.0, confidence="L3",
            evidence_json={"paired_enrolment": str(b.id), "other_institution": b.institution_id},
            status="OPEN",
        ))

    rules = [("APAAR_FORMAT",5.0),("APAAR_DUPLICATE_IN_BATCH",5.0),
             ("APAAR_DUPLICATE_CROSS_INSTITUTION",4.0),("MISSING_MANDATORY_FIELD",5.0),
             ("PROGRAM_CODE_NOT_IN_CATALOG",5.0),("ADMISSION_YEAR_MISMATCH",1.0),
             ("INTAKE_CAP_EXCEEDED",5.0),("SUPERNUMERARY_CAP_EXCEEDED",3.0),
             ("NRI_OCI_FN_FLAG_INCONSISTENT",1.0),("TFW_INCOME_CEILING_EXCEEDED",2.0),
             ("SEAT_COUNT_MISMATCH",1.0),("DUPLICATE_STUDENT_ID_WITHIN_INSTITUTION",5.0)]
    for rid, w in rules:
        db.add(RuleVersion(
            rule_id=rid, valid_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
            scope={}, created_by="system",
            rule_json={"rule_id": rid, "weight": w, "severity": "FAIL" if w >= 5 else "WARN"},
        ))

    switches = {
        "S1_APAAR_CHECKSUM_SCHEME": "OFF", "S2_L2_GATEWAY_ENABLED": "OFF",
        "S3_CAPACITY_POLICY_ON_BREACH": "HOLD_OVERFLOW", "S4_TFW_INCOME_CEILING": 250000,
        "S5_SUPERNUMERARY_POOLS": {"TFW": 3, "EWS": 6, "NRI": 5},
        "S6_FALLBACK_IDENTIFIER_POLICY": "PROVISIONAL_ID",
        "S7_CONSENT_EXPIRY_DEFAULT_DAYS": 365, "S8_VTOKEN_EXPIRY_HOURS": 24,
        "S9_ML_ENABLED": "ON", "S10_ML_CONTAMINATION": 0.05,
        "S11_STAT_CHECK_B_HISTORY_AVAILABLE": "OFF",
        "S14_QUARANTINED_RELEASES_UNIQUENESS": "ON",
        "S15_DATA_RETENTION_PERIODS": {"enrolments_years": 7, "audit_years": 10},
    }
    for k, v in switches.items():
        db.add(ConfigSwitch(key=k, value_json={"v": v}, owner="AICTE", updated_by="system"))

    from passlib.context import CryptContext
    ctx = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
    pw = ctx.hash("demo1234")
    for email, role, inst in [
        ("admin@aicte.gov.in", "aicte_admin", None),
        ("registrar@inst001.edu", "institution_admin", "INST001"),
        ("auditor@aicte.gov.in", "regulator_auditor", None),
        ("verifier@company.com", "employer_verifier", None),
        ("operator@seat.local", "seat_operator", None),
    ]:
        db.add(User(email=email, password_hash=pw, role=role, institution_id=inst))

    db.add(MLModelVersion(
        model_version="iforest-v0.1.0",
        trained_at=datetime(2025, 6, 1, tzinfo=timezone.utc),
        features_json={"version": 1, "count": 8},
        contamination=0.05, artefact_hash="0"*64,
        notes="Placeholder — trained in Phase 9",
    ))

    db.commit()

    from sqlalchemy import func, select
    for iid, b_id in batches.items():
        rows = db.query(Enrolment).filter_by(batch_id=b_id).all()
        b = db.query(Batch).filter_by(id=b_id).first()
        if b:
            b.counts_json = {
                "submitted": len(rows), "accepted": len(rows), "quarantined": 0,
                "pending": 0,
                "apaar_pending": sum(1 for r in rows if r.identity_status == "APAAR_PENDING"),
                "l3_attested": sum(1 for r in rows if r.identity_status == "L3_INSTITUTION_ATTESTED"),
            }
    db.commit()

    return {
        "institutions": db.query(Institution).count(),
        "programmes": db.query(Programme).count(),
        "approved_seats": db.query(func.sum(ApprovedIntake.sanctioned_seats)).scalar() or 0,
        "enrolments": db.query(Enrolment).count(),
        "concurrency_alerts": db.query(ConcurrencyAlert).count(),
        "findings": db.query(Finding).count(),
        "rule_versions": db.query(RuleVersion).count(),
        "config_switches": db.query(ConfigSwitch).count(),
        "users": db.query(User).count(),
    }
