import { ArrowRight, Bot, CloudCog, Code2, Database, Gauge, Globe2, Link2, UsersRound } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";

const paths = [
  {
    eyebrow: "For growing businesses",
    title: "Turn more interest into booked, paying customers.",
    description: "We connect the public-facing pieces customers actually use, then keep the system maintained.",
    items: [
      { icon: Globe2, text: "A branded website and installable customer app" },
      { icon: UsersRound, text: "Customer accounts, booking, requests, and payments" },
      { icon: Bot, text: "AI phone, text, email, and follow-up assistance" },
      { icon: Gauge, text: "Lead tracking, reporting, maintenance, and support" },
    ],
    href: "/pricing",
    cta: "Find my industry and pricing",
  },
  {
    eyebrow: "For teams and enterprises",
    title: "Build the software your operation cannot buy off the shelf.",
    description: "We design reliable systems for complex workflows, integrations, data, security, and scale.",
    items: [
      { icon: Code2, text: "Custom CRMs, portals, dashboards, and internal tools" },
      { icon: Link2, text: "APIs, system integrations, and workflow automation" },
      { icon: Database, text: "Data platforms, AI systems, and secure backends" },
      { icon: CloudCog, text: "AWS, Azure, Google Cloud, Cloudflare, and DevOps" },
    ],
    href: "/services",
    cta: "Explore engineering solutions",
  },
];

export default function HomeSolutionsOverview() {
  return (
    <section id="solutions" className="scroll-mt-24 bg-background px-4 py-12 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Choose your starting point</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Customer growth or complex engineering—we do both.</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg">Start with the outcome you need. We will translate it into a clear scope, sensible technology, and a price you can evaluate.</p>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {paths.map((path, index) => (
            <article key={path.title} className={index === 0 ? "rounded-[1.75rem] border border-brand-700/20 bg-secondary/65 p-5 shadow-sm md:p-7" : "rounded-[1.75rem] border border-border bg-card p-5 shadow-sm md:p-7"}>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">{path.eyebrow}</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-foreground md:text-3xl">{path.title}</h3>
              <p className="mt-3 leading-7 text-muted-foreground">{path.description}</p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {path.items.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background/75 p-3 text-sm leading-6 text-foreground">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card text-brand-700 shadow-sm dark:bg-white/10 dark:text-brand-100"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              <Link href={path.href} className={buttonVariants({ variant: index === 0 ? "cta" : "outline", size: "lg", className: "mt-6 w-full sm:w-auto" })}>{path.cta}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
