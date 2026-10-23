// functions/api/pay/checkout-link.js
// GET /api/pay/checkout-link?product_id=<moonroom sku>&style=<style>&mode=<mode>
//
// rot601 FAIL-1 repair (2026-10-23): Moonroom's direct-checkout links were
// href="#", JS-only — if the page's JS layer failed, a decided buyer had no
// path to pay. This endpoint is the links' real target: a top-level browser
// navigation here mints a session through the IDENTICAL POST /api/pay/checkout
// path (imported, not duplicated — pricing, hooks, pauses and idempotency all
// stay single-sourced) and 302s to Stripe. With JS alive the page's own
// handler intercepts the click and this endpoint is never called.
//
// Scope is deliberately narrow: Moonroom SKUs only, styles allowlisted per
// mode, and a navigation-shaped request is required (link scanners and
// preview bots get a 404, not a minted session). Email is empty by design —
// Moonroom checkouts allow that; Stripe collects the address and the webhook
// backfills it, exactly as the JS path behaves.

import { onRequestPost } from "./checkout.js";

const PRODUCTS = {
  "moonroom-headshot-pack": {
    mode: "headshot",
    styles: ["corporate", "creative", "outdoor", "studio"],
  },
  "moonroom-product-studio": {
    mode: "product",
    styles: ["white", "marble", "lifestyle", "gradient"],
  },
  "moonroom-theme-pack": {
    mode: "theme",
    styles: ["halloween", "holiday"],
  },
};

function notFound() {
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id") || "";
  const spec = PRODUCTS[productId];
  if (!spec) return notFound();

  // Navigation-shaped requests only.
  const fetchMode = request.headers.get("sec-fetch-mode") || "";
  const ua = request.headers.get("user-agent") || "";
  if (fetchMode !== "navigate" && !/Mozilla\/5\.0/.test(ua)) return notFound();

  const mode = url.searchParams.get("mode") || "";
  const style = url.searchParams.get("style") || "";
  if (mode !== spec.mode || !spec.styles.includes(style)) {
    return new Response("Invalid style for this pack", {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }

  const body = {
    product_id: productId,
    email: "",
    params: { style, mode, source: "landing-direct" },
    success_url: "https://moonroom.mehyar.us/success",
    cancel_url: "https://moonroom.mehyar.us/styles",
  };
  const synth = new Request("https://mehyar.us/api/pay/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    const res = await onRequestPost({ request: synth, env });
    data = await res.json().catch(() => null);
  } catch { /* fall through to the primary path */ }

  if (data && data.checkout_url) {
    return new Response(null, {
      status: 302,
      headers: { location: data.checkout_url, "cache-control": "no-store" },
    });
  }
  // Mint failed for any reason: the buyer still gets the primary path,
  // preselected with the same pack and style — never a dead end.
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://moonroom.mehyar.us/chat?mode=${spec.mode}&style=${style}`,
      "cache-control": "no-store",
    },
  });
}
