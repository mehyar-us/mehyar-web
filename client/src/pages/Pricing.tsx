import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import IndustryPricingExplorer from "@/components/industry-pricing-explorer";
import { buttonVariants } from "@/components/ui/button";

export default function Pricing() {
  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.16),transparent_34%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_60%,#fff_100%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.12),transparent_34%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_60%,hsl(var(--brand-950))_100%)] md:pt-32">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
              <Sparkles className="h-4 w-4" /> NYC small-business systems
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-ink dark:text-white md:text-6xl md:leading-[0.96]">
              Choose your business. See exactly what you get.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
              No agency jargon and no separate demo room. Choose your business
              to see the website, AI texting, full AI front desk, exact starting
              prices, and a realistic customer example together on one page.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#industry-pricing"
                className={buttonVariants({ variant: "cta", size: "lg" })}
              >
                Find my business <ArrowRight className="ml-2 h-4 w-4" />
              </a>
              <Link
                href="/micro-offer#intake"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Start with a $330 tech audit
              </Link>
            </div>
          </div>
        </div>
      </section>
      <IndustryPricingExplorer />
    </>
  );
}
