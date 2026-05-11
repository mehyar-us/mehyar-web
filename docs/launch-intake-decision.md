# MehyarSoft v1 Intake Decision — 2026-05-11

## Decision

Ship the public revenue site with mailto-only contact for v1, provided the UI is honest that it drafts an email request and does not imply durable CRM capture.

## Rationale

- Revenue velocity matters more than waiting for a full intake backend.
- The current form opens a visitor-controlled email draft to `info@mehyar.us`; it does not collect or store sensitive form values in the site.
- Cloudflare Web Analytics is enabled only for aggregate traffic/performance analytics and must not collect form field values.
- Cloudflare-native intake remains required before scaled campaigns, newsletter capture, CRM automation, or owner/admin workflows.

## Guardrails

- Do not claim a lead was captured unless the email is actually sent by the visitor.
- Keep mass outreach disabled until suppression, opt-out, audit logging, consent, and commercial-email identity controls are production-enforced.
- Keep admin surfaces server-side protected only; no static frontend admin route with secrets or client-only auth.

## Follow-up standard

Next implementation should add Cloudflare Pages Functions with Turnstile, D1/KV storage, notification, audit events, and suppression hooks as described in `docs/cloudflare-intake-architecture.md`.
