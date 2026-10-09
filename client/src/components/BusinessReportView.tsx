import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  EyeOff,
  FileText,
  ListChecks,
  Loader2,
  Printer,
  Sparkles,
  Target,
  TrendingDown,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { trackAuditPurchase } from "./MarketingTags";

/* ── Payload contract (GET /api/audit/business/report?token=<64-hex>) ───────
   { ok, status: "generating"|"ready"|"failed",
     audit_id, url, business_name, created_at, paid_at,
     failure_reason, buyer_message,
     report?: {
       score (0-100), grade, deterministic_score, ai_score, score_rationale,
       business_type, business_type_label, executive_summary,
       money_leaks[], flaws[], suggestions[], ai_opportunities[], prioritized_fixes[],
       // each finding: { title, detail, evidence, severity 1-5, confidence 0-1,
       //   estimated_monthly_impact/upside (string), effort (string),
       //   gating: { needs_review }, decide_severity_100 }
       video_section (always present; "couldn't be assessed" when no transcript),
       one_thing, coverage_note, methodology,
       gating_summary: { auto, needs_review, decide_ok }, built_at
     } }
   Every field optional — the renderer shows an honest "couldn't be assessed"
   state rather than inventing content. */

export type BusinessFinding = {
  title: string;
  detail?: string;
  evidence?: string;
  severity?: number; // 1-5
  confidence?: number; // 0-1
  estimated_monthly_impact?: string;
  estimated_monthly_upside?: string;
  effort?: string;
  gating?: { needs_review?: boolean };
  decide_severity_100?: number;
};

export type BusinessReport = {
  score?: number;
  grade?: string;
  deterministic_score?: number;
  ai_score?: number;
  score_rationale?: string;
  business_type?: string;
  business_type_label?: string;
  executive_summary?: string;
  money_leaks?: BusinessFinding[];
  flaws?: BusinessFinding[];
  suggestions?: BusinessFinding[];
  ai_opportunities?: BusinessFinding[];
  prioritized_fixes?: BusinessFinding[];
  video_section?: string;
  one_thing?: string;
  coverage_note?: string;
  methodology?: string;
  gating_summary?: { auto?: number; needs_review?: number; decide_ok?: boolean };
  built_at?: string;
};

export type BusinessReportPayload = {
  ok: boolean;
  status?: "generating" | "ready" | "failed" | string;
  audit_id?: string;
  url?: string;
  business_name?: string;
  created_at?: string;
  paid_at?: string;
  failure_reason?: string;
  buyer_message?: string;
  report?: BusinessReport | null;
  message?: string;
  error?: string;
};

const POLL_MS = 5000;
const MAX_POLLS = 36; // ~3 minutes, then "we'll email you" fallback

function hostnameOf(raw?: string | null) {
  if (!raw) return "";
  return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function needsReview(f: BusinessFinding) {
  return f.gating?.needs_review === true;
}

/** Circular score dial — red (pain) → amber (caution) → emerald (growth). */
function ScoreDial({ score, size = 200 }: { score: number; size?: number }) {
  const r = 88;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 70 ? "#10B981" : score >= 45 ? "#F59E0B" : "#DC2626";
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Overall score: ${score} out of 100`}>
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" aria-hidden="true">
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

function NeedsReviewBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
      <EyeOff className="h-3 w-3" aria-hidden="true" /> Needs review
    </span>
  );
}

function FindingCard({ f, index, tone }: { f: BusinessFinding; index: number; tone: "leak" | "flaw" | "fix" | "ai" }) {
  const impact = f.estimated_monthly_impact || f.estimated_monthly_upside;
  const sev = typeof f.severity === "number" ? Math.max(1, Math.min(5, f.severity)) : null;
  return (
    <Card className={cn("avoid-break", tone === "leak" ? "border-l-4 border-l-[#DC2626]" : tone === "ai" ? "border-emerald-500/30" : "")}>
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-foreground">
            {tone === "leak" ? `${index + 1}. ` : ""}{f.title}
          </p>
          {needsReview(f) && <NeedsReviewBadge />}
        </div>
        {f.detail && <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.detail}</p>}
        {sev != null && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Severity</span>
              <span className="font-semibold text-foreground">{sev}/5</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="img" aria-label={`Severity ${sev} out of 5`}>
              <div className={cn("h-full rounded-full", sev >= 4 ? "bg-[#DC2626]" : sev >= 3 ? "bg-[#F59E0B]" : "bg-[#10B981]")} style={{ width: `${(sev / 5) * 100}%` }} />
            </div>
          </div>
        )}
        {impact && (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-[#DC2626] dark:bg-red-950/30">
            {impact}
          </p>
        )}
        {f.effort && (
          <p className="mt-2 text-sm text-muted-foreground">
            <strong className="text-foreground">Effort:</strong> {f.effort}
          </p>
        )}
        {f.evidence && (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            <strong className="text-foreground">Evidence:</strong> {f.evidence}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return (
    <Card className="mt-4"><CardContent className="p-5 md:p-6">
      <p className="text-sm leading-6 text-muted-foreground">{children}</p>
    </CardContent></Card>
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
}
`;

/* ════════════════════════════════════════════════════════════════════════ */
export default function BusinessReportView({ token, initial }: { token: string; initial?: BusinessReportPayload | null }) {
  const [payload, setPayload] = useState<BusinessReportPayload | null>(initial ?? null);
  const [loadError, setLoadError] = useState("");
  const [timedOut, setTimedOut] = useState(false);

  /* Purchase conversion for the marketing stack: fires once per report token
     when the paid report lands (the success_url Stripe returns to). */
  useEffect(() => {
    if (payload?.status === "ready") trackAuditPurchase(token, 330);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.status]);

  useEffect(() => {
    if (initial && (initial.status === "ready" || initial.status === "failed")) return;
    let alive = true;
    let tries = 0;
    const poll = async () => {
      try {
        const r = await fetch(`/api/audit/business/report?token=${encodeURIComponent(token)}`);
        const data = (await r.json()) as BusinessReportPayload;
        if (!alive) return;
        if (data.ok) {
          setPayload(data);
          if (data.status === "ready" || data.status === "failed") return;
        } else {
          setLoadError(data.message || data.error || "Report not found — check your link.");
          return;
        }
      } catch {
        /* retry */
      }
      tries++;
      if (alive && tries < MAX_POLLS) setTimeout(poll, POLL_MS);
      else if (alive) setTimedOut(true);
    };
    if (!initial || initial.status === "generating") poll();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl py-10 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Hmm.</h1>
        <p className="mt-3 text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  const status = payload?.status;
  const report = payload?.status === "ready" ? payload.report : undefined;

  /* ── FAILED: honest buyer message from the server ── */
  if (status === "failed") {
    return (
      <div className="mx-auto max-w-2xl py-10 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold text-foreground md:text-3xl">Your report hit a snag</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          {payload?.buyer_message || "Building your audit hit a snag on our side — we're on it, and your report will be ready shortly. Nothing was lost; your purchase is safe."}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">We'll email you the permanent link as soon as it's ready.</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-2xl py-10 text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold text-foreground md:text-3xl">
          {timedOut ? "Still working on it…" : "Building your audit report…"}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          {timedOut
            ? "This is taking longer than usual. Your report is still being written — we'll email you the permanent link as soon as it's ready."
            : "Our AI is analyzing your site and writing your professional evaluation. This usually takes a few minutes — it's also being emailed to you."}
        </p>
        {!timedOut && (
          <p className="mt-3 text-xs text-muted-foreground">Status: {status || "starting"} · auto-refreshing</p>
        )}
      </div>
    );
  }

  /* ── READY: the visual report ── */
  const businessName = payload?.business_name;
  const url = payload?.url;
  const host = hostnameOf(url);
  const dateStr = formatDate(payload?.paid_at || payload?.created_at);
  const leaks = report.money_leaks || [];
  const flaws = report.flaws || [];
  const suggestions = report.suggestions || [];
  const fixes = report.prioritized_fixes || [];
  const aiOps = report.ai_opportunities || [];
  const score = typeof report.score === "number" ? report.score : null;
  const gating = report.gating_summary;

  return (
    <>
      <style>{PRINT_CSS}</style>

      {/* ── COVER ── */}
      <div className="report-cover overflow-hidden rounded-3xl bg-[#0B1B33] text-white shadow-2xl">
        <div className="flex flex-col items-center gap-8 p-8 md:flex-row md:justify-between md:p-12">
          <div className="text-center md:text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">MehyarSoft · Audit My Business</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              {businessName || host || "Your business audit"}
            </h1>
            {host && <p className="mt-3 text-lg text-slate-200">{host}</p>}
            {report.business_type_label && (
              <p className="mt-2 text-sm text-slate-300">{report.business_type_label}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-slate-300 md:justify-start">
              {dateStr && <span>Prepared {dateStr}</span>}
            </div>
            <div className="no-print mt-8 flex flex-wrap justify-center gap-3 md:justify-start">
              <Button onClick={() => window.print()} variant="cta" size="lg" className="bg-[#F59E0B] text-[#0B1B33] hover:bg-amber-400">
                <Printer className="mr-2 h-5 w-5" aria-hidden="true" /> Download / Print PDF
              </Button>
            </div>
          </div>
          {score != null ? (
            <div className="shrink-0">
              <ScoreDial score={score} />
              <p className="mt-3 text-center text-xs uppercase tracking-widest text-slate-400">
                Overall score{report.grade ? ` · Grade ${report.grade}` : ""}
              </p>
              {report.score_rationale && <p className="mx-auto mt-2 max-w-[240px] text-center text-xs leading-5 text-slate-300">{report.score_rationale}</p>}
            </div>
          ) : (
            <div className="shrink-0 rounded-2xl border border-white/15 p-6 text-center">
              <EyeOff className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
              <p className="mt-2 max-w-[220px] text-sm text-slate-300">Score couldn't be assessed — see the notes below.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── EXECUTIVE SUMMARY ── */}
      <div className="avoid-break mt-10">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
          <Sparkles className="h-6 w-6 text-[#F59E0B]" aria-hidden="true" /> Executive summary
        </h2>
        {report.executive_summary ? (
          <Card className="mt-4"><CardContent className="p-5 md:p-6">
            <p className="text-base leading-7 text-foreground">{report.executive_summary}</p>
          </CardContent></Card>
        ) : (
          <EmptySection>Executive summary couldn't be assessed for this audit.</EmptySection>
        )}
      </div>

      {/* ── THE ONE THING ── */}
      {report.one_thing && (
        <div className="avoid-break mt-10">
          <Card className="border-2 border-[#F59E0B]/60"><CardContent className="p-5 md:p-6">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-[#0B1B33] dark:text-foreground">
              <Target className="h-6 w-6 text-[#F59E0B]" aria-hidden="true" /> If you do one thing
            </h2>
            <p className="mt-2 text-base leading-7 text-foreground">{report.one_thing}</p>
          </CardContent></Card>
        </div>
      )}

      {/* ── MONEY LEAKS ── */}
      <div className="report-print-section mt-10">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
          <TrendingDown className="h-6 w-6 text-[#DC2626]" aria-hidden="true" /> Money leaks — ranked
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          What's quietly costing you money, ordered by estimated impact. Findings marked
          "Needs review" are lower-confidence calls — treat them as leads, not verdicts.
          Money figures are estimates, not guarantees.
        </p>
        {leaks.length > 0 ? (
          <div className="mt-4 space-y-4">
            {leaks.map((l, i) => <FindingCard key={i} f={l} index={i} tone="leak" />)}
          </div>
        ) : (
          <EmptySection>Money leaks couldn't be assessed — the audit didn't find measurable leak signals on the pages it could reach.</EmptySection>
        )}
      </div>

      {/* ── FLAWS ── */}
      <div className="report-print-section mt-10">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
          <FileText className="h-6 w-6 text-[#0B1B33] dark:text-sky-300" aria-hidden="true" /> Flaws
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Messaging, trust, and conversion-path flaws found on your public site.</p>
        {flaws.length > 0 ? (
          <div className="mt-4 space-y-4">
            {flaws.map((f, i) => <FindingCard key={i} f={f} index={i} tone="flaw" />)}
          </div>
        ) : (
          <EmptySection>Flaws couldn't be assessed — nothing conclusive was found on the pages the audit could reach.</EmptySection>
        )}
      </div>

      {/* ── SUGGESTIONS ── */}
      {suggestions.length > 0 && (
        <div className="report-print-section mt-10">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
            <CheckCircle2 className="h-6 w-6 text-[#10B981]" aria-hidden="true" /> Suggestions
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">Quick improvements worth making.</p>
          <div className="mt-4 space-y-4">
            {suggestions.map((f, i) => <FindingCard key={i} f={f} index={i} tone="flaw" />)}
          </div>
        </div>
      )}

      {/* ── PRIORITIZED FIXES ── */}
      <div className="report-print-section mt-10">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
          <ListChecks className="h-6 w-6 text-[#0B1B33] dark:text-sky-300" aria-hidden="true" /> Prioritized fixes
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">What to do first, second, third — in the order that matters.</p>
        {fixes.length > 0 ? (
          <div className="mt-4 space-y-4">
            {fixes.map((fx, i) => (
              <Card key={i} className="avoid-break"><CardContent className="p-5 md:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0B1B33] text-sm font-bold text-white" aria-hidden="true">{i + 1}</span>
                    {fx.title}
                  </p>
                  {needsReview(fx) && <NeedsReviewBadge />}
                </div>
                {fx.detail && <p className="mt-2 text-sm leading-6 text-muted-foreground">{fx.detail}</p>}
                {fx.effort && <p className="mt-1 text-sm text-muted-foreground"><strong className="text-foreground">Effort:</strong> {fx.effort}</p>}
                {fx.evidence && <p className="mt-1 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Evidence:</strong> {fx.evidence}</p>}
              </CardContent></Card>
            ))}
          </div>
        ) : (
          <EmptySection>Prioritized fixes couldn't be assessed for this audit.</EmptySection>
        )}
      </div>

      {/* ── AI OPPORTUNITIES ── */}
      <div className="report-print-section mt-10">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
          <Bot className="h-6 w-6 text-[#10B981]" aria-hidden="true" /> Where AI fits in your business
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Concrete opportunities — not hype. Each one names the area and the actual fit.</p>
        {aiOps.length > 0 ? (
          <div className="mt-4 space-y-4">
            {aiOps.map((o, i) => <FindingCard key={i} f={o} index={i} tone="ai" />)}
          </div>
        ) : (
          <EmptySection>AI opportunities couldn't be assessed — the audit didn't see enough of your operations to name concrete fits.</EmptySection>
        )}
      </div>

      {/* ── WALKTHROUGH DEEP-DIVE (always present when ready) ── */}
      <div className="report-print-section mt-10">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#0B1B33] dark:text-foreground">
          <Video className="h-6 w-6 text-[#0B1B33] dark:text-sky-300" aria-hidden="true" /> Walkthrough deep-dive
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">What the AI took from your CEO walkthrough video.</p>
        {report.video_section ? (
          <Card className="mt-4"><CardContent className="p-5 md:p-6">
            <p className="text-sm leading-7 text-foreground">{report.video_section}</p>
          </CardContent></Card>
        ) : (
          <EmptySection>Walkthrough deep-dive couldn't be assessed.</EmptySection>
        )}
      </div>

      {/* ── METHODOLOGY ── */}
      {(report.methodology || report.coverage_note) && (
        <div className="report-print-section mt-10">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-[#0B1B33] dark:text-foreground">
            <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> How this audit was built
          </h2>
          <Card className="mt-4"><CardContent className="space-y-3 p-5 md:p-6">
            {report.coverage_note && <p className="text-sm leading-6 text-muted-foreground">{report.coverage_note}</p>}
            {report.methodology && <p className="text-sm leading-6 text-muted-foreground">{report.methodology}</p>}
            {gating && (
              <p className="text-sm leading-6 text-muted-foreground">
                Confidence check: {gating.auto ?? 0} finding{(gating.auto ?? 0) === 1 ? "" : "s"} verified automatically
                {typeof gating.needs_review === "number" && gating.needs_review > 0
                  ? `, ${gating.needs_review} marked Needs Review`
                  : ""}
                {!gating.decide_ok && " (the automated confidence check was unavailable for this run)"}.
              </p>
            )}
          </CardContent></Card>
        </div>
      )}

      {/* ── BOTTOM ── */}
      <div className="no-print mt-12 flex flex-col items-center gap-3 rounded-3xl bg-[#0B1B33] p-8 text-center text-white">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" aria-hidden="true" />
        <p className="text-lg font-semibold">Your audit is yours to keep</p>
        <p className="max-w-md text-sm text-slate-300">Download it as a PDF for your files, your team, or your next agency conversation.</p>
        <Button onClick={() => window.print()} variant="cta" size="lg" className="mt-2 bg-[#F59E0B] text-[#0B1B33] hover:bg-amber-400">
          <Printer className="mr-2 h-5 w-5" aria-hidden="true" /> Download / Print PDF
        </Button>
        <p className="mt-2 text-xs text-slate-400">Prepared by MehyarSoft · {dateStr || "today"}{host ? ` · ${host}` : ""}</p>
      </div>
    </>
  );
}
