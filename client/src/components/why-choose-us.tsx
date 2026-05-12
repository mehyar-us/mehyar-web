import { Code, Factory, LayoutGrid } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Code,
    title: "Revenue leak first",
    description: "The first question is not what can be built. It is where customers, time, trust, or reporting are currently leaking.",
  },
  {
    icon: Factory,
    title: "Regulated-systems discipline",
    description: "Current pharma systems-engineering work informs the habits: reliability, access boundaries, auditability, and controlled change.",
  },
  {
    icon: LayoutGrid,
    title: "Small build, clear handoff",
    description: "Audits, sprints, and retainers are scoped so the business knows what changed, how it works, and what to improve next.",
  },
];

const WhyChooseUs = () => {
  return (
    <section className="bg-white px-4 py-14 dark:bg-brand-900 md:py-18">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Why MehyarSoft</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">
              Senior judgment for businesses that need fewer leaks, not more software theater.
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              MehyarSoft is for owners and operators who need a practical technical owner to clean up the path from prospect to paid customer and from manual work to reliable system.
            </p>
          </div>

          <div className="grid gap-5">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
                <CardContent className="grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-start">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                    <feature.icon aria-hidden="true" size={21} />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default WhyChooseUs;
