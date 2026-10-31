import { useState } from "react";
import { useAuth } from "@/stores/auth";
import { apiGet, API_URL } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import {
  FileDown, ShieldCheck, AlertTriangle, GitBranch, Layers, Loader2,
  Award, Search,
} from "lucide-react";

interface EnrolmentRow {
  id: string;
  student_name: string;
  program_code: string;
  identity_status: string;
  enrolment_status: string;
  batch_id: string | null;
}

export default function Reports() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [certSearch, setCertSearch] = useState("");
  const [certLoading, setCertLoading] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);

  async function download(path: string, filename: string) {
    setDownloading(path);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setDownloading(null);
    }
  }

  async function lookupCertificate() {
    const q = certSearch.trim();
    if (!q) return;
    setCertLoading(true);
    setCertError(null);
    try {
      // Search batches for a matching enrolment — simplest approach: list batches, then rows
      const batches = await apiGet<any[]>("/api/v1/batches");
      for (const b of batches) {
        try {
          const rows = await apiGet<EnrolmentRow[]>(`/api/v1/batches/${b.id}/rows`);
          const match = rows.find(
            (r) =>
              r.student_name.toLowerCase().includes(q.toLowerCase()) ||
              r.id.startsWith(q) ||
              r.student_name === q
          );
          if (match && match.identity_status === "L3_INSTITUTION_ATTESTED") {
            nav(`/certificate/${match.id}`);
            return;
          }
        } catch {}
      }
      setCertError(`No L3-attested enrolment matching "${q}". Try a student name, or check the L3 tab in Findings.`);
    } catch (e: any) {
      setCertError(e.message);
    } finally {
      setCertLoading(false);
    }
  }

  const reports = [
    {
      id: "occupancy",
      title: "Occupancy report",
      desc: "Sanctioned vs enrolled, per programme, per institution, with L3 breakdown",
      path: "/api/v1/reports/occupancy.csv",
      filename: "seat-occupancy.csv",
      icon: Layers,
      accent: "accent",
    },
    {
      id: "findings",
      title: "All findings",
      desc: "Every rule violation with severity, rule_id, evidence, and status",
      path: "/api/v1/reports/findings.csv",
      filename: "seat-findings.csv",
      icon: AlertTriangle,
      accent: "warn",
    },
    {
      id: "concurrency",
      title: "Concurrency alerts",
      desc: "Cross-institution duplicates, states, resolutions, and time gaps",
      path: "/api/v1/reports/concurrency.csv",
      filename: "seat-concurrency.csv",
      icon: GitBranch,
      accent: "accent2",
    },
    {
      id: "breaches",
      title: "Capacity breaches",
      desc: "Programmes where reported enrolments exceed sanctioned seats",
      path: "/api/v1/reports/capacity-breaches.csv",
      filename: "seat-capacity-breaches.csv",
      icon: AlertTriangle,
      accent: "danger",
    },
  ];

  const accentMap: Record<string, string> = {
    accent: "text-seat-accent border-seat-accent/40",
    accent2: "text-seat-accent2 border-seat-accent2/40",
    warn: "text-seat-warn border-seat-warn/40",
    danger: "text-seat-danger border-seat-danger/40",
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          Reports & Certificate · Phase 12
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Data exports</h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          All role-scoped. AICTE admin sees national; institution admins see only
          their own institution. Every CSV respects the four-assertion model — no
          fake "verified" badge, always named claims.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-seat-muted mb-3">
          CSV exports
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reports.map((r) => {
            const Icon = r.icon;
            const isDownloading = downloading === r.path;
            return (
              <button
                key={r.id}
                onClick={() => download(r.path, r.filename)}
                disabled={isDownloading}
                className="text-left rounded-xl border border-seat-border bg-seat-panel/50 p-5 hover:border-seat-accent/40 transition disabled:opacity-50"
              >
                <div className="flex items-start justify-between mb-3">
                  <Icon className={`w-5 h-5 ${accentMap[r.accent].split(" ")[0]}`} />
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 text-seat-accent animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4 text-seat-muted" />
                  )}
                </div>
                <div className="font-semibold text-sm">{r.title}</div>
                <div className="text-xs text-seat-muted mt-1">{r.desc}</div>
                <div className="text-[10px] uppercase tracking-widest text-seat-muted mt-3 font-mono">
                  {r.filename}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-seat-muted mb-3">
          Enrolment-verification certificate
        </h2>
        <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-seat-success/15 border border-seat-success/40 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5 text-seat-success" />
            </div>
            <div>
              <div className="font-semibold text-sm">Generate a printable certificate</div>
              <div className="text-xs text-seat-muted mt-0.5">
                Requires L3 institution attestation + an active VToken. Contains QR code,
                Ed25519 public key fingerprint, and verify URL. Print-ready A4.
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-seat-muted" />
              <input
                value={certSearch}
                onChange={(e) => setCertSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupCertificate()}
                placeholder="Enter student name or enrolment ID…"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-seat-bg border border-seat-border focus:border-seat-accent focus:outline-none text-sm"
              />
            </div>
            <button
              onClick={lookupCertificate}
              disabled={certLoading || !certSearch.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-seat-success text-seat-bg font-semibold text-sm hover:bg-seat-success/90 disabled:opacity-50"
            >
              {certLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
              {certLoading ? "Looking up…" : "Find & open"}
            </button>
          </div>

          {certError && (
            <div className="mt-3 rounded-lg border border-seat-warn/40 bg-seat-warn/10 p-2 text-xs text-seat-warn">
              {certError}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-seat-border/50 text-[11px] text-seat-muted">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-seat-success" />
              <div>
                <strong className="text-seat-success">Requirement 10 compliant.</strong> APAAR is
                displayed in masked form only (<code>XXXX-XXXX-1234</code>) by default. The
                degree-awarding body must approve any full display based on the applicable
                data-sharing basis.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
