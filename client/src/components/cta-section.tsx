import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

const CTASection = () => {
  return (
    <section className="px-4 py-20 md:py-24">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-to-r from-brand-950 via-brand-800 to-brand-950 p-8 text-white shadow-[0_24px_90px_rgba(8,63,84,0.18)] md:p-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-100">Practical next step</p>
            <h2 className="max-w-3xl text-3xl font-bold tracking-[-0.03em] text-white md:text-5xl">
              Start with the smallest fix that can protect revenue.
            </h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-white/76">
              Send the current bottleneck: website, booking, missed calls, follow-up, spreadsheets, CRM, or internal system work. MehyarSoft will recommend a practical first engagement before proposing a larger build.
            </p>
          </div>
          <Link href="/micro-offer#intake" className={buttonVariants({ variant: "cta", size: "lg", className: "h-12 bg-white px-7 text-base text-brand-950 hover:bg-brand-100 dark:text-brand-950" })}>
                      Request the audit path <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
