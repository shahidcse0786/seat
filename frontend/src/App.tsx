import React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Submission from "@/pages/Submission";
import Verify from "@/pages/Verify";
import Findings from "@/pages/Findings";
import EmployerVerify from "@/pages/EmployerVerify";
import Concurrency from "@/pages/Concurrency";
import Advisory from "@/pages/Advisory";
import Audit from "@/pages/Audit";
import Reports from "@/pages/Reports";
import Certificate from "@/pages/Certificate";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-seat-bg p-8">
          <div className="max-w-lg w-full rounded-xl border border-seat-danger/40 bg-seat-danger/10 p-6 text-center">
            <div className="text-seat-danger text-lg font-bold mb-2">Page crashed</div>
            <div className="text-xs text-seat-muted font-mono mb-4 break-all">
              {this.state.error.message}
            </div>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.href = "/";
              }}
              className="px-4 py-2 rounded-lg bg-seat-accent text-seat-bg font-semibold text-sm hover:bg-seat-accent/90"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="text-center py-24">
      <div className="text-seat-muted text-sm uppercase tracking-widest mb-2">
        Coming in a later phase
      </div>
      <h2 className="text-2xl font-bold">{title}</h2>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          {/* Public routes — no auth */}
          <Route path="/login" element={<Login />} />
          <Route path="/employer" element={<EmployerVerify />} />

          {/* Authenticated routes */}
          <Route path="/" element={<Shell><Home /></Shell>} />
          <Route path="/submission" element={<Shell><Submission /></Shell>} />
          <Route path="/verify" element={<Shell><Verify /></Shell>} />
          <Route path="/concurrency" element={<Shell><Concurrency /></Shell>} />
          <Route path="/findings" element={<Shell><Findings /></Shell>} />
          <Route path="/advisory" element={<Shell><Advisory /></Shell>} />
          <Route path="/audit" element={<Shell><Audit /></Shell>} />
          <Route path="/reports" element={<Shell><Reports /></Shell>} />
          <Route path="/certificate/:id" element={<Shell><Certificate /></Shell>} />
          <Route path="/institutions" element={<Shell><Placeholder title="Institutions" /></Shell>} />
          <Route path="/admin" element={<Shell><Placeholder title="Admin" /></Shell>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
