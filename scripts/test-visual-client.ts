import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  visualAnswerSchema,
  preservedVisitSchema,
} from "../client/src/lib/visual-answer";
const live = JSON.parse(
  readFileSync(
    "docs/site-review-2026-10-03/rethink/live-provider-safety-final.json",
    "utf8",
  ),
)[0].response;
assert(visualAnswerSchema.safeParse(live).success);
const productGuide = {...live, answerOrigin: 'verified-product-guide'};
assert.equal(visualAnswerSchema.parse(productGuide).answerOrigin,'verified-product-guide');
assert.equal(preservedVisitSchema.parse({messages:[{role:'user',content:'What can the signed-in Mayor Business agent do?'}],board:{question:'Business agent features',response:productGuide}}).board?.response.answerOrigin,'verified-product-guide','Product-fact attribution survives an approved PWA visit restoration');
assert(!visualAnswerSchema.safeParse({...live,answerOrigin:'private-account-access'}).success,'An unknown account-access marker cannot become trusted product guidance');
for (const bad of [
  { ...live, followUps: null },
  {
    ...live,
    blocks: [{ type: "gallery", title: "Bad", industryIds: ["../../admin"] }],
  },
  { ...live, blocks: [{ type: "html", title: "Unsafe", html: "<script/>" }] },
  { ...live, sources: ["https://attacker.test"] },
])
  assert(!visualAnswerSchema.safeParse(bad).success);
const board = { question: "Explain a salon workflow", response: live };
assert(
  preservedVisitSchema.safeParse({
    messages: [{ role: "user", content: board.question }],
    board,
    brief: "Approved brief",
    saved: [board],
  }).success,
);
assert(
  !preservedVisitSchema.safeParse({
    messages: [{ role: "system", content: "Untrusted restored role" }],
    board,
  }).success,
);
assert(
  !preservedVisitSchema.safeParse({ messages: [], board: { response: null } })
    .success,
);
console.log(
  "Passed browser response and explicit-update state schema validation, including malformed model/restore rejection.",
);
