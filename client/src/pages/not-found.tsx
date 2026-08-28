import { Link } from "wouter";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="site-hero flex min-h-screen items-center justify-center">
      <Card className="site-panel w-full max-w-xl">
        <CardContent className="p-8 text-center md:p-10">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
            <AlertCircle className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="site-eyebrow mb-3">Page not found</p>
          <h1 className="site-heading">This MehyarSoft route does not exist.</h1>
          <p className="site-lede mx-auto mt-4 max-w-md">Wrong address. If you meant to book the $330 audit, the button below drops you on the intake form. Otherwise, the sitemap lists every public route.</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/micro-offer#intake" className={buttonVariants({ variant: "cta" })}>
              Book a Tech Audit <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/sitemap" className={buttonVariants({ variant: "outline" })}>
              View sitemap
            </Link>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
