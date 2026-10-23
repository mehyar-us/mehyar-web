import { useEffect, useState } from "react";
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
  /* rot607 (2026-10-23): the sample page carries the same paused annotation
     as its sibling surfaces while audit_paused holds — keyed to the same
     availability flag, so it self-clears at the unpause. */
  const [auditPaused, setAuditPaused] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pay/availability", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setAuditPaused(!!(d && d.ok && d.audit_paused)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            Sample
          </span>
          Fictional business ("Sample Plumbing Co") — illustration, not a real audit.
        </p>
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
          {auditPaused && (
            <p className="max-w-xl text-xs leading-5 text-muted-foreground">
              Paid reports are currently paused while we restore full report
              generation — the free scan in Step 1 runs as always.
            </p>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Fictional business ("Sample Plumbing Co") — illustration, not a real audit.
          </p>
        </div>
      </div>
    </section>
  );
}
