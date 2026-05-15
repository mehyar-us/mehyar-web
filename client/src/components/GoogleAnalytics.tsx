import { useEffect } from "react";
import { useLocation } from "wouter";

const googleTagId = import.meta.env.MEHYAR_PUBLIC_GOOGLE_TAG_ID?.trim() || "";
const ga4MeasurementId = import.meta.env.MEHYAR_PUBLIC_GOOGLE_GA4_MEASUREMENT_ID?.trim() || "";
const dryRun = import.meta.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN === "true";
const forceEnable = import.meta.env.MEHYAR_PUBLIC_ANALYTICS_FORCE_ENABLE === "true";

const productionHosts = new Set(["mehyar.us", "www.mehyar.us"]);
const loadedScriptIds = new Set<string>();
const trackedCheckoutEvents = new Set<string>();
const trackedOfferViews = new Set<string>();

function isPublicPath(pathname: string) {
  return !pathname.startsWith("/admin");
}

function canLoadAnalytics(pathname = typeof window === "undefined" ? "" : window.location.pathname) {
  if (typeof window === "undefined") return false;
  if (!isPublicPath(pathname)) return false;
  if (!googleTagId && !ga4MeasurementId) return false;
  return forceEnable || dryRun || productionHosts.has(window.location.hostname);
}

function installGoogleTag() {
  if (typeof window === "undefined" || !canLoadAnalytics()) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtagShim(...args: unknown[]) {
      window.dataLayer?.push(args);
    };

  window.gtag("js", new Date());

  const ids = [googleTagId, ga4MeasurementId].filter(Boolean);

  for (const id of ids) {
    if (dryRun) {
      console.info("[analytics dry-run] Google tag configured", { id });
      continue;
    }

    if (loadedScriptIds.has(id) || document.querySelector(`script[data-mehyar-google-tag="${id}"]`)) {
      continue;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    script.setAttribute("data-mehyar-google-tag", id);
    document.head.appendChild(script);
    loadedScriptIds.add(id);
  }
}

export function trackPublicAnalyticsEvent(eventName: "page_view" | "offer_view" | "cta_click" | "checkout_click" | "checkout_start" | "checkout_success" | "checkout_cancel" | "lead_attempt", parameters: Record<string, string | number | boolean | null | undefined> = {}) {
  if (typeof window === "undefined" || !canLoadAnalytics() || !window.gtag) return;

  const payload = {
    page_path: `${window.location.pathname}${window.location.search}`,
    page_title: document.title,
    page_location: window.location.href,
    ...parameters,
  };

  if (dryRun) {
    console.info(`[analytics dry-run] ${eventName}`, payload);
    return;
  }

  window.gtag("event", eventName, payload);
}

function trackPageView(pathname: string) {
  if (typeof window === "undefined" || !canLoadAnalytics(pathname) || !window.gtag) return;

  const ids = [googleTagId, ga4MeasurementId].filter(Boolean);
  const pagePath = `${pathname}${window.location.search}`;
  const pageTitle = document.title;
  const pageLocation = window.location.href;

  for (const id of ids) {
    const payload = {
      page_path: pagePath,
      page_title: pageTitle,
      page_location: pageLocation,
      send_page_view: true,
    };

    if (dryRun) {
      console.info("[analytics dry-run] page_view", { id, ...payload });
      continue;
    }

    window.gtag("config", id, payload);
  }
}

function installCtaTracking() {
  if (typeof window === "undefined") return () => undefined;

  const listener = (event: MouseEvent) => {
    if (!canLoadAnalytics()) return;
    const target = event.target instanceof Element ? event.target.closest("a,button") : null;
    if (!target) return;

    const label = (target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const href = target instanceof HTMLAnchorElement ? target.getAttribute("href") : null;
    const isTrackedCta = Boolean(
      target.getAttribute("data-analytics-cta") ||
      href?.startsWith("/contact") ||
      href?.startsWith("/services") ||
      href?.startsWith("/billing/checkout") ||
      href?.startsWith("mailto:") ||
      href?.startsWith("tel:"),
    );

    if (!isTrackedCta) return;
    trackPublicAnalyticsEvent("cta_click", { label, href, location: window.location.pathname });
    if (href?.startsWith("/billing/checkout")) {
      trackPublicAnalyticsEvent("checkout_click", { label, href, location: window.location.pathname });
    }
  };

  document.addEventListener("click", listener, { capture: true });
  return () => document.removeEventListener("click", listener, { capture: true });
}

function trackOfferView(pathname: string) {
  if (pathname !== "/330" && pathname !== "/330/" && pathname !== "/micro-offer" && pathname !== "/micro-offer/") return;
  const eventKey = `offer_view:${pathname}`;
  if (trackedOfferViews.has(eventKey)) return;
  trackedOfferViews.add(eventKey);
  trackPublicAnalyticsEvent("offer_view", { offer_code: "ai_missed_lead_rescue_330" });
}

function trackCheckoutResult(pathname: string) {
  if (!pathname.startsWith("/billing/success") && !pathname.startsWith("/billing/cancel")) return;
  const eventName = pathname.startsWith("/billing/success") ? "checkout_success" : "checkout_cancel";
  const eventKey = `${eventName}:${window.location.search}`;
  if (trackedCheckoutEvents.has(eventKey)) return;
  trackedCheckoutEvents.add(eventKey);
  const params = new URLSearchParams(window.location.search);
  trackPublicAnalyticsEvent(eventName, { session_id_present: Boolean(params.get("session_id")) });
}

export default function GoogleAnalytics() {
  const [location] = useLocation();

  useEffect(() => {
    installGoogleTag();
    return installCtaTracking();
  }, []);

  useEffect(() => {
    trackPageView(location);
    trackOfferView(location);
    trackCheckoutResult(location);
  }, [location]);

  return null;
}
