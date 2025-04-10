import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const HeroSection = () => {
  return (
    <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row items-center">
          <div className="md:w-1/2 mb-10 md:mb-0">
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4 text-neutral-900 dark:text-white">
              Empowering Businesses with{" "}
              <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                Custom Web Apps, CRM & Automation
              </span>
            </h1>
            <p className="text-lg md:text-xl text-neutral-700 dark:text-neutral-300 mb-8">
              Transform your business operations with tailored technology
              solutions designed for efficiency, growth, and competitive
              advantage.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/services">
                <Button
                  size="lg"
                  className="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg shadow-md hover:shadow-lg"
                >
                  Our Services
                </Button>
              </Link>
              <Link href="/contact">
                <Button
                  variant="outline"
                  size="lg"
                  className="px-6 py-3 bg-white hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-primary dark:text-white font-medium rounded-lg shadow-md hover:shadow-lg border border-neutral-200 dark:border-neutral-700"
                >
                  Get a Quote
                </Button>
              </Link>
            </div>
          </div>
          <div className="md:w-1/2 flex justify-center">
            <img
              src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
              alt="Digital transformation illustration"
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
