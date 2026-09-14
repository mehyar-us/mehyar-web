import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Star, TrendingDown, Bot, CalendarClock, FileText, AlertTriangle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";

type FullReport = {
  score: number;
  business_type_label?: string;
  executive_summary?: string;
  leak_map?: Array<{ area: string; severity: string; finding: string; estimated_monthly_impact: string; fix: string; effort: string }>;
  page_by_page?: Array<{ page: string; grade: string; issues: string[]; fix: string }>;
  competitor_gaps?: string[];
  ai_blueprint?: Array<{ phase: string; pipeline: string; what_it_does: string; replaces: string; estimated_cost_to_build: string; estimated_monthly_upside: string }>;
  five_hundred_percent_math?: { current_capacity?: string; ai_capacity?: string; multiplier?: string; math?: string[]; honest_caveats?: string[] };
  ninety_day_plan?: Array<{ month: string; actions: string[]; expected_outcome: string }>;
  one_thing?: string;
  upsell_note?: string;
};

function useQuery() {
  return new URLSearchParams(window.location.search);
}

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
  }, [token]);

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

  const scoreColor = (s: number) => (s >= 70 ? "text-emerald-500" : s >= 45 ? "text-amber-500" : "text-red-500");

  /* ── REPORT VIEW ── */
  if (reportId) {
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
              ? "Our AI is tearing your site apart page by page and doing the 500% math. This takes about a minute — it's also being emailed to you."
              : "Fetching your full evaluation…"}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">Status: {status || "starting"} · auto-refreshing</p>
        </div></section>
      );
    }
    const m500 = report.five_hundred_percent_math || {};
    return (
      <section className="px-4 py-16">
        <div className="site-shell max-w-4xl">
          <p className="site-eyebrow mb-4 text-center">Full AI website evaluation{report.business_type_label ? ` · ${report.business_type_label}` : ""}</p>
          <div className="text-center">
            <div className={`text-7xl font-bold tracking-tight md:text-8xl ${scoreColor(report.score)}`}>{report.score}<span className="text-3xl text-muted-foreground">/100</span></div>
            <p className="site-lede mx-auto mt-4 max-w-2xl text-balance">{report.executive_summary}</p>
          </div>

          <h2 className="mt-12 flex items-center gap-2 text-2xl font-semibold"><TrendingDown className="h-6 w-6 text-red-500" /> Leak map — every leak priced</h2>
          <div className="mt-4 space-y-4">
            {(report.leak_map || []).map((l, i) => (
              <Card key={i}><CardContent className="p-5 md:p-6">
                <p className="font-semibold">{i + 1}. {l.area} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${l.severity === "critical" ? "bg-red-100 text-red-700" : l.severity === "high" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{l.severity}</span></p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{l.finding}</p>
                <p className="mt-2 text-sm font-medium text-amber-600">💸 {l.estimated_monthly_impact}</p>
                <p className="mt-2 text-sm text-emerald-700"><strong>Fix:</strong> {l.fix} <em>({l.effort})</em></p>
              </CardContent></Card>
            ))}
          </div>

          <h2 className="mt-12 flex items-center gap-2 text-2xl font-semibold"><FileText className="h-6 w-6 text-brand-700" /> Page-by-page grades</h2>
          <div className="mt-4 space-y-4">
            {(report.page_by_page || []).map((p, i) => (
              <Card key={i}><CardContent className="p-5 md:p-6">
                <p className="font-semibold">{p.page} — <span className={p.grade === "F" || p.grade === "D" ? "text-red-500" : p.grade === "C" ? "text-amber-500" : "text-emerald-500"}>Grade {p.grade}</span></p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{(p.issues || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
                <p className="mt-2 text-sm"><strong>The one fix:</strong> {p.fix}</p>
              </CardContent></Card>
            ))}
          </div>

          <h2 className="mt-12 text-2xl font-semibold">Competitor gaps</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            {(report.competitor_gaps || []).map((g, i) => <li key={i}>{g}</li>)}
          </ul>

          <h2 className="mt-12 flex items-center gap-2 text-2xl font-semibold"><Bot className="h-6 w-6 text-brand-700" /> Your AI automation blueprint</h2>
          <div className="mt-4 space-y-4">
            {(report.ai_blueprint || []).map((b, i) => (
              <Card key={i} className="border-emerald-500/30"><CardContent className="p-5 md:p-6">
                <p className="font-semibold">🤖 {b.pipeline} <span className="ml-1 text-xs font-normal text-muted-foreground">{b.phase}</span></p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{b.what_it_does}</p>
                <p className="mt-2 text-sm text-muted-foreground"><strong>Replaces:</strong> {b.replaces}</p>
                <p className="text-sm text-muted-foreground"><strong>Build cost:</strong> {b.estimated_cost_to_build}</p>
                <p className="mt-1 text-sm font-medium text-emerald-600">📈 {b.estimated_monthly_upside}</p>
              </CardContent></Card>
            ))}
          </div>

          <div className="mt-12 rounded-3xl bg-slate-950 p-6 text-white md:p-10 dark:bg-card dark:text-foreground dark:border dark:border-border">
            <h2 className="text-2xl font-semibold">The 500% math — step by step</h2>
            <p className="mt-3 text-sm text-slate-300 dark:text-muted-foreground"><strong className="text-white dark:text-foreground">Today:</strong> {m500.current_capacity}</p>
            <p className="mt-2 text-sm text-slate-300 dark:text-muted-foreground"><strong className="text-white dark:text-foreground">With AI:</strong> {m500.ai_capacity}</p>
            <p className="mt-4 text-4xl font-bold text-emerald-400">{m500.multiplier}</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-300 dark:text-muted-foreground">
              {(m500.math || []).map((x, i) => <li key={i}>{x}</li>)}
            </ol>
            <p className="mt-4 text-xs text-slate-400 dark:text-muted-foreground"><strong>Honest caveats:</strong></p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-400 dark:text-muted-foreground">
              {(m500.honest_caveats || []).map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>

          <h2 className="mt-12 flex items-center gap-2 text-2xl font-semibold"><CalendarClock className="h-6 w-6 text-brand-700" /> Your 90-day plan</h2>
          <div className="mt-4 space-y-4">
            {(report.ninety_day_plan || []).map((p, i) => (
              <Card key={i}><CardContent className="p-5 md:p-6">
                <p className="font-semibold">{p.month}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{(p.actions || []).map((a, j) => <li key={j}>{a}</li>)}</ul>
                <p className="mt-2 text-sm text-emerald-700"><em>{p.expected_outcome}</em></p>
              </CardContent></Card>
            ))}
          </div>

          <div className="mt-12 rounded-3xl border border-brand-700/30 bg-brand-700/5 p-6 md:p-8">
            <p className="site-eyebrow">If you do only one thing</p>
            <p className="mt-2 text-xl font-semibold">{report.one_thing}</p>
            {report.upsell_note && <p className="mt-4 text-sm text-muted-foreground"><em>{report.upsell_note}</em></p>}
            <Link href="/booking" className={buttonVariants({ variant: "cta", className: "mt-6" })}>Talk it through — free 15-min call <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </div>
        </div>
      </section>
    );
  }

  /* ── PURCHASE VIEW ── */
  return (
    <section className="site-hero px-4">
      <div className="site-shell max-w-2xl text-center">
        <div className="flex items-center justify-center gap-1">
          {[...Array(5)].map((_, i) => <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />)}
        </div>
        <p className="site-eyebrow mb-4 mt-3">The full evaluation</p>
        <h1 className="site-display text-balance">25 pages. Every leak priced. Your 5x AI blueprint.</h1>
        <p className="site-lede mx-auto mt-4 max-w-xl text-balance">
          The free audit is the trailer — this is the movie. Page-by-page grades, competitor gaps, the 500% AI automation math shown step by step, and your 90-day plan. Written for <em>your</em> site.
        </p>
        <div className="mx-auto mt-6 flex items-baseline justify-center gap-2">
          <span className="text-5xl font-bold">$5</span>
          <span className="text-sm text-muted-foreground">one-time</span>
        </div>

        <Card className="mx-auto mt-8 max-w-xl border-border bg-card text-left">
          <CardContent className="p-6 md:p-8">
            <form onSubmit={buy} className="space-y-4">
              <div>
                <Label htmlFor="r-url">Website to evaluate</Label>
                <Input id="r-url" type="text" inputMode="url" required placeholder="yourbusiness.com" value={url} onChange={(e) => setUrl(e.target.value)} className="mt-2 h-12 text-base" />
              </div>
              <div>
                <Label htmlFor="r-email">Email for delivery</Label>
                <Input id="r-email" type="email" required placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 text-base" />
              </div>
              {buyError && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{buyError}</p>}
              <Button type="submit" variant="cta" size="lg" className="h-13 w-full bg-emerald-500 py-4 text-base text-emerald-950 hover:bg-emerald-400" disabled={buying}>
                {buying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting checkout…</> : <>Get my full report — $5 <ArrowRight className="ml-2 h-4 w-4" /></>}
              </Button>
              <p className="text-center text-xs text-muted-foreground">Secure checkout · Instant delivery · One-time, yours forever</p>
            </form>
          </CardContent>
        </Card>

        <div className="mx-auto mt-8 grid max-w-xl gap-3 text-left sm:grid-cols-2">
          {["Page-by-page grades (A–F)", "Competitor gap analysis", "500% AI upside math", "90-day revenue plan"].map((f) => (
            <div key={f} className="flex gap-2 rounded-xl border border-border bg-card p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-sm text-foreground">{f}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
