import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import {
  Cpu, Loader2, Sparkles, RefreshCw, AlertTriangle, ChevronDown,
  ChevronRight, Info, TrendingUp, CheckCircle2,
} from "lucide-react";

interface ModelInfo {
  trained: boolean; model_version?: string; trained_at?: string;
  contamination?: number; artefact_hash?: string; notes?: string;
  features?: string[]; threshold?: number; note?: string;
}
interface MLFinding {
  id: string; enrolment_id: string; student_name: string;
  institution_id: string; program_code: string; ml_score: number | null;
  severity: string; status: string; model_version: string | null;
  shap: { top: Array<Record<string, any>> } | null;
  evidence: Record<string, any>; created_at: string;
}
interface Stats { total_ml_findings: number; open: number; }

export default function Advisory() {
  const { user } = useAuth();
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [findings, setFindings] = useState<MLFinding[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [training, setTraining] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canTrain = user?.role === "aicte_admin" || user?.role === "seat_operator";

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [m, f, s] = await Promise.all([
        apiGet<ModelInfo>("/api/v1/ml/model"),
        apiGet<MLFinding[]>("/api/v1/ml/findings?limit=100"),
        apiGet<Stats>("/api/v1/ml/stats"),
      ]);
      setModel(m); setFindings(f); setStats(s);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function train() {
    setTraining(true); setErr(null); setMsg(null);
    try {
      const res = await apiPost<{ model_version: string; notes: string }>("/api/v1/ml/train", {});
      setMsg(`Model trained: ${res.model_version} · ${res.notes}`);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setTraining(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          ML Advisory · Phase 9
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Anomaly Detection</h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          Unsupervised Isolation Forest on clean enrolments. Every flag is{" "}
          <strong>advisory only</strong> — never auto-quarantines, never affects credentials.
          Every flag comes with per-feature SHAP explanations.
        </p>
      </div>

      {err && <div className="rounded-lg border border-seat-danger/40 bg-seat-danger/10 p-3 text-sm text-seat-danger">{err}</div>}
      {msg && <div className="rounded-lg border border-seat-success/40 bg-seat-success/10 p-3 text-sm text-seat-success">{msg}</div>}

      <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-seat-accent/15 border border-seat-accent/40 flex items-center justify-center">
              <Cpu className="w-4 h-4 text-seat-accent" />
            </div>
            <div>
              <div className="font-semibold">Isolation Forest</div>
              <div className="text-xs text-seat-muted">{model?.trained ? model.model_version : "Not yet trained"}</div>
            </div>
          </div>
          {canTrain && (
            <button onClick={train} disabled={training}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-seat-accent text-seat-bg font-semibold text-xs disabled:opacity-50">
              {training ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {training ? "Training…" : model?.trained ? "Retrain" : "Train model"}
            </button>
          )}
        </div>
        {model?.trained ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <KV k="Contamination" v={String(model.contamination)} />
            <KV k="Threshold" v={String(model.threshold)} />
            <KV k="Hash" v={(model.artefact_hash || "").slice(0, 16) + "…"} />
            <KV k="Trained at" v={new Date(model.trained_at!).toLocaleString()} />
          </div>
        ) : (
          <div className="text-xs text-seat-muted">
            {canTrain ? "Click Train model to fit Isolation Forest on clean enrolments." : "No model trained yet. Ask admin to train."}
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-seat-accent/30 bg-seat-accent/5 p-3 text-xs text-seat-accent">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <strong>Guardrails.</strong> ML findings can only have severity{" "}
          <code className="px-1 rounded bg-seat-bg">REVIEW</code>. Cannot change identity/enrolment
          status, issue VTokens, or resolve concurrency alerts. Every finding records the model version.
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Total ML flags" count={stats.total_ml_findings} color="text-seat-accent" />
          <Stat label="Open" count={stats.open} color="text-seat-warn" />
          <Stat label="Above threshold" count={findings.filter(f => (f.ml_score ?? 0) >= (model?.threshold ?? 0.6)).length} color="text-seat-danger" />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-seat-muted">Anomalies (by score)</h2>
          <button onClick={load} disabled={loading} className="flex items-center gap-1 text-xs text-seat-muted hover:text-seat-accent">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
          </button>
        </div>

        {findings.length === 0 && !loading && (
          <div className="rounded-xl border border-seat-border bg-seat-panel/30 p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-seat-success mx-auto mb-3" />
            <div className="font-semibold">No ML findings yet</div>
            <div className="text-xs text-seat-muted mt-1">
              {model?.trained ? "Finalize a batch or score via POST /ml/score-batch/{id}." : "Train the model first."}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-seat-border bg-seat-panel/40 overflow-hidden">
          {findings.map((f) => (
            <div key={f.id} className="border-b border-seat-border/50 last:border-b-0">
              <button onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-seat-panel/60 text-left">
                {expanded === f.id ? <ChevronDown className="w-4 h-4 text-seat-muted" /> : <ChevronRight className="w-4 h-4 text-seat-muted" />}
                <span className="px-2 py-0.5 rounded border text-[10px] font-bold bg-seat-accent/15 text-seat-accent border-seat-accent/40">{f.severity}</span>
                <span className="text-sm font-mono text-seat-warn w-14 text-right">{(f.ml_score ?? 0).toFixed(3)}</span>
                <span className="text-sm font-medium truncate flex-1">{f.student_name}</span>
                <span className="text-xs text-seat-muted">{f.institution_id} · {f.program_code}</span>
              </button>
              {expanded === f.id && (
                <div className="px-4 pb-4 pl-11 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <KV k="Score" v={(f.ml_score ?? 0).toFixed(4)} />
                    <KV k="Model" v={f.model_version || "—"} />
                    <KV k="Status" v={f.status} />
                    <KV k="Created" v={new Date(f.created_at).toLocaleString()} />
                  </div>
                  {f.shap?.top && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-seat-muted mb-2">Top contributing features (SHAP)</div>
                      <div className="space-y-1.5">
                        {f.shap.top.map((c: any, i: number) => (
                          <div key={i} className="flex justify-between rounded bg-seat-bg border border-seat-border px-3 py-2 text-xs">
                            <span className="flex items-center gap-2"><TrendingUp className="w-3 h-3 text-seat-accent" /><span className="font-mono">{c.feature}</span></span>
                            <span className="font-mono text-seat-accent">
                              {c.shap_value !== undefined && `shap ${c.shap_value >= 0 ? "+" : ""}${c.shap_value}`}
                              {c.zscore !== undefined && `z=${c.zscore}`}
                              {c.direction && <span className="text-seat-muted ml-2">({c.direction})</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 rounded-lg border border-seat-warn/30 bg-seat-warn/5 p-2 text-xs text-seat-warn">
                    <AlertTriangle className="w-3.5 h-3.5" /> Advisory only. Route to human review; no automatic action.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[10px] uppercase tracking-widest text-seat-muted">{k}</div><div className="font-mono text-[10px]">{v}</div></div>;
}
function Stat({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-4">
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-[10px] uppercase tracking-widest text-seat-muted mt-0.5">{label}</div>
    </div>
  );
}
