/* ------------------------------------------------------------------ */
/* Money-path analytics events (rot523, 2026-10-21).                   */
/*                                                                    */
/* QA measured begin_checkout and sign_up firing ×0 across the whole  */
/* served bundle closure — the $99 funnel was unmeasurable. This      */
/* module is the single emission point for both events.               */
/*                                                                    */
/* Consent discipline: an event is emitted ONLY when the stored       */
/* consent choice is 'granted' — the exact gate                       */
/* web/public/analytics-consent.js applies before it loads GA4, GTM,  */
/* or the Meta pixel. Nothing is queued pre-consent (not even into    */
/* dataLayer): a visitor who never accepts is never measured, and a   */
/* denied choice stays denied. When consent is granted, events ride   */
/* the window.gtag the consent snippet defines at parse time, which   */
/* queues into dataLayer until the GA4 library lands — the same path  */
/* every granted pageview takes.                                      */
/*                                                                    */
/* Params carry plan context only (pro / pro-founding / pack + pack   */
/* id / business-audit) — no user id, no email, no free text. The     */
/* sign_up once-marker stores only the user id the session already    */
/* holds client-side.                                                 */
/*                                                                    */
/* sign_up semantics: signup here is OAuth account creation. The      */
/* server creates the user row and the first session in the same      */
/* flow, so a session whose createdAt lands within the freshness      */
/* window of the user's createdAt IS the signup session. The event    */
/* fires at most once per user per browser, and only when that first  */
/* session is observed while consent is already granted — if consent  */
/* comes later, the window has passed and the event is honestly       */
/* skipped rather than backfilled (the privacy gate wins over the     */
/* metric).                                                           */
/* ------------------------------------------------------------------ */

export const ANALYTICS_CONSENT_KEY = 'mayor.analytics-consent.v1';
export const SIGNUP_MARKER_KEY = 'mayor_signup_tracked_user';

export interface AnalyticsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AnalyticsDeps {
  /** Injectable for tests; defaults to window.gtag. */
  gtag?: (...args: unknown[]) => void;
  /** Injectable for tests; defaults to the stored consent choice. */
  consentGranted?: () => boolean;
  /** Injectable for tests; defaults to localStorage. */
  store?: AnalyticsStore | null;
}

function defaultStore(): AnalyticsStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The gate itself: true only for a stored 'granted' choice. */
export function analyticsConsentGranted(store: AnalyticsStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(ANALYTICS_CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

function resolveGtag(deps: AnalyticsDeps): ((...args: unknown[]) => void) | null {
  if (deps.gtag) return deps.gtag;
  const candidate = (globalThis as { gtag?: unknown }).gtag;
  return typeof candidate === 'function' ? (candidate as (...args: unknown[]) => void) : null;
}

/**
 * Emit one GA4 event through the consent gate. Returns true only when
 * the event was actually handed to gtag — callers (and tests) never
 * have to guess whether measurement happened.
 */
export function trackAnalyticsEvent(
  name: string,
  params: Record<string, unknown> = {},
  deps: AnalyticsDeps = {},
): boolean {
  const granted = deps.consentGranted ? deps.consentGranted() : analyticsConsentGranted(deps.store ?? defaultStore());
  if (!granted) return false;
  const gtag = resolveGtag(deps);
  if (!gtag) return false;
  try {
    gtag('event', name, params);
    return true;
  } catch {
    return false;
  }
}

export type BeginCheckoutPlan = 'pro' | 'pro-founding' | 'pack' | 'business-audit';

/**
 * begin_checkout — fired at the click that creates the Stripe checkout
 * session (the money path's point of no return), carrying the plan
 * context so the founding cohort's funnel is separable from list Pro.
 */
export function trackBeginCheckout(
  context: { plan: BeginCheckoutPlan; packId?: string },
  deps: AnalyticsDeps = {},
): boolean {
  return trackAnalyticsEvent(
    'begin_checkout',
    { plan: context.plan, ...(context.packId ? { pack: context.packId } : {}) },
    deps,
  );
}

export interface SignUpSignal {
  userId: string;
  userCreatedAt?: string | null;
  sessionCreatedAt?: string | null;
}

/** Session may precede the user row's timestamp by clock skew only. */
const SIGNUP_SKEW_MS = 60 * 1000;
/** The first session is created seconds after the user row; ten
 * minutes is generous for the OAuth round trip and far too short to
 * ever describe a returning user. */
const SIGNUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * sign_up — fires once when the observed session is the account's
 * first (see the header for the semantics). Returns true only when
 * the event actually fired.
 */
export function trackSignUpOnce(signal: SignUpSignal, deps: AnalyticsDeps = {}): boolean {
  if (!signal.userId) return false;
  const user = Date.parse(signal.userCreatedAt ?? '');
  const session = Date.parse(signal.sessionCreatedAt ?? '');
  if (!Number.isFinite(user) || !Number.isFinite(session)) return false;
  const delta = session - user;
  if (delta < -SIGNUP_SKEW_MS || delta > SIGNUP_WINDOW_MS) return false;
  const store = deps.store ?? defaultStore();
  try {
    if (store?.getItem(SIGNUP_MARKER_KEY) === signal.userId) return false;
  } catch {
    return false;
  }
  const fired = trackAnalyticsEvent('sign_up', { method: 'oauth' }, deps);
  if (fired) {
    try { store?.setItem(SIGNUP_MARKER_KEY, signal.userId); } catch { /* marker is best-effort */ }
  }
  return fired;
}
