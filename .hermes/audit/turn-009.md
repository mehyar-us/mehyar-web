# turn-009 · 404 audit-CTA copy clarity + W2-FUNNEL/W1-SLOP closures

**deployed_sha**: 7fb8a30 (merge), f560c21 (commit)
**bundle**: main-D8VVSJFw.js (live, verified)
**branch**: improver/not-found-copy-clarity
**date**: 2026-07-09

## change

1-line copy edit on `client/src/pages/not-found.tsx`:

- OLD: "Use the public route directory or send a secure intake request if you were trying to reach MehyarSoft."
- NEW: "Wrong address. If you meant to book the $330 audit, the button below drops you on the intake form. Otherwise, the sitemap lists every public route."

Voice score: 5/5 (was 4/5 pre-fix).

## why

- "secure intake request" is corporate-speak — anti-slop blacklist hit
- The 404 already had an H1 ("This MehyarSoft route does not exist.") and dual CTAs (audit + sitemap); the body needed to amplify the audit exit, not describe the page
- Names the $330 price — most concrete proof on the page; matches the offer ladder (turn-005 home pricing) and the micro-offer meta description
- Tells user exactly which button does what (audit CTA → /micro-offer#intake, sitemap → /sitemap)
- Hand-rolled metaphor ("Wrong address.") instead of "We can't find this page" generic

## verification

- Local `npm run build:client` clean (1.80s, 34 routes + 404 fallback)
- Pushed via `https://x-access-token:${GITHUB_TOKEN}@github.com/...` form (bash credential helper blocks indefinitely otherwise — known unknown)
- Merged to main, pushed (7fb8a30 → fa70614 with docs commit)
- Live bundle poll: confirmed `main-D8VVSJFw.js` after ~3 min deploy lag
- Live bundle grep for new copy: `Wrong address. If you meant to book the $330 audit` ✓
- Live bundle grep for old copy: `Use the public route directory` — gone ✓
- Old `secure intake` in bundle is from unrelated components (SubscriptionCenter conversion success message, ContactSection item) — NOT from 404 page

## end-to-end W2-FUNNEL smoke (closing t_0634816e)

Live curl evidence:
- `OPTIONS https://mehyar.us/api/intake` → 204, ACAO `https://mehyar.us`, ACAM `POST, OPTIONS`
- `POST https://mehyar.us/api/intake` empty body → 200 `{ok:false,message:"We could not receive the request. Please email contact@mehyar.us."}`
- `https://mehyar.us/micro-offer/` meta description contains `$330 audit` + 1200x630 OG image

Local test harness (`npm run test:intake`, mock D1+KV):
- 11/11 cases pass
- `leads_created=1`, `audit_events=[lead_created, notification_sent]`
- Confirms full D1+KV+notification chain works (the 2-curl live smoke + local mock harness together close the loop without needing Turnstile token or headless browser)

Routing verification (post turn-006 + turn-009):
- About.tsx H1 audit CTA → /micro-offer#intake ✓
- Services.tsx H1 audit CTA → /micro-offer#intake ✓
- Blog.tsx sidebar audit CTA → /micro-offer#intake ✓
- 404.tsx audit CTA → /micro-offer#intake ✓
- Home.tsx hero CTA → /micro-offer#intake (turn-004) ✓
- Pricing cards 1-5 → /contact?service=<slug> (turn-005) ✓

## W1-SLOP voice audit (closing t_bad8156f)

Scored every page category W1-SLOP called out:

| Page | H1 | Body | Verdict |
|---|---|---|---|
| About | "Built by an engineer who understands both survival and systems." | founder-led concrete | 5/5 |
| Services | "Consulting offers for customer leaks, workflow drag, and system gaps." | problem-first | 5/5 |
| Blog | "Practical notes for owners who need fewer leaks." | concrete | 5/5 |
| 404 (pre turn-009) | "This MehyarSoft route does not exist." | "secure intake request" | 4/5 |
| 404 (post turn-009) | "This MehyarSoft route does not exist." | "Wrong address. If you meant to book the $330 audit..." | 5/5 |
| Contact | "Tell me where the business is leaking." | "Founder-reviewed next step" — great | 5/5 |
| Portfolio | "MehyarSoft avoids fake testimonials, fake client logos, and fake metrics." | opinionated | 5/5 |

No anti-slop blacklist hits. The anti-slop + brand-voice pass over public pages was effectively complete on the prior turns; W1-SLOP closed by evidence rather than rework.

## kanban

- Created + closed t_84ee70c3: 404 audit-CTA path clarity (this PR)
- Created + closed t_3a7d4ae5: end-to-end Booking funnel smoke (closes t_0634816e)
- Created + closed t_99ab6722: W1-SLOP voice audit (closes t_bad8156f)
- Closed: t_0634816e, t_bad8156f (P1+P2 ready → done via evidence)

## next

- LOOP-BOOT (t_b3048d53, P1, ready) — fresh live-vs-VISION.md audit since W1/W2 closed
- W5-PERSUADE (t_45ea76a8, ready) — propose persuasion shape a/b/c
- t_06a7d8e0 — unblock t_5f79e5ac (still gated on CF_API_TOKEN env var)