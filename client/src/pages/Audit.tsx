import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Loader2, Lock, Search, TrendingDown, Zap, CalendarClock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Leak = { title: string; what: string; money: string };
type Report = {
  score: number;
  verdict: string;
  leaks: Leak[];
  quick_wins: string[];
  deep_audit_hooks: string[];
};

type Phase = "form" | "scanning" | "done" | "error";

const SCAN_STEPS = ["Fetching your homepage…", "Reading headlines, CTAs & trust signals…", "AI revenue analysis…", "Pricing your leaks…"];

export default function Audit() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [stepIdx, setStepIdx] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  const runScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPhase("scanning");
    setStepIdx(0);
    const timer = window.setInterval(() => setStepIdx((i) => Math.min(i + 1, SCAN_STEPS.length - 1)), 4000);
    try {
      const r = await fetch("/api/audit/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, email, name, business }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || "Scan failed. Check the URL and try again.");
      setReport(data.report);
      setPhase("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setPhase("error");
    } finally {
      window.clearInterval(timer);
    }
  };

  const scoreColor = (s: number) => (s >= 70 ? "text-emerald-500" : s >= 45 ? "text-amber-500" : "text-red-500");

  return (
    <>
      {/* ── HERO / FORM ─────────────────────────────── */}
      {phase !== "done" && (
        <section className="site-hero px-4">
          <div className="site-shell max-w-3xl text-center">
            <p className="site-eyebrow mb-4">Free AI website audit</p>
            <h1 className="site-display text-balance">Is your website leaking money?</h1>
            <p className="site-lede mx-auto mt-4 max-w-2xl text-balance">
              Our AI scans your site like a buyer would — and shows you exactly where customers slip away, with dollar estimates. Free, 60 seconds, no account.
            </p>

            <Card className="mx-auto mt-8 max-w-2xl border-border bg-card text-left shadow-[0_24px_80px_rgba(8,63,84,0.10)]">
              <CardContent className="p-6 md:p-8">
                {phase === "scanning" ? (
                  <div className="py-8 text-center">
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
                    <p className="mt-4 text-lg font-semibold text-foreground">{SCAN_STEPS[stepIdx]}</p>
                    <p className="mt-2 text-sm text-muted-foreground">Analyzing {url || "your site"}…</p>
                  </div>
                ) : (
                  <form onSubmit={runScan} className="space-y-4">
                    <div>
                      <Label htmlFor="audit-url">Your website</Label>
                      <div className="relative mt-2">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input id="audit-url" type="text" inputMode="url" required placeholder="yourbusiness.com" value={url} onChange={(e) => setUrl(e.target.value)} className="pl-10 h-12 text-base" />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="audit-email">Work email <span className="text-muted-foreground">(we send your report here)</span></Label>
                      <Input id="audit-email" type="email" required placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 text-base" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="audit-name">Your name <span className="text-muted-foreground">(optional)</span></Label>
                        <Input id="audit-name" type="text" placeholder="Jane" value={name} onChange={(e) => setName(e.target.value)} className="mt-2 h-12" />
                      </div>
                      <div>
                        <Label htmlFor="audit-biz">Business <span className="text-muted-foreground">(optional)</span></Label>
                        <Input id="audit-biz" type="text" placeholder="Jane's Plumbing" value={business} onChange={(e) => setBusiness(e.target.value)} className="mt-2 h-12" />
                      </div>
                    </div>
                    {phase === "error" && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
                    <Button type="submit" variant="cta" size="lg" className="h-13 w-full py-4 text-base">
                      Run my free audit <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" /> No account. No card. We only email your report + useful follow-ups.
                    </p>
                  </form>
                )}
              </CardContent>
            </Card>

            <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
              {[["60-second scan", "Score + 3 money leaks, priced in dollars."], ["Plain English", "No jargon. Built for owners, not developers."], ["Private", "Your report goes to your inbox only."]].map(([t, d]) => (
                <div key={t} className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm font-semibold text-foreground">{t}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── RESULT ──────────────────────────────────── */}
      {phase === "done" && report && (
        <section className="site-hero px-4">
          <div className="site-shell max-w-3xl">
            <p className="site-eyebrow mb-4 text-center">Your free audit</p>
            <div className="text-center">
              <div className={`text-7xl font-bold tracking-tight md:text-8xl ${scoreColor(report.score)}`}>{report.score}<span className="text-3xl text-muted-foreground">/100</span></div>
              <p className="site-lede mx-auto mt-3 max-w-xl text-balance">“{report.verdict}”</p>
              <p className="mt-2 text-sm text-muted-foreground">Full report sent to {email} ✓</p>
            </div>

            <h2 className="mt-10 flex items-center gap-2 text-xl font-semibold text-foreground"><TrendingDown className="h-5 w-5 text-red-500" /> Where you're leaking money</h2>
            <div className="mt-4 space-y-4">
              {report.leaks.map((l, i) => (
                <Card key={i} className="border-border bg-card">
                  <CardContent className="p-5 md:p-6">
                    <p className="font-semibold text-foreground">{i + 1}. {l.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{l.what}</p>
                    <p className="mt-2 text-sm font-medium text-amber-600 dark:text-amber-400">💸 {l.money}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <h2 className="mt-10 flex items-center gap-2 text-xl font-semibold text-foreground"><Zap className="h-5 w-5 text-amber-500" /> 3 quick wins</h2>
            <div className="mt-4 space-y-2">
              {report.quick_wins.map((w, i) => (
                <div key={i} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                  <p className="text-sm leading-6 text-muted-foreground">{w}</p>
                </div>
              ))}
            </div>

            {/* ── PAID TIERS ── */}
            <div className="mt-12 rounded-3xl bg-slate-950 p-6 text-white md:p-10 dark:bg-card dark:text-foreground dark:border dark:border-border">
              <p className="site-eyebrow !text-slate-300 dark:!text-muted-foreground">Go deeper</p>
              <h2 className="mt-2 text-2xl font-semibold md:text-3xl">Want every leak priced, page by page?</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 dark:text-muted-foreground">
                The Deep AI Audit crawls your whole site, benchmarks your top competitor, and hands you a 30-day fix plan ordered by revenue impact.
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/15 p-5 dark:border-border">
                  <p className="text-sm font-semibold uppercase tracking-wider text-slate-300 dark:text-muted-foreground">Deep AI Audit</p>
                  <p className="mt-2 text-3xl font-bold">$199</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-muted-foreground">One-time · 3–5 days</p>
                  <Link href="/billing/checkout?service=deep-audit-199" className={buttonVariants({ variant: "cta", className: "mt-4 w-full" })}>Get the deep audit</Link>
                </div>
                <div className="rounded-2xl border border-white/15 p-5 dark:border-border">
                  <p className="text-sm font-semibold uppercase tracking-wider text-slate-300 dark:text-muted-foreground">Tech Audit</p>
                  <p className="mt-2 text-3xl font-bold">$330</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-muted-foreground">Founder-led · 3–5 days</p>
                  <Link href="/billing/checkout?service=tech-audit-330" className={buttonVariants({ variant: "outline", className: "mt-4 w-full !border-white/25 !text-white dark:!border-border dark:!text-foreground" })}>Book tech audit</Link>
                </div>
                <div className="rounded-2xl border border-white/15 p-5 dark:border-border">
                  <p className="text-sm font-semibold uppercase tracking-wider text-slate-300 dark:text-muted-foreground">Talk it through</p>
                  <p className="mt-2 text-3xl font-bold">Free</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-muted-foreground">15-min call</p>
                  <Link href="/booking" className={buttonVariants({ variant: "outline", className: "mt-4 w-full !border-white/25 !text-white dark:!border-border dark:!text-foreground" })}><CalendarClock className="mr-2 h-4 w-4" /> Book a call</Link>
                </div>
              </div>
            </div>

            <div className="mt-8 text-center">
              <button onClick={() => { setPhase("form"); setReport(null); }} className="text-sm text-muted-foreground underline underline-offset-4">Scan another site</button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
