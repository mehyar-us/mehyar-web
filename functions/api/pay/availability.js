// functions/api/pay/availability.js
// GET /api/pay/availability — READ-ONLY checkout availability probe.
//
// Lets product pages (e.g. /audit/) show an up-front "checkout temporarily
// closed" notice instead of letting a buyer complete the whole funnel before
// discovering the $330 button can't go through. No side effects: reads only
// whether the live Stripe secret is configured. Same-origin by design — no
// CORS headers, no user data touched, nothing written.
//
// Response: { ok: true, checkout_open: boolean }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ env }) {
  // Mirrors the gate in checkout.js (stripe_not_configured when
  // env.STRIPE_SECRET_KEY is absent in non-test mode).
  const checkoutOpen = !!(env && env.STRIPE_SECRET_KEY);
  return json({ ok: true, checkout_open: checkoutOpen });
}
