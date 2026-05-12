# MehyarSoft offer fulfillment backend hooks

Status: implementation artifact for `t_5d78e83f`

## Safety contract

- Automation is draft-only by default.
- `send_allowed` is always `false` unless a future owner-review endpoint explicitly approves a specific draft.
- No autonomous unsolicited sending is implemented.
- Zoho hooks are declared as read/send integration points, but the send hook is gated behind owner approval.
- Audit records avoid raw request bodies and store only evaluation/status metadata.

## Endpoints

### `POST /api/intake`

Existing intake endpoint now runs offer evaluation after the lead is inserted and before owner notification.

New side effects:

- Inserts/updates `lead_offer_evaluations` for the lead.
- Writes a `lead_events` row with `event_type = 'offer_evaluated'`.
- Keeps public response unchanged: `{ ok, lead_id, message }`.

### `GET /api/admin/offers/evaluate`

Admin-authenticated status list for owner review.

Headers:

- `Authorization: Bearer <admin-session-token>`

Query parameters:

- `lead_id` optional; returns one lead evaluation if present.
- `limit` optional; defaults to 25, max 50.

Returns:

- lead classification
- service-fit score
- offer recommendation
- AI draft follow-up subject/body
- owner-review status
- fulfillment status
- `send_allowed`
- audit summary
- Zoho read/send hook metadata

### `POST /api/admin/offers/evaluate`

Admin-authenticated evaluator for either an existing lead or an ad-hoc lead payload.

Body options:

```json
{ "lead_id": "existing-lead-id" }
```

or:

```json
{
  "lead": {
    "form_type": "audit",
    "name": "Owner",
    "email": "owner@example.test",
    "company": "Example Co",
    "website": "https://example.test",
    "service_interest": "CRM follow-up automation",
    "budget_range": "$1k-$5k",
    "timeline": "this month",
    "message": "We miss calls and need better booking follow-up.",
    "consent_contact": true,
    "consent_marketing": false
  }
}
```

Existing lead evaluations are persisted and audited with `event_type = 'offer_evaluated_admin'`. Ad-hoc payloads return a draft-only evaluation without writing a lead row.

## D1 migration

Apply after the intake baseline migration:

```bash
npx wrangler d1 migrations apply mehyar_leads_prod --remote
```

New table:

- `lead_offer_evaluations`

Important columns:

- `lead_classification`
- `service_fit_score`
- `offer_id`
- `draft_subject`
- `draft_body`
- `owner_review_status`
- `fulfillment_status`
- `send_allowed`
- `audit_summary_json`
- `zoho_hooks_json`

## Classification and offer logic

Shared module: `functions/api/_shared/offerFulfillment.js`

Outputs:

- `lead_classification`: `hot_service_request`, `qualified_service_interest`, `newsletter_or_low_intent`, `manual_triage`, or `blocked_missing_contact_consent`.
- `service_fit_score`: 0-100 heuristic score from form type, company/website, budget/timeline, message detail, and offer keywords.
- `offer_recommendation`: currently one of:
  - `crm-follow-up-sprint`
  - `lead-leak-audit`
  - `website-booking-cleanup`
  - `manual-triage`
- `ai_draft_follow_up`: deterministic draft subject/body for owner review.
- `audit_summary`: risk flags, compliance note, and signal summary.
- `zoho_hooks`: proposed Zoho read hooks and gated send hook.

## Verification commands

Use Windows Node from WSL if Linux `node` is not installed:

```bash
'/mnt/c/nvm4w/nodejs/node.exe' scripts/test-offer-fulfillment.mjs
'/mnt/c/nvm4w/nodejs/node.exe' scripts/test-intake-functions.mjs
npm run check
```

Package scripts were added for normal Node environments:

```bash
npm run test:offers
npm run test:intake
```

## Owner-review next step

This task deliberately stops short of autonomous sending. A future approval endpoint can update `owner_review_status = 'approved'` and `send_allowed = 1` only after showing the owner the exact draft, recipient, offer, suppression status, and audit note.
