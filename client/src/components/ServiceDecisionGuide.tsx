import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  CalendarClock,
  Check,
  Code2,
  Gauge,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Workflow,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const paths = [
  {
    id: "customers",
    tab: "Get more customers",
    icon: UsersRound,
    kicker: "Recommended starting point",
    title: "Turn more interest into booked, paying customers.",
    summary: "Give people one clear place to discover you, choose, book, pay, and come back—while every request lands in a list you own.",
    outcome: "More qualified requests and fewer missed bookings.",
    includes: "Branded website or PWA, booking, forms, email, customer list, and reporting.",
    price: "$650 setup",
    cadence: "+ $39/month",
    engagement: "Launch in 1–3 weeks, then improve month to month.",
    image: "/assets/sales-system/growth-system.webp",
    href: "/pricing",
    cta: "Find my industry plan",
  },
  {
    id: "operations",
    tab: "Run operations better",
    icon: Workflow,
    kicker: "Recommended operations sprint",
    title: "Replace handoff chaos with one reliable workflow.",
    summary: "Connect forms, inboxes, spreadsheets, approvals, and reminders so routine work moves automatically and exceptions stay visible.",
    outcome: "Less retyping, faster response, and fewer dropped tasks.",
    includes: "Workflow map, automation, routing, reminders, dashboard, and team handoff guide.",
    price: "$1,500 setup",
    cadence: "Focused flows",
    engagement: "A 2–6 week sprint with a clear before-and-after process.",
    image: "/assets/sales-system/operations-system.webp",
    href: "/services#automation-sprint",
    cta: "Explore automation",
  },
  {
    id: "software",
    tab: "Build custom software",
    icon: Code2,
    kicker: "Recommended custom build",
    title: "Build the system your operation cannot buy off the shelf.",
    summary: "Design a focused CRM, portal, internal app, API, data platform, or secure cloud backend around the way your team actually works.",
    outcome: "One dependable product instead of disconnected workarounds.",
    includes: "Product design, engineering, APIs, databases, permissions, cloud, DevOps, and support.",
    price: "From $5,000",
    cadence: "After discovery",
    engagement: "Milestone-based delivery with demos, testing, and documentation.",
    image: "/assets/sales-system/software-system.webp",
    href: "/services#software-builds",
    cta: "Explore engineering",
  },
  {
    id: "ai",
    tab: "Put AI to work",
    icon: Sparkles,
    kicker: "Recommended managed AI setup",
    title: "Give your team an assistant that can actually help do the work.",
    summary: "Use a private assistant from your phone to summarize, research, schedule, prepare follow-up, and run approved routines across the tools you choose.",
    outcome: "Faster routine work while sensitive actions stay under approval.",
    includes: "Private gateway, mobile commands, three workflows, approvals, monitoring, and maintenance.",
    price: "$1,500 setup",
    cadence: "+ $349/month",
    engagement: "Managed for you, with monthly maintenance and safe improvements.",
    image: "/assets/sales-system/ai-system.webp",
    href: "/services#ai-business-operators",
    cta: "See managed AI",
  },
] as const;

type PathId = (typeof paths)[number]["id"];

const facts = [
  [Gauge, "Outcome first", "Start with the business problem, not a technology shopping list."],
  [ShieldCheck, "Clear scope", "See what is included, what it costs, and what needs approval."],
  [CalendarClock, "Managed after launch", "Maintenance and support stay available when the system is live."],
] as const;

export default function ServiceDecisionGuide({ compact = false }: { compact?: boolean }) {
  const [activeId, setActiveId] = useState<PathId>("customers");
  const active = paths.find((path) => path.id === activeId) ?? paths[0];
  const ActiveIcon = active.icon;

  return (
    <section id="solutions" className={cn("scroll-mt-24 border-b border-border bg-background px-4", compact ? "pb-12 pt-5 md:pb-16" : "py-14 md:py-20")}>
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="site-eyebrow">What do you need to improve?</p>
          <h2 className="site-heading mt-3">Pick the result. See a practical starting point.</h2>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4" role="tablist" aria-label="Choose a business result">
          {paths.map((path) => {
            const Icon = path.icon;
            const selected = path.id === activeId;
            return (
              <button
                key={path.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="service-recommendation"
                onClick={() => setActiveId(path.id)}
                className={cn(
                  "relative min-h-32 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-36 sm:p-5",
                  selected
                    ? "border-brand-700 bg-brand-100/55 text-brand-950 shadow-[0_12px_35px_rgba(6,47,66,0.1)] dark:bg-white/10 dark:text-white"
                    : "border-border bg-card text-foreground hover:-translate-y-0.5 hover:border-brand-700/35 hover:shadow-sm",
                )}
              >
                <span className={cn("grid h-10 w-10 place-items-center rounded-xl", selected ? "bg-brand-700 text-white" : "bg-muted text-brand-800 dark:bg-white/10 dark:text-brand-100")}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="mt-4 block text-sm font-semibold leading-5 sm:text-base">{path.tab}</span>
                {selected ? <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-brand-700 text-white"><Check className="h-3.5 w-3.5" /></span> : null}
              </button>
            );
          })}
        </div>

        <article id="service-recommendation" role="tabpanel" className="mt-5 overflow-hidden rounded-[1.75rem] border border-brand-700/20 bg-card shadow-[0_18px_60px_rgba(6,47,66,0.1)]">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-5 sm:p-7 lg:p-9">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-100"><ActiveIcon className="h-4 w-4" />{active.kicker}</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">{active.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">{active.summary}</p>
              <img src={active.image} alt="" className="mt-5 aspect-[16/10] w-full rounded-2xl bg-muted/25 object-cover lg:hidden" loading="eager" />
            </div>
            <div className="hidden min-h-72 bg-muted/25 lg:block">
              <img src={active.image} alt="" className="h-full w-full object-cover" loading="eager" />
            </div>
          </div>

          <div className="grid border-t border-border sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Outcome", active.outcome],
              ["What is included", active.includes],
              ["Starting price", active.price + " " + active.cadence],
              ["How we work", active.engagement],
            ].map(([label, value]) => (
              <div key={label} className="border-b border-border p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(n+3)]:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0 lg:p-5">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-100">{label}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-foreground">{value}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-border bg-brand-100/45 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-5 dark:bg-white/[0.04]">
            <p className="text-sm leading-6 text-muted-foreground">No mystery proposal: we confirm scope, running costs, ownership, and support before work begins.</p>
            <Link href={active.href} className={buttonVariants({ variant: "cta", size: "lg", className: "mt-4 w-full shrink-0 sm:mt-0 sm:w-auto" })}>{active.cta}<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </div>
        </article>

        <div className="mt-5 grid overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3">
          {facts.map(([Icon, title, text]) => (
            <div key={title} className="flex gap-3 border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-100" />
              <div><p className="text-sm font-semibold text-foreground">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
