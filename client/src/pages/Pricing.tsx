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
                href="/assessment-call/"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Book your free assessment call
              </Link>
              <Link
                href="/audit/free"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Or run the free AI audit first
              </Link>
            </div>
          </div>
        </div>
      </section>
      <IndustryPricingExplorer />
      {/* ── THE MAYOR KNOWS YOUR INDUSTRY ── */}
      <section className="border-t border-border bg-background px-4 py-12 md:py-16">
        <div className="site-shell">
          <div className="mx-auto grid max-w-5xl items-center gap-8 rounded-3xl border border-border bg-card p-7 sm:p-10 md:grid-cols-[auto_1fr_auto]">
            <img
              src="/assets/mayor-avatar.webp"
              alt="The Mayor"
              width={96}
              height={96}
              loading="lazy"
              className="h-20 w-20 rounded-full object-cover ring-2 ring-brand-700/20"
            />
            <div>
              <p className="site-eyebrow">The Mayor</p>
              <h2 className="site-serif mt-3 text-2xl font-medium leading-[1.12] text-ink md:text-3xl">
                Whichever business you run, The Mayor learns it.
              </h2>
              <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
                Your services, prices, hours, and customers — remembered. The calls you miss,
                answered. The follow-up you forget, handled. Free to start, $14/month Pro.
              </p>
            </div>
            <a
              href="https://mayor.mehyar.us"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-800 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Log in to The Mayor
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
