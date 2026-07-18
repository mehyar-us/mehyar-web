// AdminMayor.tsx — single-page mission control for the Mayor engine.
// Read-only. One button: pause. Everything else is observed, not pushed.

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Activity, Send, Search, Reply, Pause, Play, X, AlertTriangle,
  CheckCircle2, Clock, ShieldAlert, RefreshCw, Mail,
} from "lucide-react";
import {
  AdminNav, useAdminSession, TOKEN_KEY, MOBILE_NAV_HEIGHT, EmptyState,
} from "./AdminShell";

const POLL_MS = 30_000;
// BUGFIX (2026-07-17): was `localStorage` which never held the token because
// useAdminSession() in AdminShell.tsx writes to sessionStorage on login. The
// api() helper here therefore sent `Authorization: Bearer ` (empty), the
// mayor endpoints returned 401, the `if (s.ok)` guards skipped setStatus/
// setEvents/setReplies, and the page rendered the empty fallback state
// (RUNNING · day 0 · Today sent 0/25 · Cap remaining 0 · all "never").
// Reading from sessionStorage aligns this page with AdminShell.
const TOK = () => (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null) || "";

function fmtTime(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
}
function fmtAgo(iso: string) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86400_000)}d ago`;
}
function eventIcon(kind: string) {
  const m: any = {
    discovery: Search,
    outreach: Send,
    followup: Reply,
    digest: Mail,
    pause: ShieldAlert,
    weekly_digest: Mail,
    error: AlertTriangle,
    settings: Activity,
  }; return m[kind as string] || Activity;
}
function eventColor(kind: string) {
  const c: any = {
    discovery: "text-blue-600 dark:text-blue-400",
    outreach: "text-emerald-600 dark:text-emerald-400",
    followup: "text-violet-600 dark:text-violet-400",
    digest: "text-amber-600 dark:text-amber-400",
    pause: "text-red-600 dark:text-red-400",
    weekly_digest: "text-amber-600 dark:text-amber-400",
    error: "text-red-600 dark:text-red-400",
    settings: "text-zinc-500 dark:text-zinc-400",
  }; return c[kind as string] || "text-zinc-600 dark:text-zinc-300";
}

function SummaryCard({ label, value, color, sub }: { label: string; value: number | null; color: string; sub?: string; }) {
  return (
    <div className={`rounded-lg p-3 ${color}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{value === null ? '—' : value}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function SendStatusBadge({ status }: { status?: string }) {
  const map: Record<string, string> = {
    sent:                "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    delivered:           "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    bounced:             "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    failed:              "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    queued_for_review:   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    queued:              "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    scheduled:           "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  };
  const cls = map[status || ""] || "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${cls}`}>{status || "unknown"}</span>;
}

async function api(path: string, opts: any = {}): Promise<any> {
  const t = TOK();
  const r = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${t}`,
      ...(opts.headers || {}),
    },
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

export default function AdminMayor() {
  const { logout } = useAdminSession();
  const [status, setStatus] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [outboundSummary, setOutboundSummary] = useState<any>(null);
  const [sends, setSends] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<any>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [s, e, r, sum, sn] = await Promise.all([
        api("/api/mayor/status"),
        api("/api/mayor/events?limit=50"),
        api("/api/mayor/replies?needs_action=1&limit=20"),
        api(`/api/mayor/outbound-summary?days_back=30`),
        api(`/api/mayor/sends?limit=30&days_back=30`),
      ]);
      if (s.ok) setStatus(s.data);
      if (e.ok) setEvents(e.data.events || []);
      if (r.ok) setReplies(r.data.replies || []);
      if (sum.ok) setOutboundSummary(sum.data);
      if (sn.ok) setSends(sn.data);
      setError(null);
    } catch (e) {
      setError(String((e as any)?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  const pause = useCallback(async (body: any) => {
    setBusy(true);
    const r = await api("/api/mayor/pause", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { setPauseOpen(false); refresh(); }
    else alert(`Pause failed: ${r.data?.error || r.status}`);
  }, [refresh]);

  const resume = useCallback(async () => {
    setBusy(true);
    const r = await api("/api/mayor/pause", { method: "POST", body: JSON.stringify({ resume: true }) });
    setBusy(false);
    if (r.ok) refresh();
    else alert(`Resume failed: ${r.data?.error || r.status}`);
  }, [refresh]);

  const paused = status?.paused;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <AdminNav active="now" onLogout={logout} onRefresh={refresh} />

      <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-4 pb-32 md:pb-12" style={{ paddingBottom: `calc(${MOBILE_NAV_HEIGHT} + 64px)` }}>
        {/* ── Header ── */}
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6" /> Mayor Mode
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              The AI operator running mehyar.us. You observe, you don't push.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="rounded-lg p-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {paused ? (
              <button
                onClick={resume}
                disabled={busy}
                className="rounded-lg px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <Play className="w-4 h-4" /> Resume Mayor
              </button>
            ) : (
              <button
                onClick={() => setPauseOpen(true)}
                disabled={busy}
                className="rounded-lg px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <Pause className="w-4 h-4" /> Pause Mayor
              </button>
            )}
          </div>
        </header>

        {/* ── Status banner ── */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                {paused ? (
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-5 h-5" />
                    <span className="font-semibold">PAUSED</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {status?.paused_forever ? "(forever)" : `until ${fmtTime(status?.paused_until)}`}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-semibold">RUNNING</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">day {status?.warmup_day ?? 0}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Today sent</div>
                  <div className="text-lg font-semibold">{status?.sent_today ?? 0} / {status?.cap ?? 25}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Cap remaining</div>
                  <div className="text-lg font-semibold">{status?.cap_remaining ?? 0}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Last runs timeline ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Discovery", icon: Search, time: status?.last_runs?.discovery, color: "text-blue-700 dark:text-blue-400" },
            { label: "Outreach", icon: Send, time: status?.last_runs?.outreach, color: "text-emerald-700 dark:text-emerald-400" },
            { label: "Follow-up", icon: Reply, time: status?.last_runs?.followup, color: "text-violet-700 dark:text-violet-400" },
            { label: "Digest", icon: Mail, time: status?.last_runs?.digest, color: "text-amber-700 dark:text-amber-400" },
          ].map(({ label, icon: Icon, time, color }) => (
            <Card key={label}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
                </div>
                <div className="text-sm font-medium">{fmtAgo(time)}</div>
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{fmtTime(time)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Live feed ── */}
          <Card className="lg:col-span-2">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" /> Live Feed
              </h2>
              {loading && <div className="text-sm text-zinc-500">Loading…</div>}
              {error && <div className="text-sm text-red-700 dark:text-red-400">⚠ {error}</div>}
              {!loading && events.length === 0 && (
                <EmptyState icon={Activity} title="No events yet" desc="Mayor hasn't run anything. Trigger the loops from the System tab or wait for the cron." />
              )}
              <ul className="space-y-1 max-h-[480px] overflow-y-auto">
                {events.map(e => {
                  const Icon = eventIcon(e.kind);
                  return (
                    <li key={e.id} className="flex items-start gap-2 py-1.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${eventColor(e.kind)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{e.summary}</div>
                        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-2">
                          <Clock className="w-3 h-3" /> {fmtTime(e.created_at)}
                          {e.loop && <span className="uppercase tracking-wide">{e.loop}</span>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {/* ── Reply inbox ── */}
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Reply className="w-4 h-4" /> Replies needing action
              </h2>
              {replies.length === 0 ? (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  No pending replies. Mayor handles auto-replies silently.
                </div>
              ) : (
                <ul className="space-y-2">
                  {replies.map(r => (
                    <li key={r.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                      <div className="text-sm font-medium truncate">{r.from_email}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 truncate">{r.subject}</div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{r.classification || "?"}</span>
                        <span className="px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300">→ {r.recommended_action || "?"}</span>
                      </div>
                      {r.suggested_reply && (
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 italic line-clamp-2">
                          "{r.suggested_reply}"
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Outreach — what was sent / delivered / replied ── */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Send className="w-4 h-4" /> Outreach — last 30 days
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {sends ? `${sends.count} of ${sends.total} total` : 'loading…'}
            </span>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard
              label="Sent"
              value={outboundSummary?.sent_total ?? null}
              color="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
              sub="provider accepted"
            />
            <SummaryCard
              label="Bounced"
              value={outboundSummary?.bounced ?? null}
              color="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
              sub="hard bounces"
            />
            <SummaryCard
              label="Replied"
              value={outboundSummary?.replied_total ?? null}
              color="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
              sub="any inbound"
            />
            <SummaryCard
              label="Interested"
              value={outboundSummary?.replied_interested ?? null}
              color="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              sub="passing-sales bar"
            />
            <SummaryCard
              label="Unsubscribed"
              value={outboundSummary?.replied_unsubscribed ?? null}
              color="bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300"
              sub="left the list"
            />
          </div>

          {/* Send history table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-100 dark:bg-zinc-800 text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                    <tr>
                      <th className="text-left p-2">Sent</th>
                      <th className="text-left p-2">To</th>
                      <th className="text-left p-2">From</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Reply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!sends || sends.items?.length === 0) && (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-zinc-500">
                          No sends in last 30 days.
                        </td>
                      </tr>
                    )}
                    {sends?.items?.map((s: any) => (
                      <tr key={s.send_id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        <td className="p-2 text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                          {fmtTime(s.attempted_at || s.created_at)}
                        </td>
                        <td className="p-2">
                          <div className="font-medium truncate max-w-[200px]" title={s.to_email}>{s.to_email}</div>
                          <div className="text-[11px] text-zinc-400 truncate">provider: {s.provider}{s.provider_id ? ` · id ${s.provider_id.slice(0,18)}…` : ''}</div>
                        </td>
                        <td className="p-2 text-xs">
                          <div className="truncate max-w-[160px]">{s.from_email}</div>
                          {s.reply_to && <div className="text-[11px] text-zinc-400">↳ {s.reply_to}</div>}
                        </td>
                        <td className="p-2 text-xs">
                          <SendStatusBadge status={s.send_status} />
                          {s.finished_at && (
                            <div className="text-[10px] text-zinc-400">finished {fmtTime(s.finished_at)}</div>
                          )}
                          {s.failure_reason && (
                            <div className="text-[10px] text-red-600 dark:text-red-400 truncate max-w-[160px]" title={s.failure_reason}>{s.failure_reason}</div>
                          )}
                        </td>
                        <td className="p-2 text-xs">
                          {s.reply_id ? (
                            <div>
                              <div className="font-medium text-emerald-700 dark:text-emerald-400 truncate max-w-[180px]" title="reply from recipient">
                                reply received
                              </div>
                              <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                                <span className="px-1.5 py-0 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300">{s.reply_label || '?'}</span>
                                <span className="text-zinc-400">{s.reply_confidence ? `${Math.round(s.reply_confidence*100)}% conf` : ''}</span>
                              </div>
                              {s.reply_action && (
                                <div className="text-[11px] text-zinc-500 mt-0.5">action: <span className="font-medium">{s.reply_action}</span></div>
                              )}
                            </div>
                          ) : (
                            <span className="text-zinc-400">— no classification —</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* ── Pause modal ── */}
      {pauseOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPauseOpen(false)}>
          <Card className="max-w-md w-full" onClick={e => e.stopPropagation()}>
            <CardContent className="p-5">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
                Pause Mayor
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4">
                Mayor will stop all outreach, follow-ups, and discovery. The daily digest will still be sent so you know it's paused.
              </p>
              <div className="flex flex-col gap-2">
                <button onClick={() => pause({ duration_hours: 1 })} disabled={busy} className="rounded-lg py-2 px-3 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm disabled:opacity-50">Pause 1 hour</button>
                <button onClick={() => pause({ duration_hours: 24 })} disabled={busy} className="rounded-lg py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white text-sm disabled:opacity-50">Pause 24 hours (rest of today)</button>
                <button onClick={() => pause({ duration_hours: 168 })} disabled={busy} className="rounded-lg py-2 px-3 bg-amber-700 hover:bg-amber-800 text-white text-sm disabled:opacity-50">Pause 1 week</button>
                <button onClick={() => { if (confirm("Kill Mayor forever? You'll need to manually resume.")) pause({ forever: true }); }} disabled={busy} className="rounded-lg py-2 px-3 bg-red-700 hover:bg-red-800 text-white text-sm disabled:opacity-50">KILL FOREVER</button>
                <button onClick={() => setPauseOpen(false)} className="rounded-lg py-2 px-3 text-sm text-zinc-500 dark:text-zinc-400 mt-1">Cancel</button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}