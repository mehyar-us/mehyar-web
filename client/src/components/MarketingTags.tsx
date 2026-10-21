import { useEffect } from "react";
import { useLocation } from "wouter";
import { hasConsented, onConsentChange } from "@/lib/consent";

/* ── Marketing tags for the Audit tab (ID-driven, no hardcoded IDs) ────────
   GTM container, Meta pixel, and Google Ads tag load ONLY when their env var
   is set. Values ship in client/.env.production (public browser IDs, not
   secrets) and are resolved at build time by vite.config.ts — rot509 /
   AU-509-1: with no source wired, every ID compiled empty and this whole
   layer was inert in production.
     MEHYAR_PUBLIC_GTM_ID         e.g. GTM-XXXXXXX
     MEHYAR_PUBLIC_META_PIXEL_ID  e.g. 123456789012345
     MEHYAR_PUBLIC_GOOGLE_ADS_ID   e.g. AW-XXXXXXXXXX
   Same gating as GoogleAnalytics.tsx: public paths only, production hosts
   (or FORCE_ENABLE / DRY_RUN for local verification).
   Events: PageView on /audit* route changes; begin_checkout via
   trackBeginCheckout() from both checkout handlers; purchase conversions
   via trackAuditPurchase() (value = the amount actually charged, supplied
   by the server's payment record) and trackFullReportPurchase() ($5). */

const GTM_ID = import.meta.env.MEHYAR_PUBLIC_GTM_ID?.trim() || "";
const META_PIXEL_ID = import.meta.env.MEHYAR_PUBLIC_META_PIXEL_ID?.trim() || "";
const GOOGLE_ADS_ID = import.meta.env.MEHYAR_PUBLIC_GOOGLE_ADS_ID?.trim() || "";
const dryRun = import.meta.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN === "true";
const forceEnable = import.meta.env.MEHYAR_PUBLIC_ANALYTICS_FORCE_ENABLE === "true";

const productionHosts = new Set(["mehyar.us", "www.mehyar.us"]);
const firedPurchases = new Set<string>();

function isPublicPath(pathname: string) {
  return !pathname.startsWith("/admin");
}

function canLoadTags(pathname = typeof window === "undefined" ? "" : window.location.pathname) {
  if (typeof window === "undefined") return false;
  if (!isPublicPath(pathname)) return false;
  // Consent-gated (full-QA fix): marketing tags never load before Accept.
  if (!hasConsented()) return false;
  if (!GTM_ID && !META_PIXEL_ID && !GOOGLE_ADS_ID) return false;
  return forceEnable || dryRun || productionHosts.has(window.location.hostname);
}

function isAuditPath(pathname: string) {
  return pathname === "/audit" || pathname.startsWith("/audit/");
}

function ensureDataLayer() {
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtagShim(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
}

function installGtm() {
  if (!GTM_ID) return;
  ensureDataLayer();
  if (dryRun) {
    console.info("[marketing dry-run] GTM configured", { id: GTM_ID });
    return;
  }
  if (document.querySelector(`script[data-mehyar-gtm="${GTM_ID}"]`)) return;
  window.dataLayer!.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
  script.setAttribute("data-mehyar-gtm", GTM_ID);
  document.head.appendChild(script);
}

function installMetaPixel() {
  if (!META_PIXEL_ID) return;
  if (dryRun) {
    console.info("[marketing dry-run] Meta pixel configured", { id: META_PIXEL_ID });
    return;
  }
  if (window.fbq?.loaded) return;
  const fbq = function (...args: unknown[]) {
    (fbq.q = fbq.q || []).push(args);
  } as NonNullable<Window["fbq"]>;
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  script.setAttribute("data-mehyar-meta-pixel", META_PIXEL_ID);
  document.head.appendChild(script);
  fbq("init", META_PIXEL_ID);
}

function installGoogleAds() {
  if (!GOOGLE_ADS_ID) return;
  ensureDataLayer();
  if (dryRun) {
    console.info("[marketing dry-run] Google Ads tag configured", { id: GOOGLE_ADS_ID });
    return;
  }
  if (!document.querySelector(`script[data-mehyar-ads-tag="${GOOGLE_ADS_ID}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GOOGLE_ADS_ID)}`;
    script.setAttribute("data-mehyar-ads-tag", GOOGLE_ADS_ID);
    document.head.appendChild(script);
  }
  window.gtag!("js", new Date());
  window.gtag!("config", GOOGLE_ADS_ID);
}

function trackAuditPageView(pathname: string) {
  if (!isAuditPath(pathname)) return;
  const pagePath = `${pathname}${window.location.search}`;
  if (dryRun) {
    console.info("[marketing dry-run] audit page_view", {
      pagePath,
      gtm: Boolean(GTM_ID),
      metaPixel: Boolean(META_PIXEL_ID),
      googleAds: Boolean(GOOGLE_ADS_ID),
    });
    return;
  }
  if (GTM_ID && window.dataLayer) {
    window.dataLayer.push({ event: "page_view", page_path: pagePath });
  }
  if (META_PIXEL_ID && window.fbq?.loaded) {
    window.fbq("track", "PageView");
  }
  if (GOOGLE_ADS_ID && window.gtag) {
    window.gtag("event", "page_view", { send_to: GOOGLE_ADS_ID, page_path: pagePath });
  }
}

/** Fire begin_checkout when a buyer starts either audit checkout (rot509:
    the event existed nowhere — both handlers POSTed and redirected in
    silence). Called BEFORE the checkout POST/redirect, with the amount
    the buyer is about to be charged (325 when the $5 credit applies). */
export function trackBeginCheckout(productId: string, valueUsd: number) {
  if (typeof window === "undefined" || !canLoadTags()) return;
  const params = { value: valueUsd, currency: "USD", product_id: productId };
  if (dryRun) {
    console.info("[marketing dry-run] begin_checkout", params);
    return;
  }
  if (GTM_ID) {
    ensureDataLayer();
    window.dataLayer!.push({ event: "begin_checkout", ...params });
  }
  if (META_PIXEL_ID && window.fbq?.loaded) {
    window.fbq("track", "InitiateCheckout", {
      value: valueUsd,
      currency: "USD",
      content_ids: [productId],
      content_type: "product",
    });
  }
  if (window.gtag) {
    window.gtag("event", "begin_checkout", {
      ...params,
      ...(GOOGLE_ADS_ID ? { send_to: GOOGLE_ADS_ID } : {}),
    });
  }
}

/** Fire the $330 purchase conversion once per report token (per session).
    Called when a business report lands after Stripe checkout. The value is
    the amount actually charged (330, or 325 after the $5 credit) — the
    server's report payload carries it from the payment record (AU-509-2). */
export function trackAuditPurchase(token: string, valueUsd: number) {
  if (typeof window === "undefined" || !canLoadTags()) return;
  const key = `audit_purchase:${token}`;
  if (firedPurchases.has(key)) return;
  firedPurchases.add(key);
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* private mode — the in-memory Set still guards this session */
  }
  const params = { value: valueUsd, currency: "USD", transaction_id: token };
  if (dryRun) {
    console.info("[marketing dry-run] audit purchase", params);
    return;
  }
  if (GTM_ID && window.dataLayer) {
    window.dataLayer.push({ event: "purchase", ...params });
  }
  if (META_PIXEL_ID && window.fbq?.loaded) {
    window.fbq("track", "Purchase", { value: valueUsd, currency: "USD" });
  }
  if (window.gtag) {
    window.gtag("event", "purchase", {
      ...params,
      ...(GOOGLE_ADS_ID ? { send_to: GOOGLE_ADS_ID } : {}),
    });
  }
}

/** Fire the $5 Full Report purchase conversion once per report token (per
    session) — AU-509-2: this product had no purchase event anywhere. The
    value is the flat $5 the checkout charges (no credit or discount ever
    applies to audit-full-report). Called when the paid report renders. */
export function trackFullReportPurchase(token: string) {
  if (typeof window === "undefined" || !canLoadTags()) return;
  const key = `full_report_purchase:${token}`;
  if (firedPurchases.has(key)) return;
  firedPurchases.add(key);
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* private mode — the in-memory Set still guards this session */
  }
  const params = { value: 5, currency: "USD", transaction_id: token, product_id: "audit-full-report" };
  if (dryRun) {
    console.info("[marketing dry-run] full report purchase", params);
    return;
  }
  if (GTM_ID) {
    ensureDataLayer();
    window.dataLayer!.push({ event: "purchase", ...params });
  }
  if (META_PIXEL_ID && window.fbq?.loaded) {
    window.fbq("track", "Purchase", { value: 5, currency: "USD", content_ids: ["audit-full-report"], content_type: "product" });
  }
  if (window.gtag) {
    window.gtag("event", "purchase", {
      ...params,
      ...(GOOGLE_ADS_ID ? { send_to: GOOGLE_ADS_ID } : {}),
    });
  }
}

export default function MarketingTags() {
  const [location] = useLocation();

  useEffect(() => {
    const install = () => {
      if (!canLoadTags()) return;
      installGtm();
      installMetaPixel();
      installGoogleAds();
    };
    install();
    /* First-visit gap (found during the rot509 fix): the mount pass runs
       before a first-time visitor accepts the cookie banner, and without
       this subscription the tags would only ever load for RETURNING
       visitors — the exact buyers whose checkout events matter would
       never be measured. Installers are idempotent, so re-running them
       on the consent grant is safe. Mirrors GoogleAnalytics.tsx. */
    const off = onConsentChange(() => {
      install();
      if (canLoadTags(location)) trackAuditPageView(location);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canLoadTags(location)) return;
    trackAuditPageView(location);
  }, [location]);

  return null;
}
