import { Link } from "wouter";
import { services } from "@/data/services";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const ServicesSection = () => {
  const previewServices = services.slice(0, 6);

  return (
    <section id="services" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Practical consulting offers
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Choose the entry point that matches the current leak: audit the business, clean up conversion,
            install follow-up, automate internal work, or bring senior systems judgment to a complex integration.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {previewServices.map((service) => (
            <Card
              key={service.id}
              className="service-card bg-white dark:bg-neutral-800 rounded-xl shadow-lg overflow-hidden transform transition-all duration-300 hover:-translate-y-2 hover:shadow-xl"
            >
              <CardContent className="p-6">
                <div className={`w-16 h-16 ${service.bgColorClass} rounded-lg flex items-center justify-center mb-6`}>
                  <service.icon className={`text-2xl ${service.textColorClass}`} size={28} />
                </div>
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
                  {service.title}
                </h3>
                <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                  {service.description}
                </p>
                <Link href={`/services#${service.id}`}>
                  <a className={`inline-flex items-center ${service.textColorClass} hover:${service.hoverColorClass} font-medium transition-colors`}>
                    Details and range <ChevronRight className="ml-2 h-4 w-4" />
                  </a>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
