import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import IndustryPricingExplorer from "@/components/industry-pricing-explorer";
import { buttonVariants } from "@/components/ui/button";

export default function Pricing() {
  return (
    <>
      <section className="site-hero">
        <div className="site-shell">
          <div className="max-w-4xl">
            <p className="site-eyebrow mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Business systems for teams worldwide
            </p>
            <h1 className="site-display">
              Choose your business. See exactly what you get.
            </h1>
            <p className="site-lede mt-6 max-w-3xl">
              Choose your business to compare a branded customer app, AI
              texting, phone support, social content, maintenance, and exact
              starting prices.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#industry-pricing"
                className={buttonVariants({ variant: "cta", size: "lg" })}
              >
                Find my business <ArrowRight className="ml-2 h-4 w-4" />
              </a>
              <Link
                href="/micro-offer#intake"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Start with a $330 tech audit
              </Link>
            </div>
          </div>
        </div>
      </section>
      <IndustryPricingExplorer />
    </>
  );
}
