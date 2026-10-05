import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { services } from "@/data/services";
import CTASection from "@/components/cta-section";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import MaintenanceSupportSection from "@/components/maintenance-support-section";
import { managedAgentOffers } from "@/data/agent-services";
import { Bot, BrainCircuit } from "lucide-react";
import ServiceDecisionGuide from "@/components/ServiceDecisionGuide";

const steps = ["Find the leak", "Ship the smallest useful fix", "Measure and document the handoff"];

const Services = () => {
  return (
    <>
      <section className="site-hero">
        <div className="site-shell grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="site-eyebrow mb-3">Services and pricing</p>
            <h1 className="site-display max-w-4xl">
              Choose the result you need. See what it takes.
            </h1>
            <p className="site-lede mt-4 max-w-2xl">
              From a clearer website to a custom cloud platform, each path explains the problem, the build, the outcome, and a realistic starting point.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href="/micro-offer#intake" className={buttonVariants({ variant: "cta", size: "lg" })}>
                Book a Tech Audit <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>
                View industry pricing
              </Link>
            </div>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {steps.map((step, index) => (
              <div key={step} className="flex items-center gap-3 py-4">
                <span className="flex h-9 w-9 items-center justify-center border border-brand-700/20 bg-secondary text-sm font-bold text-secondary-foreground dark:bg-white/10 dark:text-brand-100">0{index + 1}</span>
                <p className="font-semibold text-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ServiceDecisionGuide />

      <section className="bg-background px-4 py-12 md:py-18">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Offer catalog</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-5xl">Every block maps pain → solution → outcome.</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => (
              <Card key={service.id} id={service.id} className="scroll-mt-28 overflow-hidden rounded-[1.5rem] border-border bg-card shadow-sm">
                <img src={service.image} alt="" className="aspect-[16/8] w-full bg-muted/25 object-cover" loading="lazy" />
                <CardContent className="flex h-full flex-col p-5">
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                      <service.icon aria-hidden="true" size={22} />
                    </div>
                    <Badge variant="outline" className="border-border bg-background/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {service.category}
                    </Badge>
                  </div>
                  <h3 className="text-xl font-bold tracking-[-0.02em] text-foreground">{service.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{service.description}</p>
                  <div className="mt-4 space-y-2">
                    {service.features.slice(0, 3).map((feature) => (
                      <div key={feature} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-none text-brand-700 dark:text-brand-100" aria-hidden="true" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  <Link href={`/booking?service=${service.id}&utm_campaign=services_catalog`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
                    Request service-specific booking <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="ai-business-operators" className="scroll-mt-24 border-y border-border bg-muted/35 px-4 py-14 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <img src="/assets/sales-system/ai-system.webp" alt="" className="min-h-80 w-full rounded-[1.75rem] border border-border bg-white object-cover shadow-[0_22px_60px_rgba(8,63,84,0.13)]" loading="lazy" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Managed AI business operators</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Your own AI command center, installed and managed.</h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground">Use a private mobile assistant for calls, scheduling, approved actions, research, summaries, follow-up, and reports. We choose and configure the right OpenClaw or Hermes setup behind the scenes. Every plan includes permissions, human approval rules, monitoring, backups, and support.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {managedAgentOffers.slice(0, 2).map((offer, index) => <div key={offer.name} className="border border-border bg-card p-4"><div className="flex items-center gap-2 font-semibold text-foreground">{index === 0 ? <Bot className="h-5 w-5 text-brand-700 dark:text-brand-100" /> : <BrainCircuit className="h-5 w-5 text-brand-700 dark:text-brand-100" />}{offer.name}</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{offer.bestFor}</p><p className="mt-3 text-sm font-semibold text-foreground">{offer.managed}</p></div>)}
              </div>
              <Link href="/pricing#industry-pricing" className={buttonVariants({ variant: "cta", size: "lg", className: "mt-6" })}>See uses for my business<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </div>
          </div>
        </div>
      </section>

      <MaintenanceSupportSection />

      <section className="bg-background px-4 py-12 md:py-18">
        <div className="mx-auto max-w-5xl border-y border-border bg-card p-6 text-center md:p-10">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Delivery approach</p>
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-ink dark:text-white md:text-4xl">Cloudflare-first, TypeScript-friendly, documentation included.</h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-muted-foreground">Tools are selected for the workflow, not trend value: React/TypeScript frontends, Node/Python backends, CRM/email/scheduling integrations, Cloudflare-native hosting, SQL databases, dashboards, and AI-assisted workflow automation.</p>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default Services;
