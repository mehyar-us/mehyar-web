import { Code, Factory, LayoutGrid } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Code,
    title: "Revenue leak first",
    description: "We start with the business problem: missed leads, weak conversion, slow follow-up, manual admin, or disconnected systems.",
  },
  {
    icon: Factory,
    title: "Regulated-systems discipline",
    description: "Experience in pharma-adjacent systems engineering brings practical habits around reliability, access, auditability, and change control.",
  },
  {
    icon: LayoutGrid,
    title: "Small build, clear handoff",
    description: "Most engagements are scoped into audits, sprints, or retainers with concrete deliverables your team can understand and operate.",
  },
];

const WhyChooseUs = () => {
  return (
    <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Why businesses call MehyarSoft
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Not every problem needs a large platform. Many businesses need a senior engineer to map the workflow,
            remove friction, and install one reliable system at a time.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <Card key={index} className="bg-white dark:bg-neutral-900 shadow-md">
              <CardContent className="p-6">
                <div className="w-12 h-12 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mb-4">
                  <feature.icon className="text-primary" size={20} />
                </div>
                <h3 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-neutral-700 dark:text-neutral-300">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default WhyChooseUs;
