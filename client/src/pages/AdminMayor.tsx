// AdminMayor.tsx — the unified "what's happening, what happened, what will happen" mission control.
//
// Three columns laid out for an iPhone thumb-scroll:
//   HAPPEND    — Mayor's recent work (last 24h): discoveries, sends, replies, cron runs.
//   HAPPENING  — Right now: engine pulse, AI insight, daily suggestions, queued-for-send.
//   WILL HAPPEN — The next cron schedule + what AI will do, click-through to drill in.
//
// One big Pause/Resume button stays prominent. Detail lives behind the existing tabs.
//
// All data fetched in parallel on tab change + 30s poll. Auth: Pages HMAC JWT
// (verified by /api/admin/auth/login) persisted in localStorage 30-day TTL.

import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Pause, Play, Mail, Send, Reply, AlertTriangle, RefreshCw, CheckCircle2,
  Loader2, ArrowRight, Activity, Clock, ExternalLink, Sparkles,
  Calendar, TrendingUp, MessageSquare, Database, Zap, ChevronDown, ChevronUp,
  Hourglass, Flame, Brain, Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AdminNav, useAdminSession,
} from "./AdminShell";

const POLL_MS = 30_000;

const TOK = () => (typeof localStorage !== "undefined" ? localStorage.getItem("mehyarsoft_admin_token") : null) || "";

function fmtAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86400_000)}d ago`;
}

function fmtWhenNext(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  if (ms < 3600_000) return `in ${Math.round(ms / 60_000)}m`;
  if (ms < 86400_000) return `in ${Math.round(ms / 3600_000)}h`;
  return `in ${Math.round(ms / 86400_000)}d`;
}

function StatBox({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className={`rounded-xl p-4 border border-zinc-200 dark:border-zinc-700 ${color || "bg-white dark:bg-zinc-900"}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-semibold">{label}</div>
        {Icon && <Icon className="w-4 h-4 opacity-60" />}
      </div>
      <div className="text-2xl md:text-3xl font-bold mt-2 tabular-nums">{value ?? "—"}</div>
      {sub && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function AdminMayor() {
  return <AdminGate>{(token) => <MayorView token={token} />}</AdminGate>;
}

function AdminGate({ children }: { children: (token: string) => React.ReactElement }) {
  const { token, isLoggedIn, login } = useAdminSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState({ username: "Mehyar500", password: "" });

  if (isLoggedIn && token) return children(token);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const r = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) throw new Error(j.message || `Login failed (${r.status})`);
      login(j.token);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-6 h-6 text-emerald-600" />
            <h1 className="text-xl font-bold">Mayor's login</h1>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Owner-only. Mayor runs the rest.
          </p>
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium">Username</label>
              <input
                value={creds.username}
                onChange={(e) => setCreds({ ...creds, username: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                autoFocus required
              />
            </div>
            <div>
              <label className="text-xs font-medium">Password</label>
              <input
                type="password"
                value={creds.password}
                onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                required
              />
            </div>
            {error && (
              <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded p-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
              </div>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Activity className="w-4 h-4 mr-2" />}
              Open Mayor
            </Button>
          </form>
          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-500 text-center">
            <a href="/" className="hover:underline">← back to mehyar.us</a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MayorView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<any>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [sends, setSends] = useState<any>(null);
  const [opps, setOpps] = useState<any>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [insight, setInsight] = useState<{ text: string; actions: any[]; used_llm?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const fetchAuth = (path: string) =>
    fetch(path, { headers: { authorization: "Bearer " + token } }).then(r => r.ok ? r.json() : null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, r, sd, op, sg, ai] = await Promise.all([
        fetchAuth("/api/mayor/status"),
        fetchAuth("/api/mayor/replies?needs_action=1&limit=10"),
        fetchAuth("/api/admin/outreach"),
        fetchAuth("/api/admin/government/opportunities"),
        fetchAuth("/api/admin/leads/daily-suggestions"),
        fetchAuth("/api/admin/now/insight"),
      ]);
      setStatus(s?.status || s || null);
      setReplies(r?.replies || []);
      setSends(sd || null);
      setOpps(op || null);
      setSuggestions(sg?.items || []);
      if (ai && ai.ok) setInsight({ text: ai.text, actions: ai.actions || [], used_llm: ai.used_llm });
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
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await refresh();
    } finally {
      setPausing(false);
    }
  };

  const refreshInsight = async () => {
    setAiBusy(true);
    try {
      const j = await fetchAuth("/api/admin/now/insight");
      if (j?.ok) setInsight({ text: j.text, actions: j.actions || [], used_llm: j.used_llm });
    } finally { setAiBusy(false); }
  };

  // ── Derived state ─────────────────────────────────────────────────────
  const sentToday = status?.sent_today ?? status?.daily_sent_count ?? 0;
  const cap = status?.cap ?? status?.daily_cap ?? 100;
  const warmup = status?.warmup_day ?? "?";
  const outreachTotal = (sends?.items || []).length;
  const liveOpps = opps?.opportunities || opps?.items || [];
  const liveOppCount = opps?.total ?? liveOpps.length;
  const funnel = status?.funnel || {};
  const lastRuns = status?.last_runs || {};
  const queuedForSend = status?.queue?.queued_for_send ?? 0;
  const openDrafts = status?.queue?.open_drafts ?? 0;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <AdminNav active="now" onLogout={logout} onRefresh={refresh} />

      {/* ── Title strip ─────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-600" />
            Mayor — see it all
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            What's happened · what's happening now · what will happen next.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* ── Error banner ────────────────────────────────────────────── */}
      {error && (
        <Card className="mb-4 border-red-200 bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </CardContent>
        </Card>
      )}

      {/* ── THE BIG BUTTON — Pause / Resume ────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="p-5 md:p-7">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {isPaused ? <Pause className="w-5 h-5 text-amber-600" /> : <Play className="w-5 h-5 text-emerald-600" />}
                {isPaused ? "Mayor is paused" : "Mayor is running"}
                {warmup !== "?" && <Badge variant="outline" className="text-[10px]">day {warmup}</Badge>}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                {isPaused
                  ? "Nothing will fire. Resume when you're ready."
                  : `Discovery, outreach, follow-up, digest run on Cloudflare cron. ${sentToday}/${cap} sent today.`}
              </p>
            </div>
            <Button
              size="lg"
              onClick={togglePause}
              disabled={pausing}
              className={`min-h-[56px] px-8 text-base font-semibold ${isPaused ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700"} text-white`}
            >
              {pausing
                ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                : isPaused ? <Play className="w-5 h-5 mr-2" /> : <Pause className="w-5 h-5 mr-2" />}
              {isPaused ? "Resume Mayor" : "Pause Mayor (24h)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── STAT STRIP — Pulse in one row ──────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
        <StatBox label="Engine" value={isPaused ? "PAUSED" : "RUNNING"} icon={isPaused ? Pause : CheckCircle2}
          color={isPaused ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200" : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200"} />
        <StatBox label="Sent today" value={`${sentToday}/${cap}`} icon={Send}
          color={sentToday > 0 ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200" : undefined} />
        <StatBox label="Pipeline $" value={`$${(funnel.pipeline_value || 0).toLocaleString()}`} icon={TrendingUp}
          color="bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200" />
        <StatBox label="SAM opps" value={liveOppCount} sub={`${funnel.sam_due_48h || 0} due 48h`} icon={Database} />
        <StatBox label="Open drafts" value={openDrafts} sub={`${queuedForSend} queued`} icon={Brain} />
        <StatBox label="Replies" value={replies.length} sub={replies.length === 0 ? "all handled" : "need eyes"} icon={Reply}
          color={replies.length > 0 ? "bg-violet-50 dark:bg-violet-950/30 border-violet-200" : undefined} />
      </div>

      {/* ── THREE COLUMNS: HAPPENED · HAPPENING · WILL HAPPEN ──────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

        {/* ─ HAPPENED (recent) ─ */}
        <Card className="border-zinc-200 dark:border-zinc-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                <Clock className="w-4 h-4 text-zinc-500" /> Happened
              </h2>
              <span className="text-[10px] text-zinc-500">last 24h</span>
            </div>
            <ul className="space-y-2 text-xs">
              <HappenedRow label="Last discovery" when={fmtAgo(lastRuns.discovery)} icon={Search} />
              <HappenedRow label="Last outreach" when={fmtAgo(lastRuns.outreach)} icon={Send} />
              <HappenedRow label="Last follow-up" when={fmtAgo(lastRuns.followup)} icon={MessageSquare} />
              <HappenedRow label="Last digest email" when={fmtAgo(lastRuns.digest)} icon={Mail} />
              <HappenedRow label="Replies logged" when={`${status?.queue?.replies_30d?.interest || 0} interested · ${status?.queue?.replies_30d?.unsubscribe || 0} unsub`} icon={Reply} />
              <HappenedRow label="Outreach rows shown" when={`${outreachTotal} of 252 sent total`} icon={TrendingUp} />
              <HappenedRow label="Bounce rate 30d" when={`${((status?.bounce_rate_30d || 0) * 100).toFixed(1)}%`} icon={AlertTriangle} />
            </ul>
            {(replies.length > 0 || outreachTotal > 0) && (
              <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex gap-2">
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => setLocation("/admin/leads")}>
                  See replies <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─ HAPPENING (right now) ─ */}
        <Card className="border-violet-200 dark:border-violet-800 bg-gradient-to-br from-violet-50/30 via-white to-cyan-50/30 dark:from-violet-950/20 dark:via-zinc-900 dark:to-cyan-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                <Zap className="w-4 h-4 text-violet-500" /> Happening now
              </h2>
              <Button size="sm" variant="ghost" onClick={refreshInsight} disabled={aiBusy}>
                {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              </Button>
            </div>

            {/* AI insight */}
            <div className="bg-white/80 dark:bg-zinc-900/80 rounded-lg border border-violet-100 dark:border-violet-900 p-3 mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Brain className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  AI says
                </span>
                {insight?.used_llm === false && (
                  <Badge variant="outline" className="text-[9px] ml-auto">heuristic</Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 whitespace-pre-line">
                {insight?.text || "Asking Mayor what to focus on..."}
              </p>
              {(insight?.actions?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-violet-100 dark:border-violet-900">
                  {insight!.actions.slice(0, 3).map((a, i) => (
                    <a key={i} href={a.href} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-600 text-white text-[10px] font-medium hover:bg-violet-700 transition">
                      {a.label.length > 40 ? a.label.slice(0, 40) + "…" : a.label} →
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Daily AI suggestions */}
            {suggestions.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Daily picks
                </div>
                <ul className="space-y-1.5">
                  {suggestions.slice(0, 3).map((s, i) => (
                    <li key={i} className="bg-white dark:bg-zinc-900 rounded border border-zinc-100 dark:border-zinc-800 p-2">
                      <div className="text-[11px] font-semibold truncate">{s.title}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {s.kind && <Badge variant="outline" className="text-[9px]">{s.kind}</Badge>}
                        {s.priority_score && <span className="text-[9px] text-zinc-500 tabular-nums">★ {s.priority_score}</span>}
                        {s.deadline_in_days != null && (
                          <span className={`text-[9px] font-mono ml-auto ${s.deadline_in_days <= 2 ? "text-red-700" : "text-zinc-500"}`}>
                            {s.deadline_in_days <= 0 ? "OVERDUE" : `D-${s.deadline_in_days}`}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─ WILL HAPPEN (next cron + queue) ─ */}
        <Card className="border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50/30 via-white to-orange-50/30 dark:from-amber-950/20 dark:via-zinc-900 dark:to-orange-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                <Calendar className="w-4 h-4 text-amber-500" /> Will happen
              </h2>
              <span className="text-[10px] text-zinc-500">cron schedule</span>
            </div>
            <ul className="space-y-2 text-xs">
              <CronRow icon={Search} label="Discover" cron="8 AM ET daily" when={lastRuns.discovery ? fmtWhenNext(new Date(new Date(lastRuns.discovery).getTime() + 86400_000).toISOString()) : ""} />
              <CronRow icon={Send} label="Outreach" cron="10 AM ET daily" when={lastRuns.outreach ? fmtWhenNext(new Date(new Date(lastRuns.outreach).getTime() + 86400_000).toISOString()) : ""} />
              <CronRow icon={MessageSquare} label="Follow-up" cron="2 PM ET daily" when={lastRuns.followup ? fmtWhenNext(new Date(new Date(lastRuns.followup).getTime() + 86400_000).toISOString()) : ""} />
              <CronRow icon={Mail} label="Digest email" cron="6 PM ET daily" when={lastRuns.digest ? fmtWhenNext(new Date(new Date(lastRuns.digest).getTime() + 86400_000).toISOString()) : ""} />
            </ul>
            <div className="mt-3 pt-3 border-t border-amber-100 dark:border-amber-900 space-y-1.5">
              <NextAction label={`${queuedForSend} queued for next send`} icon={Hourglass} />
              <NextAction label={`${openDrafts} drafts waiting for your review`} icon={Brain} />
              <NextAction label={`${liveOppCount} SAM opp${liveOppCount === 1 ? "" : "s"} in pipeline`} icon={Database} />
              <NextAction label={`${replies.length} repl${replies.length === 1 ? "y" : "ies"} needing you`} icon={Reply} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Recent events (last 10) — full timeline ────────────────── */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
              <Activity className="w-4 h-4 text-emerald-500" /> Recent events
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setShowAllEvents(!showAllEvents)}>
              {showAllEvents ? "Collapse" : "Show all"} {showAllEvents ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
          </div>
          <RecentEvents status={status} showAll={showAllEvents} />
        </CardContent>
      </Card>

      {/* ── MONEY + Deep-link row ───────────────────────────────────── */}
      <Card className="mb-4 border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50/40 via-white to-cyan-50/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-bold flex items-center gap-1.5 text-emerald-900 dark:text-emerald-200">
                <DollarSign className="w-4 h-4" /> Money pulse
              </h2>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">
                Pipeline <span className="font-bold tabular-nums">${(funnel.pipeline_value || 0).toLocaleString()}</span>{" "}
                · Interested 7d <span className="font-bold tabular-nums">{funnel.interested_7d || 0}</span>{" "}
                · Won 30d <span className="font-bold tabular-nums">{funnel.won_30d || 0}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setLocation("/admin/money")}>
                <DollarSign className="w-3.5 h-3.5 mr-1" /> Money
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/admin/leads")}>
                <Briefcase className="w-3.5 h-3.5 mr-1" /> Leads
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/admin/system")}>
                <Settings className="w-3.5 h-3.5 mr-1" /> System
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-center text-[10px] text-zinc-500 mt-4">
        Warmup day {warmup} · {sentToday}/{cap} sent today ·{" "}
        <a href="/admin/mayor/" className="hover:underline inline-flex items-center gap-0.5">
          open in new tab <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
    </div>
  );
}

function DollarSign({ className }: { className?: string }) {
  return <span className={className}>$</span>;
}
function Briefcase({ className }: { className?: string }) {
  return <span className={className}>💼</span>;
}
function Settings({ className }: { className?: string }) {
  return <span className={className}>⚙</span>;
}

function HappenedRow({ label, when, icon: Icon }: any) {
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <span className="text-zinc-500 tabular-nums shrink-0">{when}</span>
    </li>
  );
}

function CronRow({ icon: Icon, label, cron, when }: any) {
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold">{label}</div>
          <div className="text-[10px] text-zinc-500">{cron}</div>
        </div>
      </div>
      <span className="text-zinc-500 tabular-nums text-[10px] shrink-0">{when || "—"}</span>
    </li>
  );
}

function NextAction({ label, icon: Icon }: any) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-zinc-700 dark:text-zinc-200">
      <Icon className="w-3 h-3 text-zinc-400" /> {label}
    </div>
  );
}

function RecentEvents({ status, showAll }: { status: any; showAll: boolean }) {
  const events: any[] = status?.events || [];
  if (events.length === 0) {
    return <div className="text-xs text-zinc-500 italic py-4 text-center">No events logged yet — Mayor will be busy after next cron tick.</div>;
  }
  const visible = showAll ? events : events.slice(0, 8);
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {visible.map((e) => (
        <li key={e.id} className="py-2 flex items-center gap-2 text-xs">
          <Badge variant="outline" className="text-[9px] shrink-0">{e.kind}</Badge>
          <span className="flex-1 truncate">{e.summary}</span>
          <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">{fmtAgo(e.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
