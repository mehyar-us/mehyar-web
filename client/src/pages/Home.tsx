import AuditWidget from "@/components/AuditWidget";
import AIPipelinesSection from "@/components/AIPipelinesSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import { ArrowRight, FileText, ScanSearch, Sparkles, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import HomeCtaSection from "@/components/HomeCtaSection";

export default function Home() {
  return (
    <>
      {/* ── HERO: the product IS the homepage ── */}
      <section className="overflow-hidden bg-background px-4 pb-8 pt-20 sm:pt-24">
        <div className="site-shell py-8 sm:py-10">
          <p className="site-eyebrow mx-auto mb-4 flex w-fit items-center gap-3">
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
            Free AI website audit
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
          </p>
          <h1 className="site-display mx-auto max-w-5xl text-center text-balance">Is your website leaking money?</h1>
          <p className="site-lede mx-auto mt-5 max-w-3xl text-center text-balance">
            Drop in your URL. Our AI tears your site apart like a buyer would — every leak priced in dollars — then shows you the AI systems that can multiply your output up to <strong>5x</strong>. Free, 60 seconds.
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
              { icon: Sparkles, title: "2. See your AI upside", desc: "Get the AI pipelines built for your industry — voice agents, scheduling, document scanning — with honest 5x math." },
              { icon: FileText, title: "3. Go deep for $5", desc: "The full 25-page evaluation: every page graded, competitor gaps, 90-day plan. Less than a coffee." },
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
      <TestimonialsSection />

      {/* ── $5 REPORT BANNER ── */}
      <section className="px-4 pb-16 md:pb-24">
        <div className="site-shell">
          <div className="mx-auto max-w-4xl rounded-3xl bg-slate-950 p-8 text-center text-white md:p-12 dark:bg-card dark:text-foreground dark:border dark:border-border">
            <p className="site-eyebrow !text-slate-300 dark:!text-muted-foreground">The full evaluation</p>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl text-balance">
              25 pages. Every leak priced. Your 5x AI blueprint.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-300 dark:text-muted-foreground">
              The free audit is the trailer. The $5 full report is the movie — written for your site, your industry, your numbers.
            </p>
            <ul className="mx-auto mt-6 grid max-w-2xl gap-2 text-left text-sm text-slate-200 dark:text-muted-foreground sm:grid-cols-2">
              {["Page-by-page grades (A–F)", "Competitor gap analysis", "500% AI upside math", "90-day revenue plan"].map((f) => (
                <li key={f} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{f}</li>
              ))}
            </ul>
            <Link href="/audit" className={buttonVariants({ variant: "cta", size: "lg", className: "mt-8 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" })}>
              Start with the free audit <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── AGENCY CTA (kept, deprioritized) ── */}
      <HomeCtaSection />
    </>
  );
}
