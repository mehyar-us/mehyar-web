import { Link } from "wouter";

interface QuickAnswerProps {
  eyebrow?: string;
  question: string;
  answer: string;
  ctaHref?: string;
  ctaLabel?: string;
  className?: string;
}

export default function QuickAnswer({
  eyebrow = "Quick answer",
  question,
  answer,
  ctaHref,
  ctaLabel,
  className = "",
}: QuickAnswerProps) {
  return (
    <section className={`bg-background px-4 py-8 ${className}`} aria-labelledby={`qa-${question.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <div className="mx-auto max-w-5xl rounded-[1.5rem] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-7">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">{eyebrow}</p>
        <h2 id={`qa-${question.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} className="text-2xl font-semibold tracking-[-0.025em] text-ink dark:text-white md:text-3xl">
          {question}
        </h2>
        <p className="mt-3 max-w-4xl text-base leading-7 text-muted-foreground md:text-lg">{answer}</p>
        {ctaHref && ctaLabel ? (
          <Link href={ctaHref} className="mt-4 inline-flex text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
            {ctaLabel} →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
