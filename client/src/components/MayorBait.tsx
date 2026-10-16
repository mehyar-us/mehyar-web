import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * MayorBait — the small, sitewide teaser for The Mayor (Mayor's order,
 * 2026-10-15: "top as hero and in many places smaller bait"). One shared
 * strip, dropped at the end of content pages; the hero lives on Home.
 * `campaign` keeps each placement attributable in mayor.mehyar.us traffic.
 */
export default function MayorBait({ campaign }: { campaign: string }) {
  return (
    <section className="px-4 py-10">
      <div className="site-shell">
        <div className="mx-auto flex max-w-4xl flex-col gap-5 rounded-3xl border border-border bg-card p-6 sm:flex-row sm:items-center md:p-8">
          <img
            src="/assets/mayor-logo.png"
            alt="The Mayor"
            className="h-12 w-12 shrink-0 rounded-2xl"
            loading="lazy"
          />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">The Mayor — talk to your business</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The AI workspace that answers the calls you miss and keeps customers,
              appointments, and playbooks in one place. Free to start — Pro $99/month (founding cohort $79.20 for life).
            </p>
          </div>
          <a
            href={`https://mayor.mehyar.us/?utm_source=mehyar-web&utm_medium=bait&utm_campaign=${campaign}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "cta", size: "lg", className: "min-h-12 w-full shrink-0 sm:w-auto" })}
          >
            Meet The Mayor <ArrowRight className="ml-2 h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
