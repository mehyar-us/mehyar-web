/**
 * Canvas event model — the foundation of The Mayor's conversation canvas.
 * ============================================================================
 * Vision (docs/mayor-vision.md, "Visual direction"): "One conversation
 * canvas replaces tabbed views. Cards materialize in the flow of talk; they
 * don't live in a separate 'dashboard maze'."
 *
 * The canvas is therefore modelled as ONE ordered event stream, not as a set
 * of widgets. Every thing that appears in the stream is a CanvasEvent:
 *
 *   - kind 'message'     — one chat turn (owner or The Mayor).
 *   - kind 'card kinds'  — a live card materialized in the flow:
 *       'setup'       the onboarding setup card (Chief of Staff progress),
 *       'briefing'    today's morning briefing,
 *       'money'       the "Money this week" glanceable card,
 *       'missed-call' a missed-call highlight needing follow-up,
 *       'booking'     a speak-and-show booking / booking-change card (P3),
 *       'suggestion'  a proactive suggestion card,
 *       'notification' a notification highlight.
 *
 * Ordering contract (compareCanvasEvents):
 *   1. Primary: `at` — epoch milliseconds, ascending. Events whose source
 *      carries no real timestamp use CANVAS_DAY_ANCHOR: they belong to the
 *      "day segment" that opens the stream (this morning's briefing, today's
 *      cards) ahead of the live conversation.
 *   2. Tie-break: CANVAS_KIND_RANK — the day's contextual flow
 *      (setup → briefing → money → missed-call → suggestion → notification →
 *      message).
 *   3. Final tie-break: `id`, lexicographic — the order is total and stable,
 *      so re-rendering never shuffles the stream.
 *
 * P3 (speak-and-show) builds on this: during a voice turn it creates card
 * events with REAL `at` timestamps (the moment the words are spoken) and
 * calls upsertCanvasEvent() to splice them into the message segment — the
 * booking timeline lands between the messages that mention it, with no
 * model change. Message events today carry no per-message timestamps from
 * the client transcript store, so in P2 they all sit in the day segment's
 * tail in arrival order; the moment voice/message events gain timestamps,
 * the same comparator interleaves them honestly.
 *
 * This module is pure (no DOM, no fetch) so the ordering/composition logic
 * is unit-testable — see tests/canvas-model.test.ts.
 */

export type CanvasCardKind = 'setup' | 'briefing' | 'money' | 'missed-call' | 'booking' | 'suggestion' | 'notification';
export type CanvasEventKind = CanvasCardKind | 'message';

export interface CanvasEvent {
  /** Stable, unique within the stream. See canvasEventId(). */
  id: string;
  kind: CanvasEventKind;
  /** Epoch ms. CANVAS_DAY_ANCHOR for day-segment cards with no real time. */
  at: number;
}

/**
 * Anchor for the day segment: cards that summarize "today" (briefing,
 * money, today's suggestions) conceptually happen before the live
 * conversation resumes, so they sort ahead of every real timestamp.
 */
export const CANVAS_DAY_ANCHOR = Number.NEGATIVE_INFINITY;

/** Contextual order inside the day segment (and the tie-break everywhere). */
export const CANVAS_KIND_RANK: Record<CanvasEventKind, number> = {
  setup: 0,
  briefing: 1,
  money: 2,
  'missed-call': 3,
  booking: 4,
  suggestion: 5,
  notification: 6,
  message: 7,
};

/** Stable event ids: `kind:key` (e.g. `missed-call:<call-id>`, `briefing:today`). */
export function canvasEventId(kind: CanvasEventKind, key: string): string {
  return `${kind}:${key}`;
}

function eventTime(event: CanvasEvent): number {
  return Number.isFinite(event.at) ? event.at : CANVAS_DAY_ANCHOR;
}

/** Total order over canvas events — see the ordering contract above. */
export function compareCanvasEvents(a: CanvasEvent, b: CanvasEvent): number {
  const at = eventTime(a), bt = eventTime(b);
  if (at !== bt) return at < bt ? -1 : 1;
  const rank = CANVAS_KIND_RANK[a.kind] - CANVAS_KIND_RANK[b.kind];
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Return a NEW array with the events in stream order. Never mutates. */
export function orderCanvasEvents<T extends CanvasEvent>(events: readonly T[]): T[] {
  return [...events].sort(compareCanvasEvents);
}

/**
 * Insert an event into the stream, or replace the event with the same id
 * (a card whose data refreshed, a voice card that updates as The Mayor
 * speaks). Returns a NEW ordered array. This is P3's injection point.
 */
export function upsertCanvasEvent<T extends CanvasEvent>(events: readonly T[], event: T): T[] {
  return orderCanvasEvents([...events.filter(existing => existing.id !== event.id), event]);
}

/** The day-segment card kinds present, in canvas order — the card lane's projection. */
export function orderCanvasDayCards(kinds: readonly CanvasCardKind[]): CanvasCardKind[] {
  return orderCanvasEvents(kinds.map(kind => ({ id: canvasEventId(kind, 'lane'), kind, at: CANVAS_DAY_ANCHOR }))).map(event => event.kind);
}

/* ------------------------------------------------------------------ */
/* Missed-call highlights — the pure selector behind the canvas card.  */
/* ------------------------------------------------------------------ */

/** Structural subset of the GET /missed-calls rows the canvas needs. */
export interface MissedCallLike {
  id: string;
  caller_number: string;
  occurred_at: string;
  textback_sent_at: string | null;
  reply_received_at: string | null;
  booking_id: string | null;
  status: string;
  source?: string;
}

/**
 * The calls that still need the owner: no text-back has gone out yet.
 * Newest first; calls with an unparseable timestamp sort last (they still
 * show — hiding a real call would be worse than ordering it late).
 * Pure and capped: the canvas shows at most `limit` highlights; the full
 * list lives one tap away in the missed-calls dialog.
 */
export function selectMissedCallHighlights<T extends MissedCallLike>(calls: readonly T[], limit = 3): T[] {
  const time = (call: T) => {
    const parsed = Date.parse(call.occurred_at);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  return calls
    .filter(call => !call.textback_sent_at)
    .sort((a, b) => time(b) - time(a))
    .slice(0, Math.max(0, limit));
}

/** The stream event for one highlighted call — P3 reuses this shape. */
export function missedCallEvent(call: MissedCallLike): CanvasEvent {
  const parsed = Date.parse(call.occurred_at);
  return {
    id: canvasEventId('missed-call', call.id),
    kind: 'missed-call',
    at: Number.isNaN(parsed) ? CANVAS_DAY_ANCHOR : parsed,
  };
}
