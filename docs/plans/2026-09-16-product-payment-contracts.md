**Existing product payment contracts — read-only compatibility report**

Reviewed September 16, 2026 through local source and authenticated read-only GitHub API requests. No checkout, payment, webhook replay, live settings change, or repository code mutation was performed. The review covers source contracts; deployed revisions, live D1 product prices, and Stripe configuration have not been verified.

**Controlling instruction**

The user states the current Stripe checkout works correctly and requires the existing checkout/webhook flow to remain unchanged. Freeze existing checkout, webhook, status, download, backfill, fulfillment, scheduler, price mappings, token semantics, redirects, signing secrets, event subscriptions, and satellite purchase code. Build business-agent billing separately. Any future migration requires another explicit request.

**Central contract**

Several products use `POST https://mehyar.us/api/pay/checkout` with `product_id`, `email`, and flat product-specific `params`; selected existing clients also pass `success_url`, `cancel_url`, or `test`. Preserve the response fields they consume, including `checkout_url` and where used `ok` and `token`.

The central `billing_payments` fields `product_id`, `status`, `access_token`, and `metadata_json` are part of the integration contract. Product-specific flat metadata must not be wrapped, renamed, or normalized away. The same access token can bind payment, order, success page, generation, download, and email links. A schema change or token regeneration can therefore break other products even if the checkout screen still opens.

Other protected interfaces include `GET /api/pay/status?token=`, `POST /api/pay/fulfill-backfill` with `{token}`, and `GET /api/pay/download?token=`. Protect the legacy audit webhook as well as the central payment webhook. Existing clients intentionally differ in whether they supply return URLs; preserve current code, not outdated integration prose.

| Repository | Verified purchase contract / dependency | Source-listed prices |
| --- | --- | --- |
| mehyar500/venture-designful | Central checkout; seven SKUs; product-specific brief params; tokenized return; local generation/deliverable APIs | Five individual jobs $49 each; bundle of three $99; Studio Pass $149 |
| mehyar500/venture-tiktokgrowth | `tiktokgrowth-system`; niche/on_camera/hours_per_week/handle params; central status and backfill; local deliverable; token or access_token return | $27 |
| mehyar500/venture-sprint30 | Local checkout proxies central `sprint30-challenge`; `{source,product}` params; proxy response `{ok,url}`; tokenized dashboard/enrollment | $37 |
| mehyar500/venture-hustlekit | `hustlekit-starter`; track/skills/hours/income_goal/experience/niche params; local status/generate/deliverable use order_token or token | $27 |
| mehyar500/venture-bizbuilder | `bizbuilder-plan`; idea/audience/price_point params; centrally configured return; central backfill; local deliverable | $17 |
| mehyar500/venture-creditfixkit | `creditfix-kit`; name/situation/state/goal/accounts params; intentionally omits return override; central status plus local generation/delivery | $47 |
| mehyar500/venture-truesketch | `truesketch-reading`; intake_id/name params; centrally configured success and frontend cancel URL; billing token gates gallery/sketch | $37 |
| mehyar500/venture-plrvault | `plrvault-bundle`; empty params; central status and download; supplied return URLs | $9.95 |
| mehyar-us/venture-prepguide | `prepguide-playbook`; flat household intake; supplied return URLs; central status then local status; payment token preserved in order | $37 |
| mehyar-us/venture-babypeek | Local checkout proxies `baby-peek` with `{gid}`; local redeem reads shared payment ledger and validates paid/product/metadata.gid | $5 |
| mehyar500/venture-roast | Local checkout proxies `roast-card` with `{roast_id}`; token saved on roast; unlock validates paid/product/metadata against shared ledger | $5 |
| mehyar500/rizza-app | Independent Base44/Deno Stripe subscription; authenticated `{trial,plan}` -> `{url}`; webhook updates User/SubscriptionEvent; separate success/cancel paths | $3/week or $9.99/month; source optional two-day trial |
| mehyar500/ai-mechanic | Independent Base44/Deno subscription; `{priceId,plan}` -> `{url}`; webhook updates Usage and handles invoice.paid; independent billing portal | DIY $4.99/mo or $47.88/yr; Mechanic $14.99/mo or $143.88/yr |
| mehyar500/venture-freelanceros | Remote contains README only; local central hook exists, but satellite behavior cannot be verified | README $29 one-time |
| mehyar500/venture-promptpack | Remote Git tree returns empty-repository response; local central hook exists | Local public catalog $19; no remote checkout verification |
| mehyar500/venture-crayonkid | Coming-soon page, no payment implementation in reviewed repo | No source price |
| mehyar500/mehyar-jobs | No billing/Stripe flow found in reviewed tree, package and public API surfaces | No source price |
| mehyar-us/stuffprettygood.com | Reviewed source emphasizes static affiliate browsing; no Stripe integration found in inspected surfaces | Public site separately advertises $9/$7 guides; source/deployed mismatch requires reconciliation |
| mehyar-us/stuffprettygood-api | Affiliate/catalog/subscriber Worker; merchant-controlled purchases; no Stripe route found in inspected surfaces | Affiliate model |

**Designful SKU contract**

`designful-homepage-teardown`, `designful-logo-refresh`, `designful-ad-creative-pack`, `designful-social-launch-kit`, `designful-hero-rewrite`, `designful-bundle-3`, and `designful-studio-pass` must retain existing meanings. Depending on the feature, params include `url`, `hero_copy`, `product_description`, `brand_blurb`, `brand_name`, `industry`, `current_logo_desc`, or `choices`. Do not infer Studio Pass entitlement from the name alone; inspect its actual implementation before describing it to a new customer.

**Independent Base44 contracts**

Rizza and AiMech do not use the central checkout examined above. Preserve their own Stripe prices, success URLs, Base44 authentication, customer mapping, subscription entities, webhook destinations, and cancellation flows. A new centralized product dashboard may display permitted read-only status through an explicit adapter; matching an email address does not authorize merging accounts.

**Separate observations — no fixes authorized**

- Rizza supports monthly checkout in source, while some subscription/cancellation receipt text hardcodes $3/week. This is a source finding, not proof of what a specific live customer received.
- AiMech's pricing source advertises a seven-day trial, while checkout includes a temporary-live-test comment with the trial setting removed; webhook code initially records trialing. Verify deployed behavior in a separately authorized review before changing anything.
- AiMech checkout accepts a supplied price ID alongside a validated plan label; server-side plan/price consistency deserves a separate review.
- Crayon Kid's reviewed placeholder uses a browser-local waitlist fallback; visible success is not proof of a server-side registration.

These findings do not override the instruction to preserve the existing payment flow. They belong in an owner-visible backlog, not an unsolicited cleanup commit.

**New agent billing boundary**

The user clarified that the reuse/naming request is about Stripe and its webhook only. Existing general checkout/webhook already serve multiple products and retain their current names and routes. Reuse them for their existing supported purchases. Source shows the shared checkout hardcodes `mode=payment` at `functions/api/pay/checkout.js:209`, while `functions/api/pay/webhook.js:255` handles `checkout.session.completed` and has no subscription/invoice lifecycle branches. One unchanged existing webhook therefore cannot implement new recurring-agent entitlements. [Stripe's subscription event requirements](https://docs.stripe.com/billing/subscriptions/webhooks) confirm that payment failures and subscription changes need explicit handling.

Plan one new shared destination named **Mehyar Business Agent - Subscriptions** for every new agent customer and plan, using the existing Mehyar Stripe account after its account identity/configuration is verified. No webhook per business and no forced separate Stripe account. The new destination covers new agent setup and recurring billing; all general, audit, Rizza, and AiMech destinations remain unchanged. A forwarding proxy would change the existing delivery path and is not an authorized workaround.

Use a separately deployed Worker/route namespace under the new customer application, new subscription SKU/price IDs, new tenant billing tables, a new webhook registration and signing secret, and explicit event filtering. No changes to existing endpoint registrations, event subscriptions, secrets, or billing tables. Existing functions must not import the new subscription implementation. Capture protected-file hashes and check the final diff; separately test routing/configuration so byte-identical source cannot be accidentally deployed under changed bindings.

Event-type filtering is not product isolation: existing destinations on the account may receive new Checkout events too. New-platform Stripe metadata must omit legacy `payment_id` and `report_id` entirely; use `mehyar_agent_order_id`, `mehyar_agent_tenant_id`, and `mehyar_billing_domain=business_agent`. The audit webhook calls `mirrorPaymentToLedger` outside its checkout-event branch, and that helper looks up `metadata.payment_id`, so metadata collisions could affect old payments even if the code is unchanged. New-handler ownership checks must also validate server-created mappings and permitted new prices. Prove with isolated fixtures that new events cause no legacy writes, fulfillment, or email and that unrelated legacy events cause no new entitlements. Never exercise these fixtures against production.

Create contract fixtures from the observed shapes. Test the new flow in its own staging/test configuration. For protected legacy systems, no production webhook replays, test purchases, or repair jobs; any integration test with side effects needs an explicitly authorized isolated environment. Read-only checks must not mark an order paid or trigger fulfillment.

**Evidence**

- [Designful prices and SKUs](https://github.com/mehyar500/venture-designful/blob/HEAD/catalog.js#L11), [checkout and params](https://github.com/mehyar500/venture-designful/blob/HEAD/app.js#L310).
- [TikTok success/backfill/status](https://github.com/mehyar500/venture-tiktokgrowth/blob/HEAD/success.html#L80), [Sprint30 checkout proxy](https://github.com/mehyar500/venture-sprint30/blob/HEAD/functions/api/sprint30/checkout.js#L1).
- [HustleKit purchase](https://github.com/mehyar500/venture-hustlekit/blob/HEAD/public/buy.html#L97), [BizBuilder success](https://github.com/mehyar500/venture-bizbuilder/blob/HEAD/success.html#L91), [CreditFix return behavior](https://github.com/mehyar500/venture-creditfixkit/blob/HEAD/app.js#L20).
- [TrueSketch checkout](https://github.com/mehyar500/venture-truesketch/blob/HEAD/app.js#L7), [PLR endpoints](https://github.com/mehyar500/venture-plrvault/blob/HEAD/app.js#L6).
- [PrepGuide checkout snapshot](https://github.com/mehyar-us/venture-prepguide/blob/e89f3cf989ac9e2b530d7766237b881542fdc2ec/pwa/app.js#L129), [success polling](https://github.com/mehyar-us/venture-prepguide/blob/e89f3cf989ac9e2b530d7766237b881542fdc2ec/pwa/success.html#L87).
- [BabyPeek checkout/redemption snapshot](https://github.com/mehyar-us/venture-babypeek/blob/6f7ccf8bfb7cfd510cccfe4fd430e8c23645433c/src/index.js#L411).
- [Roast checkout snapshot](https://github.com/mehyar500/venture-roast/blob/f687e3c17b71c5fd2dac9ac5943090a315b2247e/functions/api/checkout.js#L25), [unlock](https://github.com/mehyar500/venture-roast/blob/f687e3c17b71c5fd2dac9ac5943090a315b2247e/functions/api/unlock.js#L21).
- [Rizza checkout snapshot](https://github.com/mehyar500/rizza-app/blob/62283f5f037fe763aca322d0b737f6a3cd56d4ca/base44/functions/createCheckout/entry.ts), [webhook](https://github.com/mehyar500/rizza-app/blob/62283f5f037fe763aca322d0b737f6a3cd56d4ca/base44/functions/stripeWebhook/entry.ts).
- [AiMech checkout snapshot](https://github.com/mehyar500/ai-mechanic/blob/f333bb20aca937a60efff56fe412f8e449dc16e3/base44/functions/createCheckout/entry.ts), [pricing](https://github.com/mehyar500/ai-mechanic/blob/f333bb20aca937a60efff56fe412f8e449dc16e3/src/pages/Pricing.jsx), [webhook](https://github.com/mehyar500/ai-mechanic/blob/f333bb20aca937a60efff56fe412f8e449dc16e3/base44/functions/stripeWebhook/entry.ts).
- [SPG frontend snapshot](https://github.com/mehyar-us/stuffprettygood.com/blob/379f822c82d08a2d97f1a073eeab94125d65a390/README.md), [SPG Worker](https://github.com/mehyar-us/stuffprettygood-api/blob/7c0730962d883b0ef055ecba4bd4d09e67261ce8/src/worker.js).
- [Crayon Kid source snapshot](https://github.com/mehyar500/venture-crayonkid/blob/95f3f44da42b7015ac2f07d2c0d34b2ebab930d2/index.html), [Jobs package snapshot](https://github.com/mehyar500/mehyar-jobs/blob/c7f20ff92572d3243a0d81d9c148e6d9e726a37e/package.json).

HEAD links identify the reviewed source paths and may change after this date. Snapshot links identify fixed commits. Before implementation, record fresh protected-contract baselines without mutating those repositories.
