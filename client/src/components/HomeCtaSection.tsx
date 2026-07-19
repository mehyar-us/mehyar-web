// HomeCtaSection — two big, side-by-side action buttons at the bottom of the
// homepage. Each opens a focused modal popup (intake form or AI checklist
// signup) instead of carrying forms inline. Designed to be tappable on every
// viewport: full-width on mobile, two equal columns on sm+.

import { useState } from "react";
import { ArrowRight, Mail, Sparkles } from "lucide-react";
import IntakePopup from "@/components/IntakePopup";
import ChecklistPopup from "@/components/ChecklistPopup";

const HomeCtaSection = () => {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  return (
    <section
      id="contact"
      className="scroll-mt-24 border-t border-border/40 bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--muted))_100%)] px-4 py-12 dark:bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background))_100%)] sm:py-14"
    >
      <div className="container mx-auto max-w-4xl">
        <div className="mb-6 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-brand-700 dark:text-brand-100">
            Two ways to start
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] text-ink dark:text-white sm:text-3xl">
            Send the leak, or grab the free checklist.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            One short step either way. No drip campaign, no fake availability — an
            honest scoped answer or a direct no-fit.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <button
            type="button"
            onClick={() => setIntakeOpen(true)}
            className="group flex items-center gap-4 rounded-2xl border border-action/30 bg-action px-5 py-5 text-left text-white shadow-lg shadow-brand-900/20 transition hover:bg-action-strong sm:px-6 sm:py-6"
          >
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 transition group-hover:bg-white/25 sm:h-14 sm:w-14">
              <Mail className="h-5 w-5 text-white sm:h-6 sm:w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold leading-tight sm:text-lg">Send the leak</p>
              <p className="mt-1 text-xs text-white/85 sm:text-sm">
                Open the intake form. Founder-reviewed, one practical next step back.
              </p>
            </div>
            <ArrowRight className="h-5 w-5 flex-shrink-0 text-white/80 transition group-hover:translate-x-1" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setChecklistOpen(true)}
            className="group flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-5 text-left text-ink shadow-sm transition hover:border-brand-700/40 hover:bg-brand-50 dark:text-white dark:hover:bg-white/[0.06] sm:px-6 sm:py-6"
          >
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 dark:bg-white/10 sm:h-14 sm:w-14">
              <Sparkles className="h-5 w-5 text-brand-700 dark:text-brand-100 sm:h-6 sm:w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold leading-tight sm:text-lg">Get the free AI checklist</p>
              <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                Open the signup. Practical leakage fixes, short and unsubscribe-anytime.
              </p>
            </div>
            <ArrowRight className="h-5 w-5 flex-shrink-0 text-brand-700 transition group-hover:translate-x-1 dark:text-brand-100" aria-hidden="true" />
          </button>
        </div>

        <p className="mx-auto mt-5 max-w-xl text-center text-xs leading-5 text-muted-foreground">
          Or email{" "}
          <a className="underline" href="mailto:contact@mehyar.us">contact@mehyar.us</a>
          {" "}with a short brief.
        </p>
      </div>

      <IntakePopup open={intakeOpen} onOpenChange={setIntakeOpen} />
      <ChecklistPopup open={checklistOpen} onOpenChange={setChecklistOpen} />
    </section>
  );
};

export default HomeCtaSection;