import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

type Offer = {
  name: string;
  price: string;
  fit: string;
  outcome: string;
  emphasis: string;
  ctaLabel: string;
  ctaHref: string;
};

// 6-tier leak ladder — matches docs/VISION.md "What we sell" verbatim.
// Source of truth: docs/VISION.md (lines 12-18). Each tier is the founder's
// real product progression, not a generic agency price menu.
const offers: Offer[] = [
  {
    name: "Free Tech Audit",
    price: "$150",
    fit: "Owners who can name the leak but cannot rank the fixes.",
    outcome: "A prioritized leak map, written in plain language, with the smallest useful next step.",
    emphasis: "Best first step",
    ctaLabel: "Book a Tech Audit",
    ctaHref: "/micro-offer#intake",
  },
  {
    name: "Website Diagnosis Report",
    price: "$250",
    fit: "Local businesses that need a written diagnosis before committing to cleanup or rebuild work.",
    outcome: "A focused written report on the website, booking path, and follow-up leaks. Fast turnaround.",
    emphasis: "Fast turnaround",
    ctaLabel: "Request the $250 report",
    ctaHref: "/micro-offer#intake",
  },
  {
    name: "Custom Build (Small)",
    price: "$1,000-$5,000",
    fit: "Scoped projects with a clear deliverable. Landing pages, booking setup, CRM wiring, single-flow automation.",
    outcome: "A working build, documented, handed off, and ready for daily use.",
    emphasis: "Scope the work",
    ctaLabel: "Plan a small build",
    ctaHref: "/contact?service=custom-build-small",
  },
  {
    name: "Custom Build (Mid)",
    price: "$5,000-$25,000",
    fit: "Multi-week engagements: internal apps, integrations, regulated-systems work, portal builds.",
    outcome: "Senior engineering across the full scope. Audit-friendly, operator-ready.",
    emphasis: "Larger scope",
    ctaLabel: "Plan a mid build",
    ctaHref: "/contact?service=custom-build-mid",
  },
  {
    name: "Quarterly Retainer",
    price: "$500-$3,500/mo",
    fit: "Owners who need a steady technical owner for website, CRM, automation, and small monthly improvements.",
    outcome: "Ongoing improvements, lead-flow monitoring, vendor coordination, and reporting.",
    emphasis: "Keep improving",
    ctaLabel: "Discuss a retainer",
    ctaHref: "/contact?service=monthly-retainer",
  },
  {
    name: "Hourly Advisory",
    price: "$150/hr",
    fit: "Pharma, healthcare, SaaS, agencies, and regulated teams that need senior IC support by the hour.",
    outcome: "Architecture review, integration planning, risk review, and hands-on systems thinking.",
    emphasis: "Senior by the hour",
    ctaLabel: "Talk about advisory",
    ctaHref: "/contact?service=hourly-advisory",
  },
];

const PricingSection = () => {
  return (
    <section id="pricing" className="border-y border-border bg-secondary/55 px-4 py-14 dark:bg-brand-950 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Leak ladder</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">
              Start small. Prove the fix. Expand only when the case is clear.
            </h2>
          </div>
          <p className="max-w-md text-base leading-7 text-muted-foreground">
            Six tiers, ordered by the smallest useful engagement first. The audit and the diagnosis report are the most common entry points.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {offers.map((offer, index) => (
            <Card key={offer.name} className={`h-full border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] ${index === 0 ? "ring-2 ring-action/35" : ""}`}>
              <CardContent className="flex h-full flex-col p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground dark:bg-white/10 dark:text-brand-100">{offer.emphasis}</span>
                  <span className="text-sm font-semibold text-muted-foreground">0{index + 1}</span>
                </div>
                <h3 className="text-xl font-bold tracking-[-0.02em] text-foreground">{offer.name}</h3>
                <p className="mt-3 text-2xl font-bold text-brand-800 dark:text-brand-100">{offer.price}</p>
                <p className="mt-4 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Best fit:</strong> {offer.fit}</p>
                <p className="mt-3 flex-grow text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Outcome:</strong> {offer.outcome}</p>
                <Link href={offer.ctaHref} className={buttonVariants({ variant: index === 0 ? "cta" : "outline", className: "mt-6 w-full" })}>
                  {offer.ctaLabel}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-8 text-center text-sm leading-6 text-muted-foreground">
          Ranges depend on scope, risk, integrations, and urgency. The first call identifies the smallest useful engagement before proposing larger work.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
