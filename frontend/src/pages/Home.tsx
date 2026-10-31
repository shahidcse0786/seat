import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Layers, Users, GitBranch, AlertTriangle, ShieldCheck, Cpu,
  Building2, TrendingUp, Activity,
} from "lucide-react";

interface Stats {
  total_institutions: number;
  total_programmes: number;
  total_approved_seats: number;
  total_enrolments: number;
  occupancy_rate: number;
  by_identity_status: Record<string, number>;
  by_consent_status: Record<string, number>;
  total_findings: number;
  open_findings: number;
  concurrency_alerts: number;
  unresolved_alerts: number;
  total_batches: number;
  rule_versions: number;
  users: number;
}

interface OccRow {
  institution_id: string;
  program_code: string;
  sanctioned: number;
  enrolled: number;
  l3: number;
  l1: number;
  l2: number;
  pending: number;
  quarantined: number;
  vacancy: number;
  occupancy_pct: number;
  source: string;
}

interface RuleRow { rule_id: string; severity: string; count: number; }

interface InstRow {
  id: string;
  name: string;
  city: string;
  state: string;
  type: string;
  capacity: number;
  enrolled: number;
  l3: number;
  findings: number;
  concurrency_alerts: number;
  occupancy_pct: number;
}

const COLORS = {
  accent: "#38BDF8",
  accent2: "#22D3EE",
  success: "#10B981",
  warn: "#F59E0B",
  danger: "#EF4444",
  muted: "#94A3B8",
  border: "#1E293B",
  panel: "#111720",
};

const PROV_COLORS: Record<string, string> = {
  BUILT: "text-seat-success border-seat-success/40 bg-seat-success/10",
  MOCK: "text-seat-warn border-seat-warn/40 bg-seat-warn/10",
  SPECIFIED: "text-seat-accent border-seat-accent/40 bg-seat-accent/10",
  ROADMAP: "text-seat-muted border-seat-muted/40 bg-seat-muted/10",
};

const SEVERITY_COLORS: Record<string, string> = {
  FAIL: COLORS.danger,
  REVIEW: COLORS.warn,
  WARN: COLORS.accent,
};

const CONSENT_COLORS: Record<string, string> = {
  ACTIVE: COLORS.success,
  NOT_GRANTED: COLORS.muted,
  EXPIRED: COLORS.warn,
  WITHDRAWN: COLORS.danger,
};

function Prov({ kind }: { kind: "BUILT" | "MOCK" | "SPECIFIED" | "ROADMAP" }) {
  return (
    <span className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border font-bold ${PROV_COLORS[kind]}`}>
      {kind}
    </span>
  );
}

export default function Home() {
  const { user } = useAuth();
  const isNational = user?.role === "aicte_admin" || user?.role === "regulator_auditor" || user?.role === "seat_operator";

  const [stats, setStats] = useState<Stats | null>(null);
  const [occ, setOcc] = useState<OccRow[]>([]);
  const [byRule, setByRule] = useState<RuleRow[]>([]);
  const [institutions, setInstitutions] = useState<InstRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, o, r, i] = await Promise.all([
        apiGet<Stats>("/api/v1/admin/stats").catch(() => null),
        apiGet<OccRow[]>("/api/v1/analytics/occupancy").catch(() => []),
        apiGet<RuleRow[]>("/api/v1/analytics/by-rule").catch(() => []),
        isNational ? apiGet<InstRow[]>("/api/v1/analytics/institutions").catch(() => []) : Promise.resolve([]),
      ]);
      if (s) setStats(s);
      setOcc(o);
      setByRule(r);
      setInstitutions(i);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const isEmpty = !stats || stats.total_enrolments === 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-seat-muted text-sm">Loading dashboard…</div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-3">Empty database</div>
        <h1 className="text-3xl font-bold mb-3">No data yet</h1>
        <p className="text-seat-muted text-sm mb-6">
          Seed the demo data to populate the dashboard. Or navigate to <strong>Submission</strong> to upload a batch.
        </p>
        <button
          onClick={async () => {
            await fetch("http://localhost:8000/api/v1/admin/reset?confirm=true", { method: "POST" });
            load();
          }}
          className="px-5 py-2.5 rounded-lg bg-seat-accent text-seat-bg font-semibold text-sm hover:bg-seat-accent/90"
        >
          Seed demo data
        </button>
      </div>
    );
  }

  const funnel = [
    { name: "APAAR Pending", value: stats.by_identity_status["APAAR_PENDING"] || 0, color: COLORS.warn },
    { name: "L1 Format", value: stats.by_identity_status["L1_FORMAT_VALID"] || 0, color: COLORS.accent },
    { name: "L2 Existence", value: stats.by_identity_status["L2_EXISTENCE_CONFIRMED"] || 0, color: COLORS.accent2 },
    { name: "L3 Attested", value: stats.by_identity_status["L3_INSTITUTION_ATTESTED"] || 0, color: COLORS.success },
  ];

  const consentData = Object.entries(stats.by_consent_status || {}).map(([k, v]) => ({
    name: k,
    value: v,
    color: CONSENT_COLORS[k] || COLORS.muted,
  }));

  // Aggregate occupancy by program (sum across institutions for national view)
  const occByProgram: Record<string, { sanctioned: number; enrolled: number; l3: number }> = {};
  for (const r of occ) {
    const key = r.program_code;
    if (!occByProgram[key]) occByProgram[key] = { sanctioned: 0, enrolled: 0, l3: 0 };
    occByProgram[key].sanctioned += r.sanctioned;
    occByProgram[key].enrolled += r.enrolled;
    occByProgram[key].l3 += r.l3;
  }
  const occupancyData = Object.entries(occByProgram)
    .map(([program, v]) => ({ program, ...v }))
    .sort((a, b) => b.enrolled - a.enrolled)
    .slice(0, 10);

  // Aggregate findings by rule (top 8)
  const ruleAgg: Record<string, { count: number; severity: string }> = {};
  for (const r of byRule) {
    if (!ruleAgg[r.rule_id]) ruleAgg[r.rule_id] = { count: 0, severity: r.severity };
    ruleAgg[r.rule_id].count += r.count;
  }
  const ruleData = Object.entries(ruleAgg)
    .map(([rule_id, v]) => ({ rule_id: rule_id.replace(/_/g, " "), ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          {isNational ? "National Overview" : "Institution Overview"} · Phase 10
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {isNational ? "AICTE National Dashboard" : `${user?.institution_id || "Institution"} Dashboard`}
        </h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          {isNational
            ? "Aggregate occupancy, verification status, findings, and cross-institution concurrency across all approved institutions."
            : "Your institution's occupancy, verification funnel, findings, and data-quality metrics."}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI
          icon={Layers} label="Approved Seats" value={stats.total_approved_seats.toLocaleString()}
          hint={`${stats.total_programmes} programmes`} accent="accent" prov="MOCK"
        />
        <KPI
          icon={Users} label="Enrolments" value={stats.total_enrolments.toLocaleString()}
          hint={`${stats.occupancy_rate}% occupancy`} accent="accent2" prov="BUILT"
        />
        <KPI
          icon={GitBranch} label="Concurrency Alerts" value={String(stats.concurrency_alerts)}
          hint={`${stats.unresolved_alerts} unresolved`} accent="warn" prov="BUILT"
        />
        <KPI
          icon={AlertTriangle} label="Findings" value={String(stats.total_findings)}
          hint={`${stats.open_findings} open`} accent="danger" prov="BUILT"
        />
      </div>

      {/* Row 1 — Occupancy + Findings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Occupancy by programme" sub="Sanctioned vs enrolled — top 10" prov="BUILT">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={occupancyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="program" tick={{ fontSize: 10, fill: COLORS.muted }} stroke={COLORS.border} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.muted }} stroke={COLORS.border} />
              <Tooltip
                contentStyle={{
                  backgroundColor: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="sanctioned" fill={COLORS.border} radius={[4, 4, 0, 0]} name="Sanctioned" />
              <Bar dataKey="enrolled" fill={COLORS.accent} radius={[4, 4, 0, 0]} name="Enrolled" />
              <Bar dataKey="l3" fill={COLORS.success} radius={[4, 4, 0, 0]} name="L3 attested" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Findings by rule" sub="Top 8 rule violations" prov="BUILT">
          {ruleData.length === 0 ? (
            <div className="text-center py-16 text-xs text-seat-muted">No findings yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={ruleData} layout="vertical" margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLORS.muted }} stroke={COLORS.border} />
                <YAxis
                  type="category" dataKey="rule_id"
                  tick={{ fontSize: 9, fill: COLORS.muted }} stroke={COLORS.border} width={130}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: COLORS.panel,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {ruleData.map((entry, i) => (
                    <Cell key={i} fill={SEVERITY_COLORS[entry.severity] || COLORS.accent} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Row 2 — Funnel + Consent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Verification funnel" sub="Records by identity level" prov="BUILT">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={funnel} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: COLORS.muted }} stroke={COLORS.border} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.muted }} stroke={COLORS.border} />
              <Tooltip
                contentStyle={{
                  backgroundColor: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {funnel.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Consent breakdown" sub="Purpose-bound · withdrawable" prov="BUILT">
          {consentData.length === 0 ? (
            <div className="text-center py-16 text-xs text-seat-muted">No consent records</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={consentData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={80} innerRadius={40}
                  paddingAngle={2}
                >
                  {consentData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: COLORS.panel,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: COLORS.muted }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Row 3 — Institution table (national only) */}
      {isNational && institutions.length > 0 && (
        <Card title="Institutions" sub={`${institutions.length} approved · sorted by enrolment`} prov="BUILT">
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-seat-muted border-b border-seat-border">
                  <th className="text-left px-3 py-2 font-medium">Institution</th>
                  <th className="text-left px-3 py-2 font-medium">State</th>
                  <th className="text-right px-3 py-2 font-medium">Capacity</th>
                  <th className="text-right px-3 py-2 font-medium">Enrolled</th>
                  <th className="text-right px-3 py-2 font-medium">L3</th>
                  <th className="text-right px-3 py-2 font-medium">Occupancy</th>
                  <th className="text-right px-3 py-2 font-medium">Findings</th>
                  <th className="text-right px-3 py-2 font-medium">Alerts</th>
                </tr>
              </thead>
              <tbody>
                {institutions
                  .sort((a, b) => b.enrolled - a.enrolled)
                  .map((inst) => (
                    <tr key={inst.id} className="border-b border-seat-border/40 hover:bg-seat-panel/40">
                      <td className="px-3 py-2">
                        <div className="font-medium">{inst.id}</div>
                        <div className="text-[10px] text-seat-muted truncate max-w-[220px]">{inst.name}</div>
                      </td>
                      <td className="px-3 py-2 text-seat-muted">{inst.state}</td>
                      <td className="px-3 py-2 text-right font-mono">{inst.capacity}</td>
                      <td className="px-3 py-2 text-right font-mono">{inst.enrolled}</td>
                      <td className="px-3 py-2 text-right font-mono text-seat-success">{inst.l3}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`font-mono ${inst.occupancy_pct > 100 ? "text-seat-danger" : inst.occupancy_pct > 90 ? "text-seat-warn" : "text-seat-muted"}`}>
                          {inst.occupancy_pct}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-seat-warn">{inst.findings}</td>
                      <td className="px-3 py-2 text-right font-mono text-seat-accent">{inst.concurrency_alerts}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Provenance legend */}
      <div className="rounded-xl border border-seat-border bg-seat-panel/30 p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-3.5 h-3.5 text-seat-accent" />
          <span className="text-xs font-semibold uppercase tracking-widest text-seat-muted">Provenance</span>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-seat-muted">
          <div className="flex items-center gap-1.5"><Prov kind="BUILT" /><span>runs in this build</span></div>
          <div className="flex items-center gap-1.5"><Prov kind="MOCK" /><span>external dependency simulated</span></div>
          <div className="flex items-center gap-1.5"><Prov kind="SPECIFIED" /><span>design only, not demoed</span></div>
          <div className="flex items-center gap-1.5"><Prov kind="ROADMAP" /><span>future work</span></div>
        </div>
      </div>
    </div>
  );
}

function KPI({
  icon: Icon, label, value, hint, accent, prov,
}: {
  icon: any; label: string; value: string; hint: string;
  accent: "accent" | "accent2" | "warn" | "danger"; prov: "BUILT" | "MOCK" | "SPECIFIED" | "ROADMAP";
}) {
  const colorMap = {
    accent: "text-seat-accent border-seat-accent/40",
    accent2: "text-seat-accent2 border-seat-accent2/40",
    warn: "text-seat-warn border-seat-warn/40",
    danger: "text-seat-danger border-seat-danger/40",
  };
  return (
    <div className="rounded-xl border border-seat-border bg-gradient-to-br from-seat-panel/60 to-seat-panel/30 p-5 relative overflow-hidden">
      <div className={`absolute top-0 right-0 w-20 h-20 opacity-5 rounded-bl-full bg-current ${colorMap[accent].split(" ")[0]}`} />
      <div className="flex items-center justify-between mb-3">
        <Icon className={`w-5 h-5 ${colorMap[accent].split(" ")[0]}`} />
        <Prov kind={prov} />
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-seat-muted mt-1">{label}</div>
      <div className="text-[10px] text-seat-muted mt-0.5">{hint}</div>
    </div>
  );
}

function Card({ title, sub, prov, children }: {
  title: string; sub?: string; prov: "BUILT" | "MOCK" | "SPECIFIED" | "ROADMAP";
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="font-semibold text-sm">{title}</div>
          {sub && <div className="text-[11px] text-seat-muted mt-0.5">{sub}</div>}
        </div>
        <Prov kind={prov} />
      </div>
      {children}
    </div>
  );
}
