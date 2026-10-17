/* ------------------------------------------------------------------ */
/* Purchase intent (NEW-1, 2026-10-17).                               */
/*                                                                    */
/* /sales and /pricing emit plan-carrying purchase links              */
/* (/billing?plan=pro, /billing?pack=small|medium|large) — the buy    */
/* click's intent. Nothing consumed the params: a signed-out visitor  */
/* lost them at the sign-in wall, a signed-in one landed on billing   */
/* with nothing preselected. This module is the consumer, following   */
/* the pattern Rizza's 1a proved:                                     */
/*   1. The allowlist is EXACTLY the emitted values — plan=pro,       */
/*      pack=small|medium|large. Anything else (including             */
/*      plan=pro-founding: founding stays seat-gated in the dialog,   */
/*      preselection is never a seat) parses to null.                 */
/*   2. A valid intent found at shell boot is stashed in              */
/*      sessionStorage, so it survives the sign-in round trip in      */
/*      the same tab whichever path the callback returns to.          */
/*   3. takeBillingIntent() consumes it exactly once (URL wins over   */
/*      the stash; the stash is cleared either way).                  */
/* Storage is injectable for tests and every access is guarded — a    */
/* storage failure degrades to URL-only, never to a crash.            */
/* ------------------------------------------------------------------ */

export type BillingIntent =
  | { kind: 'plan'; id: 'pro' }
  | { kind: 'pack'; id: 'small' | 'medium' | 'large' };

const PACK_IDS = ['small', 'medium', 'large'] as const;
const STORAGE_KEY = 'mayor_billing_intent';

export function parseBillingIntent(search: string): BillingIntent | null {
  const query = new URLSearchParams(search);
  if (query.get('plan') === 'pro') return { kind: 'plan', id: 'pro' };
  const pack = query.get('pack');
  if (pack === 'small' || pack === 'medium' || pack === 'large') return { kind: 'pack', id: pack };
  return null;
}

function serialize(intent: BillingIntent): string {
  return `${intent.kind}:${intent.id}`;
}

function deserialize(raw: string | null): BillingIntent | null {
  if (!raw) return null;
  // Re-validate stored values through the same allowlist as the URL.
  if (raw === 'plan:pro') return { kind: 'plan', id: 'pro' };
  const pack = raw.startsWith('pack:') ? raw.slice(5) : '';
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
    return globalThis.sessionStorage ?? null;
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
): BillingIntent | null {
  const intent = parseBillingIntent(search);
  if (intent && store) {
    try { store.setItem(STORAGE_KEY, serialize(intent)); } catch { /* URL still carries it this boot */ }
  }
  return intent;
}

/** True when an intent is available from the URL or the stash. */
export function hasBillingIntent(
  search: string = currentSearch(),
  store: IntentStore | null = defaultStore(),
): boolean {
  if (parseBillingIntent(search)) return true;
  if (!store) return false;
  try { return deserialize(store.getItem(STORAGE_KEY)) !== null; } catch { return false; }
}

/** Consume the intent exactly once: URL wins; the stash is cleared
 * either way so a later boot never replays a stale buy click. */
export function takeBillingIntent(
  search: string = currentSearch(),
  store: IntentStore | null = defaultStore(),
): BillingIntent | null {
  let stashed: BillingIntent | null = null;
  if (store) {
    try {
      stashed = deserialize(store.getItem(STORAGE_KEY));
      store.removeItem(STORAGE_KEY);
    } catch { /* storage unavailable: URL-only */ }
  }
  return parseBillingIntent(search) ?? stashed;
}

export const BILLING_INTENT_PACK_IDS = PACK_IDS;
