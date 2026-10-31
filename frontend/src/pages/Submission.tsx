import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { parseCsv, CsvRow } from "@/lib/csv";
import { useAuth } from "@/stores/auth";
import {
  Upload, FileText, CheckCircle2, XCircle, Download, Loader2,
  ChevronRight, Sparkles, Copy, ShieldCheck, X,
} from "lucide-react";

interface BatchSummary {
  id: string;
  institution_id: string;
  academic_year: string;
  batch_reference: string | null;
  state: string;
  counts: Record<string, number>;
  created_at: string;
  finalized_at: string | null;
}

interface RowDetail {
  id: string;
  row_number: number;
  student_id_inst: string;
  student_name: string;
  apaar_id: string | null;
  provisional_id: string | null;
  program_code: string;
  identity_status: string;
  enrolment_status: string;
  admission_date: string;
}

interface ValidatedRow extends CsvRow {
  _row_number: number;
  _valid: boolean;
  _errors: string[];
}

interface TokenModal {
  vtoken: string;
  jti: string;
  kid: string;
  expires_at: string;
  enrolment_id: string;
}

const PROGRAM_CODES_BY_INST: Record<string, string[]> = {
  INST001: ["CSE", "ECE", "ME"],
  INST002: ["CSE", "ME"],
  INST003: ["MBA", "PGDM"],
  INST004: ["BSC-CS", "BCOM"],
  INST005: ["BPHARM"],
};

const SAMPLE_CSV = `student_id_inst,student_name,apaar_id,program_code,admission_date,category
SAM-001,Aarav Sharma,111122223333,CSE,2025-07-15,GEN
SAM-002,Diya Patel,444455556666,CSE,2025-07-18,OBC
SAM-003,Ishaan Reddy,,ECE,2025-07-20,SC
SAM-004,Ananya Nair,ABCDEF,CSE,2025-07-10,GEN
SAM-005,Kabir Verma,111122223333,CSE,2025-07-12,EWS
SAM-006,Saanvi Iyer,777788889999,ME,2025-07-18,GEN
SAM-007,Riya Gupta,123123123123,ECE,2025-07-22,GEN`;

const STATE_COLORS: Record<string, string> = {
  OPEN: "text-seat-muted border-seat-border",
  PROCESSING: "text-seat-warn border-seat-warn/40",
  PARTIAL_SUCCESS: "text-seat-accent border-seat-accent/40",
  ACCEPTED: "text-seat-success border-seat-success/40",
  REJECTED: "text-seat-danger border-seat-danger/40",
};

const IDENTITY_COLORS: Record<string, string> = {
  APAAR_PENDING: "bg-seat-warn/15 text-seat-warn border-seat-warn/30",
  L1_FORMAT_VALID: "bg-seat-accent/15 text-seat-accent border-seat-accent/30",
  L2_EXISTENCE_CONFIRMED: "bg-seat-accent2/15 text-seat-accent2 border-seat-accent2/30",
  L3_INSTITUTION_ATTESTED: "bg-seat-success/15 text-seat-success border-seat-success/30",
  IDENTITY_REVIEW: "bg-seat-danger/15 text-seat-danger border-seat-danger/30",
};

const ENROLMENT_COLORS: Record<string, string> = {
  ACTIVE: "text-seat-success",
  QUARANTINED: "text-seat-danger",
  SUBMITTED: "text-seat-muted",
};

export default function Submission() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selected, setSelected] = useState<BatchSummary | null>(null);
  const [rows, setRows] = useState<RowDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Upload
  const [previewRows, setPreviewRows] = useState<ValidatedRow[]>([]);
  const [previewStats, setPreviewStats] = useState<any>(null);
  const [csvFileName, setCsvFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // Attest + token modal
  const [attesting, setAttesting] = useState<string | null>(null);
  const [tokenModal, setTokenModal] = useState<TokenModal | null>(null);
  const [copied, setCopied] = useState(false);

  const institutionId = user?.institution_id || "INST001";
  const programCodes = PROGRAM_CODES_BY_INST[institutionId] || [];

  async function loadBatches() {
    try {
      const res = await apiGet<BatchSummary[]>("/api/v1/batches");
      setBatches(res);
      if (res.length > 0 && !selected) setSelected(res[0]);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function loadRows(batchId: string) {
    try {
      const res = await apiGet<RowDetail[]>(`/api/v1/batches/${batchId}/rows`);
      setRows(res);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  useEffect(() => { loadBatches(); }, []);
  useEffect(() => {
    if (selected) loadRows(selected.id);
    else setRows([]);
  }, [selected?.id]);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../workers/csvValidator.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current.onmessage = (e) => {
      setPreviewRows(e.data.validated);
      setPreviewStats(e.data.stats);
    };
    return () => { workerRef.current?.terminate(); };
  }, []);

  const handleFile = useCallback((file: File) => {
    setErr(null); setMsg(null);
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { rows: csvRows, error } = parseCsv(reader.result as string);
      if (error) { setErr(error); return; }
      workerRef.current?.postMessage({
        rows: csvRows,
        requiredFields: ["student_id_inst", "student_name", "program_code", "admission_date"],
        validProgramCodes: programCodes,
      });
    };
    reader.readAsText(file);
  }, [programCodes]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".csv")) handleFile(f);
    else setErr("Please drop a .csv file");
  };

  async function submitBatch() {
    if (!previewRows.some((r) => r._valid)) { setErr("No valid rows to upload"); return; }
    setLoading(true); setErr(null); setMsg(null);
    try {
      const batch = await apiPost<{ batch_id: string }>("/api/v1/batches", {
        academic_year: "2025-26", batch_reference: csvFileName,
      });
      const validRows = previewRows.filter((r) => r._valid).map((r, i) => ({
        row_number: i + 1,
        student_id_inst: r.student_id_inst,
        student_name: r.student_name,
        apaar_id: r.apaar_id && r.apaar_id.trim() ? r.apaar_id.trim() : null,
        program_code: r.program_code,
        admission_date: r.admission_date,
        category: r.category || null,
      }));
      await apiPut(`/api/v1/batches/${batch.batch_id}/rows`, { rows: validRows });
      const fin = await apiPost<any>(`/api/v1/batches/${batch.batch_id}/finalize`, {});
      setMsg(`Batch finalized: ${fin.state} — ${fin.counts.accepted} accepted, ${fin.counts.quarantined} quarantined, ${fin.counts.apaar_pending} provisional`);
      await loadBatches();
      const fresh = await apiGet<BatchSummary[]>("/api/v1/batches");
      const nb = fresh.find((b) => b.id === batch.batch_id);
      if (nb) setSelected(nb);
      setPreviewRows([]); setPreviewStats(null); setCsvFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function attest(enrolmentId: string) {
    setAttesting(enrolmentId);
    setErr(null);
    try {
      const res = await apiPost<TokenModal & { identity_status: string }>(
        `/api/v1/verification/attest/${enrolmentId}`, {}
      );
      setTokenModal(res);
      if (selected) await loadRows(selected.id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAttesting(null);
    }
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "seat-sample.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function copyToken() {
    if (!tokenModal) return;
    navigator.clipboard.writeText(tokenModal.vtoken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const funnel = {
    pending: rows.filter((r) => r.identity_status === "APAAR_PENDING").length,
    l1: rows.filter((r) => r.identity_status === "L1_FORMAT_VALID").length,
    l2: rows.filter((r) => r.identity_status === "L2_EXISTENCE_CONFIRMED").length,
    l3: rows.filter((r) => r.identity_status === "L3_INSTITUTION_ATTESTED").length,
    quarantined: rows.filter((r) => r.enrolment_status === "QUARANTINED").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          Submission Pipeline · Phase 5B
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Batch Upload & Attestation</h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          Upload CSV → browser validates → server finalizes. Then click <strong>Attest L3</strong> on any
          L1 row to issue a real Ed25519-signed VToken.
        </p>
      </div>

      {err && <div className="rounded-lg border border-seat-danger/40 bg-seat-danger/10 p-3 text-sm text-seat-danger">{err}</div>}
      {msg && <div className="rounded-lg border border-seat-success/40 bg-seat-success/10 p-3 text-sm text-seat-success">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div
            onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl border-2 border-dashed border-seat-border hover:border-seat-accent/50 bg-seat-panel/30 p-8 text-center cursor-pointer transition"
          >
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <Upload className="w-8 h-8 mx-auto text-seat-accent mb-2" />
            <div className="font-semibold text-sm">Drop CSV here or click to browse</div>
            <div className="text-xs text-seat-muted mt-1">
              Required: student_id_inst, student_name, program_code, admission_date
            </div>
            <button onClick={(e) => { e.stopPropagation(); downloadSample(); }}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-seat-accent hover:underline">
              <Download className="w-3 h-3" /> Download sample CSV
            </button>
          </div>

          {previewStats && (
            <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-seat-accent" />
                  <span className="font-semibold text-sm">{csvFileName}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-seat-success">✓ {previewStats.valid} valid</span>
                  <span className="text-seat-danger">✗ {previewStats.invalid} invalid</span>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto rounded border border-seat-border">
                <table className="w-full text-xs">
                  <thead className="bg-seat-panel sticky top-0">
                    <tr className="text-seat-muted">
                      <th className="text-left p-2 font-medium">#</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-left p-2 font-medium">Program</th>
                      <th className="text-left p-2 font-medium">APAAR</th>
                      <th className="text-left p-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} className="border-t border-seat-border/50">
                        <td className="p-2 text-seat-muted">{r._row_number}</td>
                        <td className="p-2">{r.student_name || "—"}</td>
                        <td className="p-2 font-mono">{r.program_code || "—"}</td>
                        <td className="p-2 font-mono text-[10px]">
                          {r.apaar_id || <span className="text-seat-warn">PROVISIONAL</span>}
                        </td>
                        <td className="p-2">
                          {r._valid ? (
                            <span className="inline-flex items-center gap-1 text-seat-success">
                              <CheckCircle2 className="w-3 h-3" /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-seat-danger" title={r._errors.join("; ")}>
                              <XCircle className="w-3 h-3" /> {r._errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="text-xs text-seat-muted">
                  Only valid rows uploaded ({previewStats.valid} of {previewStats.total})
                </div>
                <button onClick={submitBatch} disabled={loading || previewStats.valid === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-seat-accent text-seat-bg font-semibold text-sm hover:bg-seat-accent/90 disabled:opacity-50">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {loading ? "Processing…" : `Upload ${previewStats.valid} rows`}
                </button>
              </div>
            </div>
          )}

          {selected && (
            <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-semibold">{selected.batch_reference || "Batch"}</div>
                  <div className="text-xs text-seat-muted font-mono">{selected.id.slice(0, 8)}…</div>
                </div>
                <span className={`px-2 py-1 rounded border text-xs font-semibold ${STATE_COLORS[selected.state] || ""}`}>
                  {selected.state}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2 mb-4">
                <FunnelStat label="Pending" count={funnel.pending} color="text-seat-warn" />
                <FunnelStat label="L1 Format" count={funnel.l1} color="text-seat-accent" />
                <FunnelStat label="L2 Exist" count={funnel.l2} color="text-seat-accent2" />
                <FunnelStat label="L3 Attested" count={funnel.l3} color="text-seat-success" />
                <FunnelStat label="Quarantined" count={funnel.quarantined} color="text-seat-danger" />
              </div>
              <div className="max-h-96 overflow-y-auto rounded border border-seat-border">
                <table className="w-full text-xs">
                  <thead className="bg-seat-panel sticky top-0">
                    <tr className="text-seat-muted">
                      <th className="text-left p-2 font-medium">#</th>
                      <th className="text-left p-2 font-medium">Student</th>
                      <th className="text-left p-2 font-medium">Program</th>
                      <th className="text-left p-2 font-medium">Identity</th>
                      <th className="text-left p-2 font-medium">Enrolment</th>
                      <th className="text-left p-2 font-medium">Identifier</th>
                      <th className="text-right p-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-seat-border/50 hover:bg-seat-panel/60">
                        <td className="p-2 text-seat-muted">{r.row_number}</td>
                        <td className="p-2">{r.student_name}</td>
                        <td className="p-2 font-mono">{r.program_code}</td>
                        <td className="p-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium ${IDENTITY_COLORS[r.identity_status] || ""}`}>
                            {r.identity_status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className={`p-2 font-medium ${ENROLMENT_COLORS[r.enrolment_status] || ""}`}>
                          {r.enrolment_status}
                        </td>
                        <td className="p-2 font-mono text-[10px] text-seat-muted">
                          {r.apaar_id || r.provisional_id || "—"}
                        </td>
                        <td className="p-2 text-right">
                          {r.identity_status === "L1_FORMAT_VALID" && (
                            <button onClick={() => attest(r.id)} disabled={attesting === r.id}
                              className="inline-flex items-center gap-1 text-[11px] text-seat-accent hover:text-seat-accent2 font-semibold disabled:opacity-50">
                              {attesting === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                              {attesting === r.id ? "…" : "Attest L3"}
                            </button>
                          )}
                          {r.identity_status === "L3_INSTITUTION_ATTESTED" && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-seat-success">
                              <CheckCircle2 className="w-3 h-3" /> Attested
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-widest text-seat-muted">Recent batches</div>
            <button onClick={loadBatches} className="text-xs text-seat-muted hover:text-seat-accent">Refresh</button>
          </div>
          {batches.length === 0 && (
            <div className="rounded-xl border border-seat-border bg-seat-panel/30 p-6 text-center text-xs text-seat-muted">
              No batches yet. Upload a CSV to start.
            </div>
          )}
          {batches.map((b) => (
            <button key={b.id} onClick={() => setSelected(b)}
              className={`w-full text-left rounded-xl border p-3 transition ${
                selected?.id === b.id
                  ? "border-seat-accent/40 bg-seat-accent/5"
                  : "border-seat-border bg-seat-panel/30 hover:border-seat-accent/30"
              }`}>
              <div className="flex items-center justify-between">
                <div className="font-semibold text-sm truncate">{b.batch_reference || `${b.id.slice(0, 8)}…`}</div>
                <ChevronRight className="w-3.5 h-3.5 text-seat-muted" />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${STATE_COLORS[b.state] || ""}`}>
                  {b.state}
                </span>
                <span className="text-[10px] text-seat-muted">{b.counts?.submitted ?? 0} rows</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {tokenModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setTokenModal(null)}>
          <div className="bg-seat-panel border border-seat-border rounded-2xl max-w-2xl w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-seat-success/15 border border-seat-success/40 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-seat-success" />
                </div>
                <div>
                  <div className="font-bold">VToken issued</div>
                  <div className="text-xs text-seat-muted">Ed25519-signed · offline-verifiable</div>
                </div>
              </div>
              <button onClick={() => setTokenModal(null)} className="text-seat-muted hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
              <MetaRow label="Kid" value={tokenModal.kid} mono />
              <MetaRow label="JTI" value={tokenModal.jti.slice(0, 8) + "…"} mono />
              <MetaRow label="Expires" value={new Date(tokenModal.expires_at).toLocaleString()} />
              <MetaRow label="Algorithm" value="EdDSA" />
            </div>
            <div className="rounded-lg bg-seat-bg border border-seat-border p-3 mb-4">
              <div className="text-[10px] uppercase tracking-widest text-seat-muted mb-2">JWT</div>
              <div className="font-mono text-[10px] break-all text-seat-muted max-h-32 overflow-y-auto">
                {tokenModal.vtoken}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={copyToken}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-seat-border text-xs hover:border-seat-accent/40 transition">
                <Copy className="w-3 h-3" />
                {copied ? "Copied!" : "Copy token"}
              </button>
              <button onClick={() => {
                const t = tokenModal.vtoken;
                setTokenModal(null);
                nav("/verify", { state: { vtoken: t } });
              }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-seat-accent text-seat-bg font-semibold text-xs hover:bg-seat-accent/90">
                Verify this token →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FunnelStat({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-lg border border-seat-border bg-seat-bg/50 p-2 text-center">
      <div className={`text-lg font-bold ${color}`}>{count}</div>
      <div className="text-[9px] uppercase tracking-widest text-seat-muted">{label}</div>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-seat-muted mb-0.5">{label}</div>
      <div className={`text-xs ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
