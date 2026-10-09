/**
 * Tests for the assessment-call analytics helper (ship-checklist item 1+4).
 * Verifies dry-run semantics: with MEHYAR_PUBLIC_ANALYTICS_DRY_RUN=true the
 * events are logged via console.info and never touch window.gtag.
 * Run: npx tsx this-file
 */
import { test, ok, report } from "./assert.js";
import { trackAssessmentCallEvent } from "../analytics.js";

test("no window -> silent no-op (SSR/tests)", () => {
  // In Node there is no window; must not throw.
  trackAssessmentCallEvent("call_start");
  trackAssessmentCallEvent("call_end", { duration_sec: 2400, end_reason: "completed" });
  ok(true, "no throw");
});

test("dry-run: logs via console.info, never calls gtag", () => {
  process.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN = "true";
  const logged: string[] = [];
  const origInfo = console.info;
  console.info = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  let gtagCalls = 0;
  (globalThis as unknown as { window: unknown }).window = {
    location: { pathname: "/assessment-call" },
    gtag: () => { gtagCalls++; },
  };
  try {
    trackAssessmentCallEvent("call_join", { consent_given: true });
    trackAssessmentCallEvent("call_end", { duration_sec: 2700, end_reason: "user_hangup" });
  } finally {
    console.info = origInfo;
    delete (globalThis as unknown as { window?: unknown }).window;
    delete process.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN;
  }
  ok(logged.length === 2, `two dry-run lines logged (${logged.length})`);
  ok(logged[0].includes("[analytics dry-run] assessment_call_join"), `join line: ${logged[0].slice(0, 60)}`);
  ok(logged[1].includes("assessment_call_end"), `end line: ${logged[1].slice(0, 60)}`);
  ok(gtagCalls === 0, "gtag never called in dry-run");
});

test("live mode: forwards to window.gtag with the assessment_ prefix", () => {
  delete process.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN;
  const calls: unknown[][] = [];
  (globalThis as unknown as { window: unknown }).window = {
    location: { pathname: "/assessment-call" },
    gtag: (...args: unknown[]) => { calls.push(args); },
  };
  try {
    trackAssessmentCallEvent("call_start");
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
  ok(calls.length === 1, "one gtag call");
  ok(calls[0][0] === "event" && calls[0][1] === "assessment_call_start", `event name ${calls[0][1]}`);
});

test("live mode without gtag -> silent no-op (tag blocked)", () => {
  delete process.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN;
  (globalThis as unknown as { window: unknown }).window = {
    location: { pathname: "/assessment-call" },
  };
  try {
    trackAssessmentCallEvent("call_start");
    ok(true, "no throw");
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

await report("assessment-analytics");
