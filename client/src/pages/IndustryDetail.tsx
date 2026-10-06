import { ArrowLeft, ArrowRight, Bot, CircleHelp, CheckCircle2, Route, Sparkles, Tags } from "lucide-react";
import { Link, useRoute } from "wouter";
import IndustrySalesDeck from "@/components/industry-sales-deck";
import IndustryAgentServices from "@/components/industry-agent-services";
import IndustryAgentSpotlight from "@/components/IndustryAgentSpotlight";
import { industryOffers } from "@/data/industry-offers";
import { buttonVariants } from "@/components/ui/button";
import NotFound from "@/pages/not-found";

export default function IndustryDetail() {
  const [, params] = useRoute("/industries/:slug");
  const industry = industryOffers.find((item) => item.id === params?.slug);
  if (!industry) return <NotFound />;

  return (
    <>
      <section className="site-hero">
        <div className="site-shell">
          <Link href="/pricing" className="mb-7 inline-flex items-center text-sm font-semibold text-brand-800 hover:underline dark:text-brand-100"><ArrowLeft className="mr-2 h-4 w-4" />Browse business types</Link>
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="site-eyebrow mb-3">A connected growth system for {industry.shortName.toLowerCase()}</p>
              <div className="relative mb-6 aspect-[16/8.5] overflow-hidden rounded-2xl border border-border bg-brand-950 shadow-sm lg:hidden">
                <img src={industry.heroImage} alt={`${industry.shortName} owner serving a customer`} className="absolute inset-0 h-full w-full object-cover" loading="eager" />
              </div>
              <h1 className="site-display max-w-4xl">Make it easier to choose you, reach you, and come back.</h1>
              <p className="site-lede mt-6 max-w-3xl">{industry.description}</p>
              <div className="mt-6 grid gap-2 sm:grid-cols-3">
                {industry.outcomes.map((outcome) => <span key={outcome} className="inline-flex items-center gap-2 rounded-xl border border-brand-700/20 bg-card px-3 py-3 text-sm font-medium text-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-100" />{outcome}</span>)}
              </div>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row"><a href="#services-pricing" className={buttonVariants({ variant: "cta", size: "lg" })}>See services &amp; pricing<ArrowRight className="ml-2 h-4 w-4" /></a><a href="#ai-command-center" className={buttonVariants({ variant: "outline", size: "lg" })}><Sparkles className="mr-2 h-4 w-4" />See the AI assistant</a></div>
              <div className="mt-6 flex items-end gap-3 border-t border-border pt-5">
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Practical starting point</p><p className="mt-1 text-xl font-semibold text-foreground">{industry.packages[0].price}</p></div>
                <p className="pb-0.5 text-sm text-muted-foreground">{industry.packages[0].cadence}</p>
              </div>
            </div>
            <div className="relative hidden min-h-[22rem] overflow-hidden rounded-[1.75rem] border border-border bg-brand-950 shadow-[0_20px_60px_rgba(6,47,66,0.14)] sm:min-h-[28rem] lg:block">
              <img src={industry.heroImage} alt={`${industry.shortName} owner serving a customer`} className="absolute inset-0 h-full w-full object-cover" loading="eager" />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-950/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5 text-white sm:p-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-100">What your customers feel</p>
                <p className="mt-2 max-w-lg text-lg font-semibold leading-7">A faster, clearer path from first question to booked service—and an easier reason to return.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <nav aria-label={`${industry.shortName} page sections`} className="site-sticky-tabs">
        <div className="scrollbar-none mx-auto flex max-w-7xl gap-2 overflow-x-auto">
          <a href="#services-pricing" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand-950 px-4 py-2 text-sm font-semibold text-white"><Tags className="h-4 w-4" aria-hidden="true" />Services &amp; pricing</a>
          <a href="#ai-command-center" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><Bot className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />AI assistant</a>
          <a href="#how-it-works" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><Route className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />How it works</a>
          <a href="#ai-business-assistant-details" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><Bot className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />10 AI uses &amp; pricing</a>
          <Link href={`/contact?service=industry_package&industry=${encodeURIComponent(industry.shortName)}`} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><CircleHelp className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />Ask a question</Link>
        </div>
      </nav>
      <IndustryAgentSpotlight industry={industry} />
      <IndustrySalesDeck industry={industry} />
      <IndustryAgentServices industry={industry} />
    </>
  );
}
