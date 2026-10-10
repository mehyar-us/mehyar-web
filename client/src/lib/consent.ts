// client/src/lib/consent.ts — shared cookie-consent state.
//
// Single source of truth for the visitor's analytics consent choice.
// Storage key matches the banner snippet (ms_cookie_consent=accepted|declined).
// The inline <head> script in index.html sets Consent-Mode defaults and owns
// loading gtag.js; React code uses these helpers to decide whether analytics
// may run, and to react when the visitor grants consent after load.

export const CONSENT_KEY = "ms_cookie_consent";
export const CONSENT_EVENT = "ms-cookie-consent";
export type ConsentChoice = "accepted" | "declined" | null;

export function getConsent(): ConsentChoice {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

export function hasConsented(): boolean {
  return getConsent() === "accepted";
}

/** Fired on window whenever the choice changes: { choice: ConsentChoice }. */
export function onConsentChange(fn: (choice: ConsentChoice) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<ConsentChoice>).detail ?? getConsent());
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}

/** Grant from React (rare — the banner owns this; provided for completeness). */
export function grantConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, "accepted");
  } catch {}
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: "accepted" }));
  const w = window as unknown as { __mehyarConsent?: { grant?: () => void } };
  try { w.__mehyarConsent?.grant?.(); } catch {}
}
