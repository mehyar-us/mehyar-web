/**
 * Speak-and-show — pure derivation + turn scheduling (P3).
 * ============================================================================
 * Vision (docs/mayor-vision.md, "Visual direction"): "Speak, and it shows:
 * voice and visual are one experience… a booking timeline builds as it's
 * mentioned, a revenue number counts up as it's spoken, a missed-call card
 * slides in with its one-tap actions. Never decoration; every animation
 * carries information."
 *
 * WHAT GETS VISUALIZED — and the real data source for each visual:
 *  - 'booking'       ← the server's `booking_proposal` custom event
 *                      (src/voice.ts proposeBooking tool): the exact proposal
 *                      the server read back — title, type, staff, start/end,
 *                      calendar, customer link, and its real status
 *                      ('awaiting_confirmation' = NOT booked yet;
 *                      'applied' = booked automatically under the owner's
 *                      auto tier). The card says which one it is.
 *  - 'booking'       ← the server's `booking_confirmed` custom event
 *    (confirmed)       (src/voice.ts, sent only after confirmBooking returns
 *                      'applied' for a separate confirmation turn). It
 *                      carries only the booking id — the card upgrades the
 *                      proposal card already shown for that id, or (when the
 *                      proposal isn't in this page session) the DOM layer
 *                      resolves it from the real GET /bookings endpoint.
 *                      A confirmation with no resolvable real booking
 *                      renders NOTHING.
 *  - 'booking-change'← `appointment_change_proposal` / the matching
 *                      `appointment_change_confirmed` event — same pattern,
 *                      with the server's before/after appointment data.
 *  - 'calendars'     ← `calendar_inventory` (deterministic server branch):
 *                      per-provider REAL calendar counts + availability, and
 *                      the scheduling-setup state the server returned.
 *
 * WHAT IS DELIBERATELY NOT DERIVED HERE:
 *  - Money / counts / missed calls / suggestions are NOT parsed out of the
 *    assistant's spoken reply text (guessing numbers from prose would
 *    invent data). Those figures already live in the canvas as the
 *    proactive/canvas cards, rendered from their real endpoints
 *    (GET /money-week, /briefing, /missed-calls, /suggestions); P3 refreshes
 *    them quietly when a booking settles (see web/speak-show.ts hooks) and
 *    the money figure counts up to its new real value (web/count-up.ts).
 *  - Profile / scheduling / customer proposals are NOT visualized: they
 *    have no honest glanceable card shape yet and their readback already
 *    renders as the conversation message itself.
 *
 * This module is pure (no DOM, no fetch): derivation validates the wire
 * shape defensively and returns [] for anything unrecognized or malformed,
 * so a stray custom message can never fabricate a card.
 */
import { canvasEventId, type CanvasEvent } from './canvas-model';

/* ------------------------------------------------------------------ */
/* Wire shapes (structural subsets of the src/voice.ts payloads).      */
/* ------------------------------------------------------------------ */

export interface BookingInputLike {
  title: string;
  appointmentType: string;
  staff?: string;
  start: string;
  end: string;
  attendees: string[];
}

export interface BookingProposalLike {
  id: string;
  status: string;
  input: BookingInputLike;
  customer?: { name: string } | null;
  calendarName?: string;
  timeZone?: string;
  expiresAt?: string;
}

export interface AppointmentChangeProposalLike {
  id: string;
  kind: 'cancel' | 'reschedule';
  status: string;
  before: BookingInputLike;
  after: BookingInputLike;
  customer?: { name: string } | null;
  timeZone?: string;
  expiresAt?: string;
}

export interface CalendarConnectionLike {
  provider: string;
  calendars: unknown[];
  available: boolean;
}

/* ------------------------------------------------------------------ */
/* Visuals — one per thing the canvas can honestly show.               */
/* ------------------------------------------------------------------ */

export type SpeakShowVisual =
  | {
      type: 'booking';
      /** Canvas event: kind 'booking', id `booking:<proposal-id>`. */
      event: CanvasEvent;
      proposal: BookingProposalLike;
      /** True only when the server says the booking is on the calendar. */
      confirmed: boolean;
    }
  | {
      type: 'booking-change';
      event: CanvasEvent;
      proposal: AppointmentChangeProposalLike;
      confirmed: boolean;
    }
  | {
      type: 'calendars';
      event: CanvasEvent;
      connections: CalendarConnectionLike[];
      /** Total calendars across available connections (a real count). */
      calendarCount: number;
      schedulingActive: boolean;
      setupNextQuestion: string | null;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function bookingInput(value: unknown): BookingInputLike | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.title) || !isNonEmptyString(value.appointmentType)) return null;
  if (!isNonEmptyString(value.start) || !isNonEmptyString(value.end)) return null;
  if (Number.isNaN(Date.parse(value.start)) || Number.isNaN(Date.parse(value.end))) return null;
  return {
    title: value.title,
    appointmentType: value.appointmentType,
    ...(isNonEmptyString(value.staff) ? { staff: value.staff } : {}),
    start: value.start,
    end: value.end,
    attendees: Array.isArray(value.attendees) ? value.attendees.filter(isNonEmptyString) : [],
  };
}

function customerName(value: unknown): { name: string } | null {
  return isRecord(value) && isNonEmptyString(value.name) ? { name: value.name } : null;
}

function bookingProposal(value: unknown): BookingProposalLike | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.status)) return null;
  const input = bookingInput(value.input);
  if (!input) return null;
  return {
    id: value.id,
    status: value.status,
    input,
    customer: customerName(value.customer),
    ...(isNonEmptyString(value.calendarName) ? { calendarName: value.calendarName } : {}),
    ...(isNonEmptyString(value.timeZone) ? { timeZone: value.timeZone } : {}),
    ...(isNonEmptyString(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
  };
}

function changeProposal(value: unknown): AppointmentChangeProposalLike | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.status)) return null;
  if (value.kind !== 'cancel' && value.kind !== 'reschedule') return null;
  const before = bookingInput(value.before);
  const after = bookingInput(value.after);
  if (!before || !after) return null;
  return {
    id: value.id,
    kind: value.kind,
    status: value.status,
    before,
    after,
    customer: customerName(value.customer),
    ...(isNonEmptyString(value.timeZone) ? { timeZone: value.timeZone } : {}),
    ...(isNonEmptyString(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Derivation: one wire event → the visuals it honestly supports.      */
/* ------------------------------------------------------------------ */

/**
 * Derive visuals from ONE server custom event (the payloads handleMessage
 * receives, for voice AND text turns alike — text turns return the same
 * events array). `at` is the real arrival time (epoch ms) — the canvas
 * event's stream position. Confirmation events return a 'booking' /
 * 'booking-change' visual marked confirmed ONLY when they carry (or, for
 * changes, reference) the full real proposal data; a bare confirmation id
 * yields NO visual here — the DOM layer resolves it from its cache or the
 * real bookings endpoint (see web/speak-show.ts).
 */
export function visualsFromTurnEvent(event: unknown, at: number): SpeakShowVisual[] {
  if (!isRecord(event) || !isNonEmptyString(event.type)) return [];
  const when = Number.isFinite(at) ? at : Date.now();
  switch (event.type) {
    case 'booking_proposal': {
      const proposal = bookingProposal(event.proposal);
      if (!proposal) return [];
      return [{
        type: 'booking',
        event: { id: canvasEventId('booking', proposal.id), kind: 'booking', at: when },
        proposal,
        confirmed: proposal.status === 'applied',
      }];
    }
    case 'appointment_change_proposal': {
      const proposal = changeProposal(event.proposal);
      if (!proposal) return [];
      return [{
        type: 'booking-change',
        event: { id: canvasEventId('booking', `change-${proposal.id}`), kind: 'booking', at: when },
        proposal,
        confirmed: proposal.status === 'applied',
      }];
    }
    case 'calendar_inventory': {
      if (!Array.isArray(event.connections)) return [];
      const connections: CalendarConnectionLike[] = [];
      for (const entry of event.connections) {
        if (!isRecord(entry) || !isNonEmptyString(entry.provider) || !Array.isArray(entry.calendars)) return [];
        connections.push({ provider: entry.provider, calendars: entry.calendars, available: entry.available === true });
      }
      const setup = isRecord(event.setup) ? event.setup : {};
      return [{
        type: 'calendars',
        event: { id: canvasEventId('notification', 'calendar-inventory'), kind: 'notification', at: when },
        connections,
        calendarCount: connections.reduce((total, c) => total + (c.available ? c.calendars.length : 0), 0),
        schedulingActive: setup.active === true,
        setupNextQuestion: isNonEmptyString(setup.nextQuestion) ? setup.nextQuestion : null,
      }];
    }
    default:
      return [];
  }
}

/** The booking/change id a confirmation event refers to, or null. Pure —
 * the DOM layer decides whether that id resolves to a real card. */
export function confirmationTarget(event: unknown): { kind: 'booking' | 'booking-change'; id: string } | null {
  if (!isRecord(event)) return null;
  if (event.type === 'booking_confirmed' && event.status === 'applied' && isNonEmptyString(event.id)) {
    return { kind: 'booking', id: event.id };
  }
  if (event.type === 'appointment_change_confirmed' && event.status === 'applied' && isNonEmptyString(event.id)) {
    return { kind: 'booking-change', id: event.id };
  }
  return null;
}

/** True for any wire event speak-and-show consumes (visuals or confirmations). */
export function isSpeakShowEvent(event: unknown): boolean {
  return confirmationTarget(event) !== null || visualsFromTurnEvent(event, 0).length > 0;
}

/* ------------------------------------------------------------------ */
/* Turn scheduling + interruption (barge-in) semantics.                */
/* ------------------------------------------------------------------ */

/** Stagger between visuals from the same turn: the timeline "builds". */
export const SPEAK_SHOW_STAGGER_MS = 150;

export interface ScheduledVisual {
  turnId: number;
  visual: SpeakShowVisual;
  /** Delay after the turn's first visual, ms. First visual is immediate. */
  delayMs: number;
}

/** Pure schedule for one turn's visuals: first immediate, rest staggered.
 * Total build time stays well under the 1s entrance budget. */
export function scheduleTurnVisuals(turnId: number, visuals: readonly SpeakShowVisual[], staggerMs: number = SPEAK_SHOW_STAGGER_MS): ScheduledVisual[] {
  const stagger = Math.max(0, staggerMs);
  return visuals.map((visual, index) => ({ turnId, visual, delayMs: index * stagger }));
}

export interface VisualQueue {
  /** Register a turn's scheduled visuals as pending (not yet shown). */
  enqueue(scheduled: readonly ScheduledVisual[]): void;
  /** A visual reached the screen: it is no longer cancellable. */
  markShown(eventId: string): void;
  /**
   * Barge-in: drop every PENDING visual for the turn and return what was
   * dropped. Visuals already shown are untouched (they reflect real data);
   * other turns are untouched. Synchronous — the <200ms interruption budget
   * is met by construction (no awaits, no fetches).
   */
  cancelTurn(turnId: number): SpeakShowVisual[];
  pendingCount(turnId?: number): number;
  isPending(eventId: string): boolean;
}

export function createVisualQueue(): VisualQueue {
  const pending = new Map<string, ScheduledVisual>();
  return {
    enqueue(scheduled) {
      for (const item of scheduled) pending.set(item.visual.event.id, item);
    },
    markShown(eventId) {
      pending.delete(eventId);
    },
    cancelTurn(turnId) {
      const dropped: SpeakShowVisual[] = [];
      for (const [id, item] of pending) {
        if (item.turnId === turnId) {
          pending.delete(id);
          dropped.push(item.visual);
        }
      }
      return dropped;
    },
    pendingCount(turnId) {
      if (turnId === undefined) return pending.size;
      let count = 0;
      for (const item of pending.values()) if (item.turnId === turnId) count++;
      return count;
    },
    isPending(eventId) {
      return pending.has(eventId);
    },
  };
}
