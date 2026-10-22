/**
 * analytics-events.test.ts — money-path events (rot523, 2026-10-21).
 *
 * QA measured begin_checkout and sign_up firing ×0 across the whole
 * served bundle closure. These tests prove FIRING, not presence: a
 * stubbed gtag captures every call, and the consent gate is exercised
 * in all three states (no choice, denied, granted). Nothing may fire
 * pre-consent — not even into a queue.
 */
import {describe,expect,it} from 'vitest';
import {
  ANALYTICS_CONSENT_KEY,
  SIGNUP_MARKER_KEY,
  analyticsConsentGranted,
  trackAnalyticsEvent,
  trackBeginCheckout,
  trackSignUpOnce,
  type AnalyticsStore,
} from '../web/analytics-events';

function fakeStore(initial: Record<string, string> = {}): AnalyticsStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

function capture() {
  const calls: unknown[][] = [];
  return { calls, gtag: (...args: unknown[]) => { calls.push(args); } };
}

const granted = (store: AnalyticsStore) => () => analyticsConsentGranted(store);

describe('the consent gate', () => {
  it('reads the versioned consent key and only ever honors granted', () => {
    expect(analyticsConsentGranted(fakeStore())).toBe(false);
    expect(analyticsConsentGranted(fakeStore({ [ANALYTICS_CONSENT_KEY]: 'denied' }))).toBe(false);
    expect(analyticsConsentGranted(fakeStore({ [ANALYTICS_CONSENT_KEY]: 'granted' }))).toBe(true);
    expect(analyticsConsentGranted(null)).toBe(false);
  });

  it('fires nothing when consent is absent or denied', () => {
    for (const choice of [undefined, 'denied'] as const) {
      const store = fakeStore(choice ? { [ANALYTICS_CONSENT_KEY]: choice } : {});
      const { calls, gtag } = capture();
      expect(trackBeginCheckout({ plan: 'pro' }, { gtag, store, consentGranted: granted(store) })).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it('fires nothing when granted but no gtag exists to receive the event', () => {
    const store = fakeStore({ [ANALYTICS_CONSENT_KEY]: 'granted' });
    expect(trackAnalyticsEvent('begin_checkout', {}, { store, consentGranted: granted(store), gtag: undefined })).toBe(false);
  });
});

describe('begin_checkout', () => {
  it('fires through gtag with the plan context once consent is granted', () => {
    const store = fakeStore({ [ANALYTICS_CONSENT_KEY]: 'granted' });
    const { calls, gtag } = capture();
    const deps = { gtag, store, consentGranted: granted(store) };
    expect(trackBeginCheckout({ plan: 'pro' }, deps)).toBe(true);
    expect(trackBeginCheckout({ plan: 'pro-founding' }, deps)).toBe(true);
    expect(trackBeginCheckout({ plan: 'pack', packId: 'medium' }, deps)).toBe(true);
    expect(trackBeginCheckout({ plan: 'business-audit' }, deps)).toBe(true);
    expect(calls).toEqual([
      ['event', 'begin_checkout', { plan: 'pro' }],
      ['event', 'begin_checkout', { plan: 'pro-founding' }],
      ['event', 'begin_checkout', { plan: 'pack', pack: 'medium' }],
      ['event', 'begin_checkout', { plan: 'business-audit' }],
    ]);
  });
});

describe('sign_up', () => {
  const T0 = Date.parse('2026-10-21T12:00:00.000Z');
  const iso = (ms: number) => new Date(ms).toISOString();

  it('fires once for the account’s first session, then never again', () => {
    const store = fakeStore({ [ANALYTICS_CONSENT_KEY]: 'granted' });
    const { calls, gtag } = capture();
    const deps = { gtag, store, consentGranted: granted(store) };
    const signal = { userId: 'user-1', userCreatedAt: iso(T0), sessionCreatedAt: iso(T0 + 45_000) };
    expect(trackSignUpOnce(signal, deps)).toBe(true);
    expect(calls).toEqual([['event', 'sign_up', { method: 'oauth' }]]);
    expect(store.map.get(SIGNUP_MARKER_KEY)).toBe('user-1');
    // A later boot (same browser, same user) must not re-fire.
    expect(trackSignUpOnce(signal, deps)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('never fires for a returning user — the session is far younger than the account', () => {
    const store = fakeStore({ [ANALYTICS_CONSENT_KEY]: 'granted' });
    const { calls, gtag } = capture();
    const deps = { gtag, store, consentGranted: granted(store) };
    const signal = { userId: 'user-2', userCreatedAt: iso(T0 - 30 * 24 * 3600_000), sessionCreatedAt: iso(T0) };
    expect(trackSignUpOnce(signal, deps)).toBe(false);
    expect(calls).toEqual([]);
    expect(store.map.has(SIGNUP_MARKER_KEY)).toBe(false);
  });

  it('never fires without both timestamps, and never pre-consent', () => {
    const store = fakeStore({ [ANALYTICS_CONSENT_KEY]: 'granted' });
    const { calls, gtag } = capture();
    const deps = { gtag, store, consentGranted: granted(store) };
    expect(trackSignUpOnce({ userId: 'user-3' }, deps)).toBe(false);
    expect(trackSignUpOnce({ userId: 'user-3', userCreatedAt: 'not-a-date', sessionCreatedAt: iso(T0) }, deps)).toBe(false);
    expect(trackSignUpOnce({ userId: '', userCreatedAt: iso(T0), sessionCreatedAt: iso(T0) }, deps)).toBe(false);
    expect(calls).toEqual([]);

    // Consent arrives after the first session was observed: the
    // marker was never set by the blocked attempt, so an in-window
    // granted observation still fires — exactly once.
    const late = fakeStore();
    const depsLate = { gtag, store: late, consentGranted: granted(late) };
    const signal = { userId: 'user-4', userCreatedAt: iso(T0), sessionCreatedAt: iso(T0 + 30_000) };
    expect(trackSignUpOnce(signal, depsLate)).toBe(false);
    expect(late.map.has(SIGNUP_MARKER_KEY)).toBe(false);
    late.setItem(ANALYTICS_CONSENT_KEY, 'granted');
    expect(trackSignUpOnce(signal, depsLate)).toBe(true);
    expect(calls).toEqual([['event', 'sign_up', { method: 'oauth' }]]);
  });

  it('a different user on the same browser still gets their own sign_up', () => {
    const store = fakeStore({ [ANALYTICS_CONSENT_KEY]: 'granted', [SIGNUP_MARKER_KEY]: 'user-1' });
    const { calls, gtag } = capture();
    const deps = { gtag, store, consentGranted: granted(store) };
    expect(trackSignUpOnce({ userId: 'user-5', userCreatedAt: iso(T0), sessionCreatedAt: iso(T0 + 10_000) }, deps)).toBe(true);
    expect(calls).toEqual([['event', 'sign_up', { method: 'oauth' }]]);
  });
});
