"""SEAT — All SQLAlchemy 2.0 models in one module."""
import uuid
from datetime import datetime, date
from sqlalchemy import (
    String, Integer, Boolean, Date, DateTime, Numeric, BigInteger,
    ForeignKey, Index, CheckConstraint, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    institution_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Institution(Base):
    __tablename__ = "institutions"
    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(10), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Programme(Base):
    __tablename__ = "programmes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id: Mapped[str] = mapped_column(String(50), ForeignKey("institutions.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    __table_args__ = (UniqueConstraint("institution_id", "code", name="uq_prog_inst_code"),)


class ApprovedIntake(Base):
    __tablename__ = "approved_intake"
    institution_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    program_code: Mapped[str] = mapped_column(String(50), primary_key=True)
    academic_year: Mapped[str] = mapped_column(String(10), primary_key=True)
    sanctioned_seats: Mapped[int] = mapped_column(Integer, nullable=False)
    supernumerary_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, server_default=func.now())
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        CheckConstraint("sanctioned_seats >= 0", name="chk_sanctioned_positive"),
    )


class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id: Mapped[str] = mapped_column(String(50), nullable=False)
    academic_year: Mapped[str] = mapped_column(String(10), nullable=False)
    batch_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str] = mapped_column(String(30), default="OPEN", nullable=False)
    counts_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Enrolment(Base):
    __tablename__ = "enrolments"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id: Mapped[str] = mapped_column(String(50), nullable=False)
    academic_year: Mapped[str] = mapped_column(String(10), nullable=False)
    apaar_id: Mapped[str | None] = mapped_column(String(12), nullable=True)
    provisional_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    identity_status: Mapped[str] = mapped_column(String(30), nullable=False)
    apaar_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    apaar_fingerprint_v: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    enrolment_vtoken: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    student_id_inst: Mapped[str] = mapped_column(String(100), nullable=False)
    student_name: Mapped[str] = mapped_column(String(255), nullable=False)
    program_code: Mapped[str] = mapped_column(String(50), nullable=False)
    category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_nri: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_oci: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_foreign_national: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_supernumerary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supernumerary_kind: Mapped[str | None] = mapped_column(String(20), nullable=True)
    admission_date: Mapped[date] = mapped_column(Date, nullable=False)
    enrolment_status: Mapped[str] = mapped_column(String(30), default="SUBMITTED", nullable=False)
    consent_status: Mapped[str] = mapped_column(String(20), default="NOT_GRANTED", nullable=False)
    credential_status: Mapped[str] = mapped_column(String(20), default="NOT_ISSUED", nullable=False)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("batches.id"), nullable=True)
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        CheckConstraint("apaar_id IS NOT NULL OR provisional_id IS NOT NULL", name="chk_apaar_or_provisional"),
        CheckConstraint("(NOT is_supernumerary) OR supernumerary_kind IS NOT NULL", name="chk_supernumerary_kind"),
        Index("ix_enrolments_inst_year", "institution_id", "academic_year"),
        Index("ix_enrolments_fingerprint", "apaar_fingerprint"),
        Index("ix_enrolments_status", "identity_status", "enrolment_status"),
    )


class ConcurrencyAlert(Base):
    __tablename__ = "concurrency_alerts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    apaar_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    academic_year: Mapped[str] = mapped_column(String(10), nullable=False)
    enrolment_a: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("enrolments.id"), nullable=False)
    enrolment_b: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("enrolments.id"), nullable=False)
    match_level: Mapped[str] = mapped_column(String(5), nullable=False)
    time_gap_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    suspicion_label: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state: Mapped[str] = mapped_column(String(30), default="UNRESOLVED", nullable=False)
    resolved_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    evidence_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint("enrolment_a <> enrolment_b", name="chk_distinct_enrolments"),)


class Finding(Base):
    __tablename__ = "findings"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    enrolment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("enrolments.id"), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    rule_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    rule_version: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    severity_score: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    evidence_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    confidence: Mapped[str | None] = mapped_column(String(5), nullable=True)
    ml_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    shap_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        CheckConstraint("(source = 'ML') = (ml_score IS NOT NULL)", name="chk_ml_consistency"),
        Index("ix_findings_open_severity", "status", "severity_score"),
        Index("ix_findings_enrolment", "enrolment_id"),
    )


class RuleVersion(Base):
    __tablename__ = "rule_versions"
    rule_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scope: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    rule_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    entry_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    actor_id: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(50), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    apaar_hmac: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("ix_audit_created", "created_at"),)


class ConsentRecord(Base):
    __tablename__ = "consent_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    enrolment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("enrolments.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(50), nullable=False)
    scope_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_jws: Mapped[str] = mapped_column(String(2048), nullable=False)


class VTokenRegistry(Base):
    __tablename__ = "vtoken_registry"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    enrolment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("enrolments.id"), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rev_check_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    audience: Mapped[str] = mapped_column(String(100), nullable=False)


class MLModelVersion(Base):
    __tablename__ = "ml_model_versions"
    model_version: Mapped[str] = mapped_column(String(50), primary_key=True)
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    features_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    contamination: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)
    artefact_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class ConfigSwitch(Base):
    __tablename__ = "config_switches"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    owner: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[str] = mapped_column(String(100), nullable=False)
