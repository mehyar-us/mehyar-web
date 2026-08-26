import { ArrowUpRight, MonitorPlay, Sparkles } from "lucide-react";
import { industryOffers } from "@/data/industry-offers";
import { buttonVariants } from "@/components/ui/button";

export const INDUSTRY_DEMO_ROOM_URL = "https://gamma.app/docs/v5yxk19yxlk8l6y";

export default function IndustryDemoRoom() {
  return (
    <section
      className="bg-background px-4 py-12 md:py-18"
      aria-labelledby="industry-demo-title"
    >
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-brand-700/20 bg-[radial-gradient(circle_at_top_right,rgba(11,82,104,0.18),transparent_38%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--card))_58%)] p-6 shadow-[0_24px_80px_rgba(8,63,84,0.12)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(143,211,221,0.12),transparent_38%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--card))_58%)] md:p-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.78fr] lg:items-center">
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Interactive
              industry demos
            </p>
            <h2
              id="industry-demo-title"
              className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl"
            >
              See the pitch, workflow, and packages in your language.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Open the Mehyar.us sales room to browse eleven tailored
              presentations: one overview plus a specific demo for every
              industry below. These are clearly labeled concept demos—not
              invented client case studies or guaranteed results.
            </p>
            <a
              href={INDUSTRY_DEMO_ROOM_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({
                variant: "cta",
                size: "lg",
                className: "mt-7",
              })}
            >
              Open the industry demo room{" "}
              <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </a>
          </div>

          <div className="rounded-[1.5rem] border border-border bg-card/90 p-5 shadow-sm backdrop-blur dark:bg-card/80">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                <MonitorPlay className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold text-foreground">
                  11-page Gamma sales room
                </p>
                <p className="text-sm text-muted-foreground">
                  Problem → owned system → transparent packages → next step
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {industryOffers.map((industry) => (
                <span
                  key={industry.id}
                  className="rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  {industry.shortName}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
