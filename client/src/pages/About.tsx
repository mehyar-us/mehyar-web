import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, Award, CheckCircle, Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

const values = [
  { title: "Practicality", description: "Start with the highest-leverage business leak before adding tools or complexity.", icon: Award },
  { title: "Reliability", description: "Build systems that owners can trust, monitor, and hand off without mystery.", icon: CheckCircle },
  { title: "Operator empathy", description: "Design around the people answering phones, booking customers, updating records, and serving clients.", icon: Users },
  { title: "Speed with control", description: "Move fast, but keep consent, audit trails, access, and suppression lists ahead of scale.", icon: Clock },
];

const timeline = [
  { year: "15 years ago", title: "From Syria to New York City", description: "Mehyar came to NYC and built a life and career through software, systems thinking, and persistence." },
  { year: "10+ years", title: "Professional software engineering", description: "Hands-on work across application development, systems, integrations, and business technology delivery." },
  { year: "Now", title: "MehyarSoft LLC", description: "A consulting brand focused on software, systems engineering, AI automation, and practical tech support for local and regulated businesses." },
];

const credentials = ["Syrian founder in NYC", "10+ years professional software engineering", "Current regulated systems-engineering work", "Founder-led LLC: no fake agency theater"];

const About = () => {
  useEffect(() => {
    document.title = "Founder Story | MehyarSoft";
  }, []);

  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.14),transparent_32%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_54%,#fff_100%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_32%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_54%,hsl(var(--brand-950))_100%)] md:pb-16 md:pt-32">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Founder-led consulting</p>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">
              Built by an engineer who understands both survival and systems.
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              Mehyar Swelim is a Syrian founder in New York City with 10+ years of professional software engineering experience. MehyarSoft exists to help businesses stop losing customers, time, and money through weak websites, missed calls, manual work, and disconnected systems.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className={buttonVariants({ variant: "cta", size: "lg" })}>
                Book a Tech Audit <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/services" className={buttonVariants({ variant: "outline", size: "lg" })}>
                See consulting offers
              </Link>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-border bg-card/88 p-4 shadow-[0_24px_80px_rgba(8,63,84,0.12)] dark:bg-card/80 dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
            <div className="rounded-[1.35rem] border border-border bg-background/70 p-5 dark:bg-white/[0.03]">
              <img src="/assets/mehyarsoft-logo.svg" alt="MehyarSoft logo" className="mb-6 w-full max-w-sm dark:hidden" />
              <img src="/assets/mehyarsoft-logo-dark.svg" alt="MehyarSoft logo" className="mb-6 hidden w-full max-w-sm dark:block" />
              <div className="grid gap-3">
                {credentials.map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-sm font-semibold text-foreground">
                    <CheckCircle className="h-4 w-4 flex-none text-brand-700 dark:text-brand-100" aria-hidden="true" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-background px-4 py-16 md:py-20">
        <div className="mx-auto max-w-5xl rounded-[2rem] border border-border bg-card p-6 text-center shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-10">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Mission</p>
          <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">Diagnose the workflow first. Ship a small reliable fix. Expand only when the case is clear.</h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
            The work is scoped around commercially visible leaks: slow response, confusing websites, manual handoffs, CRM gaps, disconnected tools, and systems that operators cannot trust.
          </p>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/55 px-4 py-16 dark:bg-brand-950 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Operating values</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-5xl">Premium work without theater.</h2>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {values.map(({ title, description, icon: Icon }) => (
              <Card key={title} className="h-full border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
                <CardContent className="p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background px-4 py-16 md:py-20">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Story</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-5xl">A reality-based founder story.</h2>
          </div>
          <div className="space-y-4">
            {timeline.map((item) => (
              <div key={item.title} className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:grid-cols-[150px_1fr] md:p-6">
                <div className="inline-flex h-fit w-fit rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground dark:bg-white/10 dark:text-brand-100">
                  {item.year}
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{item.title}</h3>
                  <p className="mt-2 leading-7 text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-brand-950 px-4 py-16 text-white md:py-20">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 md:flex-row md:items-center md:justify-between md:p-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-100">Next step</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] md:text-4xl">Bring one leak. Leave with one practical path.</h2>
          </div>
          <Link href="/contact" className={buttonVariants({ variant: "cta", size: "lg", className: "shrink-0" })}>
            Book a Tech Audit
          </Link>
        </div>
      </section>
    </>
  );
};

export default About;
