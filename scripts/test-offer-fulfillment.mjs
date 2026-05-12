import assert from "node:assert/strict";
import { evaluateLeadForOffer, shouldSendZohoDraft } from "../functions/api/_shared/offerFulfillment.js";

const hotLead = {
  id: "lead-hot-1",
  form_type: "audit",
  name: "Owner",
  email: "owner@example.test",
  company: "Clinic Ops",
  website: "https://clinic.example",
  service_interest: "follow-up automation and CRM integration",
  budget_range: "$1k-$5k",
  timeline: "this month",
  message: "We miss calls and need booking follow-up, audit logs, and Zoho CRM/email workflow help.",
  consent_contact: 1,
  consent_marketing: 0,
};

const hotEvaluation = evaluateLeadForOffer(hotLead);
assert.equal(hotEvaluation.review_required, true);
assert.equal(hotEvaluation.send_allowed, false);
assert.equal(hotEvaluation.owner_review_status, "pending_review");
assert.equal(hotEvaluation.lead_classification, "hot_service_request");
assert.equal(hotEvaluation.offer_recommendation.offer_id, "crm-follow-up-sprint");
assert.ok(hotEvaluation.service_fit_score >= 80);
assert.match(hotEvaluation.ai_draft_follow_up.subject, /Clinic Ops|follow-up/i);
assert.match(hotEvaluation.ai_draft_follow_up.body, /Owner/);
assert.match(hotEvaluation.ai_draft_follow_up.body, /review/i);
assert.ok(hotEvaluation.audit_summary.risk_flags.includes("owner_review_required_before_send"));

const coldLead = {
  id: "lead-cold-1",
  form_type: "newsletter",
  name: "Subscriber",
  email: "subscriber@example.test",
  company: "",
  website: "",
  service_interest: "",
  budget_range: "",
  timeline: "",
  message: "Please add me to updates.",
  consent_contact: 1,
  consent_marketing: true,
};
const coldEvaluation = evaluateLeadForOffer(coldLead);
assert.equal(coldEvaluation.lead_classification, "newsletter_or_low_intent");
assert.equal(coldEvaluation.offer_recommendation.offer_id, "manual-triage");
assert.equal(coldEvaluation.send_allowed, false);
assert.equal(shouldSendZohoDraft(coldEvaluation), false);
assert.equal(shouldSendZohoDraft({ ...hotEvaluation, owner_review_status: "approved", send_allowed: true }), true);

console.log(JSON.stringify({
  ok: true,
  tests: ["hot lead classification", "offer recommendation", "owner review gate", "AI draft", "audit summary", "Zoho send gate"],
  hot: {
    classification: hotEvaluation.lead_classification,
    offer: hotEvaluation.offer_recommendation.offer_id,
    score: hotEvaluation.service_fit_score,
    send_allowed: hotEvaluation.send_allowed,
  },
  cold: {
    classification: coldEvaluation.lead_classification,
    offer: coldEvaluation.offer_recommendation.offer_id,
    send_allowed: coldEvaluation.send_allowed,
  },
}, null, 2));
