import { Link } from "wouter";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

const operatingSignals = [
  "Website and booking path",
  "Missed-call and follow-up rules",
  "CRM, spreadsheets, and internal handoffs",
];

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.16),transparent_34%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_46%,#fff_100%)] px-4 pb-8 pt-24 dark:bg-[radial-gradient(circle_at_top_left,rgba(102,210,235,0.12),transparent_34%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_48%,hsl(var(--brand-950))_100%)] sm:pt-24 md:pb-14 md:pt-28">
      <div className="mx-auto grid max-w-7xl items-center gap-7 lg:grid-cols-[1.03fr_0.97fr] lg:gap-12">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-700/15 bg-white/72 px-3 py-1 text-xs font-semibold text-brand-800 shadow-[0_1px_2px_rgba(10,20,24,0.06)] backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-brand-100 sm:text-sm">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            Senior systems / software / AI automation consultant
          </div>

          <h1 className="max-w-3xl text-[2.05rem] font-semibold leading-[1.03] tracking-[-0.045em] text-ink dark:text-white sm:text-5xl lg:text-[3.55rem] lg:leading-[0.98]">
            Stop losing customers to bad websites, missed calls, manual work, and disconnected systems.
          </h1>

          <p className="mt-4 max-w-2xl text-[0.98rem] leading-7 text-muted-foreground md:text-lg md:leading-8">
            MehyarSoft helps local and regulated businesses find the leak, fix the public path, and install practical automation around intake, follow-up, CRM, reporting, and internal workflows.
          </p>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link href="/micro-offer#intake" className={buttonVariants({ variant: "cta", size: "lg", className: "h-12 px-7 text-base" })}>
              Book a Tech Audit <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link href="/services" className={buttonVariants({ variant: "outline", size: "lg", className: "h-12 px-7 text-base" })}>
              See the leak ladder
            </Link>
          </div>

          <div className="mt-4 grid max-w-2xl gap-2 sm:grid-cols-3 sm:gap-3">
            {operatingSignals.map((signal) => (
              <div key={signal} className="flex items-start gap-2 rounded-xl border border-border bg-white/62 p-2.5 text-sm text-foreground shadow-[0_1px_2px_rgba(10,20,24,0.04)] backdrop-blur dark:bg-white/[0.04] sm:p-3">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-brand-700 dark:text-brand-100" />
                <span>{signal}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative hidden md:block">
          <div className="absolute -inset-6 rounded-[2.25rem] bg-brand-700/10 blur-3xl dark:bg-brand-100/10" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-[1.75rem] border border-border bg-card p-3 shadow-[0_24px_90px_rgba(8,63,84,0.16)] dark:shadow-[0_24px_90px_rgba(0,0,0,0.38)] sm:p-4">
            <div className="rounded-[1.35rem] border border-border bg-gradient-to-br from-white via-brand-100/35 to-white p-4 dark:from-brand-900 dark:via-brand-800/45 dark:to-brand-950 sm:p-5">
              <div className="mb-4 flex items-center justify-between border-b border-border pb-3 sm:mb-5 sm:pb-4">
                <div>
                  <p className="text-sm font-semibold text-brand-800 dark:text-brand-100">Leak map</p>
                  <p className="text-xs text-muted-foreground">Audit → fix → automate → retain</p>
                </div>
                <div className="rounded-full bg-action px-3 py-1 text-xs font-semibold text-white dark:text-brand-950">Next step ready</div>
              </div>

              <div className="space-y-2.5 sm:space-y-3">
                {[
                  ["Customer path", "Homepage, service page, booking, intake", "Clarify"],
                  ["Response gap", "Missed calls, form leads, no-shows", "Follow up"],
                  ["Operations", "CRM, spreadsheets, inbox handoffs", "Automate"],
                  ["Risk control", "Access, opt-outs, audit trail, change notes", "Stabilize"],
                ].map(([title, detail, action]) => (
                  <div key={title} className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl border border-border bg-white/86 p-3 dark:bg-white/[0.04] sm:gap-4 sm:p-4">
                    <div>
                      <p className="font-semibold text-foreground">{title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">{detail}</p>
                    </div>
                    <div className="self-center rounded-xl bg-secondary px-2.5 py-1.5 text-xs font-semibold text-secondary-foreground dark:bg-white/10 dark:text-brand-100 sm:px-3 sm:py-2 sm:text-sm">
                      {action}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-brand-700/20 bg-brand-950 p-4 text-white dark:border-white/10 sm:mt-5 sm:p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-100">Founder-led</p>
                <p className="mt-2 text-xl font-semibold leading-tight sm:text-2xl">One senior technical owner, scoped around the business leak.</p>
                <p className="mt-2 text-sm leading-6 text-white/72">No fake agency theater. No unsupported claims. Just practical systems work with clear handoff.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;