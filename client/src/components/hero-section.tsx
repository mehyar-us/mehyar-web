import { ArrowRight, ScanSearch } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";

export default function HeroSection() {
  return (
    <section className="overflow-hidden bg-background px-4 pb-0 pt-20 sm:pt-24">
      <div className="site-shell py-8 text-center sm:py-10 lg:py-12">
        <p className="site-eyebrow mx-auto mb-4 flex w-fit items-center gap-3">
          <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
          Free AI website audit
          <span className="h-px w-8 bg-brand-700" aria-hidden="true" />
        </p>
        <h1 className="site-display mx-auto max-w-5xl text-balance">Is your website leaking money?</h1>
        <p className="site-lede mx-auto mt-5 max-w-3xl text-balance">
          Drop in your URL. Our AI scans your site in 60 seconds and shows you exactly where customers slip away — priced in dollars. Free, no account, no card.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/audit" className={buttonVariants({ variant: "cta", size: "lg", className: "h-12 px-7 text-base" })}>
            <ScanSearch className="mr-2 h-4 w-4" /> Audit my site free <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link href="/booking" className={buttonVariants({ variant: "outline", size: "lg", className: "h-12 px-7 text-base" })}>
            Talk through your idea
          </Link>
        </div>
        <p className="mx-auto mt-4 max-w-xl text-xs leading-5 text-muted-foreground">
          Free 60-second scan · Your full report lands in your inbox
        </p>
      </div>
    </section>
  );
}
