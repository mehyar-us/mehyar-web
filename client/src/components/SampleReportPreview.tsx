import { Eye, Lock } from "lucide-react";

/* ── Sample report preview ──────────────────────────────────────────────────
   Redacted illustration of what the $330 "Audit My Business" report looks like.
   All business details are fictional ("Sample Plumbing Co"). Clearly labeled
   SAMPLE — never presented as a real audit result (compliance item 11/12).
   Parked Oct 10 pending the Mayor's go; shipped 2026-10-16 under the Product
   Chief's rot294 re-pin (sample-first, AUTO band) as the /audit/sample-report
   page, linked from the /audit/ Step-3 card. States nothing about delivery —
   delivery wording lives on the pay card, not here. */

const SAMPLE_LEAKS = [
  {
    title: "No phone number above the fold",
    detail:
      "Mobile visitors — most of your traffic — have to scroll or hunt to call you. Every extra tap loses callers.",
    impact: "Estimated $800–$1,500/mo",
    severity: 4,
  },
  {
    title: "Quote form asks for 11 fields",
    detail:
      "Long forms kill conversions. Name, phone, and service needed is enough to start the conversation.",
    impact: "Estimated $500–$900/mo",
    severity: 3,
  },
];

const SAMPLE_FIXES = [
  "Add tap-to-call button in the mobile header",
  "Cut the quote form to 4 fields",
  "Add 3 recent job photos with captions",
];

export default function SampleReportPreview() {
  return (
    <div className="rounded-3xl border border-border bg-card p-6 md:p-8">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          Sample
        </span>
        <p className="text-xs text-muted-foreground">
          Illustration — not a real audit
        </p>
      </div>

      <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        What your $330 report looks like
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Fictional business ("Sample Plumbing Co"). Your report is built from{" "}
        <em>your</em> site's real measurements — every finding cites its evidence.
      </p>

      {/* Score */}
      <div className="mt-6 flex items-center gap-4 rounded-2xl bg-secondary p-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-2xl font-bold text-amber-700 dark:text-amber-300">
          62
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Site score: 62/100</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Based on measured signals — load time, CTAs, trust elements, mobile
            experience. The rationale names the exact signals behind the number.
          </p>
        </div>
      </div>

      {/* Money leaks */}
      <p className="mt-6 text-sm font-semibold text-foreground">
        Money leaks found <span className="font-normal text-muted-foreground">(2 of 6 shown)</span>
      </p>
      <div className="mt-3 space-y-3">
        {SAMPLE_LEAKS.map((leak) => (
          <div key={leak.title} className="rounded-2xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">{leak.title}</p>
              <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                Severity {leak.severity}/5
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{leak.detail}</p>
            <p className="mt-2 text-xs font-medium text-foreground">{leak.impact}</p>
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          4 more leaks, 6 flaws, and the full fix plan — in your report.
        </div>
      </div>

      {/* Prioritized fixes */}
      <p className="mt-6 text-sm font-semibold text-foreground">
        Prioritized fixes <span className="font-normal text-muted-foreground">(3 of 5 shown)</span>
      </p>
      <ol className="mt-3 space-y-2">
        {SAMPLE_FIXES.map((fix, i) => (
          <li key={fix} className="flex gap-3 text-sm leading-6 text-muted-foreground">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              {i + 1}
            </span>
            {fix}
          </li>
        ))}
      </ol>

      <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Every finding in a real report cites the exact measurement or transcript
        quote behind it. Low-confidence items are flagged "Needs review" — never
        guessed at.
      </p>
    </div>
  );
}
