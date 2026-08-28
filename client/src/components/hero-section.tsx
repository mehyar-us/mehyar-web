import { ArrowRight, BrainCircuit, CloudCog, PanelsTopLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import HomeProductPreview from "@/components/HomeProductPreview";

const outcomes = [
  { label: "Customer systems", icon: PanelsTopLeft },
  { label: "Cloud software", icon: CloudCog },
  { label: "Practical AI", icon: BrainCircuit },
];

export default function HeroSection() {
  return (
    <section className="site-hero relative overflow-hidden pb-0">
      <div className="site-shell grid items-center gap-9 py-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-12 lg:py-14">
        <div>
          <p className="site-eyebrow mb-4 flex items-center gap-3"><span className="h-px w-8 bg-brand-700" aria-hidden="true" />Software · systems · AI</p>
          <h1 className="site-display max-w-3xl">Software that makes the work move.</h1>
          <p className="site-lede mt-5 max-w-xl">We design and operate customer apps, internal systems, cloud platforms, and AI workflows—without making you manage the technology.</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a href="#how-it-works" className={buttonVariants({ variant: "cta", size: "lg", className: "h-12 px-7 text-base" })}>See how it works<ArrowRight className="ml-2 h-4 w-4" /></a>
            <a href="#solutions" className="inline-flex h-12 items-center justify-center gap-2 border-b border-brand-800 px-2 text-base font-semibold text-brand-800 transition hover:text-brand-700 dark:border-brand-100 dark:text-brand-100">Explore services<ArrowRight className="h-4 w-4" /></a>
          </div>
          <div className="mt-8 grid max-w-xl grid-cols-3 divide-x divide-border border-y border-border py-4">
            {outcomes.map(({ label, icon: Icon }) => <div key={label} className="flex flex-col gap-2 px-3 first:pl-0 last:pr-0 sm:flex-row sm:items-center"><Icon className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-100" aria-hidden="true" /><span className="text-[0.7rem] font-semibold leading-4 text-foreground sm:text-xs">{label}</span></div>)}
          </div>
        </div>
        <HomeProductPreview />
      </div>

      <div id="how-it-works" className="scroll-mt-24 border-t border-border">
        <div className="site-shell grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
          {[
            ["01", "Website or app", "Give customers and staff one clear place to act."],
            ["02", "Connected workflow", "Move information through the right tools and approvals."],
            ["03", "A visible result", "See requests, follow-up, and operations in one reliable view."],
          ].map(([number, title, text]) => (
            <div key={number} className="grid grid-cols-[2rem_1fr] gap-3 px-4 py-5 sm:px-6 lg:px-8">
              <span className="text-xs font-bold text-brand-700">{number}</span><div><h2 className="text-sm font-semibold text-foreground">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
