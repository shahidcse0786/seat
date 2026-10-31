"""Feature engineering for the ML advisory layer.

8 features, all ratios/timestamps/encoded categoricals — NO PII, NO APAAR,
NO names, NO addresses. Matches spec §3.9.2.
"""
from datetime import date
from typing import Iterable

import numpy as np

from app.models import Enrolment

FEATURE_NAMES = [
    "intake_ratio",              # batch programme count / sanctioned seats
    "days_since_session_start",  # backdating signal
    "duplicate_confidence",      # 0=none, 1=L1, 2=L2, 3=L3 cross-inst match
    "supernumerary_flag",        # 0/1
    "admission_month",           # 7=July (normal), 10+ (suspicious)
    "category_encoded",          # GEN=0, OBC=1, SC=2, ST=3, EWS=4
    "student_id_length",         # length of institution ID
    "has_apaar",                 # 0/1 (provisional rows lack APAAR)
]

SESSION_START = date(2025, 7, 1)
CATEGORY_MAP = {"GEN": 0, "OBC": 1, "SC": 2, "ST": 3, "EWS": 4}


def compute_features(
    enrolments: Iterable[Enrolment],
    sanctioned_by_program: dict[str, int],
    programme_counts: dict[str, int],
    cross_inst_level: dict[str, int],
) -> tuple[np.ndarray, list[str]]:
    """Return (X, ids) where X is (n, 8) matrix and ids are enrolment IDs in order."""
    X = []
    ids = []
    for e in enrolments:
        # intake_ratio
        sanctioned = sanctioned_by_program.get(e.program_code, 0)
        if sanctioned and sanctioned > 0:
            intake_ratio = programme_counts.get(e.program_code, 0) / sanctioned
        else:
            intake_ratio = 0.0

        # days_since_session_start (clamped, no negatives)
        days_since = max((e.admission_date - SESSION_START).days, 0) if e.admission_date else 0

        # duplicate_confidence
        dup_conf = cross_inst_level.get(e.apaar_fingerprint or "", 0)

        # supernumerary
        supernum = 1.0 if e.is_supernumerary else 0.0

        # admission_month
        month = e.admission_date.month if e.admission_date else 7

        # category encoded
        cat = CATEGORY_MAP.get((e.category or "").upper(), 0)

        # student id length (proxy for non-standard format)
        sid_len = len(e.student_id_inst or "")

        # has_apaar
        has_apaar = 1.0 if e.apaar_id else 0.0

        X.append([intake_ratio, days_since, dup_conf, supernum,
                  month, cat, sid_len, has_apaar])
        ids.append(str(e.id))

    return np.array(X, dtype=float), ids
