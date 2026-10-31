import { useEffect, useState } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import {
  AlertTriangle, CheckCircle2, XCircle, Loader2, Filter,
  ChevronDown, ChevronRight, ShieldCheck, Search,
} from "lucide-react";

interface Finding {
  id: string;
  enrolment_id: string;
  student_name: string | null;
  program_code: string | null;
  institution_id: string | null;
  source: string;
  rule_id: string | null;
  severity: string;
  severity_score: number | null;
  confidence: string | null;
  status: string;
  evidence_json: Record<string, any>;
  created_at: string;
}

interface Summary {
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  by_rule: Record<string, number>;
  total: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  FAIL: "bg-seat-danger/15 text-seat-danger border-seat-danger/40",
  REVIEW: "bg-seat-warn/15 text-seat-warn border-seat-warn/40",
  WARN: "bg-seat-accent/15 text-seat-accent border-seat-accent/40",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "text-seat-danger",
  ACKNOWLEDGED: "text-seat-warn",
  RESOLVED: "text-seat-success",
  DISMISSED: "text-seat-muted",
};

export default function Findings() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (severityFilter) params.set("severity", severityFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "500");
      const [f, s] = await Promise.all([
        apiGet<Finding[]>(`/api/v1/findings?${params}`),
        apiGet<Summary>("/api/v1/findings/summary"),
      ]);
      setFindings(f);
      setSummary(s);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [severityFilter, statusFilter]);

  async function setStatus(id: string, status: string) {
    try {
      await apiPatch(`/api/v1/findings/${id}/status`, { status });
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const filtered = findings.filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (f.student_name || "").toLowerCase().includes(q) ||
      (f.rule_id || "").toLowerCase().includes(q) ||
      (f.program_code || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          Review Queue · Phase 6
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Findings</h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          Every rule violation, sorted by severity score. All findings are evidence-backed
          and manually resolvable — never auto-cancelled.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Total" count={summary.total} color="text-white" />
          <SummaryCard label="Fail" count={summary.by_severity.FAIL || 0} color="text-seat-danger" />
          <SummaryCard label="Review" count={summary.by_severity.REVIEW || 0} color="text-seat-warn" />
          <SummaryCard label="Warn" count={summary.by_severity.WARN || 0} color="text-seat-accent" />
          <SummaryCard label="Open" count={summary.by_status.OPEN || 0} color="text-seat-danger" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-seat-muted" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student, rule, program…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-seat-panel border border-seat-border focus:border-seat-accent focus:outline-none text-sm"
          />
        </div>
        <select
          value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-seat-panel border border-seat-border focus:border-seat-accent text-sm"
        >
          <option value="">All severities</option>
          <option value="FAIL">FAIL</option>
          <option value="REVIEW">REVIEW</option>
          <option value="WARN">WARN</option>
        </select>
        <select
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-seat-panel border border-seat-border focus:border-seat-accent text-sm"
        >
          <option value="">All statuses</option>
          <option value="OPEN">OPEN</option>
          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="DISMISSED">DISMISSED</option>
        </select>
        <button onClick={load} disabled={loading}
          className="px-3 py-2 rounded-lg bg-seat-accent text-seat-bg font-semibold text-xs hover:bg-seat-accent/90 disabled:opacity-50 flex items-center gap-1.5">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-seat-danger/40 bg-seat-danger/10 p-3 text-sm text-seat-danger">{err}</div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="rounded-xl border border-seat-border bg-seat-panel/30 p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-seat-success mx-auto mb-3" />
          <div className="font-semibold">No findings match</div>
          <div className="text-xs text-seat-muted mt-1">
            {statusFilter === "OPEN" ? "All open findings resolved!" : "Try changing filters."}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-seat-border bg-seat-panel/40 overflow-hidden">
        {filtered.map((f) => (
          <div key={f.id} className="border-b border-seat-border/50 last:border-b-0">
            <button
              onClick={() => setExpanded(expanded === f.id ? null : f.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-seat-panel/60 transition text-left"
            >
              {expanded === f.id
                ? <ChevronDown className="w-4 h-4 text-seat-muted shrink-0" />
                : <ChevronRight className="w-4 h-4 text-seat-muted shrink-0" />}
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold shrink-0 ${SEVERITY_COLORS[f.severity] || ""}`}>
                {f.severity}
              </span>
              <span className="font-mono text-xs text-seat-muted shrink-0 w-8 text-right">
                {f.severity_score?.toFixed(1) ?? "—"}
              </span>
              <span className="text-sm font-medium truncate flex-1 min-w-0">
                {f.rule_id || f.source}
              </span>
              <span className="text-xs text-seat-muted truncate max-w-[180px]">
                {f.student_name || "—"} · {f.program_code || "—"}
              </span>
              <span className={`text-[10px] font-semibold uppercase shrink-0 ${STATUS_COLORS[f.status] || ""}`}>
                {f.status}
              </span>
            </button>

            {expanded === f.id && (
              <div className="px-4 pb-4 pl-11 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <KV k="Enrolment ID" v={f.enrolment_id} mono />
                  <KV k="Institution" v={f.institution_id || "—"} mono />
                  <KV k="Source" v={f.source} />
                  <KV k="Confidence" v={f.confidence || "—"} />
                  <KV k="Created" v={new Date(f.created_at).toLocaleString()} />
                  <KV k="Rule version" v="2025-01-01" mono />
                </div>

                <div className="rounded-lg bg-seat-bg border border-seat-border p-3">
                  <div className="text-[10px] uppercase tracking-widest text-seat-muted mb-2">Evidence</div>
                  <pre className="text-[11px] font-mono text-seat-muted whitespace-pre-wrap break-all">
                    {JSON.stringify(f.evidence_json, null, 2)}
                  </pre>
                </div>

                {f.status === "OPEN" && (
                  <div className="flex gap-2">
                    <button onClick={() => setStatus(f.id, "ACKNOWLEDGED")}
                      className="px-3 py-1.5 rounded-md border border-seat-warn/40 text-seat-warn text-xs hover:bg-seat-warn/10 transition">
                      Acknowledge
                    </button>
                    <button onClick={() => setStatus(f.id, "RESOLVED")}
                      className="px-3 py-1.5 rounded-md border border-seat-success/40 text-seat-success text-xs hover:bg-seat-success/10 transition">
                      Resolve
                    </button>
                    <button onClick={() => setStatus(f.id, "DISMISSED")}
                      className="px-3 py-1.5 rounded-md border border-seat-border text-seat-muted text-xs hover:border-seat-muted transition">
                      Dismiss
                    </button>
                  </div>
                )}
                {f.status !== "OPEN" && (
                  <button onClick={() => setStatus(f.id, "OPEN")}
                    className="px-3 py-1.5 rounded-md border border-seat-border text-seat-muted text-xs hover:border-seat-accent/40 transition">
                    Reopen
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-4">
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-[10px] uppercase tracking-widest text-seat-muted mt-0.5">{label}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-seat-muted">{k}</div>
      <div className={`${mono ? "font-mono text-[10px]" : "text-xs"}`}>{v}</div>
    </div>
  );
}
