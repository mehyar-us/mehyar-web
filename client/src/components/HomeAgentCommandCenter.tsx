import { ArrowRight, Bot, BrainCircuit, CalendarCheck2, MessagesSquare, Mic2, Search, ShieldCheck, Smartphone, Workflow } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import { industryOffers } from "@/data/industry-offers";

const capabilities = [
  { icon: Mic2, title: "Send a voice note", text: "Ask for today’s priorities, a lead update, or a follow-up draft while you are away from a desk." },
  { icon: MessagesSquare, title: "Triage every inbox", text: "Summarize calls, forms, email, texts, and social messages so valuable requests are not buried." },
  { icon: CalendarCheck2, title: "Coordinate the schedule", text: "Check approved availability, prepare confirmations, and keep changes from becoming phone tag." },
  { icon: Workflow, title: "Run approved workflows", text: "Update records, prepare reports, trigger reminders, and route work with clear permission rules." },
  { icon: Search, title: "Research and remember", text: "Build recurring briefs, monitor useful information, and retain approved operating knowledge." },
  { icon: ShieldCheck, title: "Keep people in control", text: "External messages, publishing, payments, and sensitive actions wait for the approvals you define." },
];

export default function HomeAgentCommandCenter() {
  return (
    <section id="ai-command-center" className="scroll-mt-24 border-b border-white/10 bg-brand-950 px-4 py-12 text-white md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-brand-100"><Bot className="h-4 w-4" aria-hidden="true" />OpenClaw</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1.5 text-sm font-semibold text-brand-950"><BrainCircuit className="h-4 w-4" aria-hidden="true" />Hermes Agent</span>
            </div>
            <p className="mt-5 text-sm font-bold uppercase tracking-[0.2em] text-brand-100">Your private AI business command center</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl md:text-5xl">Message your business. Get the work moving.</h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/75 md:text-lg">We install and maintain a private assistant you can direct from Telegram or another approved channel. OpenClaw connects your commands to business tools. Hermes adds memory, recurring research, scheduled briefings, and specialist routines.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/services#ai-business-operators" className={buttonVariants({ variant: "secondary", size: "lg" })}>Compare the two assistants<ArrowRight className="ml-2 h-4 w-4" /></Link>
              <Link href="/booking?service=OpenClaw%20or%20Hermes%20business%20agent" className={buttonVariants({ variant: "outline", size: "lg", className: "border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" })}>Talk through my setup</Link>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[1.75rem] border border-white/15 bg-white/[0.05] p-2 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
            <img src="/assets/agent-services/mobile-command-assistant.webp" alt="Business owner directing an AI business assistant from a phone" className="h-[300px] w-full rounded-[1.35rem] object-cover sm:h-[390px]" loading="eager" />
            <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-white/15 bg-brand-950/90 p-4 backdrop-blur">
              <p className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4 text-brand-100" aria-hidden="true" />A practical example</p>
              <p className="mt-1 text-sm leading-6 text-white/70">“Show me today’s bookings, unanswered leads, and the three follow-ups I should approve first.”</p>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-100"><Icon className="h-4 w-4" aria-hidden="true" /></span><h3 className="font-semibold">{title}</h3></div>
              <p className="mt-3 text-sm leading-6 text-white/70">{text}</p>
            </article>
          ))}
        </div>

        <div className="mt-9 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-100">See what it can do for you</p><h3 className="mt-2 text-2xl font-semibold">Choose your type of business.</h3></div>
            <Link href="/pricing" className="inline-flex items-center text-sm font-semibold text-brand-100 hover:underline">View all industries<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {industryOffers.map((industry) => <Link key={industry.id} href={`/industries/${industry.id}#ai-command-center`} className="rounded-xl border border-white/10 bg-brand-950/55 px-3 py-3 text-sm font-semibold text-white transition hover:border-brand-100/50 hover:bg-white/10">{industry.shortName}<ArrowRight className="ml-1 inline h-3.5 w-3.5 text-brand-100" aria-hidden="true" /></Link>)}
          </div>
        </div>
      </div>
    </section>
  );
}
