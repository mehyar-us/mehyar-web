import { ArrowRight, CalendarCheck2, MessageSquareText, BrainCircuit, Mic2, ShieldCheck } from "lucide-react";
import type { IndustryOffer } from "@/data/industry-offers";
import { getAgentUseCases } from "@/data/agent-services";
import { buttonVariants } from "@/components/ui/button";

const previewIcons = [CalendarCheck2, MessageSquareText, BrainCircuit, Mic2];

export default function IndustryAgentSpotlight({ industry }: { industry: IndustryOffer }) {
  const useCases = getAgentUseCases(industry).slice(0, 4);
  const outcomes = industry.outcomes.map((o) => o.toLowerCase()).join(", ");

  return (
    <section id="ai-command-center" className="scroll-mt-40 border-y border-border bg-background px-4 py-12 md:py-16" aria-labelledby="industry-mayor-title">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <img
              src="/assets/mayor-avatar.webp"
              alt="The Mayor"
              width={88}
              height={88}
              loading="lazy"
              className="h-20 w-20 rounded-full object-cover ring-2 ring-brand-700/20"
            />
            <p className="site-eyebrow mt-5">The Mayor for {industry.shortName.toLowerCase()}</p>
            <h2 id="industry-mayor-title" className="site-serif mt-4 text-3xl font-medium leading-[1.1] text-ink md:text-4xl">
              The Mayor runs your {industry.shortName.toLowerCase()} front desk.
            </h2>
            <p className="site-lede mt-4 max-w-xl">
              Built for {industry.shortName.toLowerCase()} — {outcomes}. The Mayor answers
              when you can't pick up, books the work, and follows up, so the leaks stop leaking.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href="https://mayor.mehyar.us"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "cta", size: "lg", className: "min-h-12" })}
              >
                Log in to The Mayor <ArrowRight className="ml-2 h-4 w-4" />
              </a>
              <a
                href="/audit"
                className={buttonVariants({ variant: "outline", size: "lg", className: "min-h-12" })}
              >
                Get the $330 audit
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Free to start · Pro $14/month · Review-gated actions — nothing sends or books without your approval.</p>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">What it handles for you</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {useCases.map((useCase, index) => {
                const Icon = previewIcons[index % previewIcons.length];
                return (
                  <article key={useCase.title} className="border-b border-border p-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(2)]:border-b-0">
                    <Icon className="h-5 w-5 text-brand-700" />
                    <h3 className="mt-2 text-[15px] font-semibold text-foreground">{useCase.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{useCase.benefit}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-border bg-muted/25 p-4 text-sm leading-6 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
          <p>It works only with the tools, users, and actions you approve. Sending, publishing, payments, and sensitive decisions can require human confirmation.</p>
        </div>
      </div>
    </section>
  );
}
