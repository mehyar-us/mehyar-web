import { Card, CardContent } from "@/components/ui/card";

const proofPoints = [
  { value: "10+", label: "years professional software and systems engineering" },
  { value: "NYC", label: "based founder serving local and regulated businesses" },
  { value: "B2B", label: "websites, CRM workflows, automation, integrations" },
];

const AboutSection = () => {
  return (
    <section id="about" className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row items-center">
          <div className="lg:w-1/2 mb-10 lg:mb-0 lg:pr-12">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
              Senior engineering judgment for businesses that need fewer leaks, not more software theater.
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-4">
              MehyarSoft LLC is led by Mehyar Swelim, a Syrian founder who came to New York City
              15 years ago and built a career as a professional software engineer. Today, MehyarSoft
              serves clients through systems engineering, software consulting, and practical AI automation.
            </p>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
              The focus is simple: find where customers, time, and money are leaking, then build the
              smallest reliable system that closes the gap. That might be a landing page, booking flow,
              missed-call SMS response, CRM cleanup, spreadsheet replacement, or regulated-system integration.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
              {proofPoints.map((point) => (
                <Card key={point.label} className="bg-white dark:bg-neutral-900 shadow-sm">
                  <CardContent className="p-4">
                    <div className="text-primary font-bold text-3xl mb-1">{point.value}</div>
                    <div className="text-neutral-700 dark:text-neutral-300 text-sm">{point.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <div className="lg:w-1/2">
            <div className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/10 via-white to-secondary/10 p-10 shadow-xl dark:from-primary/20 dark:via-neutral-900 dark:to-secondary/20">
              <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
              <div className="absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-secondary/10 blur-3xl" aria-hidden="true" />
              <div className="relative flex min-h-[420px] flex-col items-center justify-center text-center">
                <img
                  src="/assets/mehyarsoft-mark.svg"
                  alt="MehyarSoft brand mark"
                  className="mb-8 h-28 w-28 rounded-3xl shadow-lg"
                />
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">
                  Systems • Software • AI Automation
                </p>
                <p className="mt-4 max-w-md text-2xl font-bold leading-tight text-neutral-900 dark:text-white">
                  Founder-led engineering with a brand-first, systems-first public presence.
                </p>
                <p className="mt-4 max-w-sm text-neutral-700 dark:text-neutral-300">
                  Clear diagnostics, practical fixes, and owner-visible systems for businesses that need fewer leaks.
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
