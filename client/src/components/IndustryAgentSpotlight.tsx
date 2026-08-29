import { ArrowRight, Bot, BrainCircuit, CalendarCheck2, MessageSquareText, Mic2, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import type { IndustryOffer } from "@/data/industry-offers";
import { getAgentUseCases } from "@/data/agent-services";
import { buttonVariants } from "@/components/ui/button";

const previewIcons = [CalendarCheck2, MessageSquareText, BrainCircuit, Mic2];

export default function IndustryAgentSpotlight({ industry }: { industry: IndustryOffer }) {
  const useCases = getAgentUseCases(industry).slice(0, 4);

  return (
    <section id="ai-command-center" className="scroll-mt-40 border-b border-border bg-brand-950 px-4 py-12 text-white md:py-16" aria-labelledby="industry-ai-command-title">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand-100">24/7 AI command center for {industry.shortName.toLowerCase()}</p>
            <h2 id="industry-ai-command-title" className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">A business assistant you can message from your phone.</h2>
            <p className="mt-4 text-base leading-7 text-white/70">Ask what needs attention, prepare customer follow-up, check the schedule, summarize reviews, plan content, or start an approved workflow—without opening five systems or learning technical commands.</p>
            <div className="mt-5 flex flex-wrap gap-2"><span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-brand-100"><Bot className="h-4 w-4" />Fast action assistant</span><span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-950"><BrainCircuit className="h-4 w-4" />Research and memory assistant</span></div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href="#ai-business-assistant-details" className={buttonVariants({ variant: "secondary", size: "lg" })}>See all 10 uses and pricing<ArrowRight className="ml-2 h-4 w-4" /></a>
              <Link href={`/booking?service=OpenClaw%20or%20Hermes%20business%20agent&industry=${encodeURIComponent(industry.shortName)}`} className={buttonVariants({ variant: "outline", size: "lg", className: "border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" })}>Discuss my command center</Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.06]">
            <img src="/assets/sales-system/ai-system.webp" alt="" className="aspect-[16/9] w-full bg-white object-cover" loading="lazy" />
            <div className="grid grid-cols-2 border-t border-white/10">
              {useCases.map((useCase, index) => {
                const Icon = previewIcons[index];
                return <article key={useCase.title} className="border-b border-r border-white/10 p-3 sm:p-4"><Icon className="h-4 w-4 text-brand-100" /><h3 className="mt-2 text-sm font-semibold">{useCase.title}</h3><p className="mt-1 hidden text-xs leading-5 text-white/65 sm:block">{useCase.benefit}</p></article>;
              })}
            </div>
          </div>
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-6 text-white/70"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-100" /><p>It works only with the tools, users, and actions you approve. Sending, publishing, payments, and sensitive decisions can require human confirmation.</p></div>
      </div>
    </section>
  );
}
