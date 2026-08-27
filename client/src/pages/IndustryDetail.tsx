import { ArrowLeft, MonitorPlay } from "lucide-react";
import { Link, useRoute } from "wouter";
import IndustrySalesDeck from "@/components/industry-sales-deck";
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
          <div className="grid gap-8 lg:grid-cols-[1fr_0.7fr] lg:items-end">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Website and automation for {industry.shortName.toLowerCase()}</p>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.05em] text-ink dark:text-white md:text-6xl md:leading-[0.96]">Clear tools. Clear prices. Built for {industry.shortName.toLowerCase()}.</h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">{industry.description}</p>
            </div>
            <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><MonitorPlay className="h-5 w-5" /></span><div><p className="font-semibold text-foreground">The full visual demo is below</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Seven short, slide-style sections explain the problem, customer journey, all three price levels, and the next step—without leaving this site.</p></div></div>
              <a href="#visual-demo" className={buttonVariants({ variant: "cta", className: "mt-5 w-full" })}>View the {industry.shortName.toLowerCase()} presentation</a>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">Original concept demo—not a client case study or guaranteed result.</p>
            </div>
          </div>
        </div>
      </section>
      <div id="visual-demo" className="scroll-mt-24"><IndustrySalesDeck industry={industry} /></div>
    </>
  );
}
