import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Bot,
  Check,
  CloudCog,
  Code2,
  Globe2,
  Inbox,
  MessageSquareText,
  PhoneCall,
  Sparkles,
  UsersRound,
  Workflow,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const paths = [
  {
    id: "customers",
    tab: "Win customers",
    icon: Globe2,
    eyebrow: "Customer experience",
    title: "Make it easy to discover, trust, and book you.",
    summary: "A clear website and installable customer app that turns interest into an organized relationship—not another missed message.",
    details: [
      ["Good fit when", "People call, DM, or visit your site but do not consistently book."],
      ["What we build", "Branded website or PWA, customer login, booking, payments, forms, email, and your customer list."],
      ["What changes", "Customers get one simple place to act, while your team sees every request."],
      ["Starting point", "Website and booking projects typically start at $750; complete customer systems are scoped to the workflow."],
    ],
    flow: [
      [Globe2, "Visit", "A focused website"],
      [UsersRound, "Choose", "Service or appointment"],
      [Check, "Book", "Confirmation and account"],
    ],
    href: "/pricing",
    cta: "See my industry",
  },
  {
    id: "operations",
    tab: "Run the work",
    icon: Workflow,
    eyebrow: "Automation and operations",
    title: "Replace follow-up chaos with one reliable workflow.",
    summary: "Connect forms, calls, inboxes, spreadsheets, and staff handoffs so routine work happens on time and exceptions stay visible.",
    details: [
      ["Good fit when", "Your team copies information, chases updates, or relies on one person’s memory."],
      ["What we build", "CRM workflows, reminders, intake routing, dashboards, document steps, reporting, and system integrations."],
      ["What changes", "Less retyping and fewer dropped handoffs, with a clear place to see what happened."],
      ["Starting point", "Focused automations start around $1,500; operational sprints typically range from $3,000 to $12,000."],
    ],
    flow: [
      [Inbox, "Capture", "Calls, forms, email"],
      [Workflow, "Route", "Rules and approvals"],
      [MessageSquareText, "Follow up", "Right person, right time"],
    ],
    href: "/services#automation-sprint",
    cta: "Explore automation",
  },
  {
    id: "software",
    tab: "Build a system",
    icon: Code2,
    eyebrow: "Custom software and cloud",
    title: "Build the system your operation cannot buy off the shelf.",
    summary: "Senior product and engineering work for portals, internal tools, APIs, data platforms, secure backends, and cloud operations.",
    details: [
      ["Good fit when", "Existing tools force workarounds, cannot integrate safely, or do not match a proven workflow."],
      ["What we build", "CRMs, portals, dashboards, APIs, databases, AI systems, AWS, Azure, Google Cloud, Cloudflare, and DevOps."],
      ["What changes", "Teams work in a system shaped around the real process, with permissions, documentation, and support."],
      ["Starting point", "Architecture and scoped builds are estimated after discovery; advisory is available from $150 per hour."],
    ],
    flow: [
      [UsersRound, "Understand", "People and workflow"],
      [Code2, "Build", "Product and integrations"],
      [CloudCog, "Operate", "Cloud, data, support"],
    ],
    href: "/services#software-builds",
    cta: "Explore engineering",
  },
  {
    id: "ai",
    tab: "Add an AI assistant",
    icon: Bot,
    eyebrow: "Managed AI command center",
    title: "Give your team an assistant that can actually help do the work.",
    summary: "We install and maintain OpenClaw or Hermes with your approved tools, knowledge, permissions, channels, and human approval rules.",
    details: [
      ["Good fit when", "You need faster research, inbox summaries, scheduling help, drafts, reporting, or repeatable specialist routines."],
      ["What we build", "A private assistant reachable from mobile, Telegram, or approved channels, connected only to the tools you choose."],
      ["What changes", "Ask in plain language, review sensitive actions, and keep recurring work moving while you are away from a desk."],
      ["Starting point", "Choose a managed monthly plan or a fixed setup with your own infrastructure and 12 months of support."],
    ],
    flow: [
      [PhoneCall, "Ask", "Text or voice command"],
      [Sparkles, "Prepare", "Research and action"],
      [Check, "Approve", "You stay in control"],
    ],
    href: "/services#ai-business-operators",
    cta: "Compare AI assistants",
  },
] as const;

type PathId = (typeof paths)[number]["id"];

export default function ServiceDecisionGuide({ compact = false }: { compact?: boolean }) {
  const [activeId, setActiveId] = useState<PathId>("customers");
  const active = paths.find((path) => path.id === activeId) ?? paths[0];
  const ActiveIcon = active.icon;

  return (
    <section id="solutions" className={cn("scroll-mt-24 border-b border-border bg-background px-4", compact ? "py-12 md:py-16" : "py-14 md:py-20")}>
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="site-eyebrow">Find the right starting point</p>
          <h2 className="site-heading mt-3">What do you need to make easier?</h2>
          <p className="site-lede mt-4 max-w-2xl">Choose an outcome. You will see what it solves, what we build, how it works, and the likely starting point—without decoding technical language.</p>
        </div>

        <div className="scrollbar-none -mx-4 mt-8 flex overflow-x-auto border-y border-border px-4 md:mx-0 md:grid md:grid-cols-4 md:px-0" role="tablist" aria-label="Service paths">
          {paths.map((path) => {
            const Icon = path.icon;
            const selected = path.id === activeId;
            return (
              <button key={path.id} type="button" role="tab" aria-selected={selected} onClick={() => setActiveId(path.id)} className={cn("relative flex min-h-16 min-w-[10.5rem] items-center gap-2 border-r border-border px-4 py-3 text-left text-sm font-semibold transition last:border-r-0 md:min-w-0", selected ? "bg-brand-950 text-white dark:bg-white dark:text-brand-950" : "bg-background text-muted-foreground hover:bg-muted/45 hover:text-foreground")}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{path.tab}
                {selected ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-action" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        <div className="grid border-x border-b border-border lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-border p-5 sm:p-7 lg:border-b-0 lg:border-r lg:p-9">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100"><ActiveIcon className="h-4 w-4" />{active.eyebrow}</p>
            <h3 className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">{active.title}</h3>
            <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">{active.summary}</p>
            <Link href={active.href} className={buttonVariants({ variant: "cta", size: "lg", className: "mt-6 w-full sm:w-auto" })}>{active.cta}<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </div>

          <div className="min-w-0">
            <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-muted/20">
              {active.flow.map(([Icon, title, detail], index) => (
                <div key={title} className="relative px-3 py-5 text-center sm:px-5">
                  <span className="mx-auto grid h-9 w-9 place-items-center border border-brand-700/20 bg-white text-brand-800 shadow-sm dark:bg-white/10 dark:text-brand-100"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <p className="mt-2 text-xs font-semibold text-foreground sm:text-sm">{title}</p>
                  <p className="mt-1 hidden text-xs leading-5 text-muted-foreground sm:block">{detail}</p>
                  {index < 2 ? <ArrowRight className="absolute -right-2.5 top-8 z-10 h-4 w-4 bg-background text-brand-700" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
            <dl className="divide-y divide-border">
              {active.details.map(([term, detail]) => (
                <div key={term} className="grid gap-1 px-5 py-4 sm:grid-cols-[8rem_1fr] sm:gap-5 sm:px-7">
                  <dt className="text-xs font-bold uppercase tracking-[0.12em] text-foreground">{term}</dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
