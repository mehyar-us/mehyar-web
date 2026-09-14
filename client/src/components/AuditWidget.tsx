import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Loader2, Lock, Search, TrendingDown, Zap, Bot } from "lucide-react";
import ReportPreview from "@/components/ReportPreview";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const TURNSTILE_SITE_KEY = "0x4AAAAAAE0BuD-W_-t-zuK8";

type Leak = { title: string; what: string; money: string };
type Pipeline = { name: string; what: string; upside: string };
type Report = {
  business_type?: string;
  business_type_label?: string;
  score: number;
  verdict: string;
  leaks: Leak[];
  quick_wins: string[];
  ai_pipelines?: Pipeline[];
  full_report_hooks?: string[];
  deep_audit_hooks?: string[];
};

type Phase = "form" | "scanning" | "done" | "error";

const SCAN_STEPS = [
  "Fetching your homepage…",
  "Detecting your business type…",
  "AI revenue analysis — criticizing every bit…",
  "Pricing your leaks + mapping your AI upside…",
];

export default function AuditWidget({ compact = false }: { compact?: boolean }) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [stepIdx, setStepIdx] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileBoxRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  // Explicit Turnstile render — implicit auto-render (.cf-turnstile) never fires
  // in a React SPA because the widget mounts after the script's initial scan.
  useEffect(() => {
    let cancelled = false;
    const doRender = () => {
      if (cancelled || !window.turnstile?.render || !turnstileBoxRef.current || turnstileWidgetId.current) return;
      turnstileWidgetId.current = window.turnstile.render(turnstileBoxRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "auto",
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    };
    if (window.turnstile?.render) {
      doRender();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
      const script = existing ?? document.createElement("script");
      const onLoad = () => doRender();
      script.addEventListener("load", onLoad);
      if (!existing) {
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      return () => {
        cancelled = true;
        script.removeEventListener("load", onLoad);
      };
    }
    return () => { cancelled = true; };
  }, []);

  const resetTurnstile = () => {
    setTurnstileToken("");
    if (turnstileWidgetId.current && window.turnstile?.reset) {
      window.turnstile.reset(turnstileWidgetId.current);
    }
  };

  const runScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPhase("scanning");
    setStepIdx(0);
    const timer = window.setInterval(() => setStepIdx((i) => Math.min(i + 1, SCAN_STEPS.length - 1)), 4500);
    try {
      const r = await fetch("/api/audit/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, email, phone, zip, turnstileToken }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.message || data.error || "Scan failed. Check the URL and try again.");
      setReport(data.report);
      setPhase("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
      setPhase("error");
      resetTurnstile();
    } finally {
      window.clearInterval(timer);
    }
  };

  const scoreColor = (s: number) => (s >= 70 ? "text-emerald-500" : s >= 45 ? "text-amber-500" : "text-red-500");

  if (phase === "done" && report) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="site-eyebrow mb-4 text-center">Your free audit{report.business_type_label ? ` · ${report.business_type_label}` : ""}</p>
        <div className="text-center">
          <div className={`text-7xl font-bold tracking-tight md:text-8xl ${scoreColor(report.score)}`}>
            {report.score}<span className="text-3xl text-muted-foreground">/100</span>
          </div>
          <p className="site-lede mx-auto mt-3 max-w-xl text-balance">"{report.verdict}"</p>
          <p className="mt-2 text-sm text-muted-foreground">Full report sent to {email} ✓</p>
        </div>

        <h2 className="mt-10 flex items-center gap-2 text-xl font-semibold text-foreground">
          <TrendingDown className="h-5 w-5 text-red-500" /> Where you're leaking money
        </h2>
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

        <h2 className="mt-10 flex items-center gap-2 text-xl font-semibold text-foreground">
          <Zap className="h-5 w-5 text-amber-500" /> 3 quick wins
        </h2>
        <div className="mt-4 space-y-2">
          {report.quick_wins.map((w, i) => (
            <div key={i} className="flex gap-3 rounded-xl border border-border bg-card p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <p className="text-sm leading-6 text-muted-foreground">{w}</p>
            </div>
          ))}
        </div>

        {report.ai_pipelines && report.ai_pipelines.length > 0 && (
          <>
            <h2 className="mt-10 flex items-center gap-2 text-xl font-semibold text-foreground">
              <Bot className="h-5 w-5 text-brand-700" /> Your AI upside — up to 5x capacity
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              AI doesn't just fix your site — it multiplies what your business can handle without hiring.
            </p>
            <div className="mt-4 space-y-4">
              {report.ai_pipelines.map((p, i) => (
                <Card key={i} className="border-brand-700/30 bg-card">
                  <CardContent className="p-5 md:p-6">
                    <p className="font-semibold text-foreground">🤖 {p.name}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{p.what}</p>
                    <p className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">📈 {p.upside}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* ── $5 UPSELL ── */}
        <div className="mt-12 overflow-hidden rounded-3xl bg-[#0B1B33] p-6 text-white md:p-10 dark:border dark:border-border">
          <div className="flex flex-col gap-8 md:flex-row md:items-center">
            <ReportPreview className="mx-auto w-full max-w-[240px] shrink-0 rotate-[-2deg] md:mx-0" />
            <div className="min-w-0">
              <span className="text-xs text-sky-300">The free audit is the trailer — this is the movie</span>
              <h2 className="mt-3 text-2xl font-semibold md:text-3xl">Get the complete professional evaluation — just $5</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                Every page graded. How you compare. The 500% AI automation blueprint with the math shown step by step. Your 90-day plan. Written for YOUR site, delivered as a beautiful PDF.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate-200">
                {["The complete evaluation, written for YOUR site", "The 500% upside math — capacity before vs after AI", "AI automation blueprint tailored to your business type", "90-day action plan ordered by revenue impact"].map((f) => (
                  <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{f}</li>
                ))}
              </ul>
              <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <Link href={`/audit/report?email=${encodeURIComponent(email)}&url=${encodeURIComponent(url)}`} className={buttonVariants({ variant: "cta", size: "lg", className: "bg-[#F59E0B] text-[#0B1B33] hover:bg-amber-400" })}>
                  Get my full report — $5 <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <span className="text-xs text-slate-400">One-time · Instant delivery · Less than a coffee</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <button onClick={() => { setPhase("form"); setReport(null); }} className="text-sm text-muted-foreground underline underline-offset-4">Scan another site</button>
        </div>
      </div>
    );
  }

  return (
    <Card className={`mx-auto ${compact ? "max-w-xl" : "max-w-2xl"} border-border bg-card text-left shadow-[0_24px_80px_rgba(8,63,84,0.10)]`}>
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
              <Label htmlFor="aw-url">Your website</Label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="aw-url" name="website" type="text" inputMode="url" autoComplete="url" required placeholder="yourbusiness.com" value={url} onChange={(e) => setUrl(e.target.value)} className="pl-10 h-12 text-base" />
              </div>
            </div>
            <div>
              <Label htmlFor="aw-email">Email <span className="text-muted-foreground">(your free report lands here)</span></Label>
              <Input id="aw-email" name="email" type="email" autoComplete="email" required placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 text-base" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="aw-phone">Phone <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="aw-phone" name="tel" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2 h-12 text-base" />
              </div>
              <div>
                <Label htmlFor="aw-zip">ZIP <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="aw-zip" name="postal-code" type="text" inputMode="numeric" autoComplete="postal-code" placeholder="11209" value={zip} onChange={(e) => setZip(e.target.value)} className="mt-2 h-12 text-base" />
              </div>
            </div>
            {phase === "error" && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
            <div ref={turnstileBoxRef} className="flex justify-center" />
            <Button type="submit" variant="cta" size="lg" className="h-13 w-full py-4 text-base">
              Run my free audit <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Free forever. No card. Your report + the 500% AI blueprint preview.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
