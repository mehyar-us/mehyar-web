import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { services } from "@/data/services";
import CTASection from "@/components/cta-section";

const Services = () => {
  useEffect(() => {
    document.title = "Services | MehyarSoft";
  }, []);

  return (
    <>
      {/* Services Hero */}
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
            Our Services
          </h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto mb-8">
            Comprehensive technology solutions tailored to your business needs,
            helping you thrive in the digital landscape.
          </p>
        </div>
      </section>

      {/* Services List */}
      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="space-y-16">
            {services.map((service) => (
              <div
                key={service.id}
                id={service.id}
                className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center"
              >
                <div className={`order-2 ${service.id % 2 === 0 ? "lg:order-2" : "lg:order-1"}`}>
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
                    {service.features.map((feature, index) => (
                      <div key={index} className="flex items-start">
                        <ArrowRight className={`${service.textColorClass} mr-3 mt-1.5 h-4 w-4 flex-shrink-0`} />
                        <p className="text-neutral-700 dark:text-neutral-300">
                          {feature}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`order-1 ${service.id % 2 === 0 ? "lg:order-1" : "lg:order-2"}`}>
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

      {/* Technologies Section */}
      <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
              Technologies We Use
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
              We leverage modern technologies to build powerful, scalable
              solutions for our clients.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { name: "React", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" },
              { name: "Node.js", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg" },
              { name: "Python", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg" },
              { name: "Angular", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/angularjs/angularjs-original.svg" },
              { name: "TypeScript", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg" },
              { name: "AI & ML", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/tensorflow/tensorflow-original.svg" },
              { name: "AWS", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/amazonwebservices/amazonwebservices-original-wordmark.svg" },
              { name: "Docker", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg" },
              { name: "MongoDB", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mongodb/mongodb-original.svg" },
              { name: "MySQL", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mysql/mysql-original.svg" },
              { name: "PostgreSQL", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg" },
              { name: "Django", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/django/django-plain.svg" },
            ].map((tech, index) => (
              <Card key={index} className="bg-white dark:bg-neutral-900 shadow-sm">
                <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                  <img 
                    src={tech.icon} 
                    alt={tech.name} 
                    className="w-16 h-16 mb-4"
                  />
                  <h3 className="font-medium text-neutral-900 dark:text-white">
                    {tech.name}
                  </h3>
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
