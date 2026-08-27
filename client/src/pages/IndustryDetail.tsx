import { ArrowLeft, ArrowRight, Bot, CircleHelp, CheckCircle2, Route, Tags } from "lucide-react";
import { Link, useRoute } from "wouter";
import IndustrySalesDeck from "@/components/industry-sales-deck";
import IndustryAgentServices from "@/components/industry-agent-services";
import { industryOffers } from "@/data/industry-offers";
import { buttonVariants } from "@/components/ui/button";
import NotFound from "@/pages/not-found";

export default function IndustryDetail() {
  const [, params] = useRoute("/industries/:slug");
  const industry = industryOffers.find((item) => item.id === params?.slug);
  if (!industry) return <NotFound />;

  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.16),transparent_34%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_65%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.12),transparent_34%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_65%)] md:pt-32">
        <div className="mx-auto max-w-7xl">
          <Link href="/pricing" className="mb-7 inline-flex items-center text-sm font-semibold text-brand-800 hover:underline dark:text-brand-100"><ArrowLeft className="mr-2 h-4 w-4" />All business pricing</Link>
          <div className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Website and automation for {industry.shortName.toLowerCase()}</p>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.05em] text-ink dark:text-white md:text-6xl md:leading-[0.96]">Website, AI follow-up, and customer care for {industry.shortName.toLowerCase()}.</h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">{industry.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {industry.outcomes.map((outcome) => <span key={outcome} className="inline-flex items-center gap-2 rounded-full border border-brand-700/20 bg-card px-3 py-2 text-sm font-medium text-foreground"><CheckCircle2 className="h-4 w-4 text-brand-700 dark:text-brand-100" />{outcome}</span>)}
              </div>
              <a href="#services-pricing" className={buttonVariants({ variant: "cta", size: "lg", className: "mt-7" })}>View services &amp; pricing<ArrowRight className="ml-2 h-4 w-4" /></a>
            </div>
            <div className="relative min-h-80 overflow-hidden rounded-[1.75rem] border border-border bg-brand-950 shadow-[0_22px_60px_rgba(8,63,84,0.18)]">
              <img src={industry.heroImage} alt={`${industry.shortName} business owner serving a customer`} className="absolute inset-0 h-full w-full object-cover" loading="eager" />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-950/80 via-transparent to-transparent" />
              <p className="absolute bottom-5 left-5 right-5 text-sm font-medium leading-6 text-white">{industry.outcomes.join(" · ")}</p>
            </div>
          </div>
        </div>
      </section>
      <nav aria-label={`${industry.shortName} page sections`} className="sticky top-[4.5rem] z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto">
          <a href="#services-pricing" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand-950 px-4 py-2 text-sm font-semibold text-white"><Tags className="h-4 w-4" aria-hidden="true" />Services &amp; pricing</a>
          <a href="#how-it-works" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><Route className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />How it works</a>
          <a href="#ai-business-assistant" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><Bot className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />AI business assistant</a>
          <Link href={`/contact?service=industry_package&industry=${encodeURIComponent(industry.shortName)}`} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><CircleHelp className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />Ask a question</Link>
        </div>
      </nav>
      <IndustrySalesDeck industry={industry} />
      <IndustryAgentServices industry={industry} />
    </>
  );
}
