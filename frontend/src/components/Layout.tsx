import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Upload, ShieldCheck, Users, GitBranch, AlertTriangle,
  FileBarChart, Settings, Sparkles, LogOut,
} from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "@/stores/auth";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/submission", label: "Submission", icon: Upload },
  { to: "/verify", label: "Verify", icon: ShieldCheck },
  { to: "/concurrency", label: "Concurrency", icon: GitBranch },
  { to: "/findings", label: "Findings", icon: AlertTriangle },
  { to: "/institutions", label: "Institutions", icon: Users },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/admin", label: "Admin", icon: Settings },
];

const roleLabel: Record<string, string> = {
  aicte_admin: "AICTE Admin",
  institution_admin: "Institution",
  regulator_auditor: "Auditor",
  employer_verifier: "Employer",
  student_self: "Student",
  seat_operator: "Operator",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const nav2 = useNavigate();
  const { user, logout } = useAuth();

  function doLogout() {
    logout();
    nav2("/login", { replace: true });
  }

  return (
    <div className="flex h-screen bg-seat-bg">
      <aside className="w-64 border-r border-seat-border bg-seat-panel/60 backdrop-blur flex flex-col">
        <div className="p-5 border-b border-seat-border">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-seat-accent to-seat-accent2 flex items-center justify-center shadow-lg shadow-seat-accent/20">
              <Sparkles className="w-5 h-5 text-seat-bg" />
            </div>
            <div>
              <div className="font-bold text-lg tracking-tight leading-none">SEAT</div>
              <div className="text-[10px] text-seat-muted uppercase tracking-widest mt-0.5">
                Verification Layer
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => {
            const active = item.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
                  active
                    ? "bg-seat-accent/10 text-seat-accent border border-seat-accent/30"
                    : "text-seat-muted hover:text-white hover:bg-white/5 border border-transparent"
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-seat-border">
          {user && (
            <div className="mb-3">
              <div className="text-[10px] text-seat-muted uppercase tracking-widest mb-1">Signed in as</div>
              <div className="text-xs truncate">{user.email}</div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] uppercase tracking-widest text-seat-accent font-semibold">
                  {roleLabel[user.role] || user.role}
                </span>
                {user.institution_id && (
                  <span className="text-[10px] text-seat-muted">{user.institution_id}</span>
                )}
              </div>
            </div>
          )}
          <button
            onClick={doLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-seat-border text-xs text-seat-muted hover:text-seat-danger hover:border-seat-danger/40 transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto seat-grid">
        <div className="max-w-7xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
