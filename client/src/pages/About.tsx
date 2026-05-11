import { useEffect } from "react";
import { Link } from "wouter";
import { CheckCircle, Award, Users, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import CTASection from "@/components/cta-section";

const values = [
  {
    title: "Practicality",
    description: "Start with the highest-leverage business leak before adding tools or complexity.",
    icon: <Award className="h-6 w-6 text-primary" />,
  },
  {
    title: "Reliability",
    description: "Build systems that owners can trust, monitor, and hand off without mystery.",
    icon: <CheckCircle className="h-6 w-6 text-primary" />,
  },
  {
    title: "Operator empathy",
    description: "Design around the people answering phones, booking customers, updating records, and serving clients.",
    icon: <Users className="h-6 w-6 text-primary" />,
  },
  {
    title: "Speed with control",
    description: "Move fast, but keep consent, audit trails, access, and suppression lists ahead of scale.",
    icon: <Clock className="h-6 w-6 text-primary" />,
  },
];

const timeline = [
  {
    year: "15 years ago",
    title: "From Syria to New York City",
    description: "Mehyar came to NYC and built a life and career through software, systems thinking, and persistence.",
  },
  {
    year: "10+ years",
    title: "Professional software engineering",
    description: "Hands-on work across application development, systems, integrations, and business technology delivery.",
  },
  {
    year: "Now",
    title: "MehyarSoft LLC",
    description: "A consulting brand focused on software, systems engineering, AI automation, and practical tech support for local and regulated businesses.",
  },
];

const About = () => {
  useEffect(() => {
    document.title = "Founder Story | MehyarSoft";
  }, []);

  return (
    <>
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center">
            <div className="md:w-1/2 mb-10 md:mb-0 md:pr-12">
              <p className="text-sm font-semibold tracking-wide uppercase text-primary mb-3">Founder-led consulting</p>
              <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
                Built by an engineer who understands both survival and systems.
              </h1>
              <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
                Mehyar Swelim is a Syrian founder who came to New York City 15 years ago, became a professional software engineer, and built MehyarSoft LLC to help businesses solve practical operational problems with software, systems, and automation.
              </p>
              <Link href="/contact">
                <Button className="px-6 py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-md hover:shadow-lg">
                  Discuss a Business Bottleneck
                </Button>
              </Link>
            </div>
            <div className="md:w-1/2">
              <img
                src="/mehyar-swelim.jpg"
                alt="Mehyar Swelim, founder of MehyarSoft LLC"
                className="rounded-lg shadow-xl w-full object-cover h-96"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-5xl text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
            Mission
          </h2>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 mb-12 leading-relaxed">
            Help small businesses and regulated teams stop losing customers, time, and money through bad websites, missed calls, manual work, poor follow-up, and disconnected systems.
          </p>

          <Separator className="mb-12" />

          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
            Working principle
          </h2>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 leading-relaxed">
            Diagnose the workflow first, ship a small reliable fix, then expand only when the numbers and operator experience justify it.
          </p>
        </div>
      </section>

      <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
              Operating values
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
              These are the standards behind MehyarSoft consulting work.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {values.map((value) => (
              <Card key={value.title} className="bg-white dark:bg-neutral-900 shadow-md h-full">
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mb-4">
                    {value.icon}
                  </div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                    {value.title}
                  </h3>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    {value.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
              The MehyarSoft story
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
              A reality-based founder story, not a fictional agency timeline.
            </p>
          </div>

          <div className="max-w-4xl mx-auto">
            {timeline.map((item) => (
              <div key={item.title} className="flex flex-col md:flex-row mb-12 last:mb-0">
                <div className="md:w-1/4 mb-4 md:mb-0">
                  <div className="bg-primary text-white text-xl font-bold rounded-lg px-4 py-2 inline-block">
                    {item.year}
                  </div>
                </div>
                <div className="md:w-3/4">
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                    {item.title}
                  </h3>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default About;
