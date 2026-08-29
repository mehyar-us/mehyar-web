import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import { industryOffers } from "@/data/industry-offers";

export default function HomeIndustryFinder() {
  return (
    <section className="site-section-muted border-t-0 py-12 md:py-16">
      <div className="site-shell">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="site-eyebrow">Start with what is familiar</p>
            <h2 className="site-heading mt-3">See what this looks like for your industry.</h2>
            <p className="site-lede mt-4">Choose a business like yours to see practical examples, service levels, maintenance, and pricing in everyday language.</p>
          </div>
          <Link href="/pricing" className={buttonVariants({ variant: "outline", size: "lg", className: "shrink-0" })}>Browse all industries<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
        </div>

        <div className="scrollbar-none -mx-4 mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-5">
          {industryOffers.map((industry) => (
            <Link key={industry.id} href={`/industries/${industry.id}`} className="group min-w-[72vw] snap-center overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-brand-700/35 hover:shadow-[0_12px_30px_rgba(6,47,66,0.08)] sm:min-w-[18rem] md:min-w-0">
              <div className="h-36 overflow-hidden bg-brand-950"><img src={industry.heroImage} alt={`${industry.shortName} customer experience`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" /></div>
              <div className="p-4">
                <h3 className="text-sm font-semibold leading-5 text-foreground">{industry.shortName}</h3>
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-100" aria-hidden="true" />{industry.outcomes[0]}</p>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground md:hidden">Swipe to see every industry group.</p>
      </div>
    </section>
  );
}
