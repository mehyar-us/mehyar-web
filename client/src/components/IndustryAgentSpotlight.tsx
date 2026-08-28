import { ArrowRight, Bot, BrainCircuit, CalendarCheck2, MessageSquareText, Mic2, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import type { IndustryOffer } from "@/data/industry-offers";
import { getAgentUseCases } from "@/data/agent-services";
import { buttonVariants } from "@/components/ui/button";

const previewIcons = [CalendarCheck2, MessageSquareText, BrainCircuit, Mic2];

export default function IndustryAgentSpotlight({ industry }: { industry: IndustryOffer }) {
  const useCases = getAgentUseCases(industry).slice(0, 4);

  return (
    <section id="ai-command-center" className="scroll-mt-40 border-b border-border bg-brand-950 px-4 py-10 text-white md:py-14" aria-labelledby="industry-ai-command-title">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <div className="flex flex-wrap gap-2"><span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-brand-100"><Bot className="h-4 w-4" />OpenClaw</span><span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-950"><BrainCircuit className="h-4 w-4" />Hermes Agent</span></div>
            <p className="mt-5 text-sm font-bold uppercase tracking-[0.2em] text-brand-100">AI command center for {industry.shortName.toLowerCase()}</p>
            <h2 id="industry-ai-command-title" className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">A business assistant you can message from your phone.</h2>
            <p className="mt-4 text-base leading-7 text-white/70">Ask what needs attention, prepare customer follow-up, check the schedule, summarize reviews, plan content, or start an approved workflow—without opening five different systems.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href="#ai-business-assistant-details" className={buttonVariants({ variant: "secondary", size: "lg" })}>See all 10 uses and pricing<ArrowRight className="ml-2 h-4 w-4" /></a>
              <Link href={`/booking?service=OpenClaw%20or%20Hermes%20business%20agent&industry=${encodeURIComponent(industry.shortName)}`} className={buttonVariants({ variant: "outline", size: "lg", className: "border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" })}>Discuss my command center</Link>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {useCases.map((useCase, index) => {
              const Icon = previewIcons[index];
              return <article key={useCase.title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-100"><Icon className="h-4 w-4" /></span><div><h3 className="font-semibold">{useCase.title}</h3><p className="mt-1 text-sm leading-6 text-white/70">{useCase.example}</p></div></div><span className="mt-3 inline-flex rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-brand-100">Best fit: {useCase.bestAgent}</span></article>;
            })}
          </div>
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-6 text-white/70"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-100" /><p>It works only with the tools, users, and actions you approve. Sending, publishing, payments, and sensitive decisions can require human confirmation.</p></div>
      </div>
    </section>
  );
}
