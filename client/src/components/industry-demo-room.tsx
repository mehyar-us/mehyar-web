import { ArrowRight, MonitorPlay, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { industryOffers } from "@/data/industry-offers";

export default function IndustryDemoRoom() {
  return (
    <section className="bg-background px-4 py-12 md:py-18" aria-labelledby="industry-demo-title">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-brand-700/20 bg-[radial-gradient(circle_at_top_right,rgba(11,82,104,0.18),transparent_38%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--card))_58%)] p-6 shadow-[0_24px_80px_rgba(8,63,84,0.12)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(143,211,221,0.12),transparent_38%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--card))_58%)] md:p-10">
        <div className="max-w-3xl">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100"><Sparkles className="h-4 w-4" />On-site visual examples by business</p>
          <h2 id="industry-demo-title" className="text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Open the page made for your business.</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">Each business page includes its own seven-part visual presentation, original industry artwork, packages, and a realistic customer example. Nothing opens in another app. These are concept demonstrations, not invented client results.</p>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {industryOffers.map((industry) => (
            <Link key={industry.id} href={`/industries/${industry.id}`} className="group flex min-h-28 items-center gap-4 rounded-2xl border border-border bg-card/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-700/40 hover:shadow-md dark:bg-card/80">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><MonitorPlay className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-foreground">{industry.shortName}</span><span className="mt-1 block text-sm text-muted-foreground">Prices + visual demo</span></span>
              <ArrowRight className="h-4 w-4 shrink-0 text-brand-700 transition group-hover:translate-x-1 dark:text-brand-100" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
