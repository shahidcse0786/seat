import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiGet } from "@/lib/api";
import {
  Printer, ArrowLeft, ShieldCheck, Loader2, Copy, CheckCircle2,
} from "lucide-react";

interface CertMeta {
  enrolment_id: string;
  student_name: string;
  student_id_inst: string;
  program_code: string;
  academic_year: string;
  institution_id: string;
  institution_name: string;
  institution_city: string;
  institution_state: string;
  identity_status: string;
  credential_status: string;
  apaar_display_masked: string;
  vtoken_jti: string;
  kid: string;
  public_key_fingerprint: string;
  issued_at: string;
  expires_at: string;
  credential_type: string;
}

export default function Certificate() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [meta, setMeta] = useState<CertMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiGet<CertMeta>(`/api/v1/certificate/${id}`)
      .then(setMeta)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  function verifyUrl(jti: string) {
    return `${window.location.origin}/employer?jti=${jti}`;
  }

  function print() {
    window.print();
  }

  function copyUrl() {
    if (!meta) return;
    navigator.clipboard.writeText(verifyUrl(meta.vtoken_jti));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-seat-accent" />
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="rounded-xl border border-seat-warn/40 bg-seat-warn/10 p-6">
          <div className="font-semibold text-seat-warn mb-2">Cannot generate certificate</div>
          <div className="text-sm text-seat-muted">{error || "Enrolment not found"}</div>
          <button
            onClick={() => nav("/reports")}
            className="mt-4 px-4 py-2 rounded-lg bg-seat-panel border border-seat-border text-sm hover:border-seat-accent/40"
          >
            ← Back to Reports
          </button>
        </div>
      </div>
    );
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(verifyUrl(meta.vtoken_jti))}`;
  const vr = verifyUrl(meta.vtoken_jti);

  return (
    <div className="space-y-6">
      {/* Action bar (hidden in print) */}
      <div className="no-print flex items-center justify-between">
        <button
          onClick={() => nav("/reports")}
          className="flex items-center gap-1.5 text-sm text-seat-muted hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Reports
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={copyUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-seat-border text-xs hover:border-seat-accent/40"
          >
            {copied ? <CheckCircle2 className="w-3 h-3 text-seat-success" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied!" : "Copy verify URL"}
          </button>
          <button
            onClick={print}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-seat-accent text-seat-bg font-semibold text-xs hover:bg-seat-accent/90"
          >
            <Printer className="w-3 h-3" /> Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Certificate — always light for printing */}
      <div className="certificate-sheet mx-auto" style={{
        width: "min(100%, 210mm)",
        minHeight: "297mm",
        background: "#FFFFFF",
        color: "#0B0F14",
        padding: "20mm 18mm",
        border: "1px solid #E5E7EB",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        fontFamily: "'Inter', system-ui, sans-serif",
        position: "relative",
      }}>
        {/* Decorative corner */}
        <div style={{
          position: "absolute", top: 0, left: 0, width: "60mm", height: "3mm",
          background: "linear-gradient(90deg, #38BDF8, #22D3EE)",
        }} />
        <div style={{
          position: "absolute", top: 0, right: 0, width: "60mm", height: "3mm",
          background: "linear-gradient(90deg, #22D3EE, #38BDF8)",
        }} />

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "14mm" }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.3em", color: "#6B7280", textTransform: "uppercase" }}>
            Enrolment Verification Certificate
          </div>
          <div style={{ width: "40mm", height: "1px", background: "#E5E7EB", margin: "6mm auto" }} />
          <div style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.02em", marginTop: "4mm" }}>
            {meta.institution_name}
          </div>
          <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "2mm" }}>
            {meta.institution_city}, {meta.institution_state} · <span style={{ fontFamily: "monospace" }}>{meta.institution_id}</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ fontSize: "14px", lineHeight: 1.8, marginBottom: "12mm" }}>
          <div style={{ color: "#6B7280", fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "4mm" }}>
            This certifies that
          </div>
          <div style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.01em", marginBottom: "2mm" }}>
            {meta.student_name}
          </div>
          <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "8mm" }}>
            Student ID: <span style={{ fontFamily: "monospace" }}>{meta.student_id_inst}</span>
            {" · "}
            APAAR: <span style={{ fontFamily: "monospace" }}>{meta.apaar_display_masked}</span>
          </div>

          <div style={{ fontSize: "13px", lineHeight: 1.8 }}>
            was enrolled in the <strong>{meta.program_code}</strong> programme
            at <strong>{meta.institution_name}</strong> for the
            <strong> {meta.academic_year}</strong> academic year.
          </div>

          <div style={{
            marginTop: "8mm", padding: "4mm",
            background: "#F0FDF4", border: "1px solid #BBF7D0",
            borderRadius: "3mm", fontSize: "12px", color: "#166534",
          }}>
            <div style={{ fontWeight: 600, marginBottom: "1.5mm" }}>Identity verification level</div>
            <div style={{ fontFamily: "monospace", fontSize: "11px" }}>
              {meta.identity_status.replace(/_/g, " ")}
            </div>
            <div style={{ fontSize: "10px", marginTop: "2mm", color: "#4B5563" }}>
              This certificate establishes enrolment. It does not establish graduation or degree award.
            </div>
          </div>
        </div>

        {/* Signature + QR row */}
        <div style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          marginTop: "auto", paddingTop: "8mm", borderTop: "1px solid #E5E7EB",
        }}>
          <div style={{ fontSize: "11px", lineHeight: 1.7, flex: 1 }}>
            <div style={{ color: "#6B7280", letterSpacing: "0.2em", textTransform: "uppercase", fontSize: "9px", marginBottom: "1mm" }}>
              Signed by
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "11px", fontWeight: 600 }}>
              Ed25519 · key <span>{meta.kid}</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "10px", color: "#6B7280", marginTop: "1mm" }}>
              Fingerprint: {meta.public_key_fingerprint}
            </div>
            <div style={{ fontSize: "10px", color: "#6B7280", marginTop: "3mm", wordBreak: "break-all" }}>
              <strong>Verify at:</strong>{" "}
              <span style={{ fontFamily: "monospace" }}>{vr}</span>
            </div>
            <div style={{ fontSize: "9px", color: "#9CA3AF", marginTop: "3mm", lineHeight: 1.6 }}>
              Issued {new Date(meta.issued_at).toLocaleDateString()}.
              Valid only if the verifier reports VALID.
              Revocation status depends on the freshness of the signed manifest.
            </div>
          </div>
          <div style={{ textAlign: "center", marginLeft: "8mm" }}>
            <img
              src={qrUrl}
              alt="Verification QR"
              width={110}
              height={110}
              style={{ display: "block", border: "1px solid #E5E7EB" }}
            />
            <div style={{ fontSize: "8px", color: "#6B7280", marginTop: "2mm", letterSpacing: "0.1em" }}>
              SCAN TO VERIFY
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          position: "absolute", bottom: "10mm", left: "18mm", right: "18mm",
          textAlign: "center", fontSize: "8px", color: "#9CA3AF", letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}>
          SEAT · Student Enrollment Accountability & Tracking · Enrolment-verification credential (not a degree)
        </div>
      </div>

      <div className="no-print text-center text-[11px] text-seat-muted">
        Tip: In the print dialog, choose "Save as PDF" and disable "Headers and footers" for a clean archival PDF.
      </div>
    </div>
  );
}
