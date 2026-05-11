import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const HeroSection = () => {
  return (
    <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-brand-100/80 via-background to-white dark:from-brand-900 dark:via-background dark:to-brand-950">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row items-center gap-12">
          <div className="md:w-1/2 mb-10 md:mb-0">
            <p className="text-sm font-semibold tracking-wide uppercase text-brand-700 dark:text-brand-100 mb-3">
              MehyarSoft LLC · Systems, software, and AI automation consulting
            </p>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4 text-ink dark:text-white">
              Stop losing customers to missed calls, messy websites, and manual follow-up.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8">
              I help local businesses, clinics, agencies, and regulated teams turn broken intake,
              disconnected tools, and repetitive admin work into clean websites, CRM flows,
              AI-assisted follow-up, and reliable internal systems.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/contact">
                <Button
                  size="lg"
                  variant="cta"
                  className="px-6 py-3 font-medium"
                >
                  Book a Tech Audit
                </Button>
              </Link>
              <Link href="/services">
                <Button
                  variant="outline"
                  size="lg"
                  className="px-6 py-3 font-medium"
                >
                  See Offers & Pricing
                </Button>
              </Link>
            </div>
            <p className="text-sm text-muted-foreground mt-5">
              Practical builds first: audit, fix the leak, automate the follow-up, then scale what works.
            </p>
          </div>
          <div className="md:w-1/2 flex justify-center">
            <img
              src="/assets/mehyarsoft-neutral-card.svg"
              alt="Abstract MehyarSoft systems visual showing connected workflow cards"
              className="max-w-full rounded-2xl border border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.16)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]"
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
