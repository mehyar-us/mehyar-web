import {
  ArrowRight,
  CheckCircle2,
  MailCheck,
  MessageSquareText,
  PhoneCall,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Link } from "wouter";
import type { IndustryOffer } from "@/data/industry-offers";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const levelIcons = [Smartphone, MessageSquareText, PhoneCall];

export default function IndustrySalesDeck({ industry }: { industry: IndustryOffer }) {
  return (
    <section className="bg-muted/35 px-4 py-12 md:py-20" aria-label={`${industry.shortName} services, pricing, and example`}>
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Services and starting prices</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Choose how much help you want.</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">Start with the website. Add AI texting when you are busy. Choose the full system when you want phone coverage and social content too.</p>
        </div>

        {industry.complianceNote ? (
          <div className="mx-auto mt-7 flex max-w-4xl gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />{industry.complianceNote}
          </div>
        ) : null}

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {industry.packages.map((pkg, index) => {
            const Icon = levelIcons[index];
            const href = `/contact?service=industry_package&industry=${encodeURIComponent(industry.shortName)}&offer=${encodeURIComponent(pkg.name)}`;
            return (
              <article key={pkg.name} className={cn("flex h-full flex-col rounded-[1.5rem] border p-5 shadow-sm md:p-6", pkg.featured ? "border-brand-700 bg-brand-950 text-white shadow-[0_18px_45px_rgba(8,63,84,0.18)]" : "border-border bg-card")}>
                <div className="flex items-start justify-between gap-4">
                  <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", pkg.featured ? "bg-white/10 text-brand-100" : "bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100")}><Icon className="h-5 w-5" /></span>
                  <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", pkg.featured ? "bg-brand-100 text-brand-950" : "bg-muted text-muted-foreground")}>Level {index + 1}{pkg.featured ? " · Most popular" : ""}</span>
                </div>
                <h3 className={cn("mt-5 text-2xl font-semibold tracking-[-0.03em]", pkg.featured ? "text-white" : "text-ink dark:text-white")}>{pkg.name}</h3>
                <p className={cn("mt-3 text-sm leading-6", pkg.featured ? "text-white/75" : "text-muted-foreground")}>{pkg.plainSummary}</p>
                <div className={cn("mt-5 rounded-2xl border p-4", pkg.featured ? "border-white/15 bg-white/[0.06]" : "border-border bg-background")}>
                  <p className="text-2xl font-semibold tracking-[-0.03em]">{pkg.price}</p>
                  <p className={cn("mt-1 text-sm", pkg.featured ? "text-white/70" : "text-muted-foreground")}>{pkg.cadence}</p>
                </div>
                <p className={cn("mt-5 text-sm leading-6", pkg.featured ? "text-white/75" : "text-muted-foreground")}><strong className={pkg.featured ? "text-white" : "text-foreground"}>Best for:</strong> {pkg.bestFor}</p>
                <div className="mt-5 border-t border-current/10 pt-5">
                  <p className="text-sm font-semibold">What this includes</p>
                  <ul className={cn("mt-3 space-y-3 text-sm leading-6", pkg.featured ? "text-white/75" : "text-muted-foreground")}>
                    {[...pkg.customerCan, ...pkg.ownerGets].map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />{item}</li>)}
                  </ul>
                </div>
                <Link href={href} className={buttonVariants({ variant: pkg.featured ? "secondary" : "outline", className: "mt-6 w-full" })}>Ask about Level {index + 1}<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </article>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
          <strong className="text-foreground">What the prices mean:</strong> setup is the one-time build price. The monthly price covers the listed ongoing service. Text messages, call minutes, AI generation, ad spend, third-party subscriptions, large data moves, and custom connections are confirmed in writing before work starts. Instagram and TikTok publishing depends on account access and platform approval.
        </div>

        <div className="mt-12 overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm">
          <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
            <div className="relative min-h-72 overflow-hidden lg:min-h-full">
              <img src={industry.heroImage} alt={`${industry.shortName} customer experience example`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-950/75 to-transparent lg:bg-gradient-to-r" />
              <p className="absolute bottom-5 left-5 right-5 text-sm font-medium leading-6 text-white">Concept example—not an invented client result.</p>
            </div>
            <div className="p-6 md:p-9">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">See how it works</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white">One simple customer journey.</h2>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {industry.demoSteps.map((step, index) => (
                  <div key={step} className="rounded-2xl border border-border bg-background p-4">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-100">Step {index + 1}</span>
                    <p className="mt-2 font-semibold text-foreground">{step}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex gap-3 rounded-2xl bg-brand-100/60 p-4 dark:bg-white/[0.05]">
                <MailCheck className="mt-1 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-100" />
                <p className="text-sm leading-6 text-foreground">{industry.example}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-[1.75rem] bg-brand-950 p-7 text-center text-white md:p-12">
          <h2 className="mx-auto max-w-3xl text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Not sure which level fits?</h2>
          <p className="mx-auto mt-4 max-w-2xl leading-7 text-white/75">Tell us how customers reach you today. We will recommend the smallest useful level and confirm every cost before work begins.</p>
          <Link href={`/contact?service=industry_package&industry=${encodeURIComponent(industry.shortName)}`} className={buttonVariants({ variant: "secondary", size: "lg", className: "mt-6" })}>Help me choose<ArrowRight className="ml-2 h-4 w-4" /></Link>
        </div>
      </div>
    </section>
  );
}
