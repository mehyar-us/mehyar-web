import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const HeroSection = () => {
  return (
    <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row items-center gap-12">
          <div className="md:w-1/2 mb-10 md:mb-0">
            <p className="text-sm font-semibold tracking-wide uppercase text-primary mb-3">
              MehyarSoft LLC · Systems, software, and AI automation consulting
            </p>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4 text-neutral-900 dark:text-white">
              Stop losing customers to missed calls, messy websites, and manual follow-up.
            </h1>
            <p className="text-lg md:text-xl text-neutral-700 dark:text-neutral-300 mb-8">
              I help local businesses, clinics, agencies, and regulated teams turn broken intake,
              disconnected tools, and repetitive admin work into clean websites, CRM flows,
              AI-assisted follow-up, and reliable internal systems.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/contact">
                <Button
                  size="lg"
                  className="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg shadow-md hover:shadow-lg"
                >
                  Book a Tech Audit
                </Button>
              </Link>
              <Link href="/services">
                <Button
                  variant="outline"
                  size="lg"
                  className="px-6 py-3 bg-white hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-primary dark:text-white font-medium rounded-lg shadow-md hover:shadow-lg border border-neutral-200 dark:border-neutral-700"
                >
                  See Offers & Pricing
                </Button>
              </Link>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-5">
              Practical builds first: audit, fix the leak, automate the follow-up, then scale what works.
            </p>
          </div>
          <div className="md:w-1/2 flex justify-center">
            <img
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
              alt="Business dashboard showing operational metrics and workflow automation"
              className="rounded-lg shadow-xl max-w-full h-auto"
              width="600"
              height="400"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
