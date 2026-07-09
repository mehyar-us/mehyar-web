import { Link } from "wouter";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="flex min-h-screen items-center justify-center bg-background px-4 py-28">
      <Card className="w-full max-w-xl border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)]">
        <CardContent className="p-8 text-center md:p-10">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
            <AlertCircle className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Page not found</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">This MehyarSoft route does not exist.</h1>
          <p className="mx-auto mt-4 max-w-md leading-7 text-muted-foreground">Use the public route directory or send a secure intake request if you were trying to reach MehyarSoft.</p>
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
