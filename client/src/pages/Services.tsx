import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import CapabilityExplorer from "@/components/CapabilityExplorer";
export default function Services() {
  return (
    <>
      <section className="site-hero">
        <div className="site-shell">
          <p className="site-eyebrow">Solutions</p>
          <h1 className="site-display mt-4 max-w-4xl">
            Your workflow comes first. The AI is built to fit.
          </h1>
          <p className="site-lede mt-5 max-w-3xl">
            Choose the work you want to improve. We shape the knowledge, tools,
            permissions and handoffs around your business.
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
          <Link href="/explore?topic=choosing%20a%20custom%20AI%20solution" className="ml-5 inline-flex min-h-11 items-center underline">Ask The Mayor free →</Link>
          <p className="mt-5 text-sm text-muted-foreground">Want a workspace for your own business? <Link href="/mayor" className="underline">Meet The Mayor — Free $0, Pro $14 USD/month.</Link> Custom AI implementation is scoped separately.</p>
        </div>
      </section>
      <section className="px-4 py-14">
        <div className="site-shell divide-y divide-border">
          {[
            [
              "Customer response & follow-up",
              "Give each inquiry a clear next step.",
              "Approved answers, qualification, CRM updates, follow-up rules and staff handoff.",
              "missed-call-followup",
            ],
            [
              "Scheduling & intake",
              "Connect people with the information or time they need.",
              "Request forms, availability checks, confirmations, reminders and human review.",
              "website-booking-cleanup",
            ],
            [
              "Internal operations & knowledge",
              "Find information and finish repeat work with fewer manual steps.",
              "Knowledge retrieval, document workflows, summaries, reporting and approved integrations.",
              "automation-sprint",
            ],
          ].map(([title, problem, scope, id]) => (
            <article key={id} className="grid gap-6 py-9 md:grid-cols-2">
              <img
                src={`/assets/sales-system/${id === "missed-call-followup" ? "growth" : id === "website-booking-cleanup" ? "operations" : "ai"}-system.webp`}
                alt={`${title} illustrative system concept`}
                width="800"
                height="600"
                loading="lazy"
                className="aspect-[16/10] w-full rounded-xl object-cover md:row-span-2"
              />
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">
                  {title}
                </h2>
                <p className="mt-4 leading-7 text-muted-foreground">
                  {problem}
                </p>
              </div>
              <div>
                <p className="text-sm leading-7">{scope}</p>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  Capabilities depend on your tools, data and permissions. We
                  confirm feasibility and scope before implementation.
                </p>
                <Link
                  href={`/contact?service=${id}`}
                  className="mt-4 inline-flex min-h-11 font-semibold underline underline-offset-4"
                >
                  Discuss your business
                </Link>
                <Link
                  href={`/explore?topic=${encodeURIComponent(title)}`}
                  className="ml-5 inline-flex min-h-11 underline"
                >
                  Explore this with AI
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="px-4 py-12"><div className="site-shell enterprise-intro"><div><p className="site-eyebrow">Enterprise & regulated teams</p><h2 className="mt-4 text-3xl font-semibold">Work that needs clear accountability.</h2><p className="mt-5 leading-8 text-muted-foreground">Technology, healthcare, pharma, finance and enterprise operations need deliberate access, approved knowledge, traceability and human review. Scope a limited pilot around your existing systems and responsible teams.</p><Link href="/enterprise" className="mayor-primary w-fit">Explore enterprise workflows</Link></div><img src="/assets/agent-services/learning-operations-assistant.webp" alt="Illustrative knowledge and operations assistant concept" width="800" height="600" loading="lazy"/></div></section>
      <CapabilityExplorer />
      <section className="bg-secondary px-4 py-14">
        <div className="site-shell grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold">
              The software around the AI matters.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Websites, apps, dashboards and integrations give the workflow
              somewhere useful to live. Supporting engineering can be scoped as
              part of your system.
            </p>
          </div>
          <div>
            <h3 className="text-xl font-semibold">Build, launch and support</h3>
            <p className="mt-4 leading-7 text-muted-foreground">
              We agree on access boundaries, test scenarios, human handoffs and
              operating responsibilities. Hosting, usage costs and ongoing
              changes are defined separately.
            </p>
            <Link
              href="/pricing"
              className="mt-4 inline-flex min-h-11 font-semibold underline"
            >
              Understand scope and costs
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
