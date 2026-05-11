import { Code, Factory, LayoutGrid } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Code,
    title: "Full-Stack Expertise",
    description: "From UI/UX design to backend development, our team handles every aspect of your digital solution.",
  },
  {
    icon: Factory,
    title: "Industry Experience",
    description: "We've delivered solutions across finance, healthcare, retail, and more, understanding each sector's unique needs.",
  },
  {
    icon: LayoutGrid,
    title: "Agile Approach",
    description: "Our flexible development methodology ensures fast delivery and continuous adaptation to your evolving requirements.",
  },
];

const WhyChooseUs = () => {
  return (
    <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Why Choose Us
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            With our expertise and tailored approach, we deliver solutions that
            drive real business growth.
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
