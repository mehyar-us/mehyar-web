/**
 * Assessment-call analytics events (ship-checklist item 1).
 *
 * Standalone helper — deliberately NOT importing GoogleAnalytics.tsx, so it
 * stays decoupled from the shared component (another crew owns that file)
 * and testable in Node. It mirrors that component's gating semantics:
 *
 * - Events go through window.gtag when the Google tag is loaded.
 * - With MEHYAR_PUBLIC_ANALYTICS_DRY_RUN=true they are logged via
 *   console.info instead of sent (verify with the dry-run flag before ship).
 * - No-ops when window/gtag is absent (SSR, tests, tag blocked).
 *
 * Meta Pixel / GTM note (checklist item 2): audited 2026-10-09 — the repo
 * has NO Meta pixel (fbq) and NO GTM container snippet anywhere in
 * client/index.html or client/src. Per the checklist, that is flagged as a
 * GAP in the report rather than invented here. The call surfaces carry the
 * Google tag, which is the tracking stack the site actually has.
 *
 * Infra crew: call trackAssessmentCallEvent() at these points:
 *   - "call_join"   — user gives recording consent and clicks Join
 *   - "call_start"  — the call media/session is live
 *   - "call_end"    — call ends (include duration_sec + end_reason)
 */
export type AssessmentCallEventName = "call_join" | "call_start" | "call_end";

export interface AssessmentCallEventParams {
  duration_sec?: number;
  end_reason?: "user_hangup" | "completed" | "error" | "timeout";
  consent_given?: boolean;
}

function readEnv(name: string): string | undefined {
  try {
    const im = import.meta as unknown as { env?: Record<string, string | undefined> };
    const v = im.env?.[name];
    if (typeof v === "string") return v;
  } catch {
    /* not a Vite runtime */
  }
  try {
    const pe = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env;
    const v = pe?.[name];
    if (typeof v === "string") return v;
  } catch {
    /* noop */
  }
  return undefined;
}

function isDryRun(): boolean {
  return readEnv("MEHYAR_PUBLIC_ANALYTICS_DRY_RUN") === "true";
}

interface GtagFn {
  (...args: unknown[]): void;
}

function getGtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const g = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof g === "function" ? g : null;
}

export function trackAssessmentCallEvent(
  event: AssessmentCallEventName,
  params: AssessmentCallEventParams = {},
): void {
  if (typeof window === "undefined") return;
  const payload: Record<string, string | number | boolean | undefined> = {
    page_path: window.location.pathname,
    ...params,
  };
  if (isDryRun()) {
    console.info(`[analytics dry-run] assessment_${event}`, payload);
    return;
  }
  const gtag = getGtag();
  if (!gtag) return;
  gtag("event", `assessment_${event}`, payload);
}
