import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import SampleReportPreview from "@/components/SampleReportPreview";

/* ── /audit/sample-report — the labelled sample of the $330 report ──────────
   rot294 (Product Chief, 2026-10-16): the live sample comes FIRST in the
   re-pinned Audit sequence — a real, redacted sample reachable at a 200 URL
   from /audit/. The preview component is fictional by design ("Sample
   Plumbing Co") and labelled SAMPLE throughout. */
export default function AuditSampleReport() {
  return (
    <section className="px-4 py-12 md:py-16">
      <div className="site-shell max-w-3xl">
        <Link
          href="/audit"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-100"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Audit My Business
        </Link>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Sample report
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          What the $330 Audit My Business report looks like when it lands in your inbox —
          shown with a fictional business, in the real format: your score, your money
          leaks priced in dollars, and the fixes in the order that matters.
        </p>

        <div className="mt-8">
          <SampleReportPreview />
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-border bg-card p-6 text-center md:p-8">
          <p className="text-lg font-semibold text-foreground">Want this run on your business?</p>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            Your report is built from your site's real measurements — every finding cites
            its evidence, exactly like the sample.
          </p>
          <a href="/audit#step-1" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "mt-2 min-h-12")}>
            Start Step 1 — it's free <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
