// Tests for the decide() intent assist in the social-inbox router (2026-10-09).
// route() (keyword path) is unchanged; routeAsync() adds the shared
// wants_fix_link question for @aimechanicapp messages with no keyword hit.
// Fail-closed: any error / low confidence / other account -> { product_id: null }.
//
// Run with: node functions/api/social/_shared/routerDecide.test.js
// Exit non-zero on failure.

import { route, routeAsync } from "./router.js";
import QUESTIONS from "./intent-questions.json" with { type: "json" };

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}${extra ? `\n  ${extra}` : ""}`); }
}

// Mock decide transport: returns a canned choice answer for the intent question.
function mockTransport(choice, p) {
  const calls = [];
  const fn = async (env, wireBody) => {
    calls.push(wireBody);
    return {
      raw: {
        model: "clef-flash",
        answers: {
          intent: {
            type: "choice", choice,
            probabilities: {
              wants_link: choice === "wants_link" ? p : 1 - p,
              other: choice === "other" ? p : 1 - p,
            },
          },
        },
        usage: { input_tokens: 70, output_tokens: 0 },
      },
      latencyMs: 40, via: "mock",
    };
  };
  fn.calls = calls;
  return fn;
}

const env = {};

// 1. Keyword path unchanged: FIX keyword routes without consulting decide.
{
  const t = mockTransport("wants_link", 0.95);
  const r = await routeAsync(
    { account: "aimechanicapp", text: "FIX please", author_name: "Sam" },
    { env, transport: t });
  ok(r.product_id === "aimech-app" && r.keyword === "FIX", "keyword FIX routes via keyword path");
  ok(t.calls.length === 0, "decide not consulted on keyword hit");
}

// 2. Sync route() still works as before (no regression).
{
  const r = route({ account: "aimechanicapp", text: "FIX please", author_name: "Sam" });
  ok(r.product_id === "aimech-app", "sync route unchanged");
  const r2 = route({ account: "aimechanicapp", text: "nice reel!", author_name: "Sam" });
  ok(r2.product_id === null, "sync route: no keyword -> null");
}

// 3. No keyword + high-confidence wants_link -> FIX special reply.
{
  const t = mockTransport("wants_link", 0.93);
  const r = await routeAsync(
    { account: "aimechanicapp", text: "where can I download this app??", author_name: "Sam" },
    { env, transport: t });
  ok(r.product_id === "aimech-app" && r.keyword === "FIX", "decide wants_link -> FIX reply",
    JSON.stringify(r).slice(0, 200));
  ok(t.calls.length === 1, "decide consulted exactly once");
  // The question sent is the shared definition.
  const asked = t.calls[0].questions.intent;
  ok(asked.instructions === QUESTIONS.wants_fix_link.ask, "shared question ask used");
  ok(JSON.stringify(asked.criteria) === JSON.stringify(QUESTIONS.wants_fix_link.options),
    "shared question options used");
}

// 4. No keyword + high-confidence other -> null (skipped as today).
{
  const t = mockTransport("other", 0.97);
  const r = await routeAsync(
    { account: "aimechanicapp", text: "love this reel!!", author_name: "Sam" },
    { env, transport: t });
  ok(r.product_id === null, "decide other -> null");
}

// 5. Low confidence -> null (fail closed).
{
  const t = mockTransport("wants_link", 0.6);
  const r = await routeAsync(
    { account: "aimechanicapp", text: "hmm interesting", author_name: "Sam" },
    { env, transport: t });
  ok(r.product_id === null, "low confidence -> null");
}

// 6. Transport throws -> null (fail closed, no new sends).
{
  const t = async () => { throw new Error("network down"); };
  const r = await routeAsync(
    { account: "aimechanicapp", text: "where is the app", author_name: "Sam" },
    { env, transport: t });
  ok(r.product_id === null, "transport failure -> null");
}

// 7. Other accounts never consult decide (question is aimechanicapp-specific).
{
  const t = mockTransport("wants_link", 0.99);
  const r = await routeAsync(
    { account: "mehyar_us", text: "where can I download this app??", author_name: "Sam" },
    { env, transport: t });
  ok(r.product_id === null, "non-aimechanicapp -> null");
  ok(t.calls.length === 0, "decide not consulted for other accounts");
}

// 8. Empty text -> null, no decide call.
{
  const t = mockTransport("wants_link", 0.99);
  const r = await routeAsync({ account: "aimechanicapp", text: "   ", author_name: "Sam" },
    { env, transport: t });
  ok(r.product_id === null && t.calls.length === 0, "empty text -> null, no decide call");
}

// 9. Shared question definition shape (the anti-drift contract).
{
  const q = QUESTIONS.wants_fix_link;
  ok(q.type === "choice", "shared question is choice type");
  ok(typeof q.ask === "string" && q.ask.length > 0, "shared question has ask");
  ok(q.options && "wants_link" in q.options && "other" in q.options, "shared question has both options");
  ok(q.thresholds && q.thresholds.autoAt === 0.85, "shared question thresholds autoAt=0.85");
}

console.log(`routerDecide: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
