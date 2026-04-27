import { services } from "@/data/services";
import { Card, CardContent } from "@/components/ui/card";

const ServicesSection = () => {
  return (
    <section id="services" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Problems I solve
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {services.map((service) => (
            <Card 
              key={service.id}
              className="service-card bg-white dark:bg-neutral-800 rounded-xl shadow-lg overflow-hidden transform transition-all duration-300 hover:-translate-y-2 hover:shadow-xl border-neutral-200 dark:border-neutral-700"
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
                <ul className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {service.features.slice(0, 4).map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
