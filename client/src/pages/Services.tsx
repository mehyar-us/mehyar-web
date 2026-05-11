import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { services } from "@/data/services";
import PricingSection from "@/components/pricing-section";
import CTASection from "@/components/cta-section";

const Services = () => {
  useEffect(() => {
    document.title = "Services & Pricing | MehyarSoft";
  }, []);

  return (
    <>
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
            Consulting offers for customer leaks, workflow drag, and system gaps
          </h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto mb-8">
            From a one-time local business audit to senior systems architecture support, each offer is scoped around a clear operational outcome.
          </p>
        </div>
      </section>

      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="space-y-16">
            {services.map((service, index) => (
              <div
                key={service.id}
                id={service.id}
                className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center scroll-mt-24"
              >
                <div className={`order-2 ${index % 2 === 0 ? "lg:order-2" : "lg:order-1"}`}>
                  <Badge
                    variant="outline"
                    className={`mb-4 ${service.badgeBgClass} ${service.badgeColorClass} text-sm px-3 py-1`}
                  >
                    {service.category}
                  </Badge>
                  <h2 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
                    {service.title}
                  </h2>
                  <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
                    {service.description}
                  </p>
                  <div className="space-y-4">
                    {service.features.map((feature, featureIndex) => (
                      <div key={featureIndex} className="flex items-start">
                        <ArrowRight className={`${service.textColorClass} mr-3 mt-1.5 h-4 w-4 flex-shrink-0`} />
                        <p className="text-neutral-700 dark:text-neutral-300">
                          {feature}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`order-1 ${index % 2 === 0 ? "lg:order-1" : "lg:order-2"}`}>
                  <img
                    src={service.image}
                    alt={service.title}
                    className="rounded-lg shadow-xl w-full h-auto"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PricingSection />

      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
              Stack and delivery approach
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
              Tools are selected for the workflow, not for trend value. Common work includes React/TypeScript frontends, Node/Python backends, CRM/email/scheduling integrations, Cloudflare-native hosting, SQL databases, dashboards, and AI-assisted workflow automation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {["Discover the leak", "Ship the smallest useful fix", "Measure, document, and support"].map((step) => (
              <Card key={step} className="bg-neutral-50 dark:bg-neutral-800 shadow-sm">
                <CardContent className="p-6 text-center">
                  <h3 className="font-bold text-neutral-900 dark:text-white">{step}</h3>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default Services;
