import type { IndustryOffer } from "@/data/industry-offers";
import { getAgentUseCases } from "@/data/agent-services";
export default function IndustryWorkflows({
  industry,
}: {
  industry: IndustryOffer;
}) {
  return (
    <section className="px-4 py-14">
      <div className="site-shell">
        <h2 className="text-3xl font-semibold tracking-tight">
          Three workflows to discuss
        </h2>
        <p className="mt-4 text-muted-foreground">
          Illustrative possibilities, scoped around your actual tools and
          policies.
        </p>
        <div className="mt-8 grid gap-7 md:grid-cols-3">
          {getAgentUseCases(industry).map((item) => (
            <article key={item.title}>
              <h3 className="text-xl font-semibold">{item.title}</h3>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                {item.example}
              </p>
              <p className="mt-4 text-sm font-medium">{item.benefit}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
