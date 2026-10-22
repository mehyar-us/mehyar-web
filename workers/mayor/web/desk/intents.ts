/**
 * desk/intents.ts — The Desk's typed intent stream (Reinvention
 * Slice 1, blueprint §3.1/§3.2). The engine and the shell emit typed
 * intents; the React client owns exactly one renderer per catalog
 * primitive and nothing else. A new card type is data + a composition
 * of these primitives — never new imperative code in the shell.
 *
 * Every intent carries a mandatory plain-text `summary`: an intent of
 * an unknown type, or of a newer version than this client renders,
 * degrades to a Line carrying that summary (readable prose, never a
 * crash or a blank card). Money intents degrade to a NON-actionable
 * Line — an old client can never render a tappable money action it
 * does not fully understand (§3.2).
 *
 * No intent carries a price as a bare number for display: money
 * identity rides as catalog-fed labels (priceLabel) and the Seats
 * Line's counts, which the producer read from the CatalogService /
 * foundingSeats() at intent-build time. Fail-quiet is a value, not an
 * absence: seats === null means "count unverifiable — show the static
 * line, no number" (§3.2 Seats Line).
 */

export const DESK_INTENT_VERSION = 1;

interface IntentBase {
  id: string;
  version: number;
  /** Mandatory plain-text summary — the degradation rendering. */
  summary: string;
}

export interface LineIntent extends IntentBase {
  type: 'line';
  text: string;
  tone?: 'plain' | 'muted';
}

export interface ReceiptIntent extends IntentBase {
  type: 'receipt';
  text: string;
  detail?: string;
}

export interface FactIntent extends IntentBase {
  type: 'fact';
  label: string;
  value: string;
  qualifier?: string;
  copyable?: boolean;
}

export interface StatIntent extends IntentBase {
  type: 'stat';
  label: string;
  value: string;
  context?: string;
  /** Staleness stamp when the value is last-known, never fake-live. */
  stale?: string;
}

export interface PersonIntent extends IntentBase {
  type: 'person';
  name: string;
  context?: string;
  state?: 'known' | 'new' | 'blocked';
}

export interface ChipIntent extends IntentBase {
  type: 'chip';
  label: string;
  count?: number;
  selected?: boolean;
}

export interface SkeletonIntent extends IntentBase {
  type: 'skeleton';
  shape: 'line' | 'card';
}

export interface EmptyIntent extends IntentBase {
  type: 'empty';
  text: string;
  actionLabel?: string;
}

export interface InlineErrorIntent extends IntentBase {
  type: 'inline-error';
  text: string;
  retryLabel?: string;
}

export interface SeatsData {
  remaining: number;
  total: number;
}

/** The carried-intent primitive (blueprint §3.2 Intent Ribbon):
 * render-only over the one intent carrier — it reads the carrier's
 * intent and the catalog, writes nothing, and disappears on
 * consume/expiry. `state:'unhonorable'` is the sold-out truth: the
 * Ribbon says so in words and names the honest alternative — never a
 * silent substitution. */
export interface IntentRibbonIntent extends IntentBase {
  type: 'intent-ribbon';
  planRef: 'founding';
  state: 'carried' | 'preselected' | 'unhonorable';
  headline: string;
  detail?: string;
  /** Catalog-fed price label (e.g. "$79.20/mo · locked for life").
   * Absent when the catalog read failed — fail-quiet, no price. */
  priceLabel?: string;
  /** Subscription-row seat count from the catalog, or null when
   * unverifiable (fail-quiet: no count is rendered). */
  seats?: SeatsData | null;
  /** The honest alternative when the intent can't be honored. */
  alternativeLabel?: string;
}

export interface SeatsLineIntent extends IntentBase {
  type: 'seats-line';
  /** null = fail-quiet: the static line with NO count. */
  seats: SeatsData | null;
  priceLabel: string;
  soldOut?: boolean;
}

/** Slice 2 — the engine's cards (emitted by src/engine/surface.ts).
 * Readiness is a treatment, never a number: no field here can carry
 * a numeric confidence (§1.2). */

/** A prepared action awaiting the owner's word. `state` is the
 * readiness treatment: 'ready' full-strength, 'worth-a-look'
 * softened (near the edge of the owner's rule). MONEY-adjacent: the
 * primary verb can move a customer send. */
export interface ActionCardIntent extends IntentBase {
  type: 'action-card';
  actionId: string;
  state: 'ready' | 'worth-a-look';
  headline: string;
  personName?: string;
  draftText?: string;
  basisLine?: string;
  provenance?: { grantId: string };
  primaryLabel: string;
}

/** A shadow-mode action: what the engine WOULD have sent under the
 * owner's rule, shown for a ruling instead of sent. MONEY-adjacent
 * for the same reason as the action card. */
export interface ShadowCardIntent extends IntentBase {
  type: 'shadow-card';
  actionId: string;
  headline: 'Would have sent';
  personName?: string;
  draftText?: string;
  provenance: { ruleText: string; predicate: string };
  nearBoundary: boolean;
}

/** A probe question: the owner rules the scenario Allowed or
 * Blocked; the tap IS the ruling, so `expected` is never rendered
 * as a hint or pre-selected answer. */
export interface ScenarioCardIntent extends IntentBase {
  type: 'scenario-card';
  scenarioId: string;
  grantId: string;
  prompt: string;
  expected: 'allowed' | 'blocked';
}

/** A standing rule (Grant) as its card: the owner's own words, the
 * compiled summary, the NEVER lines verbatim, scope chips, and the
 * lifecycle state. */
export interface GrantCardIntent extends IntentBase {
  type: 'grant-card';
  grantId: string;
  state: 'proposed' | 'probed' | 'shadow' | 'live' | 'narrowed' | 'revoked' | 'expired';
  ownerWords: string;
  summaryText: string;
  neverLines: string[];
  scopeChips: string[];
  actsCount: number;
}

export type DeskIntent =
  | LineIntent
  | ReceiptIntent
  | FactIntent
  | StatIntent
  | PersonIntent
  | ChipIntent
  | SkeletonIntent
  | EmptyIntent
  | InlineErrorIntent
  | IntentRibbonIntent
  | SeatsLineIntent
  | ActionCardIntent
  | ShadowCardIntent
  | ScenarioCardIntent
  | GrantCardIntent;

/** Intent types that carry money identity. An unknown or newer
 * version of one of these degrades to a non-actionable Line — never
 * a tappable control (§3.2). The Slice 2 action and shadow cards
 * are money-adjacent — their verbs can move a customer send — so
 * they degrade the same way. */
export const MONEY_INTENT_TYPES: ReadonlySet<string> = new Set([
  'intent-ribbon',
  'seats-line',
  'action-card',
  'shadow-card',
]);

export const KNOWN_INTENT_TYPES: ReadonlySet<string> = new Set([
  'line',
  'receipt',
  'fact',
  'stat',
  'person',
  'chip',
  'skeleton',
  'empty',
  'inline-error',
  'intent-ribbon',
  'seats-line',
  'action-card',
  'shadow-card',
  'scenario-card',
  'grant-card',
]);

/** What an intent degrades to when this client cannot render it:
 * the summary as a Line; money summaries are non-actionable. */
export interface DegradedIntent {
  text: string;
  actionable: false;
}

export function degradeIntent(intent: { type: string; version: number; summary?: unknown }): DegradedIntent {
  const summary = typeof intent.summary === 'string' && intent.summary.trim() ? intent.summary : 'Open The Mayor to review.';
  return { text: summary, actionable: false };
}

export function isRenderable(intent: { type: string; version: number; summary?: unknown }): boolean {
  // The summary is mandatory (§3.2): an intent without one cannot be
  // rendered safely — it degrades instead of rendering half-formed.
  return (
    KNOWN_INTENT_TYPES.has(intent.type) &&
    intent.version <= DESK_INTENT_VERSION &&
    typeof intent.summary === 'string' &&
    intent.summary.length > 0
  );
}
