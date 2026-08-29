import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";

export default function HeroSection() {
  return (
    <section className="overflow-hidden bg-background px-4 pb-0 pt-20 sm:pt-24">
      <div className="site-shell py-8 text-center sm:py-10 lg:py-12">
        <p className="site-eyebrow mx-auto mb-4 flex w-fit items-center gap-3">
          <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
          Software · systems · AI
          <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
        </p>
        <h1 className="site-display mx-auto max-w-5xl text-balance">Choose the result. We build the system.</h1>
        <p className="site-lede mx-auto mt-5 max-w-3xl text-balance">
          Customer apps, business automation, cloud software, and managed AI—designed, built, and supported by one engineering partner.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="#solutions" className={buttonVariants({ variant: "cta", size: "lg", className: "h-12 px-7 text-base" })}>
            Find what fits <ArrowRight className="ml-2 h-4 w-4" />
          </a>
          <Link href="/booking" className={buttonVariants({ variant: "outline", size: "lg", className: "h-12 px-7 text-base" })}>
            Talk through your idea
          </Link>
        </div>
      </div>
    </section>
  );
}
