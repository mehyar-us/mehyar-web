import { Link } from "wouter";
import type { IndustryOffer } from "@/data/industry-offers";
import { getExtendedUseCases } from "@/data/agent-services";
export default function CapabilityExplorer({
  industry,
}: {
  industry?: IndustryOffer;
}) {
  return (
    <section className="px-4 py-14">
      <div className="site-shell grid gap-8 md:grid-cols-[.8fr_1.2fr]">
        <div>
          <p className="site-eyebrow">Custom capabilities</p>
          <h2 className="mt-4 text-3xl font-semibold">
            The work behind one useful question.
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Explore the possibilities, then choose what your business actually
            needs. Knowledge, tools and operating rules are scoped together.
          </p>
        </div>
        <div>
          {getExtendedUseCases(industry).map((item) => (
            <details className="border-b border-border py-4" key={item.title}>
              <summary className="cursor-pointer py-2 font-semibold">
                {item.title}
              </summary>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {item.detail}
              </p>
              <Link
                className="mt-3 inline-flex min-h-11 items-center underline"
                href={`/explore?topic=${encodeURIComponent(item.title)}${industry ? `&industry=${encodeURIComponent(industry.shortName)}` : ""}`}
              >
                Explore this capability →
              </Link>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
