import { Star, Quote, FlaskConical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

// NOTE: This product is new — there are no customer reviews yet.
// The cards below are ILLUSTRATIVE examples of the KIND of feedback this
// audit is built to earn, clearly labeled as such. Replace with real
// verified reviews as soon as paying customers exist. DO NOT present these
// as real customers.
const ILLUSTRATIVE_EXAMPLES = [
  {
    role: "Example: local service owner",
    quote: "The free audit found our missing click-to-call in 60 seconds. The kind of leak that costs real jobs every week.",
  },
  {
    role: "Example: clinic operator",
    quote: "The $5 report was brutal — and exactly right. The AI scheduling blueprint alone would be worth 100x the price.",
  },
  {
    role: "Example: ecommerce founder",
    quote: "A 25-page teardown with competitor gaps I'd never noticed — priced per leak, with the math shown.",
  },
];

function Stars() {
  return (
    <div className="flex gap-0.5" aria-label="Illustrative 5 out of 5 stars">
      {[...Array(5)].map((_, i) => (
        <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

export default function TestimonialsSection() {
  return (
    <section className="px-4 py-16 md:py-24">
      <div className="site-shell">
        <p className="site-eyebrow mb-4 text-center">Early access</p>
        <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl text-balance">
          Be one of the first to run it
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          This audit engine is new. Run the free scan on your site, and if the
          full report earns it, leave an honest review — real ratings from real
          owners will live here.
        </p>
        <div className="mx-auto mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <FlaskConical className="h-4 w-4" />
          <span>Illustrative examples of what the audit is built to deliver — not customer reviews.</span>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {ILLUSTRATIVE_EXAMPLES.map((t) => (
            <Card key={t.role} className="border-dashed border-border bg-card/60">
              <CardContent className="p-6">
                <Quote className="h-6 w-6 text-brand-700/40" />
                <p className="mt-3 text-sm leading-6 text-foreground">"{t.quote}"</p>
                <div className="mt-4">
                  <Stars />
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.role}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
