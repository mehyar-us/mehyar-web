import { Card, CardContent } from "@/components/ui/card";

const proofPoints = [
  { value: "10+", label: "years professional software and systems engineering" },
  { value: "NYC", label: "founder-led consulting for local and regulated businesses" },
  { value: "B2B", label: "websites, CRM workflows, automation, integrations" },
];

const AboutSection = () => {
  return (
    <section id="about" className="bg-white px-4 py-20 dark:bg-brand-900 md:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_0.92fr]">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Founder context</p>
            <h2 className="text-3xl font-bold tracking-[-0.03em] text-ink dark:text-white md:text-5xl">
              A senior technical owner for the messy middle between website, workflow, and operations.
            </h2>
            <p className="mt-6 text-lg leading-8 text-muted-foreground">
              MehyarSoft LLC is led by Mehyar Swelim, a Syrian founder in New York City with 10+ years of professional software engineering experience and current pharma systems-engineering contract work.
            </p>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">
              The focus is simple: find where customers, time, and money are leaking, then build the smallest reliable system that closes the gap — landing page, booking flow, missed-call SMS response, CRM cleanup, spreadsheet replacement, or regulated-system integration.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {proofPoints.map((point) => (
                <Card key={point.label} className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
                  <CardContent className="p-4">
                    <div className="mb-1 text-3xl font-bold text-brand-800 dark:text-brand-100">{point.value}</div>
                    <div className="text-sm leading-5 text-muted-foreground">{point.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-border bg-gradient-to-br from-brand-100 via-white to-secondary p-8 shadow-[0_20px_70px_rgba(8,63,84,0.12)] dark:from-brand-950 dark:via-brand-900 dark:to-brand-800/60">
            <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-700/10 blur-3xl" aria-hidden="true" />
            <div className="absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-action/10 blur-3xl" aria-hidden="true" />
            <div className="relative flex min-h-[420px] flex-col justify-between">
              <div>
                <img
                  src="/assets/mehyarsoft-mark.svg"
                  alt="MehyarSoft brand mark"
                  className="h-20 w-20 rounded-3xl shadow-lg"
                  width="80"
                  height="80"
                />
                <p className="mt-8 text-sm font-semibold uppercase tracking-[0.22em] text-brand-800 dark:text-brand-100">
                  Systems • Software • AI Automation
                </p>
                <p className="mt-4 max-w-md text-3xl font-bold leading-tight tracking-[-0.03em] text-ink dark:text-white">
                  Practical consulting for businesses that cannot afford a leaky customer path.
                </p>
              </div>
              <div className="mt-8 rounded-2xl border border-border bg-white/75 p-5 backdrop-blur dark:bg-white/[0.05]">
                <p className="text-sm font-semibold text-foreground">Engagement rhythm</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Diagnose the leak, scope the smallest fix, build with handoff, then decide whether to automate, integrate, or retain support.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
