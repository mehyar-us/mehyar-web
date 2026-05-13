import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import NewsletterSignup from "@/components/NewsletterSignup";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const checklistItems = [
  "Find where visitors hesitate before contacting you.",
  "Check whether missed calls and emails become tracked follow-up.",
  "Spot manual copy-paste work that an AI or system workflow can remove.",
  "Separate safe automation ideas from risky customer-data shortcuts.",
];

const Newsletter = () => {
  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.14),transparent_32%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_58%,#fff_100%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.12),transparent_32%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_58%,hsl(var(--brand-950))_100%)] md:pb-20 md:pt-32">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-start">
          <div className="max-w-4xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-brand-700 dark:text-brand-100">Free AI automation checklist</p>
            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-ink dark:text-white md:text-6xl md:leading-[0.96]">
              Stop guessing where your website, calls, and follow-up are leaking customers.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
              Get a practical checklist for local businesses and regulated teams that want cleaner intake, fewer missed leads, and safer automation ideas before committing to software work.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#signup" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "rounded-full px-7")}>Get the free checklist</a>
              <a href="/330?request_type=micro_offer&utm_campaign=newsletter_hero#intake" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-full px-7")}>Skip to the $330 audit</a>
            </div>
          </div>

          <div id="signup" className="scroll-mt-24">
            <NewsletterSignup source="newsletter_landing" title="Send me the checklist." description="One focused email path for the checklist and occasional practical updates. No spam, no fake urgency." />
          </div>
        </div>
      </section>

      <section className="bg-background px-4 py-16 md:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.85fr_1fr] lg:items-center">
          <div className="rounded-[2rem] border border-border bg-card p-6 shadow-[0_24px_80px_rgba(8,63,84,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800 dark:bg-white/10 dark:text-brand-100">
              <ShieldCheck size={14} aria-hidden="true" />
              Founder-led, consent-aware
            </div>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white">Built for owners who need a next step, not a software lecture.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              The checklist points you toward the smallest practical fix: better website flow, booking setup, missed-call response, CRM cleanup, internal automation, or a deeper systems audit.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {checklistItems.map((item) => (
              <div key={item} className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
                <CheckCircle2 className="mb-4 h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                <p className="text-sm leading-6 text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ink px-4 py-16 text-white dark:bg-black md:py-20">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-100">After the checklist</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Want Boss to diagnose the leaks?</h2>
            <p className="mt-3 max-w-2xl leading-7 text-white/72">The $330 audit turns the checklist into a practical owner-level review of website, booking, missed-call, and follow-up gaps.</p>
          </div>
          <a href="/330?request_type=micro_offer&utm_campaign=newsletter_bottom#intake" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "rounded-full px-7")}>Request the $330 audit <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></a>
        </div>
      </section>
    </>
  );
};

export default Newsletter;
