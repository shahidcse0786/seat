import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import {
  ShieldCheck, ShieldX, Loader2, RefreshCw, Link2, Lock,
  ChevronDown, ChevronRight, Activity, AlertTriangle, Sparkles,
} from "lucide-react";

interface VerifyResult {
  chain_valid: boolean; entries: number; first_invalid_id: number | null;
  reason: string; broken_at_action: string | null; tail_hash?: string;
}
interface Stats {
  total_entries: number; by_action: Record<string, number>;
  by_actor_role: Record<string, number>; latest_hash: string;
  latest_created_at: string | null;
}
interface Entry {
  id: number; prev_hash: string; entry_hash: string; entry_hash_full: string;
  prev_hash_full: string; actor_id: string; actor_role: string; action: string;
  target_type: string | null; target_id: string | null; payload_hash: string;
  created_at: string;
}
interface TamperResult {
  original: { chain_valid: boolean; entries: number; reason: string };
  tampered: {
    chain_valid: boolean; entries: number; first_invalid_id: number | null;
    reason: string; broken_at_action: string | null;
    tampered_entry_id: number; tampered_action: string;
  };
  entries_compared: number; tamper_index: number;
}

export default function Audit() {
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [tamper, setTamper] = useState<TamperResult | null>(null);
  const [tamperLoading, setTamperLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  async function load() {
    setLoading(true);
    try {
      const [v, s, e] = await Promise.all([
        apiGet<VerifyResult>("/api/v1/audit/verify"),
        apiGet<Stats>("/api/v1/audit/stats"),
        apiGet<{ entries: Entry[]; total: number }>(`/api/v1/audit/entries?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
      ]);
      setVerify(v); setStats(s); setEntries(e.entries); setTotal(e.total);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [page]);

  async function reverify() {
    setVerifying(true);
    try { setVerify(await apiGet<VerifyResult>("/api/v1/audit/verify")); }
    finally { setVerifying(false); }
  }

  async function runTamper() {
    setTamperLoading(true);
    try {
      const res = await apiGet<TamperResult>("/api/v1/audit/demo/tamper-proof?tamper_at_index=2");
      setTamper(res);
    } catch {}
    setTamperLoading(false);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          Audit Chain · Phase 11
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Hash-Chained Audit Log</h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          Every consequential action appends to a tamper-evident chain. Each entry's hash
          includes the previous entry's hash — modifying any historical entry breaks every
          subsequent one. Writes serialised with an advisory lock so the chain cannot fork.
        </p>
      </div>

      {verify && (
        <div className={`rounded-xl border p-6 ${verify.chain_valid ? "border-seat-success/40 bg-seat-success/10" : "border-seat-danger/40 bg-seat-danger/10"}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              {verify.chain_valid ? <ShieldCheck className="w-8 h-8 text-seat-success shrink-0" /> : <ShieldX className="w-8 h-8 text-seat-danger shrink-0" />}
              <div>
                <div className={`text-xl font-bold ${verify.chain_valid ? "text-seat-success" : "text-seat-danger"}`}>
                  {verify.chain_valid ? "CHAIN VALID" : "CHAIN BROKEN"}
                </div>
                <div className="text-xs mt-1 opacity-80">{verify.reason}</div>
                <div className="text-xs mt-1 opacity-60">
                  {verify.entries} entries · tail: <span className="font-mono">{(verify.tail_hash || "").slice(0, 24)}…</span>
                </div>
                {!verify.chain_valid && verify.first_invalid_id && (
                  <div className="text-xs mt-2 font-mono">First invalid: #{verify.first_invalid_id}{verify.broken_at_action && ` · ${verify.broken_at_action}`}</div>
                )}
              </div>
            </div>
            <button onClick={reverify} disabled={verifying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-current/30 text-xs font-semibold">
              {verifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Re-verify
            </button>
          </div>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total entries" value={stats.total_entries} icon={Activity} />
          <StatCard label="Distinct actions" value={Object.keys(stats.by_action).length} icon={Sparkles} />
          <StatCard label="Actor roles" value={Object.keys(stats.by_actor_role).length} icon={Lock} />
          <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-4">
            <div className="text-[10px] uppercase tracking-widest text-seat-muted mb-1">Tail hash</div>
            <div className="font-mono text-[11px] text-seat-accent truncate">{stats.latest_hash.slice(0, 20)}…</div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-seat-warn/40 bg-seat-warn/5 p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-seat-warn shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sm">Tamper detection demo</div>
              <div className="text-xs text-seat-muted mt-0.5">
                Compare real chain verification against a simulated tampered copy. <strong className="text-seat-accent">Read-only</strong> — real chain is never touched.
              </div>
            </div>
          </div>
          <button onClick={runTamper} disabled={tamperLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-seat-warn text-seat-bg text-xs font-semibold disabled:opacity-50">
            {tamperLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldX className="w-3 h-3" />} Run demo
          </button>
        </div>
        {tamper && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="rounded-lg border border-seat-success/40 bg-seat-success/5 p-3">
              <div className="flex items-center gap-2 mb-1"><ShieldCheck className="w-4 h-4 text-seat-success" /><span className="font-semibold text-sm text-seat-success">ORIGINAL</span></div>
              <div className="text-xs text-seat-success">{tamper.original.chain_valid ? "CHAIN VALID" : "CHAIN BROKEN"}</div>
              <div className="text-[11px] text-seat-muted mt-1">{tamper.entries_compared} entries · {tamper.original.reason}</div>
            </div>
            <div className="rounded-lg border border-seat-danger/40 bg-seat-danger/5 p-3">
              <div className="flex items-center gap-2 mb-1"><ShieldX className="w-4 h-4 text-seat-danger" /><span className="font-semibold text-sm text-seat-danger">TAMPERED</span></div>
              <div className="text-xs text-seat-danger">{tamper.tampered.chain_valid ? "CHAIN VALID" : "CHAIN BROKEN"}</div>
              <div className="text-[11px] text-seat-muted mt-1">Modified entry #{tamper.tampered.tampered_entry_id} ({tamper.tampered.tampered_action})</div>
              {!tamper.tampered.chain_valid && (
                <div className="text-[11px] text-seat-danger font-mono mt-1">Detected at #{tamper.tampered.first_invalid_id}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {stats && Object.keys(stats.by_action).length > 0 && (
        <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
          <div className="font-semibold text-sm mb-3">Actions by type</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.by_action).sort((a, b) => b[1] - a[1]).map(([action, count]) => (
              <div key={action} className="flex items-center gap-1.5 rounded-lg border border-seat-border bg-seat-bg px-2.5 py-1 text-[11px]">
                <span className="font-mono">{action}</span><span className="text-seat-accent font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-seat-muted">Chain entries ({total})</h2>
          <div className="flex items-center gap-2 text-xs text-seat-muted">
            <span>Page {page + 1} / {totalPages || 1}</span>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2 py-1 rounded border border-seat-border hover:border-seat-accent/40 disabled:opacity-30">←</button>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-seat-border hover:border-seat-accent/40 disabled:opacity-30">→</button>
          </div>
        </div>
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-seat-border bg-seat-panel/40 overflow-hidden">
              <button onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-seat-panel/60 text-left">
                {expanded === e.id ? <ChevronDown className="w-4 h-4 text-seat-muted" /> : <ChevronRight className="w-4 h-4 text-seat-muted" />}
                <span className="font-mono text-[10px] text-seat-muted w-12">#{e.id}</span>
                <Link2 className="w-3 h-3 text-seat-accent" />
                <span className="text-xs font-mono text-seat-accent/80">{e.entry_hash}</span>
                <span className="text-sm font-medium truncate flex-1">{e.action}</span>
                <span className="text-xs text-seat-muted truncate max-w-[140px]">{e.actor_role}</span>
                <span className="text-[10px] text-seat-muted">{new Date(e.created_at).toLocaleTimeString()}</span>
              </button>
              {expanded === e.id && (
                <div className="px-4 pb-3 pl-11 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <KV k="Actor" v={e.actor_id} />
                    <KV k="Role" v={e.actor_role} />
                    <KV k="Action" v={e.action} />
                    <KV k="Target" v={`${e.target_type || "—"} / ${e.target_id || "—"}`} />
                  </div>
                  <div className="rounded-lg bg-seat-bg border border-seat-border p-3 space-y-1.5 text-[11px] font-mono">
                    <div className="flex gap-2"><span className="text-seat-muted w-20">prev_hash:</span><span className="text-seat-muted truncate">{e.prev_hash_full}</span></div>
                    <div className="flex gap-2"><span className="text-seat-muted w-20">entry_hash:</span><span className="text-seat-accent truncate">{e.entry_hash_full}</span></div>
                    <div className="flex gap-2"><span className="text-seat-muted w-20">payload:</span><span className="text-seat-warn truncate">{e.payload_hash}</span></div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {loading && <div className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin text-seat-accent mx-auto" /></div>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[10px] uppercase tracking-widest text-seat-muted">{k}</div><div className="text-xs font-mono truncate">{v}</div></div>;
}
function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-4">
      <Icon className="w-4 h-4 text-seat-accent mb-1" />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-seat-muted mt-0.5">{label}</div>
    </div>
  );
}
