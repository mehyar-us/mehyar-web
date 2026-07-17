import { Link } from "wouter";
import { ArrowRight, ExternalLink, Zap, Smartphone, Layers, Rocket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import CTASection from "@/components/cta-section";
import QuickAnswer from "@/components/QuickAnswer";

interface ManagedApp {
  id: string;
  name: string;
  url: string;
  tagline: string;
  description: string;
  audience: string;
  highlights: string[];
  logo: string;
  accentClass: string;
}

const managedApps: ManagedApp[] = [
  {
    id: "rizza",
    name: "Rizza",
    url: "https://rizza.app",
    tagline: "Track, organize, and share your work in one place.",
    description:
      "A clean workspace app that handles subscriptions and event-style data types so teams and solo users can keep work moving without juggling five tools.",
    audience: "Teams and solo operators who need one place to track, organize, and share work.",
    highlights: [
      "Manage subscription events and ongoing work in a single view",
      "Share progress with teammates or clients without exporting",
      "Lightweight onboarding, no complex setup required",
      "Built for the everyday workflow, not enterprise ceremony",
    ],
    logo: "/assets/rizza-logo.png",
    accentClass: "from-brand-100 to-white dark:from-brand-900 dark:to-brand-950",
  },
  {
    id: "aimech",
    name: "AiMech",
    url: "https://aimech.app",
    tagline: "AI mechanic for everyday car owners.",
    description:
      "An intelligent diagnostics and automation platform that combines AI-driven technical analysis with automated workflow optimization — built so an everyday car owner can describe a sound, a symptom, or a dashboard light and get a real answer.",
    audience: "Everyday car owners who want clear next steps instead of dealership runaround.",
    highlights: [
      "AI diagnostics from plain-language descriptions of the problem",
      "Combines technical analysis with workflow automation",
      "Plain-English answers, not parts-catalog jargon",
      "Helpful before, during, and after the shop visit",
    ],
    logo: "/assets/aimech-logo.png",
    accentClass: "from-zinc-900 to-zinc-700 dark:from-zinc-800 dark:to-zinc-900",
  },
];

const buildPillars = [
  {
    icon: Zap,
    title: "Idea → live link in days, not quarters",
    body: "Marketing site, auth, data model, and dashboard assembled from a working playbook — so the cost of testing a new app is a weekend, not a raise.",
  },
  {
    icon: Smartphone,
    title: "PWAs that install like native",
    body: "Add-to-home-screen, offline shell, push notifications, and a real mobile feel without App Store review cycles. Ship to the same URL across every device.",
  },
  {
    icon: Layers,
    title: "One stack, real data, real users",
    body: "Cloudflare Workers for the edge, D1 for storage, Pages for the front-end. The same stack powers mehyar.us and every app we ship — boring on purpose, fast in practice.",
  },
  {
    icon: Rocket,
    title: "Marketing-grade from day one",
    body: "SEO shell, structured data, OG cards, RSS, sitemap, and analytics wired before launch — so the app shows up where real people search, not just in a founder's Discord.",
  },
];

const Apps = () => {
  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.12),transparent_32%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_56%,#fff_100%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_32%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_56%,hsl(var(--brand-950))_100%)] md:pt-32">
        <div className="mx-auto max-w-7xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
            Live products
          </p>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">
            Apps we build, ship, and operate.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            MehyarSoft doesn't only consult. We ship real products that real users open every day — and we use the same
            playbook to launch yours. Browse the live portfolio below, then read on for what makes the MehyarSoft
            app-launch process fast, boring, and marketing-grade from day one.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/contact" className={buttonVariants({ variant: "cta" })}>
              Brief us on your app idea <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/services" className={buttonVariants({ variant: "outline" })}>
              See consulting offers
            </Link>
          </div>
        </div>
      </section>

      <QuickAnswer
        question="What apps does MehyarSoft operate?"
        answer="MehyarSoft builds, ships, and operates its own apps — including Rizza (workspace tracking) and AiMech (AI diagnostics for everyday car owners). The same playbook is offered to clients as a custom-app build engagement."
        ctaHref="/contact"
        ctaLabel="Talk about your app"
      />

      <section className="bg-background px-4 py-16 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
                Managed apps
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-4xl">
                Products we run today.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              Each app is a working site with real users, real data, and real follow-up. Click through to see what we
              shipped — both are good examples of how small a marketing-grade launch can be when the stack is
              standardized.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {managedApps.map((app) => (
              <Card
                key={app.id}
                className="group h-full overflow-hidden border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition hover:border-brand-700/35"
              >
                <div className={`bg-gradient-to-br ${app.accentClass} px-6 py-8`}>
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/95 p-2 shadow-[0_8px_22px_rgba(8,63,84,0.18)] ring-1 ring-black/5 dark:bg-white/95">
                      <img
                        src={app.logo}
                        alt={`${app.name} logo`}
                        className="h-full w-full object-contain"
                        width="64"
                        height="64"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-brand-700/80 dark:text-brand-100/80">
                        Live product
                      </p>
                      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink dark:text-white">
                        {app.name}
                      </h3>
                      <a
                        href={app.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-100 dark:hover:text-white"
                      >
                        {app.url.replace(/^https?:\/\//, "")}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                </div>
                <CardContent className="p-6">
                  <p className="text-base font-medium text-foreground md:text-lg">{app.tagline}</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">{app.description}</p>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">
                    Built for
                  </p>
                  <p className="mt-1 text-sm leading-6 text-foreground">{app.audience}</p>
                  <ul className="mt-5 space-y-2.5">
                    {app.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-sm leading-6 text-foreground">
                        <span
                          aria-hidden="true"
                          className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100"
                        />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "default", size: "sm" })}
                    >
                      Visit {app.name} <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                    <Link
                      href={`/blog/${app.id === "rizza" ? "rizza-app-launch-tracking-and-organizing-work-without-the-overhead" : "aimech-app-launch-ai-mechanic-for-everyday-car-owners"}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Read the launch note
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/40 px-4 py-16 dark:bg-white/[0.02] md:py-20">
        <div className="mx-auto max-w-7xl">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
            How we ship fast
          </p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-4xl md:leading-[1.05]">
            Apps and PWAs in a marketing manner — quickly, without theater.
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            The same process that produced Rizza and AiMech is what MehyarSoft offers clients as a custom-app
            engagement. No agency drama. No "design phase" before the data model exists. Just a working stack, a tight
            feedback loop, and a launch that shows up in search from day one.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            {buildPillars.map((p) => {
              const Icon = p.icon;
              return (
                <Card key={p.title} className="h-full border-border bg-card">
                  <CardContent className="flex h-full flex-col p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                      <Icon aria-hidden="true" size={22} />
                    </div>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-foreground">{p.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">{p.body}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-10 rounded-[1.5rem] border border-border bg-card p-6 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
              The MehyarSoft app playbook
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground md:text-2xl">
              From napkin sketch to public launch URL in under three weeks.
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
              We don't pitch "a discovery phase followed by a build phase." We ship a thin slice on a real domain, see
              if anyone opens it, and iterate. That means your app gets real users, real analytics, and real SEO
              credit while it's still small — not six months later when the marketing window has closed.
            </p>
            <ul className="mt-5 grid grid-cols-1 gap-3 text-sm leading-6 text-foreground md:grid-cols-2">
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>Marketing site with SEO shell and structured data on launch day</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>Auth, data, and one core flow working end-to-end before any polish</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>Hosted on the same Cloudflare stack that runs mehyar.us</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>PWA install prompt and share card built into the first release</span>
              </li>
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/contact" className={buttonVariants({ variant: "cta" })}>
                Brief us on your app <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/services" className={buttonVariants({ variant: "outline" })}>
                See how engagements work
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default Apps;
