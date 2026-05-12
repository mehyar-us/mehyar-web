import { Link } from "wouter";
import { services } from "@/data/services";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const servicePainMap: Record<string, { pain: string; next: string }> = {
  "tech-audit": {
    pain: "You know something is leaking, but not which fix should come first.",
    next: "Start with an audit",
  },
  "website-booking-cleanup": {
    pain: "People visit, get confused, hesitate, or never reach the booking step.",
    next: "Clean up conversion",
  },
  "missed-call-followup": {
    pain: "Calls, forms, and warm leads go cold before anyone follows up.",
    next: "Install follow-up",
  },
  "automation-sprint": {
    pain: "The team is buried in recurring spreadsheet, inbox, and admin work.",
    next: "Automate one workflow",
  },
  "systems-integration": {
    pain: "Tools, APIs, users, and risk requirements are colliding.",
    next: "Bring senior systems help",
  },
  "crm-support-retainer": {
    pain: "The system needs a steady technical owner, not another one-off fix.",
    next: "Set monthly support",
  },
};

const ServicesSection = () => {
  const previewServices = services.slice(0, 6);

  return (
    <section id="services" className="bg-background px-4 py-14 md:py-18">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">Consulting offers</p>
          <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">
            Pick the entry point by the leak, not by a generic service menu.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Each engagement maps pain → solution → outcome → next step, so the work stays commercially useful and easy to approve.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {previewServices.map((service) => {
            const mapped = servicePainMap[service.id];

            return (
              <Card key={service.id} className="group h-full overflow-hidden border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition-colors hover:border-brand-700/35">
                <CardContent className="flex h-full flex-col p-5">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                      <service.icon aria-hidden="true" size={22} />
                    </div>
                    <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {service.category}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold tracking-[-0.02em] text-foreground">{service.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">Pain:</span> {mapped.pain}</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">Solution:</span> {service.description}</p>
                  <p className="mt-3 flex-grow text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">Outcome:</span> {service.features[3]}</p>

                  <Link href={`/services#${service.id}`} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-800 transition-colors hover:text-brand-700 dark:text-brand-100 dark:hover:text-action">
                    {mapped.next} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
