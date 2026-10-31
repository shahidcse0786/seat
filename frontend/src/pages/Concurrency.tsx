import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import {
  GitBranch, CheckCircle2, XCircle, AlertTriangle, Loader2,
  RefreshCw, ChevronDown, ChevronRight, Sparkles, Info, ShieldAlert,
} from "lucide-react";

interface Side {
  enrolment_id: string; institution_id: string; student_name: string;
  program_code: string; admission_date: string; identity_status: string;
  enrolment_status: string; student_id_inst: string;
}
interface Alert {
  id: string; apaar_fingerprint: string; academic_year: string;
  match_level: string; time_gap_days: number | null; suspicion_label: string;
  state: string; resolved_by: string | null; resolved_at: string | null;
  created_at: string; evidence: Record<string, any>; a: Side; b: Side;
}
interface Summary { by_state: Record<string, number>; total: number; }

const STATE_COLORS: Record<string, string> = {
  UNRESOLVED: "text-seat-warn border-seat-warn/40 bg-seat-warn/10",
  TRANSFER_RECONCILED: "text-seat-success border-seat-success/40 bg-seat-success/10",
  DUAL_STUDY_PERMITTED: "text-seat-accent border-seat-accent/40 bg-seat-accent/10",
  ESCALATED: "text-seat-danger border-seat-danger/40 bg-seat-danger/10",
};
const SUSPICION_COLORS: Record<string, string> = {
  HIGH_SUSPICION: "text-seat-danger",
  MEDIUM: "text-seat-warn",
  LOW: "text-seat-muted",
};

export default function Concurrency() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("UNRESOLVED");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canResolve = user?.role === "aicte_admin" || user?.role === "seat_operator";

  async function load() {
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams();
      if (stateFilter) p.set("state", stateFilter);
      p.set("limit", "200");
      const [list, sum] = await Promise.all([
        apiGet<Alert[]>(`/api/v1/concurrency/queue?${p}`),
        apiGet<Summary>("/api/v1/concurrency/summary"),
      ]);
      setAlerts(list); setSummary(sum);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [stateFilter]);

  async function resolve(id: string, resolution: string) {
    const notes = prompt(`Notes for ${resolution}?`, "") ?? "";
    try {
      await apiPost(`/api/v1/concurrency/${id}/resolve`, { resolution, notes });
      setMsg(`Resolved: ${resolution}`); await load();
    } catch (e: any) { setErr(e.message); }
  }

  async function simulateTransfer(alert: Alert) {
    try {
      await apiPost(`/api/v1/concurrency/${alert.id}/transfer`, {
        source_authenticated: true,
        event_id: `TRF-${Date.now()}`,
        from_institution: alert.a.institution_id,
        to_institution: alert.b.institution_id,
        event_date: new Date().toISOString().slice(0, 10),
        source: "demo:manual_simulation",
      });
      setMsg("Auto-reconciled via authenticated transfer"); await load();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          Concurrency Gate · Phase 8
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Cross-Institution Alerts</h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          Same APAAR at two institutions. Both records preserved. Only a human
          decision (or an authenticated transfer event) changes state.{" "}
          <strong>Never auto-cancelled.</strong>
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Unresolved" count={summary.by_state.UNRESOLVED || 0} color="text-seat-warn" />
          <Stat label="Transfer reconciled" count={summary.by_state.TRANSFER_RECONCILED || 0} color="text-seat-success" />
          <Stat label="Dual-study" count={summary.by_state.DUAL_STUDY_PERMITTED || 0} color="text-seat-accent" />
          <Stat label="Escalated" count={summary.by_state.ESCALATED || 0} color="text-seat-danger" />
        </div>
      )}

      {err && <div className="rounded-lg border border-seat-danger/40 bg-seat-danger/10 p-3 text-sm text-seat-danger">{err}</div>}
      {msg && <div className="rounded-lg border border-seat-success/40 bg-seat-success/10 p-3 text-sm text-seat-success">{msg}</div>}

      <div className="flex items-center gap-3">
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-seat-panel border border-seat-border text-sm">
          <option value="">All states</option>
          <option value="UNRESOLVED">Unresolved</option>
          <option value="TRANSFER_RECONCILED">Transfer reconciled</option>
          <option value="DUAL_STUDY_PERMITTED">Dual-study</option>
          <option value="ESCALATED">Escalated</option>
        </select>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-seat-panel border border-seat-border text-xs">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
        </button>
        <span className="ml-auto text-xs text-seat-muted">{alerts.length} alert{alerts.length === 1 ? "" : "s"}</span>
      </div>

      {alerts.length === 0 && !loading && (
        <div className="rounded-xl border border-seat-border bg-seat-panel/30 p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-seat-success mx-auto mb-3" />
          <div className="font-semibold">No alerts in this state</div>
        </div>
      )}

      <div className="space-y-3">
        {alerts.map((alert) => (
          <div key={alert.id} className="rounded-xl border border-seat-border bg-seat-panel/40 overflow-hidden">
            <button onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-seat-panel/60 text-left">
              {expanded === alert.id ? <ChevronDown className="w-4 h-4 text-seat-muted" /> : <ChevronRight className="w-4 h-4 text-seat-muted" />}
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${STATE_COLORS[alert.state] || ""}`}>
                {alert.state.replace(/_/g, " ")}
              </span>
              <span className={`text-[10px] uppercase tracking-widest font-semibold ${SUSPICION_COLORS[alert.suspicion_label] || ""}`}>
                {alert.suspicion_label.replace(/_/g, " ")}
              </span>
              <span className="text-sm font-medium truncate flex-1">{alert.a.institution_id} ↔ {alert.b.institution_id}</span>
              <span className="text-xs text-seat-muted">gap: {alert.time_gap_days ?? "—"}d</span>
              <span className="text-[10px] text-seat-muted">{alert.match_level}</span>
            </button>

            {expanded === alert.id && (
              <div className="px-4 pb-4 pl-11 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <SideCard side={alert.a} label="Enrolment A" />
                  <SideCard side={alert.b} label="Enrolment B" />
                </div>
                <div className="rounded-lg bg-seat-bg border border-seat-border p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-seat-muted">APAAR fp</span><span className="font-mono">{alert.apaar_fingerprint}</span></div>
                  <div className="flex justify-between"><span className="text-seat-muted">Gap</span><span className="font-mono">{alert.time_gap_days ?? "?"}d</span></div>
                  {alert.resolved_by && <div className="flex justify-between pt-2 border-t border-seat-border/50"><span className="text-seat-muted">Resolved by</span><span className="font-mono">{alert.resolved_by}</span></div>}
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-seat-accent/30 bg-seat-accent/5 p-3 text-xs text-seat-accent">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div><strong>Both records preserved.</strong> No cancellation has occurred. {alert.state === "UNRESOLVED" && "Human decision or authenticated transfer event will resolve this."}</div>
                </div>
                {alert.state === "UNRESOLVED" && canResolve && (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => resolve(alert.id, "LEGAL_TRANSFER")}
                      className="px-3 py-1.5 rounded-md border border-seat-success/40 text-seat-success text-xs hover:bg-seat-success/10">
                      Legal transfer
                    </button>
                    <button onClick={() => resolve(alert.id, "DUAL_STUDY_PERMITTED")}
                      className="px-3 py-1.5 rounded-md border border-seat-accent/40 text-seat-accent text-xs hover:bg-seat-accent/10">
                      Dual-study
                    </button>
                    <button onClick={() => resolve(alert.id, "ESCALATED")}
                      className="px-3 py-1.5 rounded-md border border-seat-danger/40 text-seat-danger text-xs hover:bg-seat-danger/10">
                      Escalate
                    </button>
                    <button onClick={() => simulateTransfer(alert)}
                      className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-md bg-seat-accent text-seat-bg font-semibold text-xs">
                      <Sparkles className="w-3 h-3" /> Simulate transfer
                    </button>
                  </div>
                )}
                {alert.state === "UNRESOLVED" && !canResolve && (
                  <div className="flex items-center gap-2 rounded-lg border border-seat-warn/30 bg-seat-warn/5 p-2 text-xs text-seat-warn">
                    <ShieldAlert className="w-3.5 h-3.5" /> Resolution requires AICTE admin role.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SideCard({ side, label }: { side: Side; label: string }) {
  return (
    <div className="rounded-lg border border-seat-border bg-seat-bg p-3 space-y-1.5 text-xs">
      <div className="text-[10px] uppercase tracking-widest text-seat-muted mb-1">{label}</div>
      <Row k="Institution" v={side.institution_id} />
      <Row k="Student" v={side.student_name} />
      <Row k="Programme" v={side.program_code} />
      <Row k="Admitted" v={side.admission_date} />
      <Row k="Identity" v={side.identity_status.replace(/_/g, " ")} />
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-seat-muted">{k}</span><span className="font-mono">{v}</span></div>;
}
function Stat({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-4">
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-[10px] uppercase tracking-widest text-seat-muted mt-0.5">{label}</div>
    </div>
  );
}
