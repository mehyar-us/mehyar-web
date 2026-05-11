import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const CTASection = () => {
  return (
    <section className="py-20 px-4 bg-gradient-to-r from-primary to-primary-dark text-white">
      <div className="container mx-auto">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Start with the smallest fix that creates revenue.
          </h2>
          <p className="text-xl text-white/80 mb-8 max-w-3xl mx-auto">
            Send the current bottleneck: website, booking, missed calls, follow-up, spreadsheets,
            CRM, or internal system work. I will recommend a practical first engagement before
            proposing a larger build.
          </p>
          <Link href="/contact">
            <Button
              size="lg"
              variant="secondary"
              className="px-8 py-4 bg-white text-primary hover:bg-neutral-100 font-medium rounded-lg transition-colors shadow-lg hover:shadow-xl text-lg"
            >
              Request a Practical Next Step
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
