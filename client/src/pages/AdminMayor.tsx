// AdminMayor.tsx — calm, ultra-minimal Mayor mission control.
//
// One screen. One pause button. Money-first framing.
//
//   • Top: engine pulse (paused or running, last digest, sent today, replies waiting)
//   • Middle: ONE big button — Pause / Resume (no scroll, no clutter)
//   • Bottom: replies needing action (last 5) with quick-link to detail
//   • Footer: deep links to the full mission control + each specialized tab
//
// Detail (every outreach, every contract, every prospect drill-down) lives in
// the existing /admin/leads, /admin/money, /admin/system tabs. This page is
// intentionally minimal — the user explicitly said "ui ux is teribale …
// make them buttons big … simpler".
//
// All data fetched in parallel on tab change + 30s poll. Bearer token from
// the shared admin session (now persisted in localStorage with a 30-day TTL
// so iPhone + Safari + Telegram-switch-back doesn't kick you out).

import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Pause, Play, Mail, Send, Reply, AlertTriangle, RefreshCw, CheckCircle2,
  Loader2, ArrowRight, Activity, Calendar, Clock, ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AdminNav, AdminGate, useAdminSession,
} from "./AdminShell";

const POLL_MS = 30_000;

const TOK = () => (typeof localStorage !== "undefined" ? localStorage.getItem("mehyarsoft_admin_token") : null) || "";

function fmtAgo(iso: string) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86400_000)}d ago`;
}

function StatBox({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className={`rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 ${color || "bg-white dark:bg-zinc-900"}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-medium">{label}</div>
        {Icon && <Icon className="w-4 h-4 opacity-50" />}
      </div>
      <div className="text-3xl font-bold mt-2 tabular-nums">{value ?? "—"}</div>
      {sub && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function AdminMayor() {
  return <AdminGate>{(token) => <MayorView token={token} />}</AdminGate>;
}

function MayorView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<any>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, r] = await Promise.all([
        fetch("/api/mayor/status", { headers: { authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
        fetch("/api/mayor/replies?needs_action=1&limit=5", { headers: { authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : { replies: [] }),
      ]);
      setStatus(s);
      setReplies(r.replies || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const isPaused = !!status?.paused || !!status?.paused_forever;
  const togglePause = async () => {
    setPausing(true);
    try {
      const body = isPaused ? { resume: true } : { duration_hours: 24 };
      await fetch("/api/mayor/pause", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await refresh();
    } finally {
      setPausing(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <AdminNav active="mayor" onLogout={logout} onRefresh={refresh} />

      {/* ── Title ─────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-600" />
            Mayor
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Your AI operator running the site. You just watch the pulse — it handles discovery, outreach, follow-up, and replies.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1.5 hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* ── Error banner ──────────────────────────────────────────── */}
      {error && (
        <Card className="mb-4 border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </CardContent>
        </Card>
      )}

      {/* ── Status pulse — 4 stat boxes ───────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatBox
          label="Engine"
          value={loading ? "…" : (isPaused ? "PAUSED" : "RUNNING")}
          sub={isPaused ? (status?.paused_until ? `until ${fmtAgo(status.paused_until)}` : "until you resume") : "all loops firing"}
          icon={isPaused ? Pause : CheckCircle2}
          color={isPaused
            ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60"
            : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60"}
        />
        <StatBox
          label="Sent today"
          value={status?.sent_today ?? "—"}
          sub={status?.cap ? `${status.cap_remaining ?? 0} of ${status.cap} cap left` : "no cap set"}
          icon={Send}
        />
        <StatBox
          label="Last digest"
          value={status?.last_runs?.digest ? fmtAgo(status.last_runs.digest) : "—"}
          sub={status?.last_runs?.digest
            ? `discover ${fmtAgo(status.last_runs.discovery)} · outreach ${fmtAgo(status.last_runs.outreach)}`
            : "engine idle"}
          icon={Mail}
        />
        <StatBox
          label="Replies waiting"
          value={replies.length}
          sub={replies.length === 0 ? "all handled" : "need your eyes"}
          icon={Reply}
          color={replies.length > 0
            ? "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-900/60"
            : undefined}
        />
      </div>

      {/* ── The ONE big button — Pause / Resume ───────────────────── */}
      <Card className="mb-4">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {isPaused ? <Pause className="w-5 h-5 text-amber-600" /> : <Play className="w-5 h-5 text-emerald-600" />}
                {isPaused ? "Mayor is paused" : "Mayor is running"}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                {isPaused
                  ? "No discovery, outreach, or follow-up will fire. Resume when you're ready."
                  : "Discovery, outreach, and follow-up run on their cron. You don't have to do anything."}
              </p>
            </div>
            <Button
              size="lg"
              onClick={togglePause}
              disabled={pausing}
              className={`min-h-[56px] px-8 text-base font-semibold ${
                isPaused
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-amber-600 hover:bg-amber-700 text-white"
              }`}
            >
              {pausing
                ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                : isPaused
                  ? <Play className="w-5 h-5 mr-2" />
                  : <Pause className="w-5 h-5 mr-2" />}
              {isPaused ? "Resume Mayor" : "Pause Mayor (24h)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Replies needing action ────────────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Reply className="w-4 h-4" />
              Replies needing action
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/leads")}>
              See all <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          {replies.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-500 dark:text-zinc-400">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
              Nothing waiting on you. Mayor will ping if something lands.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {replies.map((r) => (
                <li key={r.id} className="py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.from_email}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] py-0">
                        {r.classification || "?"}
                      </Badge>
                      <span>·</span>
                      <span className="truncate">{r.recommended_action || "—"}</span>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400 shrink-0">{fmtAgo(r.received_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Footer — deep links + last-run timeline ───────────────── */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4" />
            Where to go from here
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button variant="outline" className="justify-start min-h-[56px]" onClick={() => setLocation("/admin/now")}>
              <Calendar className="w-4 h-4 mr-2" />
              <span className="flex-1 text-left">
                <div className="font-semibold text-sm">NOW</div>
                <div className="text-xs text-zinc-500 font-normal">Today's pulse + Jarvis</div>
              </span>
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" className="justify-start min-h-[56px]" onClick={() => setLocation("/admin/leads")}>
              <Reply className="w-4 h-4 mr-2" />
              <span className="flex-1 text-left">
                <div className="font-semibold text-sm">CRM</div>
                <div className="text-xs text-zinc-500 font-normal">Every lead, every reply</div>
              </span>
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" className="justify-start min-h-[56px]" onClick={() => setLocation("/admin/money")}>
              <Mail className="w-4 h-4 mr-2" />
              <span className="flex-1 text-left">
                <div className="font-semibold text-sm">MONEY</div>
                <div className="text-xs text-zinc-500 font-normal">Pipeline, contracts, forecast</div>
              </span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-between flex-wrap gap-2">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Warmup day {status?.warmup_day ?? "?"} · {status?.sent_today ?? 0}/{status?.cap ?? 100} sent today
            </span>
            <a href="/admin/mayor/" className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100">
              <ExternalLink className="w-3 h-3" /> Open in new tab
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}