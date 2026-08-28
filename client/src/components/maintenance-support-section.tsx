import { ArrowRight, CheckCircle2, LifeBuoy, ShieldCheck, Wrench } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import { openSupportTicket } from "@/components/SupportTicketModal";

const plans = [
  {
    name: "Essential Care",
    price: "$149/month",
    annual: "$1,490/year",
    summary: "For a small website or customer app that needs dependable upkeep.",
    items: ["Hosting and uptime checks", "Security and dependency updates", "Backups and recovery help", "Up to 30 minutes of small content changes"],
  },
  {
    name: "Growth Care",
    price: "$349/month",
    annual: "$3,490/year",
    summary: "For businesses using booking, forms, email, SMS, or automations.",
    items: ["Everything in Essential Care", "Monthly booking and form checks", "Automation and delivery monitoring", "Up to 2 hours of fixes or improvements"],
  },
  {
    name: "Priority Operations",
    price: "$699/month",
    annual: "$6,990/year",
    summary: "For a customer-facing system that needs faster help and active oversight.",
    items: ["Everything in Growth Care", "Priority response and incident help", "Monthly performance review", "Up to 5 hours of fixes or improvements"],
  },
] as const;

export default function MaintenanceSupportSection({ compact = false }: { compact?: boolean }) {
  return (
    <section className="border-y border-border bg-brand-950 px-4 py-14 text-white md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-7 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-100">Maintenance and real support</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">Your system should keep working after launch.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/75">Send one support ticket for a broken form, website update, booking issue, automation problem, or improvement request. We keep the work, business details, and affected service together.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
            <button type="button" onClick={openSupportTicket} className={buttonVariants({ variant: "secondary", size: "lg" })}><LifeBuoy className="mr-2 h-4 w-4" />Create support ticket</button>
            <Link href="/contact?service=maintenance" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/30 bg-transparent px-8 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-950">Ask about maintenance<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </div>
        </div>

        {!compact ? (
          <div className="mt-9 grid gap-5 lg:grid-cols-3">
            {plans.map((plan, index) => (
              <article key={plan.name} className={`rounded-[1.5rem] border p-5 ${index === 1 ? "border-brand-100/60 bg-white/[0.12]" : "border-white/15 bg-white/[0.06]"}`}>
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">{index === 0 ? <ShieldCheck className="h-5 w-5" /> : index === 1 ? <Wrench className="h-5 w-5" /> : <LifeBuoy className="h-5 w-5" />}</span><h3 className="text-xl font-semibold">{plan.name}</h3></div>
                <p className="mt-4 text-sm leading-6 text-white/70">{plan.summary}</p>
                <p className="mt-5 text-2xl font-semibold">{plan.price}</p>
                <p className="text-sm text-white/60">or {plan.annual}</p>
                <ul className="mt-5 space-y-2 text-sm leading-6 text-white/80">{plan.items.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-brand-100" />{item}</li>)}</ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-8 grid divide-y divide-white/15 border-y border-white/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">{["Hosting, backups, and security", "Forms, booking, and automations checked", "Clear support tickets and accountable follow-through"].map((item) => <div key={item} className="flex gap-2 px-2 py-4 text-sm leading-6 text-white/80 sm:px-5"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-brand-100" />{item}</div>)}</div>
        )}
        <p className="mt-6 text-xs leading-5 text-white/55">One-time repair work starts at $250 after review. Response times, included hours, third-party fees, and emergency coverage are confirmed in the written scope.</p>
      </div>
    </section>
  );
}
