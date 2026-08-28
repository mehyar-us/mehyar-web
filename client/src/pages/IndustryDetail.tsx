import { ArrowLeft, ArrowRight, Bot, CircleHelp, CheckCircle2, Route, Tags } from "lucide-react";
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
          <Link href="/pricing" className="mb-7 inline-flex items-center text-sm font-semibold text-brand-800 hover:underline dark:text-brand-100"><ArrowLeft className="mr-2 h-4 w-4" />All business pricing</Link>
          <div className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center">
            <div>
              <p className="site-eyebrow mb-3">Website and automation for {industry.shortName.toLowerCase()}</p>
              <h1 className="site-display max-w-4xl">Website, AI follow-up, and customer care for {industry.shortName.toLowerCase()}.</h1>
              <p className="site-lede mt-6 max-w-3xl">{industry.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {industry.outcomes.map((outcome) => <span key={outcome} className="inline-flex items-center gap-2 rounded-full border border-brand-700/20 bg-card px-3 py-2 text-sm font-medium text-foreground"><CheckCircle2 className="h-4 w-4 text-brand-700 dark:text-brand-100" />{outcome}</span>)}
              </div>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row"><a href="#ai-command-center" className={buttonVariants({ variant: "cta", size: "lg" })}><Bot className="mr-2 h-4 w-4" />See your AI command center</a><a href="#services-pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>View services &amp; pricing<ArrowRight className="ml-2 h-4 w-4" /></a></div>
            </div>
            <div className="site-panel relative min-h-80 overflow-hidden bg-brand-950">
              <img src={industry.heroImage} alt={`${industry.shortName} business owner serving a customer`} className="absolute inset-0 h-full w-full object-cover" loading="eager" />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-950/80 via-transparent to-transparent" />
              <p className="absolute bottom-5 left-5 right-5 text-sm font-medium leading-6 text-white">{industry.outcomes.join(" · ")}</p>
            </div>
          </div>
        </div>
      </section>
      <nav aria-label={`${industry.shortName} page sections`} className="site-sticky-tabs">
        <div className="scrollbar-none mx-auto flex max-w-7xl gap-2 overflow-x-auto">
          <a href="#ai-command-center" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand-950 px-4 py-2 text-sm font-semibold text-white"><Bot className="h-4 w-4" aria-hidden="true" />AI command center</a>
          <a href="#services-pricing" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-700/40"><Tags className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />Services &amp; pricing</a>
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
