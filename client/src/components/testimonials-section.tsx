import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const proofItems = [
  {
    title: "Founder credibility",
    body: "Mehyar Swelim is a Syrian founder in New York City with 10+ years of professional software engineering experience and current systems-engineering work through MehyarSoft LLC.",
  },
  {
    title: "Operational focus",
    body: "Engagements are scoped around visible business leaks: missed calls, weak website conversion, manual reporting, CRM gaps, or disconnected tools.",
  },
  {
    title: "Compliance-aware approach",
    body: "For follow-up and outreach systems, the build plan includes opt-out handling, suppression lists, audit trails, and no deceptive or unsafe mass sending.",
  },
];

const TestimonialsSection = () => {
  return (
    <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Proof without fake testimonials
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            MehyarSoft uses verifiable positioning instead of invented client quotes. The promise is grounded in professional engineering experience and practical business outcomes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {proofItems.map((item) => (
            <Card key={item.title} className="bg-white dark:bg-neutral-900 shadow-md h-full">
              <CardContent className="p-6">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">{item.title}</h3>
                <p className="text-neutral-700 dark:text-neutral-300">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link href="/about">
            <Button variant="outline">Read the founder story</Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
