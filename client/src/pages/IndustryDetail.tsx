import VisualExplorer from "@/components/VisualExplorer";
import HomeProductPreview from "@/components/HomeProductPreview";
import CapabilityExplorer from "@/components/CapabilityExplorer";
import { Link, useRoute } from "wouter";
import { industryOffers } from "@/data/industry-offers";
import IndustryWorkflows from "@/components/industry-agent-services";
import { buttonVariants } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
export default function IndustryDetail() {
  const [, params] = useRoute("/industries/:slug");
  const industry = industryOffers.find((i) => i.id === params?.slug);
  if (!industry) return <NotFound />;
  return (
    <>
      <section className="site-hero">
        <div className="site-shell industry-visual-hero">
          <div>
            <Link
              href="/industries"
              className="inline-flex min-h-11 text-sm font-semibold underline"
            >
              Browse industries
            </Link>
            <p className="site-eyebrow mt-5">Custom business AI</p>
            <h1 className="site-display mt-4 max-w-4xl">
              Custom AI for {industry.shortName.toLowerCase()}.
            </h1>
            <p className="site-lede mt-5 max-w-3xl">{industry.description}</p>
            <Link
              href={`/contact?service=automation-sprint&industry=${encodeURIComponent(industry.shortName)}`}
              className={buttonVariants({
                variant: "cta",
                size: "lg",
                className: "mt-7",
              })}
            >
              Discuss your business
            </Link>
          </div>
          <figure>
            <img
              src={industry.heroImage}
              alt={`${industry.shortName} illustrative business setting`}
              width="800"
              height="600"
              loading="eager"
            />
            <figcaption>{industry.outcomes.join(" · ")}</figcaption>
          </figure>
        </div>
      </section>
      <nav
        className="industry-section-nav site-shell"
        aria-label={`${industry.shortName} sections`}
      >
        <a href="#industry-workflows">Useful workflows</a>
        <a href="#industry-journey">Customer journey</a>
        <a href="#industry-explore">Ask about my business</a>
        <a href="#industry-system">Phone and workspace</a>
      </nav>
      <div id="industry-workflows" className="scroll-mt-24">
        <IndustryWorkflows industry={industry} />
      </div>
      <section
        id="industry-journey"
        className="border-y border-border px-4 py-14 scroll-mt-24"
      >
        <div className="site-shell grid gap-8 md:grid-cols-2">
          <div>
            <p className="site-eyebrow">Illustrative customer journey</p>
            <h2 className="mt-4 text-3xl font-semibold">
              From a request to a clear next step.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              {industry.example}
            </p>
            <figure className="mt-5 overflow-hidden rounded-xl">
              <img
                src={`/assets/industries/${industry.id}.webp`}
                alt={`${industry.shortName} illustrative customer experience`}
                width="1200"
                height="675"
                loading="lazy"
                className="aspect-video w-full object-cover"
              />
              <figcaption className="text-xs mt-2 text-muted-foreground">
                Illustrative setting for this customer journey
              </figcaption>
            </figure>
            <p className="mt-4 text-xs text-muted-foreground">
              A workflow to build, not a measured client result.
            </p>
          </div>
          <div>
            <h3 className="text-xl font-semibold">
              Replace scattered handoffs
            </h3>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              Before: requests and status depend on separate inboxes and manual
              reminders.
            </p>
            <ol className="mt-5 visual-journey">
              {industry.demoSteps.map((step, index) => (
                <li className="flex gap-3 text-sm" key={step}>
                  <span className="font-semibold">0{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section id="industry-explore" className="px-4 py-14 scroll-mt-24">
        <div className="site-shell">
          <VisualExplorer industry={industry.shortName} />
        </div>
      </section>
      <section id="industry-system" className="studio-system px-4 scroll-mt-24">
        <div className="site-shell studio-system-grid">
          <div>
            <p className="site-eyebrow">Your business from your phone</p>
            <h2>
              One question.
              <br />A useful next step.
            </h2>
            <p>
              Shape customer requests, an installable app, approved knowledge
              and follow-up around {industry.shortName.toLowerCase()}. The
              actual tools, permissions and review rules are scoped together.
            </p>
            <p className="studio-caption">
              Interactive concept; all activity is simulated. The private
              workspace is separate from this public discovery assistant.
            </p>
            <Link
              href={`/explore?industry=${encodeURIComponent(industry.shortName)}`}
            >
              Explore your connected system →
            </Link>
          </div>
          <HomeProductPreview />
        </div>
      </section>
      <CapabilityExplorer industry={industry} />
      <section className="px-4 py-14">
        <div className="site-shell grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold">
              Fit it to the tools you use.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              We review booking, customer records, inboxes and other tools
              involved. API access, available data, permissions and staff review
              rules determine what can be connected.
            </p>
            {industry.complianceNote && (
              <p className="mt-5 rounded-xl bg-secondary p-5 text-sm leading-7">
                {industry.complianceNote}
              </p>
            )}
          </div>
          <div>
            <h3 className="text-xl font-semibold">
              Scope and costs before the build
            </h3>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              Custom AI is quoted around the workflow. Build costs, hosting,
              model usage, messaging and third-party tools are separate
              considerations. Your quote defines the deliverables and operating
              requirements.
            </p>
            <details className="mt-5 border-t border-border pt-4">
              <summary className="cursor-pointer py-2 font-semibold">
                What does support cover?
              </summary>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Monitoring, maintenance, handoff and changes are defined in your
                scope. Ownership, access and ongoing responsibilities are agreed
                before launch.
              </p>
            </details>
            <Link
              href="/pricing"
              className="mt-4 inline-flex min-h-11 font-semibold underline"
            >
              How pricing works
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
