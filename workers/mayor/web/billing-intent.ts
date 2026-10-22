/* ------------------------------------------------------------------ */
/* Purchase intent (NEW-1, 2026-10-17; carrier hardened same day on  */
/* the rot333 verify-and-harden).                                     */
/*                                                                    */
/* /sales and /pricing emit plan-carrying purchase links              */
/* (/billing?plan=pro, /billing?pack=small|medium|large) — the buy    */
/* click's intent. Nothing consumed the params: a signed-out visitor  */
/* lost them at the sign-in wall, a signed-in one landed on billing   */
/* with nothing preselected. This module is the consumer, following   */
/* the pattern Rizza's 1a proved:                                     */
/*   1. The allowlist is EXACTLY the emitted values — plan=pro,       */
/*      plan=founding, pack=small|medium|large. Anything else          */
/*      (including plan=pro-founding: that is a checkout planId, not   */
/*      an intent) parses to null. plan=founding joined the allowlist  */
/*      with the reinvention's founding door (blueprint §2.1 E-0,      */
/*      §4.8a as amended): it is INTENT only — the seat gate still     */
/*      decides at claim time in the dialog and on the server, and    */
/*      preselection is never a seat.                                 */
/*   2. A valid intent found at shell boot is stashed so it can       */
/*      survive the sign-in round trip. The carrier is localStorage   */
/*      — shared across the tabs and windows of one browser          */
/*      profile — because sessionStorage is scope-bound and the     */
/*      intent provably died when sign-in crossed a tab/webview       */
/*      boundary (rot333 trace). The value carries a timestamp and   */
/*      a 60-minute expiry: long enough for any sign-in round trip    */
/*      (including account creation and password resets), short       */
/*      enough that a stale buy click can never ambush a later        */
/*      visit. What no client carrier can cross is a storage          */
/*      PARTITION hop (in-app webview → system browser); the URL      */
/*      param itself remains the carrier there.                       */
/*   3. takeBillingIntent() consumes it exactly once (URL wins over   */
/*      the stash; the stash is cleared either way — including when   */
/*      expired or corrupt).                                          */
/* Storage is injectable for tests and every access is guarded — a    */
/* storage failure degrades to URL-only, never to a crash. The       */
/* stored value is just the intent + timestamp — no PII, no secret.   */
/* ------------------------------------------------------------------ */

export type BillingIntent =
  | { kind: 'plan'; id: 'pro' | 'founding' }
  | { kind: 'pack'; id: 'small' | 'medium' | 'large' };

const PACK_IDS = ['small', 'medium', 'large'] as const;
const STORAGE_KEY = 'mayor_billing_intent';
export const INTENT_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function parseBillingIntent(search: string): BillingIntent | null {
  const query = new URLSearchParams(search);
  if (query.get('plan') === 'pro') return { kind: 'plan', id: 'pro' };
  if (query.get('plan') === 'founding') return { kind: 'plan', id: 'founding' };
  const pack = query.get('pack');
  if (pack === 'small' || pack === 'medium' || pack === 'large') return { kind: 'pack', id: pack };
  return null;
}

function serialize(intent: BillingIntent, nowMs: number): string {
  return `${intent.kind}:${intent.id}@${nowMs}`;
}

function deserialize(raw: string | null, nowMs: number): BillingIntent | null {
  if (!raw) return null;
  // Stored values are re-validated through the same allowlist as the
  // URL, and must be inside their expiry window.
  const at = raw.lastIndexOf('@');
  if (at < 0) return null;
  const stamp = Number(raw.slice(at + 1));
  if (!Number.isFinite(stamp)) return null;
  if (stamp - nowMs > CLOCK_SKEW_MS) return null; // future beyond skew
  if (nowMs - stamp > INTENT_TTL_MS) return null; // expired
  const body = raw.slice(0, at);
  if (body === 'plan:pro') return { kind: 'plan', id: 'pro' };
  if (body === 'plan:founding') return { kind: 'plan', id: 'founding' };
  const pack = body.startsWith('pack:') ? body.slice(5) : '';
  if (pack === 'small' || pack === 'medium' || pack === 'large') return { kind: 'pack', id: pack };
  return null;
}

export interface IntentStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultStore(): IntentStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function currentSearch(): string {
  try {
    return globalThis.location?.search ?? '';
  } catch {
    return '';
  }
}

/** At shell boot: if the URL carries a valid intent, stash it so the
 * sign-in round trip cannot lose it. Returns the intent found. */
export function captureBillingIntent(
  search: string = currentSearch(),
  store: IntentStore | null = defaultStore(),
  nowMs: number = Date.now(),
): BillingIntent | null {
  const intent = parseBillingIntent(search);
  if (intent && store) {
    try { store.setItem(STORAGE_KEY, serialize(intent, nowMs)); } catch { /* URL still carries it this boot */ }
  }
  return intent;
}

/** True when an unexpired intent is available from the URL or the stash. */
export function hasBillingIntent(
  search: string = currentSearch(),
  store: IntentStore | null = defaultStore(),
  nowMs: number = Date.now(),
): boolean {
  if (parseBillingIntent(search)) return true;
  if (!store) return false;
  try { return deserialize(store.getItem(STORAGE_KEY), nowMs) !== null; } catch { return false; }
}

/** Read the carried intent WITHOUT consuming it (URL wins, same
 * precedence as take). The Intent Ribbon and the founding pill are
 * renders of this carrier (blueprint §3.2/§4.8a): they read it, they
 * never write it — consumption happens only through takeBillingIntent
 * (the billing hand-off) or dismissBillingIntent (the owner's own
 * dismissal). */
export function peekBillingIntent(
  search: string = currentSearch(),
  store: IntentStore | null = defaultStore(),
  nowMs: number = Date.now(),
): BillingIntent | null {
  const fromUrl = parseBillingIntent(search);
  if (fromUrl) return fromUrl;
  if (!store) return null;
  try { return deserialize(store.getItem(STORAGE_KEY), nowMs); } catch { return null; }
}

/** The owner dismisses the carried intent (the Ribbon's ✕): the stash
 * is cleared and nothing is consumed toward billing. A URL param on
 * the current page is the caller's to strip (history.replaceState) —
 * the next boot's capture would otherwise re-stash it. */
export function dismissBillingIntent(
  store: IntentStore | null = defaultStore(),
): void {
  if (!store) return;
  try { store.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}

/** Consume the intent exactly once: URL wins; the stash is cleared
 * either way (present-but-expired and corrupt entries are cleaned
 * too) so a later boot never replays a stale buy click. */
export function takeBillingIntent(
  search: string = currentSearch(),
  store: IntentStore | null = defaultStore(),
  nowMs: number = Date.now(),
): BillingIntent | null {
  let stashed: BillingIntent | null = null;
  if (store) {
    try {
      stashed = deserialize(store.getItem(STORAGE_KEY), nowMs);
      store.removeItem(STORAGE_KEY);
    } catch { /* storage unavailable: URL-only */ }
  }
  return parseBillingIntent(search) ?? stashed;
}

export const BILLING_INTENT_PACK_IDS = PACK_IDS;
