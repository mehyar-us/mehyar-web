import { Code, Factory, LayoutGrid } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Code,
    title: "Architecture + execution",
    description: "I can design the system, write production code, unblock teams, review implementation quality, and own delivery through launch.",
  },
  {
    icon: Factory,
    title: "Regulated + high-scale systems",
    description: "Experience across pharmaceutical commercial platforms, analytics systems, high-throughput marketing APIs, video platforms, and AI products.",
  },
  {
    icon: LayoutGrid,
    title: "Modern AI/cloud stack",
    description: "Hands-on with AWS, Kubernetes, CI/CD, Python, TypeScript, RAG, LLMs, observability, secure integrations, and platform modernization.",
  },
];

const WhyChooseUs = () => {
  return (
    <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Why hiring teams should talk to me
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            I fit teams that need senior ownership across product engineering, infrastructure, AI systems, and operational reliability.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <Card key={index} className="bg-white dark:bg-neutral-900 shadow-md border-neutral-200 dark:border-neutral-700">
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
