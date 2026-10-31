import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth, AuthUser } from "@/stores/auth";
import { Sparkles, Loader2, LogIn, ShieldCheck } from "lucide-react";

interface DemoUser { email: string; role: string; institution_id: string | null; password: string; }

const roleLabel: Record<string, string> = {
  aicte_admin: "AICTE Admin",
  institution_admin: "Institution",
  regulator_auditor: "Auditor",
  employer_verifier: "Employer",
  seat_operator: "Operator",
};

const roleColor: Record<string, string> = {
  aicte_admin: "text-seat-accent",
  institution_admin: "text-seat-accent2",
  regulator_auditor: "text-seat-muted",
  employer_verifier: "text-seat-success",
  seat_operator: "text-seat-warn",
};

export default function Login() {
  const nav = useNavigate();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);

  useEffect(() => {
    apiGet<DemoUser[]>("/api/v1/auth/demo-users").then(setDemoUsers).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<{ access_token: string; user: AuthUser }>(
        "/api/v1/auth/login",
        { email, password }
      );
      setAuth(res.access_token, res.user);
      nav("/", { replace: true });
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function quickFill(u: DemoUser) {
    setEmail(u.email);
    setPassword(u.password);
  }

  return (
    <div className="min-h-screen flex seat-grid bg-seat-bg">
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 border-r border-seat-border bg-seat-panel/30">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-seat-accent to-seat-accent2 flex items-center justify-center shadow-lg shadow-seat-accent/20">
            <Sparkles className="w-6 h-6 text-seat-bg" />
          </div>
          <div>
            <div className="font-bold text-xl tracking-tight leading-none">SEAT</div>
            <div className="text-[10px] text-seat-muted uppercase tracking-widest mt-1">
              Verification Layer
            </div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight leading-tight max-w-md">
            Verification is a{" "}
            <span className="bg-gradient-to-r from-seat-accent to-seat-accent2 bg-clip-text text-transparent">
              stack, not a flag
            </span>
          </h1>
          <p className="text-seat-muted mt-4 max-w-md text-sm leading-relaxed">
            Four claims — record existence, identity level, institutional signature,
            current validity — kept separate, always. Every API response names the
            claim it makes.
          </p>
        </div>
        <div className="text-xs text-seat-muted">Prototype · Phase 7 · Employer Gateway</div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
            <p className="text-sm text-seat-muted mt-1">Use a demo role below, or type credentials.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-seat-muted mb-2">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@aicte.gov.in"
                className="w-full px-4 py-2.5 rounded-lg bg-seat-panel border border-seat-border focus:border-seat-accent focus:outline-none focus:ring-2 focus:ring-seat-accent/20 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-seat-muted mb-2">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="demo1234"
                className="w-full px-4 py-2.5 rounded-lg bg-seat-panel border border-seat-border focus:border-seat-accent focus:outline-none focus:ring-2 focus:ring-seat-accent/20 text-sm"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-seat-danger/40 bg-seat-danger/10 p-3 text-xs text-seat-danger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-seat-accent text-seat-bg font-semibold text-sm hover:bg-seat-accent/90 disabled:opacity-50 transition"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-seat-border">
            <div className="text-xs text-seat-muted mb-2">Verify without logging in</div>
            <Link
              to="/employer"
              className="inline-flex items-center gap-1.5 text-sm text-seat-accent hover:underline"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Employer portal →
            </Link>
          </div>

          {demoUsers.length > 0 && (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-widest text-seat-muted mb-3">
                Demo roles · click to fill
              </div>
              <div className="space-y-1.5">
                {demoUsers.map((u) => (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => quickFill(u)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-seat-border hover:border-seat-accent/40 hover:bg-seat-panel/60 transition text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{u.email}</div>
                      {u.institution_id && (
                        <div className="text-[11px] text-seat-muted">{u.institution_id}</div>
                      )}
                    </div>
                    <span className={`text-[10px] uppercase tracking-widest ${roleColor[u.role] || "text-seat-muted"} font-semibold`}>
                      {roleLabel[u.role] || u.role}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
