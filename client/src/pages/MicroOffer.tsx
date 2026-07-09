import { ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, PhoneCall, ShieldCheck, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import ContactSection from "@/components/contact-section";
import { cn } from "@/lib/utils";

const offerCards = [
  {
    icon: ClipboardCheck,
    title: "Website leak audit",
    pain: "Visitors do not understand the offer or know what to do next.",
    solution: "Review the first impression, service clarity, CTA path, mobile flow, and trust gaps.",
    outcome: "You get a ranked fix list: what to clean up now, what to automate next, and what to defer.",
  },
  {
    icon: CalendarClock,
    title: "Booking path setup plan",
    pain: "Prospects ask questions, call, or message — then fall through manual follow-up.",
    solution: "Map the smallest booking/intake path with fields, confirmations, owner alerts, and handoff logic.",
    outcome: "You leave with the simplest next setup: booking link, form path, response script, or sprint scope.",
  },
  {
    icon: PhoneCall,
    title: "Missed-call follow-up blueprint",
    pain: "Calls, forms, and emails are not answered fast enough or tracked clearly.",
    solution: "Identify where consent-safe SMS/email follow-up and owner visibility can reduce leakage.",
    outcome: "You know whether a lightweight follow-up flow is worth building before buying more software.",
  },
];

const included = [
  "Review of homepage/service message, CTA, mobile path, and obvious trust gaps",
  "Booking/contact path check: form fields, call/email handoff, confirmations, and next-step clarity",
  "Follow-up and systems map: missed calls, inboxes, CRM/spreadsheets, reminders, manual retyping",
  "One practical written action plan with the first fix, next automation, and larger-scope recommendation",
];

const fitSignals = [
  "Local service business, clinic, restaurant, shop, agency, or owner-led company",
  "You suspect leads are leaking through bad web flow, missed calls, weak follow-up, or disconnected tools",
  "You want a senior technical operator to find the smallest useful move before a bigger build",
];

const MicroOffer = () => {
  return (
    <>
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.14),transparent_34%),linear-gradient(180deg,#fff_0%,hsl(var(--background))_100%)] px-4 pb-16 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(102,210,235,0.12),transparent_34%),linear-gradient(180deg,hsl(var(--brand-950))_0%,hsl(var(--background))_100%)] sm:pb-20 lg:pt-32">
        <div className="container mx-auto grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-700/15 bg-white/80 px-4 py-2 text-sm font-semibold text-brand-800 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-brand-100">
              <Sparkles size={16} aria-hidden="true" />
              First practical step: $330
            </div>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white sm:text-5xl lg:text-6xl">
              Find where your website, booking path, or follow-up is losing customers.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl sm:leading-9">
              A focused founder-led audit for small businesses that know something is leaking — bad website clarity, missed calls, manual booking, weak follow-up, or disconnected systems — but need the next move before committing to a larger build.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="/micro-offer#intake" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "rounded-full px-7")}>Request the $330 audit/setup path</a>
              <a href="#included" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-full px-7")}>See what is included</a>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              No fake agency pitch. No guaranteed revenue claim. Just a senior systems/software/AI automation consultant identifying the smallest practical fix.
            </p>
          </div>

          <aside className="rounded-[2rem] border border-border bg-card/92 p-5 shadow-[0_24px_80px_rgba(8,63,84,0.12)] dark:bg-card/88 dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)] sm:p-7">
            <div className="rounded-3xl bg-brand-950 p-6 text-white dark:bg-white/[0.05]">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-100">Micro-offer</p>
              <div className="mt-4 flex items-end gap-3">
                <span className="text-5xl font-semibold tracking-[-0.05em]">$330</span>
                <span className="pb-2 text-sm text-white/72">audit + setup plan</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-white/78">
                Best when the problem is visible but the fix is not: website trust, booking friction, missed calls, slow response, or messy handoffs.
              </p>
            </div>
            <div className="mt-5 space-y-3">
              {fitSignals.map((signal) => (
                <div key={signal} className="flex gap-3 rounded-2xl bg-brand-100/60 p-3 text-sm leading-6 text-muted-foreground dark:bg-white/[0.04]">
                  <CheckCircle2 size={17} className="mt-1 flex-shrink-0 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                  <span>{signal}</span>
                </div>
              ))}
            </div>
            <a href="/micro-offer#intake" className={cn(buttonVariants({ variant: "cta" }), "mt-6 w-full rounded-xl")}>Request the $330 audit</a>
          </aside>
        </div>
      </section>

      <section id="included" className="px-4 py-16 sm:py-20">
        <div className="container mx-auto">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-brand-700 dark:text-brand-100">What you get</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-5xl">A clear decision path, not a bloated proposal.</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {offerCards.map((card) => {
              const Icon = card.icon;
              return (
                <article key={card.title} className="rounded-[1.75rem] border border-border bg-card p-6 shadow-[0_18px_60px_rgba(8,63,84,0.08)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-white/10 dark:text-brand-100">
                    <Icon size={22} aria-hidden="true" />
                  </div>
                  <h3 className="text-xl font-semibold text-ink dark:text-white">{card.title}</h3>
                  <div className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
                    <p><span className="font-semibold text-ink dark:text-white">Pain:</span> {card.pain}</p>
                    <p><span className="font-semibold text-ink dark:text-white">Solution:</span> {card.solution}</p>
                    <p><span className="font-semibold text-ink dark:text-white">Outcome:</span> {card.outcome}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-10 grid gap-6 rounded-[2rem] border border-border bg-white p-5 dark:bg-white/[0.04] sm:p-7 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Included checklist</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-ink dark:text-white">The audit is designed to turn uncertainty into one next action.</h3>
            </div>
            <div className="space-y-3">
              {included.map((item) => (
                <div key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                  <ArrowRight size={16} className="mt-1 flex-shrink-0 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-brand-950 px-4 py-16 text-white dark:bg-brand-900 sm:py-20">
        <div className="container mx-auto grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-brand-100">Credibility fit</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] md:text-5xl">Built for owner-led businesses and regulated teams that need clarity.</h2>
          </div>
          <div className="space-y-4 text-base leading-8 text-white/78">
            <p>MehyarSoft is founder-led by Mehyar Swelim, a senior software/systems consultant with 10+ years of professional engineering experience and current pharma systems-engineering work.</p>
            <p>The point of the $330 path is restraint: identify the leak, protect the intake boundary, and recommend the smallest practical next step before proposing cleanup, booking setup, AI follow-up, or a larger automation sprint.</p>
          </div>
        </div>
      </section>

      <div id="intake" className="scroll-mt-24">
        <ContactSection
          mode="offer_330_missed_lead_rescue"
          serviceCategory="ai_missed_lead_rescue_330"
          selectedOffer="ai_missed_lead_rescue_330"
          source="330_micro_offer"
          campaign="330_micro_offer"
        />
      </div>
    </>
  );
};

export default MicroOffer;
