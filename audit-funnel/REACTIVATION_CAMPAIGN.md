# Legacy Lead Reactivation Campaign — Free AI Audit Tool

**Goal:** Reactivate cold legacy leads from the `leads` table by giving them the free AI website audit.
**Audience:** Leads with `consent_marketing=1`, not on `suppression_list`, not unsubscribed.
**Sequence:** 3 emails, 3 days apart. Each drives to mehyar.us (free audit).

---

## Email 1 — "We built you something free" (Day 0)

**Subject:** I built you a free tool — is your website leaking money?

**Body:**

Hi {{name}},

You reached out to MehyarSoft a while back, and I wanted you to be first to try something I just built:

**A free AI website audit.** Drop in your URL, and in 60 seconds it tears your site apart — every money leak priced in dollars, plus the AI systems that could multiply your output up to 5x.

No account. No card. Your report lands in your inbox.

👉 [Run my free audit](https://mehyar.us)

It detects your business type automatically — whether you're a local shop, a clinic, or an enterprise — and shows you the exact AI pipelines (voice agents, smart scheduling, document scanning) built for businesses like yours.

Try it and tell me your score.

— Mehyar
MehyarSoft

P.S. If you want the full 25-page teardown with competitor gaps and a 90-day plan, it's $5. Less than a coffee.

[Unsubscribe](https://mehyar.us/unsubscribe)

---

## Email 2 — "The 5x angle" (Day 3)

**Subject:** Your competitors are using AI to do 5x the work

**Body:**

Hi {{name}},

Quick follow-up — did you try the free audit yet?

Here's what most business owners miss: the audit doesn't just find what's broken on your site. It shows you the **AI systems** that let businesses like yours handle 5x the volume without hiring:

- **AI voice receptionist** — answers every call 24/7, books jobs while you sleep
- **Smart scheduling** — fills your calendar, kills no-shows, follows up automatically
- **Document scanner** — snap a photo of any paperwork, AI extracts and files it

The math is shown step by step. No hype, no vague promises — just the mechanism and honest estimates.

👉 [Get my free audit + AI blueprint](https://mehyar.us)

— Mehyar

[Unsubscribe](https://mehyar.us/unsubscribe)

---

## Email 3 — "Last call" (Day 6)

**Subject:** Last call: your $5 full website evaluation

**Body:**

Hi {{name}},

Last note on this — the free audit will always be free, but the **full 25-page evaluation** is $5 at launch pricing.

That's every page of your site graded A–F. Competitor gaps exposed. The 500% AI automation blueprint with the math shown. Your 90-day revenue plan.

One business owner told us: *"Best five dollars I've spent on the business."*

👉 [Get the full report — $5](https://mehyar.us/audit/report)

After launch pricing ends, it goes to $199. Just being straight with you.

— Mehyar
MehyarSoft

[Unsubscribe](https://mehyar.us/unsubscribe)

---

## Sending rules

- Only `consent_marketing=1` leads
- Exclude `suppression_list` emails
- Exclude audit_leads who already converted (bought the $5 report)
- Track opens/clicks via existing email_event infra
- Endpoint: `POST /api/audit/reactivate` (Bearer AUDIT_CRON_SECRET)
- Body: `{ "step": 1|2|3, "limit": 50, "dry_run": true }`
- Dry run first, Mayor approves the real blast in chat
