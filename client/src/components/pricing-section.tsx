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

const offers: Offer[] = [
  {
    name: "Local Business Tech Audit",
    price: "$150-$500",
    fit: "Restaurants, clinics, stores, salons, service businesses",
    outcome: "A prioritized leak map and practical action plan.",
    emphasis: "Best first step",
    ctaLabel: "Book a Tech Audit",
    ctaHref: "/micro-offer#intake",
  },
  {
    name: "Website / Booking Cleanup",
    price: "$750-$2,500",
    fit: "Owners with traffic or referrals but weak conversion",
    outcome: "Clear offer pages, intake, CTAs, and booking path.",
    emphasis: "Fix the public path",
    ctaLabel: "Plan my site fix",
    ctaHref: "/contact?service=website-cleanup",
  },
  {
    name: "AI Follow-Up Flow",
    price: "$1,500-$5,000",
    fit: "Missed calls, slow responses, no-shows, unworked leads",
    outcome: "SMS/email/CRM follow-up with consent-safe rules.",
    emphasis: "Recover warm leads",
    ctaLabel: "Map my follow-up flow",
    ctaHref: "/contact?service=ai-follow-up",
  },
  {
    name: "Internal Automation Sprint",
    price: "$3,000-$12,000",
    fit: "Teams buried in spreadsheets, inboxes, and recurring admin",
    outcome: "One workflow automated and documented.",
    emphasis: "Save operator time",
    ctaLabel: "Scope a sprint",
    ctaHref: "/contact?service=internal-sprint",
  },
  {
    name: "Architecture / Integration Consulting",
    price: "$100-$175/hr or $5k-$25k/project",
    fit: "Pharma, healthcare, SaaS, agencies, regulated teams",
    outcome: "Senior systems support for safe, reliable integrations.",
    emphasis: "De-risk complexity",
    ctaLabel: "Talk about architecture",
    ctaHref: "/contact?service=architecture-consulting",
  },
  {
    name: "Monthly Support Retainer",
    price: "$500-$3,500/mo",
    fit: "Businesses needing ongoing technical ownership",
    outcome: "Website, CRM, automation, and reporting support.",
    emphasis: "Keep improving",
    ctaLabel: "Discuss a retainer",
    ctaHref: "/contact?service=monthly-retainer",
  },
];

const PricingSection = () => {
  return (
    <section id="pricing" className="border-y border-border bg-secondary/55 px-4 py-14 dark:bg-brand-950 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Offer ladder</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">
              Start small. Prove the fix. Expand only when the case is clear.
            </h2>
          </div>
          <p className="max-w-md text-base leading-7 text-muted-foreground">
            Ranges depend on scope, risk, integrations, and urgency. The first call should identify the smallest useful engagement.
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
          Local phone/electronics help may be available for $50-$250/job when it is the fastest path to a relationship, referral, or trust-building entry point.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
