import AuditWidget from "@/components/AuditWidget";
import AIPipelinesSection from "@/components/AIPipelinesSection";
import { ArrowRight, FileText, ScanSearch, Sparkles, CheckCircle2, PhoneMissed } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import HomeCtaSection from "@/components/HomeCtaSection";

export default function Home() {
  return (
    <>
      {/* ── HERO: THE MAYOR (Mayor's order 2026-10-15: The Mayor is the hero) ── */}
      <section className="overflow-hidden bg-background px-4 pb-8 pt-20 sm:pt-24">
        <div className="site-shell py-8 sm:py-10">
          <img src="/assets/mayor-logo.png" alt="The Mayor" className="mx-auto h-16 w-16 rounded-3xl" />
          <p className="site-eyebrow mx-auto mb-4 mt-6 flex w-fit items-center gap-3">
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
            The Mayor · AI for your business
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
          </p>
          <h1 className="site-display mx-auto max-w-5xl text-center text-balance">Mayor. Talk to your business.</h1>
          <p className="site-lede mx-auto mt-5 max-w-3xl text-center text-balance">
            The Mayor is an AI business workspace for Main Street — it remembers your business, captures the calls you miss, and keeps customers, appointments, and playbooks in one place.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="https://mayor.mehyar.us/?utm_source=mehyar-home&utm_medium=hero&utm_campaign=mayor-hero"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "cta", size: "lg", className: "min-h-12 w-full sm:w-auto" })}
            >
              Visit The Mayor <ArrowRight className="ml-2 h-4 w-4" />
            </a>
            <a href="#free-audit" className={buttonVariants({ variant: "outline", size: "lg", className: "min-h-12 w-full sm:w-auto" })}>
              Scan your website free
            </a>
          </div>
          <p className="mt-5 text-center text-sm text-muted-foreground">Free $0 · Pro $14/month · No credit card to start</p>
          <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left text-sm sm:grid-cols-2">
            {[
              "Business memory — it knows your services, hours, and customers",
              "Missed-call voice capture answers every call you miss",
              "Appointments, customers, and playbooks in one workspace",
              "Review-gated actions — every send and booking runs on your approval",
            ].map((f) => (
              <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" /><span>{f}</span></li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── THE MAYOR: FREE MISSED-CALL CHECKLIST ── */}
      <section className="px-4 pb-12 md:pb-16">
        <div className="site-shell">
          <div className="mx-auto flex max-w-4xl flex-col gap-5 rounded-3xl border border-emerald-600/30 bg-emerald-50 p-6 dark:bg-emerald-950/20 sm:flex-row sm:items-center md:p-8">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600/15 text-emerald-800 dark:text-emerald-300">
              <PhoneMissed className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">Free from The Mayor: the Missed-Call Revenue Checklist</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Every missed call is revenue walking to a competitor. This free checklist shows where the calls slip away — and what to fix first.
              </p>
            </div>
            <a
              href="https://mayor.mehyar.us/missed-call-checklist?utm_source=mehyar-home&utm_medium=homepage&utm_campaign=mayor-checklist"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "cta", size: "lg", className: "min-h-12 w-full shrink-0 sm:w-auto" })}
            >
              Get the free checklist <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── FREE AUDIT (section 2 — the lead-in tool under the hero) ── */}
      <section id="free-audit" className="overflow-hidden bg-background px-4 py-12 md:py-16">
        <div className="site-shell">
          <p className="site-eyebrow mx-auto mb-4 flex w-fit items-center gap-3">
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
            Free AI website audit
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
          </p>
          <h2 className="site-display mx-auto max-w-5xl text-center text-balance">Is your website leaking money?</h2>
          <p className="site-lede mx-auto mt-5 max-w-3xl text-center text-balance">
            Drop in your URL. Our AI tears your site apart like a buyer would — every leak priced in dollars — then maps the AI systems that fit your business, with the capacity math shown for your numbers. Free, 60 seconds.
          </p>
          <div className="mt-8">
            <AuditWidget compact />
          </div>
          <div className="mx-auto mt-6 flex max-w-xl items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Free 60-second scan · No signup · No credit card</span>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-4 py-12 md:py-16">
        <div className="site-shell">
          <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
            {[
              { icon: ScanSearch, title: "1. Free 60-second audit", desc: "Enter your URL. AI scores your site, finds your 3 biggest money leaks, and detects your business type." },
              { icon: Sparkles, title: "2. See your AI upside", desc: "Get the AI pipelines built for your industry — voice agents, scheduling, document scanning — with the capacity math shown step by step." },
              { icon: FileText, title: "3. Go deep for $5", desc: "The complete professional evaluation: every page graded, every leak priced, your AI blueprint, 90-day plan. Less than a coffee." },
            ].map((s) => (
              <div key={s.title} className="rounded-2xl border border-border bg-card p-6">
                <s.icon className="h-7 w-7 text-brand-700" />
                <p className="mt-3 font-semibold text-foreground">{s.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI PIPELINES ── */}
      <AIPipelinesSection />

      {/* ── TESTIMONIALS ── */}

      {/* ── $5 REPORT BANNER ── */}
      <section className="px-4 pb-16 md:pb-24">
        <div className="site-shell">
          <div className="mx-auto max-w-4xl rounded-3xl bg-slate-950 p-8 text-center text-white md:p-12 dark:bg-card dark:text-foreground dark:border dark:border-border">
            <p className="site-eyebrow !text-slate-300 dark:!text-muted-foreground">The full report</p>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl text-balance">
              The complete evaluation. Every leak priced. Your AI blueprint, with the math shown.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-300 dark:text-muted-foreground">
              The free audit is the trailer. The $5 full report is the movie — written for your site, your industry, your numbers.
            </p>
            <ul className="mx-auto mt-6 grid max-w-2xl gap-2 text-left text-sm text-slate-200 dark:text-muted-foreground sm:grid-cols-2">
              {["Page-by-page grades (A–F)", "How you compare", "AI capacity math, step by step", "90-day revenue plan"].map((f) => (
                <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{f}</li>
              ))}
            </ul>
            <Link href="/audit/free" className={buttonVariants({ variant: "cta", size: "lg", className: "mt-8 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" })}>
              Start with the free audit <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── $330 DEEP AUDIT SIGNPOST ── */}
      <section className="px-4 pb-16 md:pb-24">
        <div className="site-shell">
          <div className="mx-auto max-w-4xl rounded-3xl border border-border bg-card p-8 md:p-12">
            <p className="site-eyebrow">Go deepest · Audit My Business</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-balance md:text-4xl">
              The $330 deep audit — your site, your voice, one report.
            </h2>
            <p className="site-lede mt-4 max-w-2xl">
              The free scan and $5 report read your public site. Audit My Business goes further: add a short CEO walkthrough video and the AI folds your own words — your offer, your customers, what's actually broken — into a deeper, transcript-based assessment with a prioritized fix plan.
            </p>
            <ul className="mt-6 grid max-w-3xl gap-3 text-sm sm:grid-cols-2">
              {[
                "Everything in the free scan, measured deeper",
                "Your walkthrough video transcribed and analyzed",
                "Money leaks ranked by estimated impact",
                "One prioritized fix plan — what to do first",
              ].map((f) => (
                <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" /><span>{f}</span></li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-muted-foreground">One-time $330 · No subscription</p>
            <Link href="/audit" className={buttonVariants({ variant: "cta", size: "lg", className: "mt-6 min-h-12 w-full sm:w-auto" })}>
              Get the $330 audit <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── AGENCY CTA (kept, deprioritized) ── */}
      <HomeCtaSection />
    </>
  );
}
