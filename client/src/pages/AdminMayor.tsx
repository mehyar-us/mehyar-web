// AdminMayor.tsx — single-page mission control for the Mayor engine.
//
// Six tabs:
//   1. Live     — engine status, last runs, event feed, reply inbox, pause controls
//   2. Discovered — full prospect list with leak signals, scan status, draft readiness
//   3. Outreach  — every email sent (subject, body, recipient, status), with filters
//   4. Replies   — inbound replies, classification, suggested reply, manual action
//   5. Pipeline  — money: services catalog, pricing tiers, prospects matched to services,
//                  contracts/drafts per prospect, revenue forecast
//   6. Prospects — drill-down on a single prospect: every scan, every draft, every
//                  send, every reply, plus next-action hint
//
// All data fetched in parallel on tab change + 30s poll. Bearer token from sessionStorage
// (admin session).

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Activity, Send, Search, Reply, Pause, Play, AlertTriangle, X,
  CheckCircle2, Clock, ShieldAlert, RefreshCw, Mail, DollarSign,
  FileText, Briefcase, ExternalLink, Filter, ChevronDown, ChevronRight,
  Eye, Inbox, TrendingUp, Package, Globe, Phone, MapPin,
  Hash, Tag, Layers, BarChart3, Users, Target, FileSignature, Plus,
} from "lucide-react";
import {
  AdminNav, useAdminSession, TOKEN_KEY, MOBILE_NAV_HEIGHT, EmptyState,
} from "./AdminShell";

const POLL_MS = 30_000;

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
    discovery: Search, outreach: Send, followup: Reply, digest: Mail,
    pause: ShieldAlert, weekly_digest: Mail, error: AlertTriangle, settings: Activity,
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

function SummaryCard({ label, value, color, sub }: { label: string; value: number | null | string; color: string; sub?: string; }) {
  return (
    <div className={`rounded-lg p-3 ${color}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{value === null || value === undefined ? '—' : value}</div>
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
    scheduled:           "bg-blue-100 text-blue-800 dark:bg-blue-300",
    replied:             "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
    interest:            "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    objection:           "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    unsubscribe:         "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200",
    stop:                "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200",
    not_interested:      "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    out_of_office:       "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    invalid:             "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200",
    warm:                "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    unclassified:        "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
    unread:              "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    draft:               "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    approved:            "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    rejected:            "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    superseded:          "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    skipped_suppressed:  "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200",
  };
  const cls = map[status || ""] || "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${cls}`}>{status || "unknown"}</span>;
}

function LeakBadge({ signal }: { signal: string }) {
  // Color leak signals by severity
  const critical = ["no_https", "no_ssl", "broken_booking", "no_phone", "page_5xx"];
  const warning = ["no_viewport", "slow_load", "no_booking_cta", "no_form_action", "large_page"];
  let cls = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  if (critical.some(c => signal.includes(c))) cls = "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  else if (warning.some(w => signal.includes(w))) cls = "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{signal}</span>;
}

function VerticalBadge({ vertical }: { vertical?: string }) {
  if (!vertical) return <span className="text-[11px] text-zinc-400">—</span>;
  return <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">{vertical}</span>;
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

// ── Service catalog (mirrors client/src/data/services.ts for AdminMayor only) ──
// Pulled from the public /services page so the Pipeline tab can show the
// pricing tiers as live cards next to the matched prospects.
const SERVICE_CATALOG = [
  { id: "tech-audit",                title: "Local Business Tech Audit",        category: "Audit",       low: 150,   high: 500,    hint: "Surface leaks before buying more software." },
  { id: "website-booking-cleanup",   title: "Website Cleanup + Booking Setup",  category: "Conversion", low: 750,   high: 2500,   hint: "Homepage, landing, booking wiring, mobile cleanup." },
  { id: "missed-call-followup",      title: "AI Missed-Call / SMS / Email Flow",category: "Automation", low: 1500,  high: 5000,   hint: "Reply to every missed call + form in under 60 seconds." },
  { id: "automation-sprint",         title: "Internal Automation Sprint",       category: "Operations",  low: 3000,  high: 12000,  hint: "Replace spreadsheets + manual handoffs with a real workflow." },
  { id: "systems-integration",       title: "Architecture & Integration",       category: "Consulting",  low: 5000,  high: 25000,  hint: "Senior engineering support, hourly or per-project." },
  { id: "crm-support-retainer",      title: "Monthly Support Retainer",         category: "Support",     low: 500,   high: 3500,   hint: "Ongoing monitoring + small monthly improvements." },
  { id: "software-builds",           title: "Custom Software Builds",           category: "Development", low: 5000,  high: 50000,  hint: "Internal portals, dashboards, integration layers." },
];

// Map a prospect's vertical + leak signals to the highest-fit services.
// Returns the top 3 services ranked by fit.
function matchServicesToProspect(p: any): { id: string; title: string; low: number; high: number; fit: number; reason: string }[] {
  const signals: string[] = [];
  try { signals.push(...JSON.parse(p.leak_signals_json || "[]")); } catch {}
  const vertical = (p.vertical || "").toLowerCase();
  const hasBooking = p.has_booking_cta === 1;
  const hasPhone = p.has_phone_click_to_call === 1;
  const hasSsl = p.has_ssl === 1;
  const slowLoad = (p.load_time_ms || 0) > 2500;

  type Scored = { id: string; title: string; low: number; high: number; fit: number; reason: string };
  const candidates: Scored[] = [];

  // Tech audit: baseline. Always fits if no other strong signal.
  candidates.push({ ...SERVICE_CATALOG[0], fit: 30, reason: "Baseline review — always a fit for first-touch prospects." });

  // Website + booking: missing booking or phone or SSL
  if (!hasBooking || !hasPhone || !hasSsl) {
    candidates.push({ ...SERVICE_CATALOG[1], fit: 75,
      reason: [!hasBooking && "no booking CTA", !hasPhone && "no phone CTA", !hasSsl && "no HTTPS"].filter(Boolean).join(", ") });
  }
  // Missed-call flow: any business with a phone that's not optimized
  if (hasPhone === 0 && (vertical === "dental" || vertical === "restaurant" || vertical === "hvac" || vertical === "salon" || vertical === "clinic" || vertical === "auto" || vertical === "real_estate" || vertical === "legal" || vertical === "therapy")) {
    candidates.push({ ...SERVICE_CATALOG[2], fit: 85, reason: `${vertical} business missing phone CTA — likely losing calls.` });
  } else if (vertical) {
    candidates.push({ ...SERVICE_CATALOG[2], fit: 60, reason: "Missed-call/SMS flow standard for any appointment business." });
  }
  // Automation sprint: slow load, multiple leak signals, no automation
  if (slowLoad || signals.length >= 3) {
    candidates.push({ ...SERVICE_CATALOG[3], fit: 70, reason: signals.length >= 3 ? `${signals.length} leak signals` : "Slow page load suggests automation debt" });
  }
  // Systems integration: SaaS / regulated
  if (vertical === "saas" || vertical === "pharma" || vertical === "healthcare" || vertical === "agency") {
    candidates.push({ ...SERVICE_CATALOG[4], fit: 80, reason: `Regulated vertical (${vertical}) — architecture support fits.` });
  }
  // CRM retainer: if any engagement is likely
  if (p.leak_score >= 40 || signals.length >= 2) {
    candidates.push({ ...SERVICE_CATALOG[5], fit: 55, reason: "Likely needs ongoing monitoring after first engagement." });
  }
  // Custom builds: enterprise signals
  if (vertical === "saas" || vertical === "agency" || signals.length >= 4) {
    candidates.push({ ...SERVICE_CATALOG[6], fit: 65, reason: signals.length >= 4 ? "Workflow complexity suggests custom build" : "Vertical commonly needs custom tooling" });
  }

  // Sort by fit desc, drop the always-fit baseline if we have better options
  candidates.sort((a, b) => b.fit - a.fit);
  const top = candidates.slice(0, 3);
  return top;
}

// ── TAB: Live ───────────────────────────────────────────────────────────────
function LiveTab({ status, events, replies, outboundSummary, sends, health, loading, error, onRunDiscovery, busy }: any) {
  const lastRuns = status?.last_runs || {};
  const paused = status?.paused;
  return (
    <>
      {/* Status banner */}
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

      {/* Health badge */}
      {health && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Engine health
            </h2>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-3 h-3 rounded-full ${
                  health.color === 'emerald' ? 'bg-emerald-500' :
                  health.color === 'amber' ? 'bg-amber-500' :
                  health.color === 'red' ? 'bg-red-500' : 'bg-zinc-400'
                }`} />
                <span className="font-semibold">{health.verdict?.[0] || 'UNKNOWN'}</span>
                {health.verdict?.length > 1 && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">+{health.verdict.length - 1} more</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onRunDiscovery} disabled={busy}
                  className="rounded-lg px-3 py-1.5 bg-brand-700 hover:bg-brand-800 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50">
                  <Search className="w-3 h-3" /> Run discovery now
                </button>
              </div>
            </div>
            {health.env_health?.degraded && (
              <div className="mt-2 text-[11px] text-red-700 dark:text-red-400">
                Missing required env vars: {Object.entries(health.env_health.keys || {}).filter(([k, v]) => !v).map(([k]) => k).join(", ")}
              </div>
            )}
            {health.bounce_rate_30d > 0 && (
              <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                Bounce rate (30d): <strong>{(health.bounce_rate_30d * 100).toFixed(1)}%</strong>
                {health.send_stats_30d && ` · ${health.send_stats_30d.delivered} delivered, ${health.send_stats_30d.bounced} bounced, ${health.send_stats_30d.failed} failed`}
              </div>
            )}
            {health.funnel && (
              <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                Funnel: <strong>{health.funnel.prospects}</strong> prospects → <strong>{health.funnel.worked}</strong> worked → <strong>{health.funnel.delivered}</strong> delivered → <strong>{health.funnel.interested}</strong> interested ({health.funnel.interested_7d} in last 7d)
                {health.funnel.contact_to_interest > 0 && ` · ${(health.funnel.contact_to_interest * 100).toFixed(1)}% reply-to-interest`}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last runs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Discovery", icon: Search, time: lastRuns.discovery, color: "text-blue-700 dark:text-blue-400" },
          { label: "Outreach",  icon: Send,   time: lastRuns.outreach,  color: "text-emerald-700 dark:text-emerald-400" },
          { label: "Follow-up", icon: Reply,  time: lastRuns.followup,  color: "text-violet-700 dark:text-violet-400" },
          { label: "Digest",    icon: Mail,   time: lastRuns.digest,    color: "text-amber-700 dark:text-amber-400" },
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

      {/* Live feed + reply inbox */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
              {events.map((e: any) => {
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

        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Inbox className="w-4 h-4" /> Replies needing action
            </h2>
            {replies.length === 0 ? (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                No pending replies. Mayor handles auto-replies silently.
              </div>
            ) : (
              <ul className="space-y-2">
                {replies.map((r: any) => (
                  <li key={r.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                    <div className="text-sm font-medium truncate">{r.from_email}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 truncate">{r.subject}</div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <SendStatusBadge status={r.classification} />
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

      {/* 30-day summary cards */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Send className="w-4 h-4" /> Outreach — last 30 days
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Sent"    value={outboundSummary?.steps_sent   ?? null} color="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" sub="step_no=1..3" />
          <SummaryCard label="Queued"  value={outboundSummary?.steps_queued ?? null} color="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" sub="awaiting send" />
          <SummaryCard label="Skipped" value={outboundSummary?.steps_skipped ?? null} color="bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300" sub="cap/cool-down" />
          <SummaryCard label="Failed"  value={outboundSummary?.steps_failed ?? null} color="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" sub="send error" />
          <SummaryCard label="Total"   value={outboundSummary?.steps_total ?? null} color="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" sub={`last ${outboundSummary?.days_back ?? 30}d`} />
        </div>
      </div>
    </>
  );
}

// ── TAB: Discovered (real prospect pipeline) ─────────────────────────────────
function DiscoveredTab({ data, loading, onSelect }: { data: any; loading: boolean; onSelect: (id: string) => void }) {
  const totals = data?.totals || {};
  const prospects = data?.prospects || [];
  const verticals = data?.verticals || [];
  return (
    <>
      {/* Big-number summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total prospects" value={totals.prospects_total ?? null} color="bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" sub={`${totals.vertical_count ?? 0} verticals`} />
        <SummaryCard label="New"             value={totals.prospects_new ?? null}     color="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" sub="awaiting scan" />
        <SummaryCard label="Scanned"         value={totals.prospects_scanned ?? null} color="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300" sub="leak signals captured" />
        <SummaryCard label="Drafted"         value={totals.prospects_drafted ?? null} color="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" sub="email drafted" />
        <SummaryCard label="Sent / Replied"  value={`${totals.prospects_sent ?? 0} / ${totals.prospects_replied ?? 0}`} color="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" sub="in pipeline" />
      </div>

      {/* Verticals breakdown */}
      {verticals.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> By vertical
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {verticals.slice(0, 8).map((v: any) => (
                <div key={v.vertical} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="flex items-center justify-between">
                    <VerticalBadge vertical={v.vertical} />
                    <span className="text-xs text-zinc-500">{v.count} total</span>
                  </div>
                  <div className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Contacted: <strong>{v.contacted || 0}</strong> · Replied: <strong>{v.replies || 0}</strong>
                  </div>
                  {v.avg_leak_score !== null && v.avg_leak_score !== undefined && (
                    <div className="text-[11px] text-zinc-500 mt-0.5">Avg leak score: {Math.round(v.avg_leak_score)}/100</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prospect table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" /> Prospects ({prospects.length})
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Click any row to drill into scans, drafts, sends, and replies.
            </p>
          </div>
          {loading && <div className="p-4 text-sm text-zinc-500">Loading…</div>}
          {!loading && prospects.length === 0 && (
            <div className="p-6 text-center text-sm text-zinc-500">
              No prospects yet. Run discovery to populate.
            </div>
          )}
          {prospects.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                  <tr>
                    <th className="text-left p-2">Business</th>
                    <th className="text-left p-2">Vertical</th>
                    <th className="text-left p-2">Contact</th>
                    <th className="text-left p-2">Leak</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Pipeline</th>
                    <th className="text-left p-2">Last scan</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((p: any) => (
                    <tr key={p.id}
                        onClick={() => onSelect(p.id)}
                        className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                      <td className="p-2">
                        <div className="font-medium">{p.business_name}</div>
                        {p.website && (
                          <a className="text-[11px] text-brand-700 underline dark:text-brand-100" href={p.website} target="_blank" rel="noreferrer"
                             onClick={(e) => e.stopPropagation()}>
                            {p.root_domain || p.website} <ExternalLink className="inline h-2.5 w-2.5" />
                          </a>
                        )}
                      </td>
                      <td className="p-2"><VerticalBadge vertical={p.vertical} /></td>
                      <td className="p-2 text-xs">
                        {p.email && <div className="truncate max-w-[180px]">{p.email}</div>}
                        {p.phone && <div className="text-zinc-400">{p.phone}</div>}
                        {!p.email && !p.phone && <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="p-2 text-xs">
                        <div className="font-semibold">
                          {p.leak_score != null ? `${p.leak_score}/100` : '—'}
                        </div>
                        {p.detected_platform && <div className="text-[10px] text-zinc-400">{p.detected_platform}</div>}
                      </td>
                      <td className="p-2 text-xs"><SendStatusBadge status={p.status} /></td>
                      <td className="p-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                        <div>📧 {p.draft_open_count || 0} drafts · ✓ {p.draft_approved_count || 0}</div>
                        <div>📤 {p.send_sent_count || 0} sent · ↩ {p.send_replied_count || 0} replied</div>
                      </td>
                      <td className="p-2 text-[11px] text-zinc-500 whitespace-nowrap">{fmtAgo(p.last_scanned_at || p.last_contact_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ── TAB: Outreach (full email history) ──────────────────────────────────────
function OutreachTab({ sends, loading }: { sends: any; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Send className="w-4 h-4" /> Outreach — last 30 days
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {sends ? `${sends.count} of ${sends.total} total sends` : 'loading…'}
            · Click any row to see the full email body and the sequence step it belongs to.
          </p>
        </div>
        {loading && <div className="p-4 text-sm text-zinc-500">Loading…</div>}
        {(!sends || sends.items?.length === 0) && !loading && (
          <div className="p-6 text-center text-sm text-zinc-500">No sends in last 30 days.</div>
        )}
        {sends?.items?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                <tr>
                  <th className="text-left p-2 w-4"></th>
                  <th className="text-left p-2">When</th>
                  <th className="text-left p-2">Recipient</th>
                  <th className="text-left p-2">Step</th>
                  <th className="text-left p-2">Subject</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {sends.items.map((s: any) => {
                  const isOpen = expanded === s.step_id;
                  return (
                    <RowExpand key={s.step_id} isOpen={isOpen} onClick={() => setExpanded(isOpen ? null : s.step_id)} row={s}>
                      <td className="p-2 text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                        {fmtTime(s.sent_at || s.created_at)}
                      </td>
                      <td className="p-2">
                        <div className="font-medium truncate max-w-[220px]" title={s.to_email}>
                          {s.business_name || s.to_email || '(no recipient)'}
                        </div>
                        {s.business_name && s.to_email && (
                          <div className="text-[11px] text-zinc-400 truncate" title={s.to_email}>{s.to_email}</div>
                        )}
                        {s.from_website && (
                          <div className="text-[11px] text-zinc-400 truncate">{s.from_website}</div>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        <div className="font-semibold">step {s.step_no}</div>
                      </td>
                      <td className="p-2 text-xs">
                        <div className="truncate max-w-[320px]" title={s.subject}>{s.subject}</div>
                      </td>
                      <td className="p-2 text-xs">
                        <SendStatusBadge status={s.step_status} />
                        {s.sent_at && <div className="text-[10px] text-zinc-400 mt-0.5">sent {fmtTime(s.sent_at)}</div>}
                        {s.event_at && s.event_at !== s.sent_at && (
                          <div className="text-[10px] text-zinc-400">event {fmtTime(s.event_at)}</div>
                        )}
                      </td>
                    </RowExpand>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RowExpand({ children, isOpen, onClick, row }: any) {
  return (
    <>
      <tr onClick={onClick} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
        <td className="p-2 align-top">
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </td>
        {children}
      </tr>
      {isOpen && (
        <tr className="bg-zinc-50 dark:bg-zinc-900/40">
          <td colSpan={6} className="p-3">
            <ExpandedSendBody row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedSendBody({ row }: { row: any }) {
  // Prefer the newer draft body (cited_signals + structured copy) when joined;
  // fall back to the legacy sequence body_text.
  const bodyText = row?.draft_body_text || row?.body_text || '';
  const subject = row?.draft_subject || row?.subject || '(no subject)';
  let citedSignals: string[] = [];
  try {
    const raw = row?.draft_cited_signals;
    if (typeof raw === 'string') {
      citedSignals = JSON.parse(raw);
    } else if (Array.isArray(raw)) {
      citedSignals = raw;
    }
  } catch {}

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  return (
    <div className="space-y-3">
      {/* Subject + recipient + copy button */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Subject</div>
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{subject}</div>
          {row?.to_email && (
            <div className="text-[11px] text-zinc-500 mt-0.5">
              To: <span className="font-mono">{row.to_email}</span>
              {row.from_website && <> · From: <span className="font-mono">{row.from_website}</span></>}
            </div>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); copyToClipboard(`${subject}\n\n${bodyText}`); }}
          className="rounded-md px-2 py-1 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 text-[10px] font-medium flex items-center gap-1 shrink-0">
          <FileText className="w-3 h-3" /> Copy full email
        </button>
      </div>

      {/* Cited leak signals (newer draft body has these) */}
      {citedSignals.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">
            Cited leak signals
          </div>
          <div className="flex flex-wrap gap-1">
            {citedSignals.map((s: string, i: number) => (
              <span key={i} className="rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-[10px] font-mono">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Email body */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">
          Body ({bodyText.length.toLocaleString()} chars)
        </div>
        {bodyText ? (
          <pre className="text-xs whitespace-pre-wrap font-sans text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 p-3 rounded-lg max-h-[500px] overflow-y-auto">
{bodyText}
          </pre>
        ) : (
          <div className="text-xs italic text-zinc-500">
            No body stored for this sequence step. The legacy engine may not have written body_text — check mayor_events for the actual sent payload.
          </div>
        )}
      </div>
    </div>
  );
}

// ── TAB: Replies (inbound) ──────────────────────────────────────────────────
function RepliesTab({ replies, loading }: { replies: any[]; loading: boolean }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Reply className="w-4 h-4" /> Inbound replies — needs action
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Mayor routes replies into the prospect_replies table with a
            classification (interest / objection / unsubscribe / etc.) and a
            suggested reply. Anything with classification = interest is the
            highest-value row to action.
          </p>
        </div>
        {loading && <div className="p-4 text-sm text-zinc-500">Loading…</div>}
        {!loading && replies.length === 0 && (
          <div className="p-6 text-center text-sm text-zinc-500">No replies yet.</div>
        )}
        {replies.length > 0 && (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {replies.map((r: any) => (
              <li key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.from_email}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{r.subject}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] shrink-0">
                    <SendStatusBadge status={r.classification} />
                    <span className="text-zinc-400">{fmtAgo(r.received_at)}</span>
                  </div>
                </div>
                {r.body_text && (
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 line-clamp-3">
                    {r.body_text}
                  </div>
                )}
                {r.suggested_reply && (
                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400 italic border-l-2 border-zinc-200 dark:border-zinc-700 pl-2">
                    Suggested: "{r.suggested_reply}"
                  </div>
                )}
                {r.recommended_action && (
                  <div className="mt-1 text-[11px]">
                    Action: <strong>{r.recommended_action}</strong>
                    {r.sentiment_score !== undefined && r.sentiment_score !== null && (
                      <span className="ml-2 text-zinc-400">sentiment {r.sentiment_score?.toFixed?.(2) ?? r.sentiment_score}</span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── TAB: Pipeline (services ↔ prospects ↔ money) ────────────────────────────
function PipelineTab({ discovered, loading }: { discovered: any; loading: boolean }) {
  const totals = discovered?.totals || {};
  const prospects = discovered?.prospects || [];
  const verticals = discovered?.verticals || [];

  // For each service, count prospects that match + forecast value at low/high
  const serviceStats = useMemo(() => {
    const out: Record<string, { id: string; title: string; category: string; low: number; high: number; count: number; matched: any[] }> = {};
    for (const svc of SERVICE_CATALOG) {
      out[svc.id] = { ...svc, count: 0, matched: [] };
    }
    for (const p of prospects) {
      const matches = matchServicesToProspect(p);
      for (const m of matches) {
        if (out[m.id]) {
          out[m.id].count += 1;
          out[m.id].matched.push({ prospect: p, fit: m.fit, reason: m.reason });
        }
      }
    }
    return out;
  }, [prospects]);

  // Top-of-funnel forecast
  const forecast = useMemo(() => {
    const sent = totals.prospects_sent ?? 0;
    const replied = totals.prospects_replied ?? 0;
    const interest = totals.replies_interest ?? 0;
    // Crude funnel: 25% reply rate, 30% of replies = interest, 50% close on interest
    const projectedInterest = Math.max(interest, Math.round(sent * 0.05));
    const projectedCloses = Math.round(projectedInterest * 0.4);
    const avgDeal = 4500; // weighted average across catalog midpoints
    return { sent, replied, interest, projectedInterest, projectedCloses, projectedMRR: projectedCloses * avgDeal };
  }, [totals]);

  return (
    <>
      {/* Forecast */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Pipeline forecast
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Sent so far" value={forecast.sent} color="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" sub="prospects reached" />
            <SummaryCard label="Replied" value={forecast.replied} color="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" sub="inbound responses" />
            <SummaryCard label="Projected interest" value={forecast.projectedInterest} color="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" sub={`actual: ${forecast.interest}`} />
            <SummaryCard label="Projected closes" value={forecast.projectedCloses} color="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" sub={`≈ $${forecast.projectedMRR.toLocaleString()} at $4.5k avg`} />
          </div>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Forecast uses a conservative 5% reply rate × 40% interest-to-close on any
            prospect that has been sent outreach. Adjusts upward if actual interest
            replies exceed the 5% baseline. The $4.5k average is the midpoint across
            the service catalog below — not a hard number per deal.
          </p>
        </CardContent>
      </Card>

      {/* Service catalog with matched prospect counts */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Briefcase className="w-4 h-4" /> Services catalog & matched prospects
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.values(serviceStats).map((svc) => (
            <Card key={svc.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-brand-700 dark:text-brand-100" />
                      <h3 className="font-semibold">{svc.title}</h3>
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{svc.category}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-zinc-500">price range</div>
                    <div className="text-sm font-semibold">${svc.low.toLocaleString()} – ${svc.high.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs">
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase">Matched</div>
                    <div className="font-semibold text-base">{svc.count}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase">Forecast</div>
                    <div className="font-semibold text-base">
                      ${(svc.count * svc.low).toLocaleString()} – ${(svc.count * svc.high).toLocaleString()}
                    </div>
                  </div>
                </div>
                {svc.matched.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-[11px] cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                      Show {svc.matched.length} matched prospect{svc.matched.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {svc.matched.slice(0, 10).map((m: any, i: number) => (
                        <li key={i} className="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-start gap-1">
                          <span className="text-zinc-400 shrink-0">•</span>
                          <div>
                            <strong>{m.prospect.business_name}</strong>
                            {m.prospect.vertical && <span className="text-zinc-400"> ({m.prospect.vertical})</span>}
                            <div className="text-[10px] text-zinc-500">fit {m.fit}/100 · {m.reason}</div>
                          </div>
                        </li>
                      ))}
                      {svc.matched.length > 10 && (
                        <li className="text-[11px] text-zinc-400">+ {svc.matched.length - 10} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Verticals */}
      {verticals.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4" /> Verticals
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {verticals.map((v: any) => (
                <div key={v.vertical} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <VerticalBadge vertical={v.vertical} />
                  <div className="mt-1 text-[11px] text-zinc-500">{v.count} prospects</div>
                  <div className="text-[11px] text-zinc-500">contacted {v.contacted || 0} · replied {v.replies || 0}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ── TAB: Contracts (signed-engagement pipeline) ──────────────────────────────
function ContractsTab({ contracts, loading, onRefresh }: { contracts: any; loading: boolean; onRefresh: () => void }) {
  const totals = contracts?.totals || {};
  const items = contracts?.contracts || [];
  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Pipeline value" value={`$${((totals.pipeline_value_usd || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" sub={`${totals.contracts_total || 0} contracts`} />
        <SummaryCard label="Won" value={`$${((totals.won_value_usd || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" sub={`${totals.paid || 0} paid`} />
        <SummaryCard label="Proposed" value={totals.proposed || 0} color="bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" sub="awaiting prospect" />
        <SummaryCard label="In flight" value={`${(totals.sent || 0) + (totals.viewed || 0) + (totals.accepted || 0) + (totals.contracted || 0) + (totals.invoiced || 0)}`} color="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" sub="sent→invoiced" />
        <SummaryCard label="Lost" value={totals.lost || 0} color="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" sub="cancelled+lost" />
      </div>

      {/* Contracts table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="font-semibold flex items-center gap-2">
              <FileSignature className="w-4 h-4" /> Contracts ({items.length})
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Each prospect → one or more contracts, tracked from proposed → sent → viewed → accepted → contracted → invoiced → paid → delivered.
              Pipeline value = sum of price_committed (or price_high if not set) across all open contracts.
              Won value = sum across paid + delivered only.
            </p>
          </div>
          {loading && <div className="p-4 text-sm text-zinc-500">Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="p-6 text-center text-sm text-zinc-500">No contracts yet. Create one from a prospect detail page or click <strong>Create contract</strong> in the table below.</div>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                  <tr>
                    <th className="text-left p-2">Business</th>
                    <th className="text-left p-2">Service</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Price</th>
                    <th className="text-left p-2">Lifecycle</th>
                    <th className="text-left p-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c: any) => {
                    const priceCommitted = c.price_committed || c.price_high || 0;
                    const lifecycle = [
                      c.proposed_at && "📝 proposed",
                      c.sent_at && "✉ sent",
                      c.viewed_at && "👁 viewed",
                      c.accepted_at && "✓ accepted",
                      c.contracted_at && "📜 contracted",
                      c.invoiced_at && "🧾 invoiced",
                      c.paid_at && "💰 paid",
                      c.delivered_at && "📦 delivered",
                    ].filter(Boolean).join(" → ");
                    return (
                      <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        <td className="p-2">
                          <div className="font-medium">{c.business_name || c.prospect_id}</div>
                          <div className="text-[11px] text-zinc-400 truncate max-w-[180px]">{c.prospect_email || ''}</div>
                        </td>
                        <td className="p-2 text-xs">
                          <div className="font-medium">{c.service_title}</div>
                          {c.service_id && <div className="text-[10px] text-zinc-400">{c.service_id}</div>}
                        </td>
                        <td className="p-2 text-xs"><SendStatusBadge status={c.status} /></td>
                        <td className="p-2 text-xs">
                          <div className="font-semibold">${(priceCommitted / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                          {c.price_low && c.price_high && c.price_low !== c.price_high && (
                            <div className="text-[10px] text-zinc-400">${(c.price_low/100).toLocaleString()} – ${(c.price_high/100).toLocaleString()}</div>
                          )}
                          <div className="text-[10px] text-zinc-400">{c.price_model}</div>
                        </td>
                        <td className="p-2 text-[10px] text-zinc-500 max-w-[300px]">{lifecycle || "—"}</td>
                        <td className="p-2 text-[11px] text-zinc-500 whitespace-nowrap">{fmtAgo(c.proposed_at || c.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ── TAB: Prospect Detail ────────────────────────────────────────────────────
function ProspectDetail({ id, onClose, onProspectUpdate }: { id: string; onClose: () => void; onProspectUpdate?: () => void }) {
  const [data, setData] = useState<any>(null);
    const [contracts, setContracts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionMsg, setActionMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
    const [actionBusy, setActionBusy] = useState<string | null>(null);

    const loadData = useCallback(async () => {
      setLoading(true);
      const [r, c] = await Promise.all([
        api(`/api/mayor/prospect/${id}`),
        api(`/api/mayor/contracts?prospect_id=${id}`),
      ]);
      setData(r.data);
      setContracts(c.data?.contracts || []);
      setLoading(false);
    }, [id]);

    const createContract = useCallback(async (svc: any) => {
      setActionBusy("create-contract");
      setActionMsg(null);
      try {
        const r = await api(`/api/mayor/contracts`, {
          method: "POST",
          body: JSON.stringify({
            prospect_id: id,
            service_id: svc.id,
            service_title: svc.title,
            scope_text: svc.hint,
            price_model: svc.id === "crm-support-retainer" ? "monthly" : (svc.id === "systems-integration" ? "hourly" : "one_time"),
            price_low: svc.low,
            price_high: svc.high,
            status: "proposed",
            notes: `Generated from matchServicesToProspect on ${new Date().toISOString()}`,
          }),
        });
        if (r.ok) {
          setActionMsg({ kind: "ok", text: `Contract proposed · ${r.data?.contract_id}` });
          await loadData();
          onProspectUpdate?.();
        } else {
          setActionMsg({ kind: "err", text: `create failed: ${r.data?.error || r.status}` });
        }
      } finally {
        setActionBusy(null);
      }
    }, [id, loadData, onProspectUpdate]);

    const transitionContract = useCallback(async (contractId: string, action: string) => {
      setActionBusy(`contract-${action}`);
      setActionMsg(null);
      try {
        const r = await api(`/api/mayor/contracts/${contractId}`, {
          method: "POST",
          body: JSON.stringify({ action }),
        });
        if (r.ok) {
          setActionMsg({ kind: "ok", text: `Contract ${action} ✓ · now ${r.data?.new_status}` });
          await loadData();
          onProspectUpdate?.();
        } else {
          setActionMsg({ kind: "err", text: `${action} failed: ${r.data?.error || r.status}` });
        }
      } finally {
        setActionBusy(null);
      }
    }, [loadData, onProspectUpdate]);

  useEffect(() => {
    let cancelled = false;
    loadData();
    return () => { cancelled = true; };
  }, [loadData]);

  const doAction = useCallback(async (kind: string, body: any = {}) => {
    setActionBusy(kind);
    setActionMsg(null);
    try {
      let url = `/api/mayor/prospect/${id}/${kind}`;
      if (kind === "approve-draft") url = `/api/mayor/draft/${id}/approve`;
      const r = await api(url, { method: "POST", body: JSON.stringify(body) });
      if (r.ok) {
        setActionMsg({ kind: "ok", text: `${kind} ✓ · ${r.data?.provider_id ? `provider ${r.data.provider_id}` : (r.data?.inline_send?.deferred ? "queued (email service offline)" : "done")}` });
        await loadData();
        onProspectUpdate?.();
      } else {
        setActionMsg({ kind: "err", text: `${kind} failed: ${r.data?.error || r.status} ${r.data?.message || ""}` });
      }
    } catch (e) {
      setActionMsg({ kind: "err", text: `${kind} threw: ${String((e as any)?.message || e)}` });
    } finally {
      setActionBusy(null);
    }
  }, [id, loadData, onProspectUpdate]);

  if (loading) return <Card><CardContent className="p-6 text-center text-sm text-zinc-500">Loading prospect {id}…</CardContent></Card>;
  if (!data?.prospect) return <Card><CardContent className="p-6 text-center text-sm text-red-700">Prospect not found.</CardContent></Card>;

  const p = data.prospect;
  const signals = data.signals || [];
  const drafts = data.drafts || [];
  const sends = data.sends || [];
  const replies = data.replies || [];
  const sequences = data.sequences || [];
  const matches = matchServicesToProspect(p);
  const latestSignal = signals[0];
  const openDraft = drafts.find((d: any) => d.status === "draft");
  const approvedDraft = drafts.find((d: any) => d.status === "approved");

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-semibold">{p.business_name}</h2>
                <VerticalBadge vertical={p.vertical} />
                <SendStatusBadge status={p.status} />
              </div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                {p.city && <span><MapPin className="inline h-3 w-3" /> {p.city}{p.region && `, ${p.region}`}</span>}
                {p.website && (
                  <a className="ml-2 text-brand-700 underline dark:text-brand-100" href={p.website} target="_blank" rel="noreferrer">
                    {p.root_domain || p.website} <ExternalLink className="inline h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-300 mt-1 space-x-3">
                {p.email && <span><Mail className="inline h-3 w-3" /> {p.email}</span>}
                {p.phone && <span><Phone className="inline h-3 w-3" /> {p.phone}</span>}
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Close">
              <ChevronDown className="w-4 h-4 rotate-90" />
            </button>
          </div>

          {data.next_action && data.next_action.length > 0 && (
                      <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300 flex items-center gap-1">
                          <Target className="w-3 h-3" /> Next action
                        </div>
                        <ul className="mt-1 text-xs text-amber-900 dark:text-amber-200">
                          {data.next_action.map((h: string, i: number) => (<li key={i}>· {h}</li>))}
                        </ul>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => doAction("rescan")}
                        disabled={!!actionBusy}
                        className="rounded-lg px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Globe className="w-3 h-3" />
                        {actionBusy === "rescan" ? "Scanning…" : "Rescan website"}
                      </button>

                      {!openDraft && (
                        <button
                          onClick={() => doAction("generate-draft", { step_no: 1 })}
                          disabled={!!actionBusy || !latestSignal}
                          className="rounded-lg px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                          title={!latestSignal ? "Run rescan first" : "Generate step 1 draft"}
                        >
                          <FileText className="w-3 h-3" />
                          {actionBusy === "generate-draft" ? "Drafting…" : "Generate draft (step 1)"}
                        </button>
                      )}

                      {openDraft && (
                        <>
                          <button
                            onClick={() => doAction("approve-draft", { send_now: false, reviewer_notes: "approved via admin dashboard" })}
                            disabled={!!actionBusy}
                            className="rounded-lg px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                            title="Approve and queue for next outreach tick"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {actionBusy === "approve-draft" ? "Approving…" : "Approve & queue"}
                          </button>
                          <button
                            onClick={() => {
                              if (confirm("Send this draft RIGHT NOW via Cloudflare Email Service?\n\nRecipients get the email within seconds. Use this for hot leads only.")) {
                                doAction("approve-draft", { send_now: true, reviewer_notes: "approved + sent inline via admin" });
                              }
                            }}
                            disabled={!!actionBusy}
                            className="rounded-lg px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                            title="Approve AND fire the email immediately via CF Email Service"
                          >
                            <Send className="w-3 h-3" />
                            Send now
                          </button>
                          <button
                            onClick={() => doAction("approve-draft", { reviewer_notes: "REJECTED via admin dashboard" })}
                            disabled={!!actionBusy}
                            className="rounded-lg px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                            title="Reject the draft — no send"
                          >
                            <X className="w-3 h-3" />
                            Reject
                          </button>
                        </>
                      )}

                      {approvedDraft && sends.filter((s: any) => s.draft_id === approvedDraft.id && s.status === "queued").length > 0 && (
                        <button
                          onClick={() => {
                            const queuedSend = sends.find((s: any) => s.draft_id === approvedDraft.id && s.status === "queued");
                            if (queuedSend && confirm(`Send ${queuedSend.to_email} the queued draft right now?`)) {
                              // Use the approve endpoint with send_now on the same draft to re-fire
                              doAction("approve-draft", { send_now: true, reviewer_notes: "fire approved queued send" });
                            }
                          }}
                          disabled={!!actionBusy}
                          className="rounded-lg px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" /> Fire queued send now
                        </button>
                      )}

                      {p.status !== 'sent' && p.status !== 'replied' && (
                        <button
                          onClick={() => {
                            const sample = prompt(
                              `Simulate an inbound reply for testing. Enter classification:\n\n` +
                              `interest · objection · unsubscribe · not_interested · out_of_office · warm`,
                              "interest"
                            );
                            if (sample && ['interest','objection','unsubscribe','not_interested','out_of_office','warm'].includes(sample)) {
                              api(`/api/mayor/test/simulate-reply`, { method: "POST", body: JSON.stringify({ prospect_id: p.id, classification: sample }) })
                                .then(r => {
                                  if (r.ok) setActionMsg({ kind: "ok", text: `Simulated ${sample} reply · id ${r.data?.reply_id}` });
                                  else setActionMsg({ kind: "err", text: `simulate failed: ${r.data?.error}` });
                                  loadData();
                                });
                            }
                          }}
                          disabled={!!actionBusy}
                          className="rounded-lg px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                          title="Insert a fake inbound reply to test the reply → pipeline flow"
                        >
                          <Reply className="w-3 h-3" /> Simulate reply
                        </button>
                      )}
                    </div>

                    {actionMsg && (
                      <div className={`mt-2 rounded-lg p-2 text-xs ${
                        actionMsg.kind === "ok" ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800" :
                        actionMsg.kind === "err" ? "bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-200 border border-red-200 dark:border-red-800" :
                        "bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800"
                      }`}>
                        {actionMsg.text}
                      </div>
                    )}
                  </CardContent>
                </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leak signals (latest scan) */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4" /> Latest leak scan
              {latestSignal && <span className="text-xs text-zinc-500">({fmtAgo(latestSignal.scanned_at)})</span>}
            </h3>
            {!latestSignal && <div className="text-sm text-zinc-500">Not scanned yet.</div>}
            {latestSignal && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-3xl font-bold">{latestSignal.leak_score}<span className="text-base font-normal text-zinc-500">/100</span></div>
                  <div className="text-xs space-y-0.5">
                    {latestSignal.detected_platform && <div>Platform: <strong>{latestSignal.detected_platform}</strong></div>}
                    {latestSignal.has_ssl === 1 ? <div className="text-emerald-600">✓ SSL</div> : <div className="text-red-600">✗ No SSL</div>}
                    {latestSignal.has_booking_cta === 1 ? <div className="text-emerald-600">✓ Booking CTA</div> : <div className="text-red-600">✗ No booking CTA</div>}
                    {latestSignal.has_phone_click_to_call === 1 ? <div className="text-emerald-600">✓ Phone CTA</div> : <div className="text-red-600">✗ No phone CTA</div>}
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500 mb-2">
                  Page weight: {latestSignal.page_weight_kb ?? '?'} KB · Load: {latestSignal.load_time_ms ?? '?'} ms · Status: {latestSignal.status_code ?? '?'}
                </div>
                {(() => {
                  let leakList: string[] = [];
                  try { leakList = JSON.parse(latestSignal.leak_signals_json || "[]"); } catch {}
                  if (leakList.length === 0) return <div className="text-xs text-emerald-700">No leaks detected ✓</div>;
                  return (
                    <div className="flex flex-wrap gap-1">
                      {leakList.map((s: string, i: number) => <LeakBadge key={i} signal={s} />)}
                    </div>
                  );
                })()}
                {signals.length > 1 && (
                  <details className="mt-3">
                    <summary className="text-[11px] cursor-pointer text-zinc-500">+ {signals.length - 1} older scan{signals.length === 2 ? '' : 's'}</summary>
                    <ul className="mt-2 space-y-1 text-[11px] text-zinc-500">
                      {signals.slice(1, 8).map((s: any) => (
                        <li key={s.id}>{fmtTime(s.scanned_at)} · score {s.leak_score ?? '?'} · {(JSON.parse(s.leak_signals_json || "[]").length || 0)} leaks</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Matched services + forecast */}
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
                          <DollarSign className="w-4 h-4" /> What we could sell them
                        </h3>
                        <ul className="space-y-2">
                          {matches.map((m, i) => (
                            <li key={m.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-medium text-sm">{m.title}</div>
                                  <div className="text-[11px] text-zinc-500">fit {m.fit}/100 · {m.reason}</div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="text-[11px] text-zinc-500">${m.low.toLocaleString()} – ${m.high.toLocaleString()}</div>
                                  <button onClick={() => createContract(m)} disabled={actionBusy === "create-contract"}
                                    className="rounded-md px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium flex items-center gap-1 disabled:opacity-50">
                                    <Plus className="w-3 h-3" /> Propose contract
                                  </button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 text-[11px] text-zinc-500">
                          Match by vertical + leak signals. Numbers reflect the public service
                          catalog from <a className="text-brand-700 underline" href="/services">/services</a>.
                          Click <strong>Propose contract</strong> on any match to create a `prospect_contracts` row ready for tracking.
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Contracts */}
                  <Card>
                    <CardContent className="p-4">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <FileSignature className="w-4 h-4" /> Contracts ({contracts.length})
                      </h3>
                      {contracts.length === 0 ? (
                        <div className="text-sm text-zinc-500">
                          No contracts yet. Use <strong>Propose contract</strong> on a matched service above, or the <strong>Contracts</strong> tab to create one.
                        </div>
                      ) : (
                        <ul className="space-y-3">
                          {contracts.map((c: any) => {
                            const price = c.price_committed || c.price_high || 0;
                            const lifecycle = [
                              c.proposed_at && "📝 proposed",
                              c.sent_at && "✉ sent",
                              c.viewed_at && "👁 viewed",
                              c.accepted_at && "✓ accepted",
                              c.contracted_at && "📜 contracted",
                              c.invoiced_at && "🧾 invoiced",
                              c.paid_at && "💰 paid",
                              c.delivered_at && "📦 delivered",
                            ].filter(Boolean);
                            const nextAction = (() => {
                              if (c.status === "proposed") return "send";
                              if (c.status === "sent") return "view";
                              if (c.status === "viewed") return "accept";
                              if (c.status === "accepted") return "contract";
                              if (c.status === "contracted") return "invoice";
                              if (c.status === "invoiced") return "pay";
                              if (c.status === "paid_full") return "deliver";
                              return null;
                            })();
                            return (
                              <li key={c.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                  <div className="min-w-0">
                                    <div className="font-medium">{c.service_title}</div>
                                    {c.scope_text && <div className="text-[11px] text-zinc-500 mt-0.5">{c.scope_text}</div>}
                                    <div className="text-[11px] text-zinc-500 mt-1">
                                      <strong>${(price/100).toLocaleString()}</strong>
                                      {c.price_low && c.price_high && c.price_low !== c.price_high && ` (range $${(c.price_low/100).toLocaleString()}-$${((c.price_high || 0)/100).toLocaleString()})`}
                                      {' · '}{c.price_model}
                                    </div>
                                  </div>
                                  <SendStatusBadge status={c.status} />
                                </div>
                                {lifecycle.length > 0 && (
                                  <div className="mt-2 text-[10px] text-zinc-500">{lifecycle.join(" → ")}</div>
                                )}
                                {nextAction && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    <button onClick={() => transitionContract(c.id, nextAction)} disabled={!!actionBusy}
                                      className="rounded-md px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium disabled:opacity-50">
                                      {actionBusy === `contract-${nextAction}` ? `${nextAction}…` : `→ ${nextAction}`}
                                    </button>
                                    {(c.status === "proposed" || c.status === "sent") && (
                                      <button onClick={() => transitionContract(c.id, "lost")} disabled={!!actionBusy}
                                        className="rounded-md px-2 py-1 bg-zinc-600 hover:bg-zinc-700 text-white text-[10px] font-medium disabled:opacity-50">
                                        → lost
                                      </button>
                                    )}
                                    {(c.status === "invoiced" || c.status === "contracted") && (
                                      <button onClick={() => transitionContract(c.id, "cancel")} disabled={!!actionBusy}
                                        className="rounded-md px-2 py-1 bg-zinc-600 hover:bg-zinc-700 text-white text-[10px] font-medium disabled:opacity-50">
                                        → cancel
                                      </button>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

      {/* Drafts */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Drafts ({drafts.length})
          </h3>
          {drafts.length === 0 ? (
            <div className="text-sm text-zinc-500">No drafts yet. Approve the prospect from the prospect pipeline to generate one.</div>
          ) : (
            <ul className="space-y-3">
              {drafts.map((d: any) => (
                <li key={d.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{d.subject}</div>
                      <div className="text-[11px] text-zinc-500">
                        {d.generated_by} · {fmtTime(d.created_at)}{d.model && ` · ${d.model}`}
                      </div>
                    </div>
                    <SendStatusBadge status={d.status} />
                  </div>
                  {d.body_text && (
                    <pre className="mt-2 text-xs whitespace-pre-wrap font-sans text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-2 rounded max-h-72 overflow-y-auto">{d.body_text}</pre>
                  )}
                  {d.reviewer_notes && (
                    <div className="mt-2 text-[11px] text-zinc-500 italic">Notes: {d.reviewer_notes}</div>
                  )}
                  {d.cited_signals_json && (() => {
                    let cited: string[] = [];
                    try { cited = JSON.parse(d.cited_signals_json); } catch {}
                    if (cited.length === 0) return null;
                    return (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="text-[10px] text-zinc-500">Cited:</span>
                        {cited.map((s: string, i: number) => <LeakBadge key={i} signal={s} />)}
                      </div>
                    );
                  })()}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Sends (outreach history for this prospect) */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Send className="w-4 h-4" /> Sends ({sends.length})
          </h3>
          {sends.length === 0 ? (
            <div className="text-sm text-zinc-500">No sends yet for this prospect.</div>
          ) : (
            <ul className="space-y-2">
              {sends.map((s: any) => (
                <li key={s.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate max-w-[600px]">{s.subject}</div>
                      <div className="text-[11px] text-zinc-500">
                        To {s.to_email} · From {s.from_email}{s.reply_to && ` · Reply-To ${s.reply_to}`}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Provider {s.provider}{s.provider_id && ` · id ${s.provider_id}`}
                        {s.attempted_at && ` · attempted ${fmtTime(s.attempted_at)}`}
                        {s.finished_at && ` · finished ${fmtTime(s.finished_at)}`}
                      </div>
                      {s.failure_reason && <div className="text-[11px] text-red-600">Failure: {s.failure_reason}</div>}
                    </div>
                    <SendStatusBadge status={s.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Replies */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Inbox className="w-4 h-4" /> Replies ({replies.length})
          </h3>
          {replies.length === 0 ? (
            <div className="text-sm text-zinc-500">No replies yet.</div>
          ) : (
            <ul className="space-y-2">
              {replies.map((r: any) => (
                <li key={r.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{r.subject || '(no subject)'}</div>
                      <div className="text-[11px] text-zinc-500">
                        From {r.from_email} · {fmtTime(r.received_at)}{r.manually_synced ? ' · manually synced' : ''}
                      </div>
                    </div>
                    <SendStatusBadge status={r.classification} />
                  </div>
                  {r.body_excerpt && (
                    <pre className="mt-2 text-xs whitespace-pre-wrap font-sans text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-2 rounded max-h-60 overflow-y-auto">{r.body_excerpt}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Sequences (legacy Mayor engine flow) */}
      {sequences.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Live engine sequences ({sequences.length})
            </h3>
            <p className="text-[11px] text-zinc-500 mb-3">
              Steps queued by the live Mayor engine (legacy prospect_sequences table).
              Distinct from the full drafts/sends above (newer prospect_pipeline schema).
            </p>
            <ul className="space-y-2">
              {sequences.map((s: any) => (
                <li key={s.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">step {s.step_no} · {s.subject}</div>
                      <div className="text-[11px] text-zinc-500">
                        {s.scheduled_for && `scheduled ${fmtTime(s.scheduled_for)}`}
                        {s.sent_at && ` · sent ${fmtTime(s.sent_at)}`}
                      </div>
                    </div>
                    <SendStatusBadge status={s.status} />
                  </div>
                  {s.body_text && (
                    <pre className="mt-2 text-xs whitespace-pre-wrap font-sans text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-2 rounded max-h-60 overflow-y-auto">{s.body_text}</pre>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ── Main AdminMayor ────────────────────────────────────────────────────────
export default function AdminMayor() {
  const { logout } = useAdminSession();
  const [tab, setTab] = useState<"live" | "discovered" | "outreach" | "replies" | "pipeline" | "prospect">("live");
  const [selectedProspect, setSelectedProspect] = useState<string | null>(null);

  const [status, setStatus] = useState<any>(null);
    const [events, setEvents] = useState<any[]>([]);
    const [replies, setReplies] = useState<any[]>([]);
    const [outboundSummary, setOutboundSummary] = useState<any>(null);
    const [sends, setSends] = useState<any>(null);
    const [discovered, setDiscovered] = useState<any>(null);
    const [health, setHealth] = useState<any>(null);
  const [contracts, setContracts] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pauseOpen, setPauseOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const pollRef = useRef<any>(null);

    const refresh = useCallback(async (): Promise<void> => {
      try {
        const [s, e, r, sum, sn, d, h, c] = await Promise.all([
                api("/api/mayor/status"),
                api("/api/mayor/events?limit=50"),
                api("/api/mayor/replies?needs_action=1&limit=20"),
                api(`/api/mayor/outbound-summary?days_back=30`),
                api(`/api/mayor/sends?limit=30&days_back=30`),
                api(`/api/mayor/discovered?limit=100`),
                api(`/api/mayor/health`),
                api(`/api/mayor/contracts?limit=100`),
              ]);
              if (s.ok) setStatus(s.data);
              if (e.ok) setEvents(e.data.events || []);
              if (r.ok) setReplies(r.data.replies || []);
              if (sum.ok) setOutboundSummary(sum.data);
              if (sn.ok) setSends(sn.data);
              if (d.ok) setDiscovered(d.data);
              if (h.ok) setHealth(h.data);
              if (c.ok) setContracts(c.data);
        setError(null);
      } catch (e) {
        setError(String((e as any)?.message || e));
      } finally {
        setLoading(false);
      }
    }, []);

    const runDiscoveryNow = useCallback(async () => {
      setBusy(true);
      setError(null);
      const r = await api("/api/mayor/discover", { method: "POST", body: "{}" });
      setBusy(false);
      if (r.ok) {
        setStatus((prev: any) => ({ ...prev, last_runs: { ...(prev?.last_runs || {}), discovery: new Date().toISOString() } }));
        refresh();
      } else {
        setError(`Discovery failed: ${r.data?.error || r.status} ${r.data?.message || ""}`);
      }
    }, [refresh]);

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
              <Activity className="w-6 h-6" /> Mayor Mission Control
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Six tabs: Live state, what was Discovered, what was sent (Outreach),
              what came back (Replies), Pipeline economics, and per-Prospect drill-down.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} className="rounded-lg p-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            {paused ? (
              <button onClick={resume} disabled={busy} className="rounded-lg px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                <Play className="w-4 h-4" /> Resume
              </button>
            ) : (
              <button onClick={() => setPauseOpen(true)} disabled={busy} className="rounded-lg px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                <Pause className="w-4 h-4" /> Pause
              </button>
            )}
          </div>
        </header>

        {/* ── Tabs ── */}
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {([
            { id: "live",       label: "Live",       icon: Activity },
            { id: "discovered", label: "Discovered", icon: Search },
            { id: "outreach",   label: "Outreach",   icon: Send },
            { id: "replies",    label: "Replies",    icon: Inbox },
            { id: "pipeline",   label: "Pipeline",   icon: DollarSign },
                        { id: "contracts",  label: "Contracts",  icon: FileSignature },
                        { id: "prospect",   label: "Prospect",   icon: Eye, disabled: !selectedProspect },
          ] as const).map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                disabled={(t as any).disabled}
                onClick={() => setTab(t.id as any)}
                className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 rounded-t-lg border-b-2 transition ${
                  active
                    ? "border-brand-700 text-brand-700 dark:text-brand-100 dark:border-brand-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
                {t.id === "discovered" && discovered?.count !== undefined && (
                  <span className="text-[10px] bg-zinc-200 dark:bg-zinc-700 px-1 rounded">{discovered.count}</span>
                )}
                {t.id === "replies" && replies.length > 0 && (
                  <span className="text-[10px] bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 px-1 rounded">{replies.length}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab content ── */}
        {tab === "live"       && <LiveTab status={status} events={events} replies={replies} outboundSummary={outboundSummary} sends={sends} health={health} loading={loading} error={error} onRunDiscovery={runDiscoveryNow} busy={busy} />}
                {tab === "discovered" && <DiscoveredTab data={discovered} loading={loading} onSelect={(id) => { setSelectedProspect(id); setTab("prospect"); }} />}
                {tab === "outreach"   && <OutreachTab sends={sends} loading={loading} />}
                {tab === "replies"    && <RepliesTab replies={replies} loading={loading} />}
                {tab === "pipeline"   && <PipelineTab discovered={discovered} loading={loading} />}
                {tab === "contracts"  && <ContractsTab contracts={contracts} loading={loading} onRefresh={refresh} />}
        {tab === "prospect"   && (
                  selectedProspect
                    ? <ProspectDetail id={selectedProspect} onClose={() => { setSelectedProspect(null); setTab("discovered"); }} onProspectUpdate={refresh} />
                    : <EmptyState icon={Eye} title="No prospect selected" desc="Click any row in the Discovered tab to drill in." />
                )}
      </main>

      {/* ── Pause modal ── */}
      {pauseOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPauseOpen(false)}>
          <Card className="max-w-md w-full" onClick={(e: any) => e.stopPropagation()}>
            <CardContent className="p-5">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" /> Pause Mayor
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