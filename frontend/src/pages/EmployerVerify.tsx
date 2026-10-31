import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { publicPost, publicGet } from "@/lib/publicApi";
import {
  ShieldCheck, ShieldX, Clock, Loader2, Sparkles,
  CheckCircle2, XCircle, AlertTriangle, ArrowLeft, Building2, Key,
} from "lucide-react";

interface VerifyResult {
  status: string;
  reason: string | null;
  assertions: {
    a_exists: boolean;
    b_identity_level: string | null;
    c_institution_signed: boolean;
    d_currently_valid: boolean;
  };
  claims: {
    institution?: string;
    programme?: string;
    academic_year?: string;
    identity_level?: string;
    credential_type?: string;
  };
  checked_at: string;
}

interface Manifest {
  issued_at: string;
  next_expected: string;
  kid: string;
  revoked_jtis: string[];
  signature: string;
}

const STATUS_META: Record<string, { color: string; label: string; icon: any }> = {
  VALID: { color: "border-seat-success/40 bg-seat-success/10 text-seat-success", label: "VALID", icon: ShieldCheck },
  INVALID_SIGNATURE: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "INVALID SIGNATURE", icon: ShieldX },
  EXPIRED: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "EXPIRED", icon: Clock },
  REVOKED: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "REVOKED", icon: ShieldX },
  CONSENT_WITHDRAWN: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "CONSENT WITHDRAWN", icon: AlertTriangle },
  CONSENT_EXPIRED: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "CONSENT EXPIRED", icon: Clock },
  CONSENT_NOT_FOUND: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "CONSENT NOT FOUND", icon: AlertTriangle },
  UNKNOWN_JTI: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "UNKNOWN TOKEN", icon: AlertTriangle },
  AUDIENCE_MISMATCH: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "AUDIENCE MISMATCH", icon: ShieldX },
  ISSUER_MISMATCH: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "ISSUER MISMATCH", icon: ShieldX },
  MALFORMED_TOKEN: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "MALFORMED TOKEN", icon: ShieldX },
};

export default function EmployerVerify() {
  const [params] = useSearchParams();
  const initial = params.get("t") || "";

  const [token, setToken] = useState(initial);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  useEffect(() => {
    publicGet<Manifest>("/api/v1/public/revocation-manifest").then(setManifest).catch(() => {});
    if (initial) runVerify(initial);
    // eslint-disable-next-line
  }, []);

  async function runVerify(t: string) {
    if (!t.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await publicPost<VerifyResult>("/api/v1/public/verify-credential", { vtoken: t.trim() });
      setResult(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const statusInfo = result ? (STATUS_META[result.status] || STATUS_META.INVALID_SIGNATURE) : null;
  const StatusIcon = statusInfo?.icon;

  return (
    <div className="min-h-screen seat-grid bg-seat-bg">
      {/* Header — no auth bar, this is the public page */}
      <header className="border-b border-seat-border bg-seat-panel/40 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-seat-accent to-seat-accent2 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-seat-bg" />
            </div>
            <div>
              <div className="font-bold text-sm">SEAT Public Verification</div>
              <div className="text-[10px] uppercase tracking-widest text-seat-muted">No login required</div>
            </div>
          </div>
          <Link to="/login" className="flex items-center gap-1.5 text-xs text-seat-muted hover:text-seat-accent">
            <ArrowLeft className="w-3 h-3" /> Sign in
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Verify an enrolment credential</h1>
          <p className="text-seat-muted mt-2 max-w-2xl text-sm">
            Paste a VToken to verify. Signature is checked against the SEAT public key —
            independently of the issuing institution's servers. Revocation status is checked
            against the signed manifest.
          </p>
        </div>

        <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
          <label className="block text-xs uppercase tracking-widest text-seat-muted mb-2">VToken</label>
          <textarea
            value={token} onChange={(e) => setToken(e.target.value)}
            rows={5}
            placeholder="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6…"
            className="w-full px-3 py-2 rounded-lg bg-seat-bg border border-seat-border focus:border-seat-accent focus:outline-none text-xs font-mono resize-none"
          />
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => runVerify(token)}
              disabled={loading || !token.trim()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-seat-accent text-seat-bg font-semibold text-sm hover:bg-seat-accent/90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {loading ? "Verifying…" : "Verify"}
            </button>
            <button onClick={() => { setToken(""); setResult(null); setError(null); }}
              className="text-xs text-seat-muted hover:text-white">Clear</button>
          </div>
          {error && <div className="mt-3 rounded-lg border border-seat-danger/40 bg-seat-danger/10 p-2 text-xs text-seat-danger">{error}</div>}
        </div>

        {result && statusInfo && (
          <>
            <div className={`rounded-xl border p-5 ${statusInfo.color}`}>
              <div className="flex items-center gap-3">
                <StatusIcon className="w-7 h-7" />
                <div>
                  <div className="text-lg font-bold tracking-tight">{statusInfo.label}</div>
                  {result.reason && <div className="text-xs opacity-80 mt-0.5">{result.reason}</div>}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-seat-muted mb-3">
                Four assertions
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Assertion letter="a" label="Record exists" ok={result.assertions.a_exists}
                  value={result.assertions.a_exists ? "true" : "false"} />
                <Assertion letter="b" label="Identity to level" ok={!!result.assertions.b_identity_level}
                  value={(result.assertions.b_identity_level || "—").replace(/_/g, " ")} />
                <Assertion letter="c" label="Institution signed" ok={result.assertions.c_institution_signed}
                  value={result.assertions.c_institution_signed ? "Ed25519 ✓" : "false"} />
                <Assertion letter="d" label="Currently valid" ok={result.assertions.d_currently_valid}
                  value={result.assertions.d_currently_valid ? "true" : "false"} />
              </div>
            </div>

            {Object.keys(result.claims).length > 0 && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-seat-muted mb-3">
                  Claims (role-masked · no PII)
                </h2>
                <div className="rounded-xl border border-seat-border bg-seat-panel/50 divide-y divide-seat-border/50">
                  {Object.entries(result.claims).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-seat-muted capitalize flex items-center gap-2">
                        <Building2 className="w-3 h-3" /> {k.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-xs">{v as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[11px] text-seat-muted font-mono">
              checked_at: {result.checked_at}
            </div>
          </>
        )}

        {/* Manifest info */}
        {manifest && (
          <div className="rounded-xl border border-seat-border bg-seat-panel/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Key className="w-3.5 h-3.5 text-seat-accent" />
              <span className="text-xs font-semibold uppercase tracking-widest text-seat-muted">
                Revocation manifest (signed)
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
              <KV k="Kid" v={manifest.kid} mono />
              <KV k="Issued at" v={new Date(manifest.issued_at).toLocaleTimeString()} />
              <KV k="Revoked tokens" v={String(manifest.revoked_jtis.length)} />
              <KV k="Signature" v={manifest.signature.slice(0, 16) + "…"} mono />
            </div>
          </div>
        )}

        <div className="text-center pt-4 text-[11px] text-seat-muted">
          SEAT issues <strong>enrolment-verification credentials</strong>, not degree credentials.
          A valid signature proves the claim at issue time; freshness depends on the signed manifest.
        </div>
      </main>
    </div>
  );
}

function Assertion({ letter, label, ok, value }: { letter: string; label: string; ok: boolean; value: string }) {
  return (
    <div className={`rounded-xl border p-4 ${ok ? "border-seat-success/40 bg-seat-success/5" : "border-seat-danger/40 bg-seat-danger/5"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono font-bold text-sm ${
          ok ? "bg-seat-success/15 text-seat-success border border-seat-success/30"
             : "bg-seat-danger/15 text-seat-danger border border-seat-danger/30"
        }`}>{letter}</span>
        {ok ? <CheckCircle2 className="w-4 h-4 text-seat-success" /> : <XCircle className="w-4 h-4 text-seat-danger" />}
      </div>
      <div className="text-xs font-semibold mb-1">{label}</div>
      <div className={`text-[10px] font-mono break-words ${ok ? "text-seat-success" : "text-seat-danger"}`}>{value}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-seat-muted">{k}</div>
      <div className={`${mono ? "font-mono" : ""} truncate`}>{v}</div>
    </div>
  );
}
