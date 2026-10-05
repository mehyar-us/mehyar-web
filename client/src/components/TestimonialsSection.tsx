import { ClipboardCheck, MousePointerClick, Workflow } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const reviewAreas = [
  { icon: ClipboardCheck, title: "Offer clarity", detail: "Check whether visitors can understand what you sell, who it helps, and what to do next." },
  { icon: MousePointerClick, title: "Contact and booking", detail: "Look for unclear calls to action, mobile friction, and missing paths from interest to a conversation." },
  { icon: Workflow, title: "Automation opportunities", detail: "Identify workflows worth discussing, then validate the scope and economics with your actual business data." },
];

export default function TestimonialsSection() {
  return (
    <section className="px-4 py-16 md:py-24">
      <div className="site-shell">
        <p className="site-eyebrow mb-4 text-center">What the review covers</p>
        <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl text-balance">Start with practical questions about your website.</h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">An AI review is a starting point. Confirm findings before making business decisions; founder-led review and implementation are available separately.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {reviewAreas.map((area) => (
            <Card key={area.title} className="border-border bg-card">
              <CardContent className="p-6">
                <area.icon className="h-6 w-6 text-brand-700" aria-hidden="true" />
                <h3 className="mt-3 font-semibold text-foreground">{area.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{area.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
