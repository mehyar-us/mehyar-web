import AuditWidget from "@/components/AuditWidget";
import AIPipelinesSection from "@/components/AIPipelinesSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import { ArrowRight, FileText, ScanSearch, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import HomeCtaSection from "@/components/HomeCtaSection";

const howItWorks = [
  {
    icon: ScanSearch,
    title: "1. Free 60-second scan",
    desc: "Enter your URL. AI scores your site, finds your biggest money leaks, and detects your business type. No signup.",
    href: null as string | null,
  },
  {
    icon: Sparkles,
    title: "2. See your AI upside",
    desc: "Get the AI systems built for your industry — voice agents, scheduling, document scanning — with honest math.",
    href: null as string | null,
  },
  {
    icon: FileText,
    title: "3. Go deep — $330",
    desc: "The complete AI business audit: every leak priced in dollars, flaws ranked, AI opportunities mapped. One-time, report by email.",
    href: "/audit" as string | null,
  },
];

export default function Home() {
  return (
    <>
      {/* ── HERO: two products, side by side ── */}
      <section className="overflow-hidden bg-background px-4 pb-10 pt-20 sm:pt-24">
        <div className="site-shell py-8 sm:py-10">
          <p className="site-eyebrow mx-auto mb-5 flex w-fit items-center gap-3">
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
            MehyarSoft · AI for business
            <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
          </p>
          <h1 className="site-display-serif mx-auto max-w-4xl text-center">Two ways to put AI to work.</h1>
          <p className="site-lede mx-auto mt-5 max-w-2xl text-center text-balance">
            Run your business with The Mayor, your always-on AI workspace — or get a complete
            AI audit that finds every leak and prices it in dollars.
          </p>

          <div className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-2 md:gap-6">
            {/* ── THE MAYOR ── */}
            <div className="flex flex-col rounded-3xl border border-border bg-card p-7 sm:p-9">
              <img
                src="/assets/mayor-avatar.webp"
                alt="The Mayor"
                width={96}
                height={96}
                className="h-20 w-20 rounded-full object-cover ring-2 ring-brand-700/20 sm:h-24 sm:w-24"
                loading="eager"
              />
              <p className="site-eyebrow mt-5">The Mayor</p>
              <h2 className="site-serif mt-4 text-3xl font-medium leading-[1.08] text-ink">
                Log in to The Mayor.
              </h2>
              <p className="mt-4 flex-1 text-[15px] leading-7 text-muted-foreground">
                Your AI business workspace — it remembers your business, answers the calls
                you miss, and keeps customers, appointments, and playbooks in one place.
              </p>
              <p className="mt-5 text-sm font-medium text-foreground">Free to start · Pro $14/month</p>
              <a
                href="https://mayor.mehyar.us"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "lg", className: "mt-5 min-h-12 w-full" })}
              >
                Log in to The Mayor <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </div>

            {/* ── AUDIT MY BUSINESS ── */}
            <div className="flex flex-col rounded-3xl border border-border bg-card p-7 sm:p-9">
              <img
                src="/assets/audit-my-business-logo.png"
                alt="Audit My Business"
                width={96}
                height={96}
                className="h-20 w-20 rounded-full object-cover ring-2 ring-brand-700/20 sm:h-24 sm:w-24"
                loading="eager"
              />
              <p className="site-eyebrow mt-5">Audit My Business</p>
              <h2 className="site-serif mt-4 text-3xl font-medium leading-[1.08] text-ink">
                A complete AI audit, priced in dollars.
              </h2>
              <p className="mt-4 flex-1 text-[15px] leading-7 text-muted-foreground">
                Every money leak found and priced, every flaw ranked, plus the AI opportunities
                hiding in your operation. Delivered as a visual report.
              </p>
              <p className="mt-5 text-sm font-medium text-foreground">One-time $330 · No subscription</p>
              <Link
                href="/audit"
                className={buttonVariants({ variant: "cta", size: "lg", className: "mt-5 min-h-12 w-full" })}
              >
                Get my audit — $330 <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FREE SCAN STRIP: the lead magnet ── */}
      <section className="border-y border-border bg-muted/25 px-4 py-10 md:py-12">
        <div className="site-shell">
          <p className="site-eyebrow mb-3 text-center">Start free</p>
          <h2 className="site-serif mx-auto max-w-2xl text-center text-2xl font-medium text-ink md:text-3xl">
            Curious first? Run the free 60-second scan.
          </h2>
          <div className="mx-auto mt-6 max-w-xl">
            <AuditWidget compact />
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Free 60-second scan · No signup · No credit card
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-4 py-12 md:py-16">
        <div className="site-shell">
          <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
            {howItWorks.map((s) => {
              const body = (
                <>
                  <s.icon className="h-7 w-7 text-brand-700" />
                  <p className="mt-3 font-semibold text-foreground">{s.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.desc}</p>
                  {s.href && (
                    <span className="mt-4 inline-flex items-center text-sm font-semibold text-brand-700">
                      Get the audit <ArrowRight className="ml-1 h-4 w-4" />
                    </span>
                  )}
                </>
              );
              return s.href ? (
                <Link
                  key={s.title}
                  href={s.href}
                  className="block rounded-2xl border border-border bg-card p-6 transition-colors hover:border-brand-700/40"
                >
                  {body}
                </Link>
              ) : (
                <div key={s.title} className="rounded-2xl border border-border bg-card p-6">
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── AI PIPELINES ── */}
      <AIPipelinesSection />

      {/* ── TESTIMONIALS ── */}
      <TestimonialsSection />

      {/* ── AGENCY CTA (kept, deprioritized) ── */}
      <HomeCtaSection />
    </>
  );
}
