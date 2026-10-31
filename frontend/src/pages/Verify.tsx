import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiPost } from "@/lib/api";
import {
  ShieldCheck, ShieldX, Clock, Loader2, Sparkles, RotateCcw,
  CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";

interface VerifyResult {
  status: string;
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
  reason: string | null;
}

const STATUS_META: Record<string, { color: string; label: string; icon: any }> = {
  VALID: { color: "border-seat-success/40 bg-seat-success/10 text-seat-success", label: "VALID", icon: ShieldCheck },
  INVALID_SIGNATURE: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "INVALID SIGNATURE", icon: ShieldX },
  EXPIRED: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "EXPIRED", icon: Clock },
  REVOKED: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "REVOKED", icon: ShieldX },
  CONSENT_WITHDRAWN: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "CONSENT WITHDRAWN", icon: AlertTriangle },
  CONSENT_EXPIRED: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "CONSENT EXPIRED", icon: Clock },
  CONSENT_NOT_FOUND: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "CONSENT NOT FOUND", icon: AlertTriangle },
  UNKNOWN_JTI: { color: "border-seat-warn/40 bg-seat-warn/10 text-seat-warn", label: "UNKNOWN JTI", icon: AlertTriangle },
  AUDIENCE_MISMATCH: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "AUDIENCE MISMATCH", icon: ShieldX },
  ISSUER_MISMATCH: { color: "border-seat-danger/40 bg-seat-danger/10 text-seat-danger", label: "ISSUER MISMATCH", icon: ShieldX },
};

export default function Verify() {
  const location = useLocation();
  const initial = (location.state as any)?.vtoken || "";

  const [token, setToken] = useState(initial);
  const [originalValid, setOriginalValid] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) runVerify(initial);
    // eslint-disable-next-line
  }, []);

  async function runVerify(t: string) {
    const trimmed = t.trim();
    if (!trimmed) { setError("Paste a VToken first"); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiPost<VerifyResult>("/api/v1/verify/credential", { vtoken: trimmed });
      setResult(res);
      if (res.status === "VALID") setOriginalValid(trimmed);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function tamper() {
    if (!token) return;
    const parts = token.split(".");
    if (parts.length !== 3) { setError("Malformed token"); return; }
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
      const obj = JSON.parse(atob(padded));
      obj.institution_id = "FORGED_INSTITUTION";
      obj.identity_level = "FORGED";
      const newB64 = btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const tampered = `${parts[0]}.${newB64}.${parts[2]}`;
      setToken(tampered);
      runVerify(tampered);
    } catch (e: any) {
      setError("Could not tamper token: " + e.message);
    }
  }

  function restore() {
    if (originalValid) {
      setToken(originalValid);
      runVerify(originalValid);
    }
  }

  function clear() {
    setToken(""); setResult(null); setError(null); setOriginalValid(null);
  }

  const statusInfo = result ? STATUS_META[result.status] : null;
  const StatusIcon = statusInfo?.icon;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-seat-accent mb-2">
          Verification Gateway · Phase 5B
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Verify a VToken</h1>
        <p className="text-seat-muted mt-2 max-w-2xl text-sm">
          Paste an Ed25519-signed VToken. Signature is verified offline against the public key —
          no database callback needed. Then revocation, expiry, audience, and consent are checked.
        </p>
      </div>

      <div className="rounded-xl border border-seat-border bg-seat-panel/50 p-5">
        <label className="block text-xs uppercase tracking-widest text-seat-muted mb-2">VToken (JWT)</label>
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={5}
          placeholder="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6…"
          className="w-full px-3 py-2 rounded-lg bg-seat-bg border border-seat-border focus:border-seat-accent focus:outline-none focus:ring-2 focus:ring-seat-accent/20 text-xs font-mono resize-none"
        />
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => runVerify(token)} disabled={loading || !token.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-seat-accent text-seat-bg font-semibold text-sm hover:bg-seat-accent/90 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {loading ? "Verifying…" : "Verify"}
          </button>
          {result?.status === "VALID" && (
            <button onClick={tamper}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-seat-warn/40 text-seat-warn text-xs hover:bg-seat-warn/10 transition">
              <Sparkles className="w-3.5 h-3.5" /> Try tampered token
            </button>
          )}
          {result && result.status !== "VALID" && originalValid && (
            <button onClick={restore}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-seat-border text-xs hover:border-seat-accent/40 transition">
              <RotateCcw className="w-3.5 h-3.5" /> Restore original
            </button>
          )}
          <button onClick={clear} className="ml-auto text-xs text-seat-muted hover:text-white">Clear</button>
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
              The four assertions
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AssertionCard
                letter="a"
                label="Record exists"
                value={result.assertions.a_exists ? "true" : "false"}
                ok={result.assertions.a_exists}
              />
              <AssertionCard
                letter="b"
                label="Identity to level"
                value={result.assertions.b_identity_level
                  ? result.assertions.b_identity_level.replace(/_/g, " ")
                  : "—"}
                ok={!!result.assertions.b_identity_level}
              />
              <AssertionCard
                letter="c"
                label="Institution signed"
                value={result.assertions.c_institution_signed ? "Ed25519 ✓" : "false"}
                ok={result.assertions.c_institution_signed}
              />
              <AssertionCard
                letter="d"
                label="Currently valid"
                value={result.assertions.d_currently_valid ? "true" : "false"}
                ok={result.assertions.d_currently_valid}
              />
            </div>
          </div>

          {Object.keys(result.claims).length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-seat-muted mb-3">
                Claims (role-masked — no PII)
              </h2>
              <div className="rounded-xl border border-seat-border bg-seat-panel/50 divide-y divide-seat-border/50">
                {Object.entries(result.claims).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-seat-muted capitalize">{k.replace(/_/g, " ")}</span>
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
    </div>
  );
}

function AssertionCard({ letter, label, value, ok }: { letter: string; label: string; value: string; ok: boolean }) {
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
