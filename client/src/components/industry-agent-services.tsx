import { ArrowRight, Bot, BrainCircuit, CalendarDays, Clock3, DollarSign, LockKeyhole, MessageSquareText, Send, Server, ShieldCheck, Smartphone, Sparkles, UserCheck, Users, Workflow, Wrench } from "lucide-react";
import { Link } from "wouter";
import type { IndustryOffer } from "@/data/industry-offers";
import { getAgentUseCases, managedAgentOffers } from "@/data/agent-services";
import { buttonVariants } from "@/components/ui/button";

const useCaseIcons = [Clock3, MessageSquareText, Workflow, Clock3, BrainCircuit, MessageSquareText, MessageSquareText, BrainCircuit, Workflow, Smartphone];
const trustIcons = [LockKeyhole, Users, UserCheck, Wrench];
const openClawIcons = [MessageSquareText, Workflow, Clock3, Smartphone];
const hermesIcons = [BrainCircuit, CalendarDays, Bot, Sparkles];
const managedIncludeIcons = [Server, Smartphone, ShieldCheck, Wrench];

export default function IndustryAgentServices({ industry }: { industry: IndustryOffer }) {
  const useCases = getAgentUseCases(industry);
  return (
    <section id="ai-business-assistant" className="scroll-mt-24 border-t border-border bg-background px-4 py-14 md:py-20" aria-labelledby="agent-services-title">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Private AI business operator</p>
            <h2 id="agent-services-title" className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Message your business assistant from your phone.</h2>
            <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">Ask for a morning brief, follow-up list, approved outreach draft, schedule check, review summary, or content plan from Telegram or another approved channel. The system works on your business tools while sensitive actions stay behind permission and human approval.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {["Private, isolated business environment", "Approved channels and authorized users only", "Human approval for sending and risky actions", "Monitoring, backups, maintenance, and support"].map((item, index) => { const ItemIcon = trustIcons[index]; return <div key={item} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm leading-6 text-foreground"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-800 dark:bg-white/10 dark:text-brand-100"><ItemIcon className="h-4 w-4" aria-hidden="true" /></span><span>{item}</span></div>; })}
            </div>
          </div>
          <img src="/assets/agent-services/mobile-command-assistant.webp" alt="New York small-business owner directing work from a phone" className="min-h-80 w-full rounded-[1.75rem] border border-border object-cover shadow-[0_22px_60px_rgba(8,63,84,0.15)]" loading="lazy" />
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <article className="rounded-[1.5rem] border border-border bg-card p-6">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-950 text-brand-100"><Bot className="h-5 w-5" /></span><div><h3 className="text-2xl font-semibold text-foreground">OpenClaw</h3><p className="text-sm text-muted-foreground">Best for command, channel routing, and action from your phone</p></div></div>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">{["Connects Telegram, WhatsApp, Slack, Discord, and other supported channels to an agent gateway", "Keeps separate sessions and routes work to the right agent or workspace", "Runs schedules, webhooks, skills, and approved actions from a central gateway", "Strong fit when the owner wants one mobile command center"].map((item, index) => { const ItemIcon = openClawIcons[index]; return <li key={item} className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-800 dark:bg-white/10 dark:text-brand-100"><ItemIcon className="h-3.5 w-3.5" aria-hidden="true" /></span><span>{item}</span></li>; })}</ul>
            <a href="https://docs.openclaw.ai/" target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center text-sm font-semibold text-brand-800 hover:underline dark:text-brand-100">Read official OpenClaw documentation<ArrowRight className="ml-2 h-4 w-4" /></a>
          </article>
          <article className="rounded-[1.5rem] border border-border bg-card p-6">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-white/10 dark:text-brand-100"><BrainCircuit className="h-5 w-5" /></span><div><h3 className="text-2xl font-semibold text-foreground">Hermes Agent</h3><p className="text-sm text-muted-foreground">Best for memory, recurring research, reports, and specialist routines</p></div></div>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">{["Builds durable memory and reusable skills around approved business routines", "Runs scheduled briefings, research, monitoring, and follow-up tasks", "Supports specialist bots for research, content, operations, or reporting", "Strong fit when the business wants an assistant that improves repeat work over time"].map((item, index) => { const ItemIcon = hermesIcons[index]; return <li key={item} className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><ItemIcon className="h-3.5 w-3.5" aria-hidden="true" /></span><span>{item}</span></li>; })}</ul>
            <a href="https://hermes-agent.nousresearch.com/docs/" target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center text-sm font-semibold text-brand-800 hover:underline dark:text-brand-100">Read official Hermes documentation<ArrowRight className="ml-2 h-4 w-4" /></a>
          </article>
        </div>

        <div className="mt-14">
          <div className="max-w-3xl"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Top uses for {industry.shortName.toLowerCase()}</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Ten jobs your AI operator can help with.</h2><p className="mt-4 leading-7 text-muted-foreground">Each workflow is configured around your approved tools, policies, customer permissions, and review rules. Results depend on lead volume, staff adoption, data quality, and the systems you connect.</p></div>
          <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {useCases.map((useCase, index) => { const Icon = useCaseIcons[index]; return <article key={useCase.title} className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><Icon className="h-4 w-4" /></span><span className="text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, "0")}</span></div><h3 className="mt-4 font-semibold text-foreground">{useCase.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{useCase.example}</p><p className="mt-3 border-t border-border pt-3 text-sm font-medium leading-6 text-foreground">{useCase.benefit}</p><span className="mt-3 inline-flex rounded-full bg-brand-100/70 px-2.5 py-1 text-xs font-semibold text-brand-950 dark:bg-white/10 dark:text-brand-100">Best fit: {useCase.bestAgent}</span></article>; })}
          </div>
        </div>

        <div className="mt-14">
          <div className="max-w-3xl"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Installation and management</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Choose managed service or your own infrastructure.</h2><p className="mt-4 leading-7 text-muted-foreground">Managed plans include hosting and maintenance. Fixed-price installations run on infrastructure you provide and include twelve months of support guidance. Model usage, third-party tools, messaging, and infrastructure beyond the listed scope are confirmed before launch.</p></div>
          <div className="mt-7 grid gap-5 lg:grid-cols-3">
            {managedAgentOffers.map((offer) => <article key={offer.name} className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm"><img src={offer.image} alt="" className="h-44 w-full object-cover" loading="lazy" /><div className="p-5"><h3 className="text-xl font-semibold text-foreground">{offer.name}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{offer.bestFor}</p><div className="mt-5 space-y-2"><p className="flex items-center gap-2 rounded-xl bg-brand-950 p-3 text-sm font-semibold text-white"><DollarSign className="h-4 w-4 shrink-0" aria-hidden="true" />Monthly: {offer.managed}</p><p className="flex items-center gap-2 rounded-xl bg-secondary p-3 text-sm font-semibold text-secondary-foreground"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />Annual: {offer.annual}</p><p className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-semibold text-foreground"><Server className="h-4 w-4 shrink-0" aria-hidden="true" />Your infrastructure: {offer.owned}</p><p className="text-xs leading-5 text-muted-foreground">{offer.ownedNote}</p></div><ul className="mt-5 space-y-2 text-sm leading-6 text-muted-foreground">{offer.includes.map((item, index) => { const ItemIcon = managedIncludeIcons[index % managedIncludeIcons.length]; return <li key={item} className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-800 dark:bg-white/10 dark:text-brand-100"><ItemIcon className="h-3.5 w-3.5" aria-hidden="true" /></span><span>{item}</span></li>; })}</ul><Link href={`/contact?service=systems_consulting&industry=${encodeURIComponent(industry.shortName)}&offer=${encodeURIComponent(offer.name)}`} className={buttonVariants({ variant: "outline", className: "mt-6 w-full" })}>Ask about this setup<ArrowRight className="ml-2 h-4 w-4" /></Link></div></article>)}
          </div>
        </div>

        <div className="mt-8 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><p><strong>Safety rule:</strong> customer outreach, payments, account changes, publishing, medical or legal decisions, and destructive actions require explicit rules and human approval. These assistants support the business; they do not replace licensed judgment or owner responsibility.</p></div>
      </div>
    </section>
  );
}
