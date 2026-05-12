import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { projects } from "@/data/portfolio-projects";
import CTASection from "@/components/cta-section";

const Portfolio = () => {
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    document.title = "Engagement Patterns | MehyarSoft";
  }, []);

  const categories = ["all", ...new Set(projects.map((project) => project.category))];
  const filteredProjects = filter === "all" ? projects : projects.filter((project) => project.category === filter);

  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.12),transparent_32%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_56%,#fff_100%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_32%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_56%,hsl(var(--brand-950))_100%)] md:pt-32">
        <div className="mx-auto max-w-7xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Engagement patterns</p>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">Engagement patterns, not fake case studies.</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">No invented logos or testimonials. These are concrete MehyarSoft work patterns for audits, missed-call follow-up, automations, integrations, website cleanup, and retainers.</p>
        </div>
      </section>

      <section className="bg-background px-4 py-16 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-wrap gap-2">
            {categories.map((category) => (
              <Button key={category} variant={filter === category ? "default" : "outline"} className="capitalize" onClick={() => setFilter(category)}>
                {category}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {filteredProjects.map((project, index) => {
              const Icon = project.icon;
              return (
                <Card key={project.id} className="group h-full border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition hover:border-brand-700/35">
                  <CardContent className="flex h-full flex-col p-6">
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                        {Icon ? <Icon aria-hidden="true" size={22} /> : null}
                      </div>
                      <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">0{index + 1}</span>
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">{project.category}</p>
                    <h2 className="mt-3 text-xl font-bold tracking-[-0.02em] text-foreground">{project.title}</h2>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{project.description}</p>
                    <div className="mt-5 rounded-2xl border border-border bg-background/70 p-4 dark:bg-white/[0.03]">
                      <p className="text-sm font-semibold text-foreground">Typical deliverables</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{project.results.slice(0, 2).join(" • ")}</p>
                    </div>
                    <Link href={`/portfolio/${project.id}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
                      View pattern <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default Portfolio;
