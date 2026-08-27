import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Search, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { findIndustryOffer, industryOffers } from "@/data/industry-offers";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = { compact?: boolean; lockedIndustryId?: string };

const getInitialIndustryId = () => {
  if (typeof window === "undefined") return industryOffers[0].id;
  return findIndustryOffer(new URLSearchParams(window.location.search).get("industry"))?.id ?? industryOffers[0].id;
};

export default function IndustryPricingExplorer({ compact = false, lockedIndustryId }: Props) {
  const [selectedId, setSelectedId] = useState(lockedIndustryId ?? getInitialIndustryId);
  const [query, setQuery] = useState("");
  const industry = useMemo(() => industryOffers.find((item) => item.id === (lockedIndustryId ?? selectedId)) ?? industryOffers[0], [lockedIndustryId, selectedId]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return industryOffers;
    return industryOffers.filter((item) => [item.name, item.shortName, ...item.examples].some((value) => value.toLowerCase().includes(needle)));
  }, [query]);

  const selectIndustry = (industryId: string) => {
    setSelectedId(industryId);
    setQuery("");
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("industry", industryId);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <section id="industry-pricing" className={cn("px-4", compact ? "py-10" : "py-16 md:py-20")}>
      <div className="mx-auto max-w-7xl">
        {!lockedIndustryId ? (
          <>
            <div className="mb-8 max-w-3xl">
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Pick your business</p>
              <h2 className="text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">See prices made for the way your business works.</h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg">Type what you do—barber, dentist, plumber, restaurant, real estate agent, and more. Then compare three clear levels.</p>
            </div>
            <div className="relative mb-4 max-w-xl">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 rounded-2xl pl-12" placeholder="What kind of business do you run?" aria-label="Search business types" />
            </div>
            <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Choose your business type">
              {matches.map((item) => (
                <Button key={item.id} id={`industry-tab-${item.id}`} role="tab" aria-controls="industry-package-panel" aria-selected={item.id === selectedId} variant={item.id === selectedId ? "default" : "outline"} onClick={() => selectIndustry(item.id)} className="rounded-full">{item.shortName}</Button>
              ))}
              {matches.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No exact match. Tell us what you run and we will point you to the closest option.</p> : null}
            </div>
          </>
        ) : null}

        <div id="industry-package-panel" role="tabpanel" aria-labelledby={`industry-tab-${industry.id}`} className="rounded-[2rem] border border-border bg-card p-5 shadow-[0_18px_60px_rgba(8,63,84,0.08)] sm:p-7">
          <div className="grid gap-5 border-b border-border pb-6 lg:grid-cols-[1fr_0.9fr] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Prices for {industry.shortName.toLowerCase()}</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink dark:text-white md:text-3xl">{industry.name}</h3>
              <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">{industry.description}</p>
              {!lockedIndustryId ? <Link href={`/industries/${industry.id}`} className="mt-4 inline-flex items-center text-sm font-semibold text-brand-800 hover:underline dark:text-brand-100">Open the full {industry.shortName.toLowerCase()} page <ArrowRight className="ml-1.5 h-4 w-4" /></Link> : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {industry.outcomes.map((outcome) => <div key={outcome} className="flex items-center gap-2 rounded-xl bg-brand-100/60 px-3 py-2 text-sm font-medium text-brand-950 dark:bg-white/[0.06] dark:text-brand-100"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-100" />{outcome}</div>)}
            </div>
          </div>

          {industry.complianceNote ? <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />{industry.complianceNote}</div> : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {industry.packages.map((pkg, index) => {
              const href = `/contact?service=industry_package&industry=${encodeURIComponent(industry.shortName)}&offer=${encodeURIComponent(pkg.name)}`;
              return (
                <article key={pkg.name} className={cn("flex h-full flex-col rounded-2xl border p-5", pkg.featured ? "border-brand-700 bg-brand-100/45 shadow-[0_14px_34px_rgba(8,63,84,0.10)] dark:bg-white/[0.06]" : "border-border bg-background/60 dark:bg-white/[0.03]")}>
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Level {index + 1}</p><h4 className="mt-1 text-xl font-semibold text-ink dark:text-white">{pkg.name}</h4></div>
                    {pkg.featured ? <span className="rounded-full bg-brand-800 px-2.5 py-1 text-xs font-semibold text-white dark:bg-brand-100 dark:text-brand-950">Most popular</span> : null}
                  </div>
                  <p className="mt-3 min-h-12 text-sm leading-6 text-foreground">{pkg.plainSummary}</p>
                  <div className="mt-4 rounded-xl border border-border bg-card p-3"><p className="text-2xl font-semibold tracking-[-0.04em] text-brand-800 dark:text-brand-100">{pkg.price}</p><p className="mt-1 text-sm text-muted-foreground">{pkg.cadence}</p></div>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Good fit if:</strong> {pkg.bestFor}</p>
                  <p className="mt-5 text-sm font-semibold text-foreground">Your customers can:</p>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">{pkg.customerCan.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-100" />{item}</li>)}</ul>
                  <p className="mt-5 text-sm font-semibold text-foreground">You get:</p>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">{pkg.ownerGets.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-100" />{item}</li>)}</ul>
                  <Link href={href} className={buttonVariants({ variant: pkg.featured ? "cta" : "outline", className: "mt-6 w-full" })}>Ask about this package <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </article>
              );
            })}
          </div>
          <div className="mt-6 rounded-2xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">No surprise wording:</strong> “setup” is the one-time build price. “Per month” keeps the site running and covers the listed ongoing service. Text-message volume, outside software, payment fees, large data moves, and custom connections are priced before work starts.</div>
        </div>

        {!lockedIndustryId ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-4"><p className="text-sm text-muted-foreground">Still not sure which one fits? Tell us what customers need to do and we will point you to the smallest useful option.</p><Link href="/contact?service=general" className={buttonVariants({ variant: "outline" })}>Help me choose <ArrowRight className="ml-2 h-4 w-4" /></Link></div> : null}
      </div>
    </section>
  );
}
