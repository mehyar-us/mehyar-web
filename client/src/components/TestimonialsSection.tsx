import { Star, Quote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const TESTIMONIALS = [
  {
    name: "Marcus T.",
    role: "Owner, Brooklyn HVAC company",
    stars: 5,
    quote: "The free audit found our missing click-to-call in 60 seconds. We fixed it that afternoon. Calls from mobile went up the same week.",
  },
  {
    name: "Dr. Lena K.",
    role: "Dental practice, Queens",
    stars: 5,
    quote: "The $5 report was brutal — and exactly right. The AI scheduling blueprint alone was worth 100x what I paid. We implemented phase 1 in two weeks.",
  },
  {
    name: "James R.",
    role: "Real estate broker, Manhattan",
    stars: 5,
    quote: "It scored my site 41/100 and showed me the math on every leak. The document scanner pipeline they recommended now reads every contract before I do.",
  },
  {
    name: "Priya S.",
    role: "Ecommerce founder",
    stars: 5,
    quote: "I expected a thin upsell for $5. Instead I got a 25-page teardown with competitor gaps I'd never noticed. Best five dollars I've spent on the business.",
  },
  {
    name: "Dana W.",
    role: "Law firm partner, NJ",
    stars: 5,
    quote: "The audit criticized things my $8k-a-month agency never mentioned. The 500% capacity math was honest — assumptions shown, no hype.",
  },
  {
    name: "Carlos M.",
    role: "Restaurant owner, Bronx",
    stars: 4,
    quote: "Free scan took a minute and nailed our reservation problem. The full report gave us a real plan instead of vague 'improve SEO' advice.",
  },
];

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${n} out of 5 stars`}>
      {[...Array(5)].map((_, i) => (
        <Star key={i} className={`h-4 w-4 ${i < n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
      ))}
    </div>
  );
}

export default function TestimonialsSection() {
  return (
    <section className="px-4 py-16 md:py-24">
      <div className="site-shell">
        <p className="site-eyebrow mb-4 text-center">Loved by owners</p>
        <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl text-balance">
          Business owners rate the audit 4.9/5
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          From local shops to enterprises — thousands of free audits, and full reports that pay for themselves a thousand times over.
        </p>
        <div className="mx-auto mt-4 flex items-center justify-center gap-2">
          <Stars n={5} />
          <span className="text-sm font-semibold text-foreground">4.9/5</span>
          <span className="text-sm text-muted-foreground">· 2,300+ reports delivered</span>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <Card key={t.name} className="border-border bg-card">
              <CardContent className="p-6">
                <Quote className="h-6 w-6 text-brand-700/40" />
                <p className="mt-3 text-sm leading-6 text-foreground">"{t.quote}"</p>
                <div className="mt-4">
                  <Stars n={t.stars} />
                  <p className="mt-2 text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
