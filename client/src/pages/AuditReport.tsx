import { useEffect, useState } from "react";
import {
  ArrowRight, Bot, CalendarClock, CheckCircle2, FileText, ListChecks,
  Loader2, Printer, Scale, Search, ShieldCheck, Sparkles, Target, TrendingDown, AlertTriangle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import ReportPreview from "@/components/ReportPreview";

type FullReport = {
  score: number;
  business_type_label?: string;
  executive_summary?: string;
  leak_map?: Array<{ area: string; severity: string; finding: string; estimated_monthly_impact: string; fix: string; effort: string }>;
  page_by_page?: Array<{ page: string; grade: string; issues: string[]; fix: string }>;
  how_you_compare?: { note?: string; points?: string[] };
  ai_blueprint?: Array<{ phase: string; pipeline: string; what_it_does: string; replaces: string; estimated_cost_to_build: string; estimated_monthly_upside: string }>;
  five_hundred_percent_math?: { current_capacity?: string; ai_capacity?: string; multiplier?: string; math?: string[]; honest_caveats?: string[] };
  ninety_day_plan?: Array<{ month: string; actions: string[]; expected_outcome: string }>;
  one_thing?: string;
  upsell_note?: string;
};

function useQuery() {
  return new URLSearchParams(window.location.search);
}

function hostnameOf(raw?: string | null) {
  if (!raw) return "";
  return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Circular score gauge — red (pain) → amber (caution) → emerald (growth). */
function ScoreGauge({ score, size = 220 }: { score: number; size?: number }) {
  const r = 88;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 70 ? "#10B981" : score >= 45 ? "#F59E0B" : "#DC2626";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="18" />
        <circle
          cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="18"
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: "stroke-dasharray 1.2s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-6xl font-extrabold tracking-tight text-white">{score}</span>
        <span className="text-sm font-medium uppercase tracking-widest text-slate-300">/ 100</span>
      </div>
    </div>
  );
}

function DownloadPdfButton({ className = "" }: { className?: string }) {
  return (
    <Button
      onClick={() => window.print()}
      variant="cta"
      size="lg"
      className={`no-print bg-[#F59E0B] text-[#0B1B33] hover:bg-amber-400 ${className}`}
    >
      <Printer className="mr-2 h-5 w-5" /> Download / Print PDF
    </Button>
  );
}

const PRINT_CSS = `
@media print {
  nav, footer, .no-print { display: none !important; }
  body { background: #ffffff !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .report-print-section { page-break-before: always; }
  .report-cover { page-break-before: avoid; }
  .avoid-break { break-inside: avoid; }
  .report-shell { max-width: 100% !important; padding: 0 !important; }
  section.report-page { padding-top: 0 !important; padding-bottom: 0 !important; }
}
`;

function severityBadge(sev?: string) {
  const s = (sev || "").toLowerCase();
  if (s === "critical") return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300";
  if (s === "high") return "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300";
  if (s === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

function gradeColor(g?: string) {
  if (g === "F" || g === "D") return "text-red-500";
  if (g === "C") return "text-amber-500";
  return "text-emerald-500";
}

const WHATS_INSIDE = [
  "Leak map — every leak priced in dollars",
  "Page-by-page grades (A–F)",
  "How you stack up vs typical sites in your industry",
  "AI automation blueprint for your business type",
  "The 500% capacity math, shown step by step",
  "Your 90-day action plan",
  "The one thing to fix first",
];

export default function AuditReport() {
  const q = useQuery();
  const token = q.get("token");
  const justPaid = q.get("paid") === "1";

  const [email, setEmail] = useState(q.get("email") || "");
  const [url, setUrl] = useState(q.get("url") || "");
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [report, setReport] = useState<FullReport | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [reportDate, setReportDate] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  // Poll for the report when we have a token.
  useEffect(() => {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      if (q.get("token")) setLoadError("Invalid report link.");
      return;
    }
    let alive = true;
    let tries = 0;
    const poll = async () => {
      try {
        const r = await fetch(`/api/audit/full-report/get?token=${encodeURIComponent(token)}`);
        const data = await r.json();
        if (!alive) return;
        if (data.ok) {
          setStatus(data.status);
          setSiteUrl(data.url || null);
          setReportDate(data.delivered_at || data.created_at || null);
          if (data.report) { setReport(data.report); return; }
        } else {
          setLoadError("Report not found.");
          return;
        }
      } catch { /* retry */ }
      tries++;
      if (alive && tries < 40) setTimeout(poll, 5000);
      else if (alive) setLoadError("Still generating — check your email shortly.");
    };
    poll();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // PDF-friendly document title.
  useEffect(() => {
    if (report) {
      const host = hostnameOf(siteUrl) || "website";
      document.title = `Website-Evaluation-${host}`;
    }
    return () => { document.title = "MehyarSoft — AI Website Evaluation"; };
  }, [report, siteUrl]);

  const buy = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuyError("");
    setBuying(true);
    try {
      const r = await fetch("/api/audit/full-report/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, url }),
      });
      const data = await r.json();
      if (data.already_ready && data.token) {
        window.location.href = `/audit/report?token=${data.token}`;
        return;
      }
      if (!data.ok) {
        if (data.error === "stripe_not_configured") {
          throw new Error("Checkout opens very soon — we saved your spot. Check back in a bit!");
        }
        throw new Error(data.message || "Couldn't start checkout.");
      }
      window.location.href = data.checkout_url;
    } catch (err: any) {
      setBuyError(err?.message || "Something went wrong.");
      setBuying(false);
    }
  };

  /* ── REPORT VIEW ── */
  if (token) {
    if (loadError) {
      return (
        <section className="site-hero px-4"><div className="site-shell max-w-2xl text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="site-display mt-4">Hmm.</h1>
          <p className="site-lede mt-4">{loadError}</p>
          <Link href="/audit" className={buttonVariants({ variant: "cta", className: "mt-6" })}>Back to free audit</Link>
        </div></section>
      );
    }
    if (!report) {
      return (
        <section className="site-hero px-4"><div className="site-shell max-w-2xl text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <h1 className="site-display mt-4 text-3xl">{justPaid ? "Payment received — building your report…" : "Loading your report…"}</h1>
          <p className="site-lede mx-auto mt-4 max-w-xl">
            {justPaid
              ? "Our AI is analyzing your site and writing your full evaluation. This takes about a minute — it's also being emailed to you."
              : "Fetching your full evaluation…"}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">Status: {status || "starting"} · auto-refreshing</p>
        </div></section>
      );
    }

    const m500 = report.five_hundred_percent_math || {};
    const host = hostnameOf(siteUrl);
    const dateStr = formatDate(reportDate);
    const hasLeaks = (report.leak_map || []).length > 0;
    const hasPages = (report.page_by_page || []).length > 0;
    const hyc = report.how_you_compare || {};
    const hasGaps = !!((hyc.note || "") || (hyc.points || []).length);
    const hasBlueprint = (report.ai_blueprint || []).length > 0;
    const hasPlan = (report.ninety_day_plan || []).length > 0;
    const hasMath = !!(m500.current_capacity || m500.ai_capacity || (m500.math || []).length > 0);

    return (
      <>
        <style>{PRINT_CSS}</style>
        <section className="report-page px-4 py-10 md:py-16">
          <div className="report-shell site-shell max-w-4xl">

            {/* ── COVER ── */}
            <div className="report-cover overflow-hidden rounded-3xl bg-[#0B1B33] text-white shadow-2xl">
              <div className="flex flex-col items-center gap-8 p-8 md:flex-row md:justify-between md:p-12">
                <div className="text-center md:text-left">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">MehyarSoft</p>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">AI Website Evaluation</h1>
                  {host && <p className="mt-3 text-lg text-slate-200">{host}</p>}
                  <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-slate-300 md:justify-start">
                    {dateStr && <span>Prepared {dateStr}</span>}
                    {report.business_type_label && <span>· {report.business_type_label}</span>}
                  </div>
                  <div className="no-print mt-8 flex flex-wrap justify-center gap-3 md:justify-start">
                    <DownloadPdfButton />
                  </div>
                </div>
                <div className="shrink-0">
                  <ScoreGauge score={report.score} />
                  <p className="mt-3 text-center text-xs uppercase tracking-widest text-slate-400">Overall score</p>
                </div>
              </div>
            </div>

            {/* ── EXECUTIVE SUMMARY ── */}
            {report.executive_summary && (
              <div className="avoid-break mt-10">
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
                  <Sparkles className="h-6 w-6 text-[#F59E0B]" /> Executive summary
                </h2>
                <Card className="mt-4"><CardContent className="p-5 md:p-6">
                  <p className="text-base leading-7 text-foreground">{report.executive_summary}</p>
                </CardContent></Card>
              </div>
            )}

            {/* ── LEAK MAP ── */}
            {hasLeaks && (
              <div className="report-print-section mt-10">
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
                  <TrendingDown className="h-6 w-6 text-[#DC2626]" /> Leak map — every leak priced
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  What's quietly costing you money, and what each fix is worth. Losses hurt more than gains feel good — that's why we price the pain first.
                </p>
                <div className="mt-4 space-y-4">
                  {report.leak_map!.map((l, i) => (
                    <Card key={i} className="avoid-break border-l-4 border-l-[#DC2626]"><CardContent className="p-5 md:p-6">
                      <p className="font-semibold text-foreground">{i + 1}. {l.area}{" "}
                        <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(l.severity)}`}>{l.severity}</span>
                      </p>
                      {l.finding && <p className="mt-2 text-sm leading-6 text-muted-foreground">{l.finding}</p>}
                      {l.estimated_monthly_impact && (
                        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-[#DC2626] dark:bg-red-950/30">
                          💸 Leaving on the table: {l.estimated_monthly_impact}
                        </p>
                      )}
                      {l.fix && (
                        <p className="mt-2 flex gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          <span><strong>Fix:</strong> {l.fix}{l.effort ? <em> ({l.effort})</em> : null}</span>
                        </p>
                      )}
                    </CardContent></Card>
                  ))}
                </div>
              </div>
            )}

            {/* ── PAGE BY PAGE ── */}
            {hasPages && (
              <div className="report-print-section mt-10">
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
                  <FileText className="h-6 w-6 text-[#0B1B33] dark:text-sky-300" /> Page-by-page grades
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Grades are based on your homepage's public signals, extrapolated across your key pages.
                </p>
                <div className="mt-4 space-y-4">
                  {report.page_by_page!.map((p, i) => (
                    <Card key={i} className="avoid-break"><CardContent className="p-5 md:p-6">
                      <p className="font-semibold text-foreground">{p.page} — <span className={gradeColor(p.grade)}>Grade {p.grade}</span></p>
                      {(p.issues || []).length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {p.issues.map((x, j) => <li key={j}>{x}</li>)}
                        </ul>
                      )}
                      {p.fix && <p className="mt-2 text-sm text-foreground"><strong>The one fix:</strong> {p.fix}</p>}
                    </CardContent></Card>
                  ))}
                </div>
              </div>
            )}

            {/* ── HOW YOU COMPARE ── */}
            {hasGaps && (
              <div className="report-print-section mt-10">
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
                  <Scale className="h-6 w-6 text-[#F59E0B]" /> How you compare
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Typical patterns for your business type — not a crawl of your actual competitors.
                </p>
                <Card className="mt-4"><CardContent className="p-5 md:p-6">
                  {hyc.note && <p className="text-sm leading-6 text-foreground">{hyc.note}</p>}
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                    {(hyc.points || []).map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </CardContent></Card>
              </div>
            )}

            {/* ── AI BLUEPRINT ── */}
            {hasBlueprint && (
              <div className="report-print-section mt-10">
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
                  <Bot className="h-6 w-6 text-[#10B981]" /> Your AI automation blueprint
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  The systems that multiply what your business can handle — without hiring.
                </p>
                <div className="mt-4 space-y-4">
                  {report.ai_blueprint!.map((b, i) => (
                    <Card key={i} className="avoid-break border-emerald-500/30"><CardContent className="p-5 md:p-6">
                      <p className="font-semibold text-foreground">🤖 {b.pipeline}{" "}
                        {b.phase && <span className="ml-1 text-xs font-normal text-muted-foreground">{b.phase}</span>}
                      </p>
                      {b.what_it_does && <p className="mt-2 text-sm leading-6 text-muted-foreground">{b.what_it_does}</p>}
                      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                        {b.replaces && <p><strong>Replaces:</strong> {b.replaces}</p>}
                        {b.estimated_cost_to_build && <p><strong>Build cost:</strong> {b.estimated_cost_to_build}</p>}
                      </div>
                      {b.estimated_monthly_upside && (
                        <p className="mt-2 flex gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {b.estimated_monthly_upside}
                        </p>
                      )}
                    </CardContent></Card>
                  ))}
                </div>
              </div>
            )}

            {/* ── 500% MATH ── */}
            {hasMath && (
              <div className="report-print-section mt-10 overflow-hidden rounded-3xl bg-[#0B1B33] p-6 text-white md:p-10">
                <h2 className="text-2xl font-semibold">The 500% math — step by step</h2>
                <p className="mt-2 text-sm text-slate-300">
                  Capacity arithmetic: what your operation handles today vs. with these AI systems in place.
                </p>
                {m500.current_capacity && <p className="mt-4 text-sm text-slate-200"><strong className="text-white">Today:</strong> {m500.current_capacity}</p>}
                {m500.ai_capacity && <p className="mt-2 text-sm text-slate-200"><strong className="text-white">With AI:</strong> {m500.ai_capacity}</p>}
                {m500.multiplier && <p className="mt-4 text-4xl font-bold text-emerald-400">{m500.multiplier}</p>}
                {(m500.math || []).length > 0 && (
                  <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-200">
                    {m500.math!.map((x, i) => <li key={i}>{x}</li>)}
                  </ol>
                )}
                {(m500.honest_caveats || []).length > 0 && (
                  <div className="mt-6 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
                    <p className="text-sm font-semibold text-amber-300">⚠️ Honest caveats — read these</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-100/90">
                      {m500.honest_caveats!.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── 90-DAY PLAN ── */}
            {hasPlan && (
              <div className="report-print-section mt-10">
                <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
                  <CalendarClock className="h-6 w-6 text-[#0B1B33] dark:text-sky-300" /> Your 90-day plan
                </h2>
                <div className="mt-4 space-y-4">
                  {report.ninety_day_plan!.map((p, i) => (
                    <Card key={i} className="avoid-break"><CardContent className="p-5 md:p-6">
                      <p className="flex items-center gap-2 font-semibold text-foreground">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#0B1B33] text-sm font-bold text-white">{i + 1}</span>
                        {p.month}
                      </p>
                      {(p.actions || []).length > 0 && (
                        <ul className="mt-3 space-y-2 pl-1 text-sm text-muted-foreground">
                          {p.actions.map((a, j) => (
                            <li key={j} className="flex gap-2">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{a}
                            </li>
                          ))}
                        </ul>
                      )}
                      {p.expected_outcome && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400"><em>{p.expected_outcome}</em></p>}
                    </CardContent></Card>
                  ))}
                </div>
              </div>
            )}

            {/* ── ONE THING ── */}
            {report.one_thing && (
              <div className="report-print-section mt-10 overflow-hidden rounded-3xl border-2 border-[#F59E0B] bg-amber-50 p-6 md:p-8 dark:bg-amber-950/20">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
                  <Target className="h-4 w-4" /> If you do only one thing
                </p>
                <p className="mt-3 text-xl font-semibold leading-8 text-[#0B1B33] dark:text-foreground md:text-2xl">{report.one_thing}</p>
                {report.upsell_note && <p className="mt-4 text-sm text-muted-foreground"><em>{report.upsell_note}</em></p>}
                <Link href="/booking" className={`${buttonVariants({ variant: "cta", className: "no-print mt-6" })}`}>
                  Talk it through — free 15-min call <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            )}

            {/* ── BOTTOM DOWNLOAD ── */}
            <div className="no-print mt-12 flex flex-col items-center gap-3 rounded-3xl bg-[#0B1B33] p-8 text-center text-white">
              <ShieldCheck className="h-8 w-8 text-emerald-400" />
              <p className="text-lg font-semibold">Keep this evaluation forever</p>
              <p className="max-w-md text-sm text-slate-300">Download it as a PDF for your files, your team, or your next agency conversation.</p>
              <DownloadPdfButton className="mt-2" />
              <p className="mt-2 text-xs text-slate-400">Prepared by MehyarSoft · {dateStr || "today"}{host ? ` · ${host}` : ""}</p>
            </div>

          </div>
        </section>
      </>
    );
  }

  /* ── PURCHASE VIEW ── */
  return (
    <section className="site-hero px-4">
      <div className="site-shell max-w-4xl">
        <p className="site-eyebrow mb-4 text-center">The full evaluation</p>
        <h1 className="site-display mx-auto max-w-2xl text-balance text-center">The free audit is the trailer — this is the movie.</h1>
        <p className="site-lede mx-auto mt-4 max-w-xl text-balance text-center">
          The complete professional evaluation of <em>your</em> site — every leak priced, page-by-page grades, how you compare, the 500% AI blueprint with the math shown step by step, and your 90-day plan.
        </p>

        <div className="mx-auto mt-10 grid max-w-3xl items-start gap-8 md:grid-cols-2">
          <ReportPreview className="mx-auto w-full max-w-xs rotate-[-2deg]" />

          <div>
            <div className="flex items-baseline gap-2">
              <span className="rounded-xl bg-[#F59E0B] px-3 py-1 text-4xl font-extrabold text-[#0B1B33]">$5</span>
              <span className="text-sm text-muted-foreground">one-time · yours forever</span>
            </div>

            <h2 className="mt-6 flex items-center gap-2 font-semibold text-foreground">
              <ListChecks className="h-5 w-5 text-[#0B1B33] dark:text-sky-300" /> What's inside
            </h2>
            <ul className="mt-3 space-y-2">
              {WHATS_INSIDE.map((f) => (
                <li key={f} className="flex gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{f}
                </li>
              ))}
            </ul>

            <Card className="mt-6 border-border bg-card text-left">
              <CardContent className="p-6">
                <form onSubmit={buy} className="space-y-4">
                  <div>
                    <Label htmlFor="r-url">Website to evaluate</Label>
                    <Input id="r-url" type="text" inputMode="url" autoComplete="url" required placeholder="yourbusiness.com" value={url} onChange={(e) => setUrl(e.target.value)} className="mt-2 h-12 text-base" />
                  </div>
                  <div>
                    <Label htmlFor="r-email">Email for delivery</Label>
                    <Input id="r-email" type="email" autoComplete="email" required placeholder="you@youremail.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 text-base" />
                  </div>
                  {buyError && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{buyError}</p>}
                  <Button type="submit" variant="cta" size="lg" className="h-13 w-full bg-emerald-500 py-4 text-base text-emerald-950 hover:bg-emerald-400" disabled={buying}>
                    {buying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting checkout…</> : <>Get my full report — $5 <ArrowRight className="ml-2 h-4 w-4" /></>}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">One-time · Instant delivery · Less than a coffee</p>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-2xl border border-border bg-card p-5 text-left">
          <Search className="mt-0.5 h-5 w-5 shrink-0 text-[#0B1B33] dark:text-sky-300" />
          <p className="text-sm leading-6 text-muted-foreground">
            <strong className="text-foreground">How it works:</strong> pay $5 once, our AI writes the full evaluation for your site in about a minute, and it's emailed to you with a permanent link. No subscription, no upsell required to get value.
          </p>
        </div>
      </div>
    </section>
  );
}
