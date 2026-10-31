"""SEAT rules engine — 12 deterministic rules evaluated on batch finalize.

Each rule takes an enrolment + precomputed context and returns None or
(severity, evidence_json, should_quarantine). The engine orchestrates them,
records Finding rows, and marks rows for quarantine when required.
"""
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import ApprovedIntake, Batch, Enrolment, Finding

# Severity weights — matches spec §3.8.4
RULE_WEIGHTS = {
    "APAAR_FORMAT": 5.0,
    "APAAR_DUPLICATE_IN_BATCH": 5.0,
    "APAAR_DUPLICATE_CROSS_INSTITUTION": 4.0,
    "MISSING_MANDATORY_FIELD": 5.0,
    "PROGRAM_CODE_NOT_IN_CATALOG": 5.0,
    "ADMISSION_YEAR_MISMATCH": 1.0,
    "INTAKE_CAP_EXCEEDED": 5.0,
    "SUPERNUMERARY_CAP_EXCEEDED": 3.0,
    "NRI_OCI_FN_FLAG_INCONSISTENT": 1.0,
    "TFW_INCOME_CEILING_EXCEEDED": 2.0,
    "SEAT_COUNT_MISMATCH": 1.0,
    "DUPLICATE_STUDENT_ID_WITHIN_INSTITUTION": 5.0,
}


def _mk_finding(enrolment: Enrolment, rule_id: str, severity: str, evidence: dict,
                confidence: str | None = None) -> Finding:
    return Finding(
        enrolment_id=enrolment.id,
        source="RULE",
        rule_id=rule_id,
        rule_version=datetime(2025, 1, 1, tzinfo=timezone.utc),
        severity=severity,
        severity_score=RULE_WEIGHTS.get(rule_id, 1.0),
        evidence_json=evidence,
        confidence=confidence,
        status="OPEN",
    )


def evaluate_batch(db: Session, batch: Batch, rows: list[Enrolment]) -> list[tuple[Enrolment, Finding, bool]]:
    """Run all 12 rules. Returns list of (enrolment, finding, should_quarantine)."""
    results: list[tuple[Enrolment, Finding, bool]] = []

    # ---- Precompute batch-scoped context ----
    capacities: dict[str, ApprovedIntake] = {
        ai.program_code: ai
        for ai in db.query(ApprovedIntake).filter(
            ApprovedIntake.institution_id == batch.institution_id,
            ApprovedIntake.academic_year == batch.academic_year,
        ).all()
    }

    program_counts = Counter(r.program_code for r in rows if r.program_code)
    supernum_counts = Counter(
        (r.program_code, r.supernumerary_kind)
        for r in rows if r.is_supernumerary and r.supernumerary_kind
    )
    sid_counts = Counter(r.student_id_inst for r in rows if r.student_id_inst)
    fp_counts = Counter(r.apaar_fingerprint for r in rows if r.apaar_fingerprint)

    # Cross-institution overlaps — ONE query for the whole batch
    fps = [r.apaar_fingerprint for r in rows if r.apaar_fingerprint]
    cross_overlaps: dict[str, list[Enrolment]] = {}
    if fps:
        matches = db.query(Enrolment).filter(
            Enrolment.apaar_fingerprint.in_(fps),
            Enrolment.academic_year == batch.academic_year,
            Enrolment.institution_id != batch.institution_id,
            Enrolment.enrolment_status.in_(["SUBMITTED", "ACTIVE"]),
        ).all()
        for m in matches:
            cross_overlaps.setdefault(m.apaar_fingerprint, []).append(m)

    # Order rows so "first occurrence" is deterministic
    ordered = sorted(rows, key=lambda r: (r.row_number or 0, str(r.id)))
    seen_fps: set[str] = set()
    seen_sids: set[str] = set()

    for e in ordered:
        # ============================================================
        # R1 — APAAR_FORMAT (FAIL) — 12 digits required
        # Provisional rows have no APAAR → not a failure
        # ============================================================
        if e.apaar_id and (len(e.apaar_id) != 12 or not e.apaar_id.isdigit()):
            results.append((
                e,
                _mk_finding(e, "APAAR_FORMAT", "FAIL", {
                    "reason": "Must be exactly 12 digits",
                    "prefix_masked": (e.apaar_id[:4] + "****") if len(e.apaar_id) >= 4 else "****",
                }),
                True,
            ))

        # ============================================================
        # R2 — APAAR_DUPLICATE_IN_BATCH (FAIL)
        # ============================================================
        if e.apaar_fingerprint:
            if e.apaar_fingerprint in seen_fps:
                earlier = [r for r in ordered if r.apaar_fingerprint == e.apaar_fingerprint and r.row_number and e.row_number and r.row_number < e.row_number]
                results.append((
                    e,
                    _mk_finding(e, "APAAR_DUPLICATE_IN_BATCH", "FAIL", {
                        "reason": "APAAR appears more than once in this batch",
                        "duplicate_of_row": earlier[0].row_number if earlier else None,
                    }, confidence="L1"),
                    True,
                ))
            else:
                seen_fps.add(e.apaar_fingerprint)

        # ============================================================
        # R3 — APAAR_DUPLICATE_CROSS_INSTITUTION (REVIEW) — non-punitive
        # ============================================================
        if e.apaar_fingerprint and e.apaar_fingerprint in cross_overlaps:
            others = cross_overlaps[e.apaar_fingerprint]
            results.append((
                e,
                _mk_finding(e, "APAAR_DUPLICATE_CROSS_INSTITUTION", "REVIEW", {
                    "other_institutions": sorted({m.institution_id for m in others}),
                    "other_enrolment_ids": [str(m.id) for m in others],
                    "note": "Route to review queue — not auto-cancelled",
                }, confidence="L1"),
                False,  # never auto-quarantine — human review only
            ))

        # ============================================================
        # R4 — MISSING_MANDATORY_FIELD (FAIL)
        # APAAR is NOT mandatory; name/program/date are.
        # ============================================================
        missing = []
        if not e.student_name or not e.student_name.strip():
            missing.append("student_name")
        if not e.program_code:
            missing.append("program_code")
        if not e.admission_date:
            missing.append("admission_date")
        if missing:
            results.append((
                e,
                _mk_finding(e, "MISSING_MANDATORY_FIELD", "FAIL", {"missing": missing}),
                True,
            ))

        # ============================================================
        # R5 — PROGRAM_CODE_NOT_IN_CATALOG (FAIL)
        # ============================================================
        if e.program_code and e.program_code not in capacities:
            results.append((
                e,
                _mk_finding(e, "PROGRAM_CODE_NOT_IN_CATALOG", "FAIL", {
                    "program_code": e.program_code,
                    "known_programs": list(capacities.keys()),
                }),
                True,
            ))

        # ============================================================
        # R6 — ADMISSION_YEAR_MISMATCH (WARN)
        # Batch academic_year 2025-26 → admission_date.year must be 2025
        # ============================================================
        if e.admission_date:
            expected_year = int(batch.academic_year.split("-")[0])
            if e.admission_date.year != expected_year:
                results.append((
                    e,
                    _mk_finding(e, "ADMISSION_YEAR_MISMATCH", "WARN", {
                        "admission_date": e.admission_date.isoformat(),
                        "expected_year": expected_year,
                    }),
                    False,
                ))

        # ============================================================
        # R7 — INTAKE_CAP_EXCEEDED (FAIL when authoritative)
        # Only checks regular (non-supernumerary) rows
        # ============================================================
        if e.program_code in capacities and not e.is_supernumerary:
            ai = capacities[e.program_code]
            if ai.source in ("ONOD", "ONOD_MOCK", "AICTE_APPROVAL") and ai.sanctioned_seats >= 0:
                total_regular = program_counts[e.program_code]
                if total_regular > ai.sanctioned_seats and ai.sanctioned_seats > 0:
                    results.append((
                        e,
                        _mk_finding(e, "INTAKE_CAP_EXCEEDED", "FAIL", {
                            "program_code": e.program_code,
                            "sanctioned": ai.sanctioned_seats,
                            "reported": total_regular,
                            "overflow": total_regular - ai.sanctioned_seats,
                            "capacity_source": ai.source,
                        }),
                        False,  # capacity breach is a batch-level signal, not per-row cancellation
                    ))

        # ============================================================
        # R8 — SUPERNUMERARY_CAP_EXCEEDED (FAIL)
        # ============================================================
        if e.is_supernumerary and e.supernumerary_kind and e.program_code in capacities:
            ai = capacities[e.program_code]
            pool_cap = (ai.supernumerary_json or {}).get(e.supernumerary_kind, 0)
            pool_actual = supernum_counts[(e.program_code, e.supernumerary_kind)]
            if pool_actual > pool_cap:
                results.append((
                    e,
                    _mk_finding(e, "SUPERNUMERARY_CAP_EXCEEDED", "FAIL", {
                        "pool": e.supernumerary_kind,
                        "cap": pool_cap,
                        "reported": pool_actual,
                    }),
                    True,
                ))

        # ============================================================
        # R9 — NRI_OCI_FN_FLAG_INCONSISTENT (WARN)
        # ============================================================
        if e.is_oci and e.is_foreign_national:
            results.append((
                e,
                _mk_finding(e, "NRI_OCI_FN_FLAG_INCONSISTENT", "WARN", {
                    "reason": "OCI and Foreign National both true — pick one",
                }),
                False,
            ))

        # ============================================================
        # R10 — TFW_INCOME_CEILING_EXCEEDED (WARN) — not in demo data
        # Skipped unless income is present (schema doesn't carry it)
        # ============================================================

        # ============================================================
        # R12 — DUPLICATE_STUDENT_ID_WITHIN_INSTITUTION (FAIL)
        # ============================================================
        if e.student_id_inst:
            if e.student_id_inst in seen_sids:
                results.append((
                    e,
                    _mk_finding(e, "DUPLICATE_STUDENT_ID_WITHIN_INSTITUTION", "FAIL", {
                        "student_id_inst": e.student_id_inst,
                    }),
                    True,
                ))
            else:
                seen_sids.add(e.student_id_inst)

    # ============================================================
    # R11 — SEAT_COUNT_MISMATCH (WARN) — batch-level
    # Only fires if the batch carries a "reported_total" override.
    # In our schema it doesn't, so we skip silently.
    # ============================================================

    return results
