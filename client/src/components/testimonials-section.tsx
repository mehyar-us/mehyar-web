import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

const proofItems = [
  {
    title: "Founder-led specialist",
    body: "Mehyar Swelim is a Syrian founder in New York City with 10+ years of professional software engineering experience and current systems-engineering work through MehyarSoft LLC.",
  },
  {
    title: "Built around visible business leaks",
    body: "Engagements are scoped around missed calls, weak website conversion, manual reporting, CRM gaps, disconnected tools, and follow-up that is too slow or inconsistent.",
  },
  {
    title: "Compliance-aware by default",
    body: "Follow-up and outreach systems include opt-out handling, suppression lists, audit trails, and explicit guardrails against deceptive or unsafe mass sending.",
  },
];

const TestimonialsSection = () => {
  return (
    <section className="bg-background px-4 py-14 md:py-18">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto mb-8 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Proof and trust</p>
          <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">
            Credibility without fake testimonials or borrowed logos.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            The promise is grounded in founder experience, regulated-systems discipline, and practical business outcomes — not invented social proof.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {proofItems.map((item) => (
            <Card key={item.title} className="h-full border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
              <CardContent className="p-5">
                <h3 className="text-xl font-bold tracking-[-0.02em] text-foreground">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-7 text-center">
          <Link href="/about" className={buttonVariants({ variant: "outline" })}>
            Read the founder story
          </Link>
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
