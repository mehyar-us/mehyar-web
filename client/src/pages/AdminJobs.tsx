// AdminJobs.tsx — "💼 Jobs" tab: the mehyar.jobs email growth engine console.
//
// All data comes through the same-origin relay /api/jobs-relay/*
// (functions/api/jobs-relay/[[path]].js) → jobs.mehyar.us. The browser NEVER
// talks to jobs.mehyar.us or api.smtp2go.com directly — the dashboard Bearer
// token is forwarded verbatim server-side and verified there.
//
// Endpoints (built on mehyar-jobs; code defensively — all fields optional):
//   GET  /admin/email/campaign-report?date=YYYY-MM-DD
//   POST /admin/email/wire-up
//   GET  /admin/email/gate

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase, CheckCircle2, XCircle, Loader2, ShieldCheck, Mail, Eye,
  MousePointerClick, TrendingUp, Package, Link2, AlertTriangle, Info,
  CalendarDays, Rocket, Lock, RefreshCw, Users, Zap, CircleDot,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, AdminGate, useAdminSession, STAGE_BADGE } from "./AdminShell";

const RELAY = "/api/jobs-relay";

async function fetchJobs(token: string, path: string) {
  const r = await fetch(`${RELAY}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
  return data;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminJobs() {
  return <AdminGate>{(token) => <JobsView token={token} />}</AdminGate>;
}

function JobsView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const [date, setDate] = useState(todayStr());
  const [wireRunning, setWireRunning] = useState(false);
  const [wireResult, setWireResult] = useState<any>(null);
  const [wireError, setWireError] = useState<string | null>(null);

  // ── Daily campaign report ──────────────────────────────────────────────
  const reportQ = useQuery({
    queryKey: ["admin-jobs-report", token, date],
    queryFn: () => fetchJobs(token, `/admin/email/campaign-report?date=${date}`),
    retry: 1,
  });
  const report: any = reportQ.data || {};

  // ── Fib gate (exists already on mehyar-jobs) ──────────────────────────
  const gateQ = useQuery({
    queryKey: ["admin-jobs-gate", token],
    queryFn: () => fetchJobs(token, "/admin/email/gate"),
    retry: 1,
  });
  const gateData: any = gateQ.data || {};
  const gate: any = report.fib_gate || gateData.gate || {};
  const gateLevels: any[] = gateData.levels || [];

  const refreshAll = () => { reportQ.refetch(); gateQ.refetch(); };

  // ── Wire-up (readiness check + arm) ────────────────────────────────────
  const runWireUp = async () => {
    setWireRunning(true); setWireError(null); setWireResult(null);
    try {
      const r = await fetch(`${RELAY}/admin/email/wire-up`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
      setWireResult(data);
      refreshAll();
    } catch (e) {
      setWireError(String((e as any)?.message || e));
    }
    setWireRunning(false);
  };

  const checks: any[] = wireResult?.checks || [];
  const cohortDetail: string = checks.find((c) => c.key === "cohort")?.detail || "";
  const listSize = parseListSize(cohortDetail);
  const armed: boolean = !!(wireResult?.armed || report.sender_armed);
  const armedTs: string | null = report.sender_armed || null;

  // Today's decision — derived from the gate status
  const decision = deriveDecision(gate);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <AdminNav active="jobs" onLogout={logout} onRefresh={refreshAll} />

      {/* Header */}
      <Card className="mb-4">
        <CardContent className="p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                <Briefcase className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                Mayor Jobs
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
                The mehyar.jobs email growth engine — readiness, daily sender, and the
                full daily campaign report. Same data the 07:00 ET review writes to the repo brief.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Tile label="Sender" value={armed ? "ARMED" : "NOT ARMED"} sub={armedTs ? new Date(armedTs).toLocaleString() : "wire-up to arm"} tone={armed ? "emerald" : "amber"} icon={Rocket} />
              <Tile label="Fib level" value={gate.level ?? "—"} sub={gate.daily_cap ? `${gate.daily_cap}/day cap` : gate.status || "gate"} tone="neutral" icon={ShieldCheck} />
              <Tile label="Contacts" value={listSize ?? "—"} sub={listSize ? "cohort check" : "run readiness"} tone="neutral" icon={Users} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* (a) Status cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1"><Rocket className="w-3 h-3" />Sender state</div>
          <div className="mt-2">
            {armed
              ? <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">ARMED</Badge>
              : <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">NOT ARMED</Badge>}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{armedTs ? `Armed ${new Date(armedTs).toLocaleString()}` : "Daily sender not armed"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1"><ShieldCheck className="w-3 h-3" />Fib gate</div>
          <div className="mt-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {gate.level_idx != null ? `L${gate.level_idx}` : "—"} <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{gate.level || ""}</span>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{gate.daily_cap != null ? `Daily cap: ${gate.daily_cap}` : "cap unknown"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1"><Users className="w-3 h-3" />List size</div>
          <div className="mt-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">{listSize ?? "—"}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate" title={cohortDetail}>{cohortDetail ? cohortDetail.slice(0, 60) : "from cohort readiness check"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1"><Zap className="w-3 h-3" />Today's decision</div>
          <div className="mt-2">
            <Badge className={decision.cls}>{decision.label}</Badge>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{decision.note}</div>
        </CardContent></Card>
      </div>

      {/* (b) Readiness checklist + ARM */}
      <Card className="mb-4">
        <CardContent className="p-5">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                Readiness checklist
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Verifies every dependency, then arms the daily sender. This check does
                <strong> not send any email</strong> — it only arms. The final live flip
                (EMAIL_LIVE) is always Mayor's manual action.
              </p>
            </div>
            <Button onClick={runWireUp} disabled={wireRunning}>
              {wireRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
              {wireRunning ? "Checking…" : "Run readiness check (arms sender)"}
            </Button>
          </div>

          {wireError && (
            <div className="mb-3 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> ⚠ {wireError}
            </div>
          )}

          {wireResult?.armed && (
            <div className="mb-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>Daily sender ARMED.</strong> All checks green — the final live
                flip (EMAIL_LIVE) remains Mayor's manual action.
              </div>
            </div>
          )}

          {checks.length > 0 ? (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {checks.map((c, i) => (
                <div key={c.key || i} className="flex items-start gap-3 px-4 py-2.5 bg-white dark:bg-zinc-900">
                  {c.ok
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {c.label || c.key}
                      <span className={`ml-2 text-[10px] uppercase font-semibold ${c.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {c.ok ? "pass" : "fail"}
                      </span>
                    </div>
                    {c.detail && <div className="text-xs text-zinc-500 dark:text-zinc-400 break-words">{c.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">
              No check run yet — press the button to verify the pipeline end to end.
              Expected checks: smtp2go_api · brevo_api · fib_gate · seed_test · suppression · product_catalog · cohort · env_live.
            </div>
          )}
        </CardContent>
      </Card>

      {/* (c) Daily campaign report */}
      <Card className="mb-4">
        <CardContent className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Daily campaign report
            </h2>
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-zinc-400" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
              />
              <Button variant="ghost" size="sm" onClick={() => reportQ.refetch()} disabled={reportQ.isFetching}>
                <RefreshCw className={`w-4 h-4 ${reportQ.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {reportQ.isLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading report for {date}…
            </div>
          )}

          {reportQ.isError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              ⚠ Couldn't load the report: {String((reportQ.error as any)?.message || "unknown")}.
              The jobs-side endpoints may still be building — see docs/JOBS_RELAY_SETUP.md.
            </div>
          )}

          {reportQ.isSuccess && report && (
            <div className="space-y-5">
              {/* stat tiles */}
              <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                <StatTile label="Sends" value={report.sends?.total ?? 0} icon={Mail} />
                <StatTile label="Opens" value={report.events?.opens ?? 0} icon={Eye} />
                <StatTile label="Clicks" value={report.events?.clicks ?? 0} icon={MousePointerClick} />
                <StatTile label="CTR" value={fmtPct(report.events?.ctr)} icon={TrendingUp} />
                <StatTile label="Bounces" value={report.events?.bounces ?? 0} icon={AlertTriangle} tone={report.events?.bounces > 0 ? "red" : undefined} />
                <StatTile label="Complaints" value={report.events?.complaints ?? 0} icon={CircleDot} tone={report.events?.complaints > 0 ? "red" : undefined} />
                <StatTile label="Unsubs" value={report.events?.unsubscribes ?? 0} icon={XCircle} />
              </div>

              {/* provider stats */}
              <div>
                <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Provider</h3>
                {report.provider?.error ? (
                  <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> SMTP2GO stats unavailable: {report.provider.error}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <ProviderStat label="SMTP2GO sends" value={report.provider?.sends ?? "—"} />
                    <ProviderStat label="Bounce" value={fmtPct(report.provider?.bouncePct)} />
                    <ProviderStat label="Complaint" value={fmtPct(report.provider?.complaintPct)} />
                    <ProviderStat label="Unsub" value={fmtPct(report.provider?.unsubPct)} />
                  </div>
                )}
                {report.sends?.byStatus && Object.keys(report.sends.byStatus).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {Object.entries(report.sends.byStatus).map(([k, v]) => (
                      <Badge key={k} className={STAGE_BADGE[k] || "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}>
                        {k}: {String(v)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* email table */}
              <div>
                <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Emails ({(report.emails || []).length})</h3>
                {(report.emails || []).length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <table className="text-xs min-w-full">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Subject</th>
                          <th className="px-3 py-2 text-left font-medium">Template</th>
                          <th className="px-3 py-2 text-left font-medium">Variant</th>
                          <th className="px-3 py-2 text-right font-medium">Sends</th>
                          <th className="px-3 py-2 text-right font-medium">Recipients</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.emails || []).map((e: any, i: number) => (
                          <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800 odd:bg-zinc-50/60 dark:odd:bg-zinc-800/30">
                            <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100 max-w-[280px] truncate" title={e.subject}>{e.subject || "—"}</td>
                            <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-300">{e.template || "—"}</td>
                            <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{e.variant || "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{e.sends ?? 0}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{e.recipients ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">No emails recorded for {date}.</div>
                )}
              </div>

              {/* offers */}
              <div>
                <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Offers</h3>
                {(report.offers || []).length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <table className="text-xs min-w-full">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Offer</th>
                          <th className="px-3 py-2 text-right font-medium">Opens</th>
                          <th className="px-3 py-2 text-right font-medium">Clicks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.offers || []).map((o: any, i: number) => (
                          <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{o.offer || "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{o.opens ?? 0}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{o.clicks ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">No offer-tagged events yet.</div>
                )}
              </div>

              {/* products */}
              <div>
                <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Products</h3>
                {report.products?.product_of_day ? (
                  <Card className="border-emerald-200 dark:border-emerald-800">
                    <CardContent className="p-3 flex items-start gap-3">
                      <Package className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{report.products.product_of_day.name}</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {report.products.product_of_day.category}{report.products.product_of_day.slug ? ` · ${report.products.product_of_day.slug}` : ""}
                        </div>
                        {report.products.product_of_day.url && (
                          <a href={report.products.product_of_day.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 mt-1">
                            <Link2 className="w-3 h-3" /> product link
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">No product of the day set for {date}.</div>
                )}
                {(report.products?.tagged_events || []).length > 0 && (
                  <div className="text-xs text-zinc-600 dark:text-zinc-300 mt-2">
                    {report.products.tagged_events.length} product-tagged event{(report.products.tagged_events.length === 1 ? "" : "s")}
                  </div>
                )}
              </div>

              {/* landing pages */}
              <div>
                <h3 className="text-xs uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Landing pages</h3>
                {report.landing_pages?.note && (
                  <div className="text-xs text-zinc-600 dark:text-zinc-300 mb-2">{report.landing_pages.note}</div>
                )}
                {(report.landing_pages?.active_go_slugs || []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(report.landing_pages.active_go_slugs || []).map((s: string) => (
                      <Badge key={s} className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 font-mono">/go/{s}</Badge>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">No active /go/ slugs.</div>
                )}
              </div>

              {/* fib gate detail */}
              {gate.level_idx != null && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">Fib gate:</span>{" "}
                  level {gate.level_idx} ({gate.level || "—"}) · status {gate.status || "—"}
                  {gate.hold_until ? ` · hold until ${gate.hold_until}` : ""}
                  {gate.last_complaint_pct != null ? ` · complaints ${gate.last_complaint_pct}%` : ""}
                  {gate.last_bounce_pct != null ? ` · bounce ${gate.last_bounce_pct}%` : ""}
                  {gate.notes ? ` · ${gate.notes}` : ""}
                  {gateLevels.length > 0 && (
                    <div className="mt-1 text-zinc-500 dark:text-zinc-400">
                      Levels: {gateLevels.map((l: any) => l.label || l.level || l.idx).join(" → ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* (d) Note card */}
      <Card>
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-xs text-zinc-600 dark:text-zinc-300">
            The <strong>07:00 ET daily review</strong> writes a full brief to{" "}
            <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">email-reviews/YYYY-MM-DD.md</code>{" "}
            in the mehyar-jobs repo and reports in the Mayor Jobs chat. This tab reads
            the same data live — use the date picker above to audit any day.
            <span className="flex items-center gap-1 mt-1 text-zinc-500 dark:text-zinc-400">
              <Lock className="w-3 h-3" /> Auth: the jobs-side endpoints verify this
              dashboard's admin token (see docs/JOBS_RELAY_SETUP.md).
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Local atoms ────────────────────────────────────────────────────────────
function Tile({ label, value, sub, tone = "neutral", icon: Icon }: any) {
  const toneCls: Record<string, string> = {
    neutral: "text-zinc-900 dark:text-zinc-100",
    emerald: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    red: "text-red-700 dark:text-red-400",
  };
  return (
    <div className="text-center px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 min-w-[80px]">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-semibold flex items-center justify-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${toneCls[tone] || toneCls.neutral}`}>{value}</div>
      {sub && <div className="text-[9px] text-zinc-500 dark:text-zinc-400 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function StatTile({ label, value, icon: Icon, tone }: any) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-2 text-center">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-semibold flex items-center justify-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </div>
      <div className={`text-base font-bold tabular-nums ${tone === "red" && Number(value) > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100"}`}>
        {value}
      </div>
    </div>
  );
}

function ProviderStat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 px-2 py-1.5">
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}

function fmtPct(v: any): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `${n}%`;
}

// Parse a total contact count out of the cohort check's free-text detail,
// e.g. "3 alerts, 1,248 contacts ready" or "contacts: 1248".
function parseListSize(detail: string): string | null {
  if (!detail) return null;
  const m = detail.match(/([\d,]+)\s*contacts?/i) || detail.match(/contacts?\s*[:=]\s*([\d,]+)/i);
  return m ? m[1].replace(/,/g, "") : null;
}

function deriveDecision(gate: any): { label: string; cls: string; note: string } {
  const s = String(gate?.status || "").toLowerCase();
  const notes = String(gate?.notes || "");
  if (s.includes("paus")) return {
    label: "PAUSED",
    cls: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200",
    note: notes.slice(0, 80) || "gate paused",
  };
  if (s.includes("advanc")) return {
    label: "ADVANCED",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200",
    note: notes.slice(0, 80) || "level advanced",
  };
  if (s) return {
    label: "HOLDING",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
    note: notes.slice(0, 80) || `status: ${gate.status}`,
  };
  return {
    label: "UNKNOWN",
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    note: "no gate data yet",
  };
}
