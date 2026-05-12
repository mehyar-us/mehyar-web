import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { services } from "@/data/services";
import PricingSection from "@/components/pricing-section";
import CTASection from "@/components/cta-section";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import QuickAnswer from "@/components/QuickAnswer";

const steps = ["Find the leak", "Ship the smallest useful fix", "Measure and document the handoff"];

const Services = () => {
  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.14),transparent_32%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_54%,#fff_100%)] px-4 pb-10 pt-24 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_32%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_54%,hsl(var(--brand-950))_100%)] sm:pb-14 md:pt-32">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Services and pricing</p>
            <h1 className="max-w-4xl text-[2.1rem] font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-5xl md:leading-[0.98]">
              Consulting offers for customer leaks, workflow drag, and system gaps.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              Start with the smallest engagement that can clarify the leak, fix a visible path, or install one reliable automation around follow-up, CRM, reporting, and operations.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className={buttonVariants({ variant: "cta", size: "lg" })}>
                Book a Tech Audit <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="#pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>
                See pricing ranges
              </Link>
            </div>
          </div>
          <div className="grid gap-3 rounded-[1.75rem] border border-border bg-card/88 p-4 shadow-[0_20px_70px_rgba(8,63,84,0.10)] dark:bg-card/80">
            {steps.map((step, index) => (
              <div key={step} className="flex items-center gap-3 rounded-2xl border border-border bg-white/70 p-4 dark:bg-white/[0.04]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground dark:bg-white/10 dark:text-brand-100">0{index + 1}</span>
                <p className="font-semibold text-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background px-4 py-10">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-2">
          <QuickAnswer className="px-0 py-0" question="What consulting services does MehyarSoft offer?" answer="MehyarSoft LLC offers practical tech audits, website and booking cleanup, consent-safe missed-call follow-up flows, internal automation sprints, systems integration consulting, support retainers, and custom software builds." ctaHref="/contact" ctaLabel="Request a practical next step" />
          <QuickAnswer className="px-0 py-0" question="What is a local business tech audit?" answer="A local business tech audit reviews the public website, booking path, phone and email response, CRM or spreadsheet use, and manual admin bottlenecks to find the highest-value fixes before adding more tools." />
          <QuickAnswer className="px-0 py-0" question="What is a missed-call follow-up flow?" answer="A missed-call follow-up flow turns inbound intent into a lead record, owner notification, and consent-aware SMS or email response with opt-out and suppression planning before scale." />
          <QuickAnswer className="px-0 py-0" question="When should a business build custom software?" answer="Custom software makes sense when the workflow is stable, repeated, important, and constrained by off-the-shelf tools that create more manual work than they remove." />
        </div>
      </section>

      <section className="bg-background px-4 py-12 md:py-18">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Offer catalog</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-5xl">Every block maps pain → solution → outcome.</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => (
              <Card key={service.id} id={service.id} className="scroll-mt-28 border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
                <CardContent className="flex h-full flex-col p-5">
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
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
                  <Link href="/contact" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
                    Request Practical Next Step <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <PricingSection />

      <section className="bg-background px-4 py-12 md:py-18">
        <div className="mx-auto max-w-5xl rounded-[2rem] border border-border bg-card p-6 text-center shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-10">
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
