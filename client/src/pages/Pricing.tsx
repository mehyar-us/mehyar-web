import MayorPlans from "@/components/MayorPlans";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
export default function Pricing() {
  return (
    <>
      <section className="site-hero">
        <div className="site-shell">
          <p className="site-eyebrow">Scope & pricing</p>
          <h1 className="site-display mt-4 max-w-4xl">
            A clear scope before a custom build.
          </h1>
          <p className="site-lede mt-5 max-w-3xl">
            The price depends on the workflow, integration work and operating
            needs. We separate the build from the costs of running it.
          </p>
          <Link
            href="/contact"
            className={buttonVariants({
              variant: "cta",
              size: "lg",
              className: "mt-7",
            })}
          >
            Discuss your business
          </Link>
        </div>
      </section>
      <MayorPlans/>
      <section className="px-4 py-14">
        <div className="site-shell grid gap-8 md:grid-cols-3">
          {[
            [
              "Discovery",
              "Start with one business problem",
              "Review the workflow, tools and feasibility, then define the smallest useful scope. A focused $330 founder-led website and booking audit is available separately.",
              "/micro-offer",
            ],
            [
              "Custom build",
              "Quoted for an agreed scope",
              "Knowledge preparation, workflows, integrations, testing and handoff are scoped together. There is no universal installation package.",
              "/services",
            ],
            [
              "Operation & support",
              "Defined before launch",
              "Hosting, AI usage, messages, call minutes and third-party subscriptions may have separate costs. Maintenance and changes are agreed for your system.",
              "/contact",
            ],
          ].map(([title, price, copy, href]) => (
            <article key={title} className="border-t border-border pt-6">
              <h2 className="text-2xl font-semibold">{title}</h2>
              <p className="mt-3 font-medium">{price}</p>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                {copy}
              </p>
              <Link
                href={href}
                className="mt-4 inline-flex min-h-11 text-sm font-semibold underline"
              >
                {title === "Discovery"
                  ? "Explore the optional audit"
                  : title === "Custom build"
                    ? "Explore solutions"
                    : "Discuss your business"}
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className="bg-secondary px-4 py-14">
        <div className="site-shell max-w-4xl">
          <h2 className="text-3xl font-semibold">
            What we agree before work starts
          </h2>
          <ul className="mt-6 grid gap-4 text-sm leading-7 sm:grid-cols-2">
            {[
              "Deliverables, acceptance checks and integration boundaries",
              "Setup cost, recurring charges and usage assumptions",
              "Data access, ownership and operator responsibilities",
              "Support scope, changes and third-party dependencies",
            ].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            Final terms are confirmed in your engagement scope. Public examples
            are not a binding quote.
          </p>
        </div>
      </section>
    </>
  );
}
