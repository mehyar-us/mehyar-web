# Mayor AI customer app

Standalone React 18 / TypeScript / Vite application. It does not import or modify the marketing site, legacy checkout, webhook, or fulfillment handlers.

```powershell
cd apps/business-agent
npm ci
npm run dev
```

Open http://127.0.0.1:5174. Requests to `/api` proxy to the business-agent Worker at http://127.0.0.1:8788. All workspace data comes from those APIs; there is no demo login or fabricated activity. Missing provider configuration leaves sign-in unavailable with a clear explanation.

```powershell
npm run check
npm run build
npm test
```

The production build is in `dist/`. Host it with the new Worker at the same origin so session cookies and Origin checks remain intact. Do not deploy over the existing website.

## Current interactions

- Google sign-in with server-advertised optional capabilities; Microsoft identity sign-in.
- Provider authorization through `/api/auth/start/:provider`; no provider tokens enter the frontend.
- Workspace creation and switching, confirmed backend conversation messages with retry idempotency keys.
- Business memory creation/update by key and confirmed deletion.
- Activity, verified membership, connection status, reported usage, and workspace pause/resume.
- Separate setup and subscription activation through `/api/agent-billing`, with server-authorized plan gates, Stripe portal, cancellation requests, and verified orders/subscription status. Missing gates disable purchases.
- Clear unavailable states for unimplemented approval, invitation, voice, and WhatsApp actions.

The service worker runs only in production and only caches the public application shell and hashed static assets. API routes, OAuth, query-bearing requests, conversations, and credentials are never cached. Offline drafting is in-memory only and is never sent automatically on reconnection. No private information is persisted to local storage; onboarding website/goal are kept in session storage only to survive provider sign-in and cleared after creation or logout. Billing stores only random retry keys in session storage, scoped to workspace and action, so retries preserve idempotency.

Billing checkout destinations are restricted to `https://checkout.stripe.com`; portal destinations are restricted to `https://billing.stripe.com`. A checkout return selects a workspace only after it appears in the authenticated membership list. Return URL parameters never grant access or confirm payment. Browser tests use explicit Stripe response/navigation fixtures and perform no real charges.

The Google G in `src/assets/google-g.svg` comes from the [official Google sign-in asset bundle](https://developers.google.com/static/identity/images/signin-assets.zip), downloaded September 16, 2026. Its viewBox is cropped to the original 20px icon, without altering its shape or gradient. The [current branding guidelines](https://developers.google.com/identity/branding-guidelines) require this standard color gradient mark. This asset update does not constitute provider approval.

Browser tests use isolated explicit API fixtures. They validate UI contracts, not provider authorization or deployed integrations. Live OAuth, real Android/iOS installation and push, and production deployment require separate evidence.

To verify the production service worker, build and start `npm run preview` in another terminal, then run `node scripts/verify-pwa.mjs`. It checks an offline reload of the production bundle and asserts that no API, authorization, or query-bearing URL is in Cache Storage. Evidence is written under ignored `artifacts/`.

With the real local Worker and Vite dev server running, `node scripts/capture-local.mjs` captures the actual unauthenticated sign-in screen at desktop/mobile widths. It uses no API interception and does not test live provider authorization. The authenticated conversation screenshot from the browser suite is explicitly a fixture screenshot.
