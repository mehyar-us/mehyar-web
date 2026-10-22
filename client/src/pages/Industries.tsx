import { useState } from "react";
import { Link } from "wouter";
import { industryOffers } from "@/data/industry-offers";
export default function Industries() {
  const [query, setQuery] = useState("");
  const matches = industryOffers.filter((i) =>
    [i.name, ...i.examples]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="site-hero">
      <div className="site-shell">
        <p className="site-eyebrow">Industries</p>
        <h1 className="site-display mt-4 max-w-4xl">
          Start with the work your business does.
        </h1>
        <p className="site-lede mt-5 max-w-3xl">
          Find custom workflow examples for your team. Actual scope depends on
          your tools and the problem to solve.
        </p>
        <label
          htmlFor="industry-search"
          className="mt-8 block text-sm font-semibold"
        >
          Search your business type
        </label>
        <input
          id="industry-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try dentist, HVAC, barber or restaurant"
          className="mt-3 min-h-12 w-full max-w-xl rounded-xl border border-border bg-card px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {matches.length} industry matches
        </p>
        <div className="mt-8 grid gap-x-10 md:grid-cols-2">
          {matches.map((i) => (
            <article key={i.id} className="border-t border-border py-6"><Link href={`/industries/${i.id}`}><img src={i.heroImage} alt={`${i.shortName} illustrative business setting`} width="800" height="600" loading="lazy" className="mb-5 aspect-[16/9] w-full rounded-xl object-cover"/></Link>
              <h2 className="text-xl font-semibold">
                <Link
                  href={`/industries/${i.id}`}
                  className="underline underline-offset-4"
                >
                  {i.shortName}
                </Link>
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {i.description}
              </p>
            </article>
          ))}
        </div>
        {!matches.length && (
          <p className="mt-8">
            No exact match.{" "}
            <Link href="/contact" className="font-semibold underline">
              Discuss your business
            </Link>{" "}
            and we will review the workflow.
          </p>
        )}
      </div>
    </section>
  );
}
