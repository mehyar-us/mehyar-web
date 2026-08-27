import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Search } from "lucide-react";
import { Link } from "wouter";
import { industryOffers } from "@/data/industry-offers";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function IndustryPricingExplorer() {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return industryOffers;
    return industryOffers.filter((item) => [item.name, item.shortName, ...item.examples].some((value) => value.toLowerCase().includes(needle)));
  }, [query]);

  return (
    <section id="industry-pricing" className="px-4 py-14 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.75fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Find your business</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">One page with your services, prices, and example.</h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">Choose the closest business type. You will see all three levels together—website, AI texting, and the full AI front desk.</p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 rounded-2xl pl-12" placeholder="Try barber, dentist, HVAC, restaurant..." aria-label="Search business types" />
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((industry) => (
            <article key={industry.id} className="group overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-brand-700/40 hover:shadow-md">
              <div className="relative h-40 overflow-hidden bg-brand-950">
                <img src={industry.heroImage} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-brand-950/80 to-transparent" />
                <h3 className="absolute bottom-4 left-4 right-4 text-xl font-semibold text-white">{industry.shortName}</h3>
              </div>
              <div className="p-5">
                <div className="space-y-2">
                  {industry.outcomes.slice(0, 2).map((outcome) => <p key={outcome} className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-100" />{outcome}</p>)}
                </div>
                <div className="mt-5 flex items-end justify-between gap-4 border-t border-border pt-4">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Starts at</p><p className="mt-1 font-semibold text-foreground">{industry.packages[0].price}</p><p className="text-sm text-muted-foreground">{industry.packages[0].cadence}</p></div>
                  <Link href={`/industries/${industry.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>View page<ArrowRight className="ml-2 h-4 w-4" /></Link>
                </div>
              </div>
            </article>
          ))}
        </div>

        {matches.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-border p-6 text-center">
            <p className="text-muted-foreground">No exact match. Tell us what you run and we will use the closest working model.</p>
            <Link href="/contact?service=general" className={buttonVariants({ variant: "outline", className: "mt-4" })}>Tell us about my business<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
