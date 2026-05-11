import { Link } from "wouter";
import { services } from "@/data/services";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const ServicesSection = () => {
  return (
    <section id="services" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Our Services
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Comprehensive technology solutions tailored to your business needs, from
            custom web applications to automation workflows.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {services.map((service) => (
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
                    Learn more <ChevronRight className="ml-2 h-4 w-4" />
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
