import { describe, expect, it } from 'vitest';
import {
  SPEAK_SHOW_STAGGER_MS,
  confirmationTarget,
  createVisualQueue,
  isSpeakShowEvent,
  scheduleTurnVisuals,
  visualsFromTurnEvent,
  type SpeakShowVisual,
} from '../web/speak-show-model';

const AT = 1_762_000_000_000;

const bookingProposal = (overrides: Record<string, unknown> = {}) => ({
  type: 'booking_proposal',
  proposal: {
    id: 'bk-1',
    status: 'awaiting_confirmation',
    input: {
      title: 'Haircut with Sam', appointmentType: 'Haircut', staff: 'Sam',
      start: '2026-10-13T14:00:00.000Z', end: '2026-10-13T14:45:00.000Z', attendees: [],
    },
    customer: { name: 'Riley' },
    calendarName: 'Shop calendar',
    timeZone: 'America/New_York',
    expiresAt: '2026-10-12T15:02:00.000Z',
    ...overrides,
  },
});

describe('visualsFromTurnEvent — booking proposals', () => {
  it('derives a booking visual from the real server proposal, unconfirmed while awaiting yes', () => {
    const visuals = visualsFromTurnEvent(bookingProposal(), AT);
    expect(visuals).toHaveLength(1);
    const visual = visuals[0];
    expect(visual.type).toBe('booking');
    if (visual.type !== 'booking') throw new Error('unreachable');
    expect(visual.confirmed).toBe(false);
    expect(visual.event).toEqual({ id: 'booking:bk-1', kind: 'booking', at: AT });
    expect(visual.proposal.input.title).toBe('Haircut with Sam');
    expect(visual.proposal.customer).toEqual({ name: 'Riley' });
  });

  it('marks the visual confirmed only when the server status is applied (auto tier)', () => {
    const [visual] = visualsFromTurnEvent(bookingProposal({ status: 'applied' }), AT);
    expect(visual.type === 'booking' && visual.confirmed).toBe(true);
  });

  it('never invents a booking from malformed or partial payloads', () => {
    expect(visualsFromTurnEvent({ type: 'booking_proposal' }, AT)).toEqual([]);
    expect(visualsFromTurnEvent({ type: 'booking_proposal', proposal: { id: 'x', status: 'applied' } }, AT)).toEqual([]);
    expect(visualsFromTurnEvent(bookingProposal({ input: { title: 'T', appointmentType: 'Cut', start: 'not-a-date', end: '2026-10-13T14:45:00.000Z', attendees: [] } }), AT)).toEqual([]);
    expect(visualsFromTurnEvent(null, AT)).toEqual([]);
    expect(visualsFromTurnEvent('booking_proposal', AT)).toEqual([]);
    expect(visualsFromTurnEvent({ type: 'something_else' }, AT)).toEqual([]);
  });

  it('drops non-string attendees and a customer without a name instead of guessing', () => {
    const [visual] = visualsFromTurnEvent(bookingProposal({
      input: { title: 'T', appointmentType: 'Cut', start: '2026-10-13T14:00:00.000Z', end: '2026-10-13T14:45:00.000Z', attendees: ['a@b.c', 42] },
      customer: { email: 'x@y.z' },
    }), AT);
    expect(visual.type).toBe('booking');
    if (visual.type !== 'booking') throw new Error('unreachable');
    expect(visual.proposal.input.attendees).toEqual(['a@b.c']);
    expect(visual.proposal.customer).toBeNull();
  });
});

describe('visualsFromTurnEvent — appointment changes', () => {
  const change = (kind: string) => ({
    type: 'appointment_change_proposal',
    proposal: {
      id: 'ch-1', kind, status: 'awaiting_confirmation',
      before: { title: 'Checkup', appointmentType: 'Exam', start: '2026-10-14T15:00:00.000Z', end: '2026-10-14T15:30:00.000Z', attendees: [] },
      after: { title: 'Checkup', appointmentType: 'Exam', start: '2026-10-15T15:00:00.000Z', end: '2026-10-15T15:30:00.000Z', attendees: [] },
      customer: null, timeZone: 'America/New_York',
    },
  });

  it('derives a change visual with before/after from the server proposal', () => {
    const [visual] = visualsFromTurnEvent(change('reschedule'), AT);
    expect(visual.type).toBe('booking-change');
    if (visual.type !== 'booking-change') throw new Error('unreachable');
    expect(visual.event).toEqual({ id: 'booking:change-ch-1', kind: 'booking', at: AT });
    expect(visual.proposal.after.start).toBe('2026-10-15T15:00:00.000Z');
    expect(visual.confirmed).toBe(false);
  });

  it('rejects an unknown change kind', () => {
    expect(visualsFromTurnEvent(change('teleport'), AT)).toEqual([]);
  });
});

describe('visualsFromTurnEvent — calendar inventory', () => {
  it('counts only calendars from available connections (real server counts)', () => {
    const [visual] = visualsFromTurnEvent({
      type: 'calendar_inventory',
      connections: [
        { provider: 'google', calendars: [{ id: 'a' }, { id: 'b' }], available: true },
        { provider: 'microsoft', calendars: [{ id: 'c' }], available: false },
      ],
      setup: { active: false, nextQuestion: 'What time zone is the shop in?' },
    }, AT);
    expect(visual.type).toBe('calendars');
    if (visual.type !== 'calendars') throw new Error('unreachable');
    expect(visual.calendarCount).toBe(2);
    expect(visual.schedulingActive).toBe(false);
    expect(visual.setupNextQuestion).toBe('What time zone is the shop in?');
    expect(visual.event).toEqual({ id: 'notification:calendar-inventory', kind: 'notification', at: AT });
  });

  it('returns nothing when a connection entry is malformed', () => {
    expect(visualsFromTurnEvent({ type: 'calendar_inventory', connections: [{ provider: 'google' }] }, AT)).toEqual([]);
    expect(visualsFromTurnEvent({ type: 'calendar_inventory' }, AT)).toEqual([]);
  });
});

describe('confirmationTarget', () => {
  it('resolves applied booking and change confirmations to their ids', () => {
    expect(confirmationTarget({ type: 'booking_confirmed', id: 'bk-1', status: 'applied' })).toEqual({ kind: 'booking', id: 'bk-1' });
    expect(confirmationTarget({ type: 'appointment_change_confirmed', id: 'ch-1', kind: 'cancel', status: 'applied' })).toEqual({ kind: 'booking-change', id: 'ch-1' });
  });

  it('ignores non-applied confirmations and unrelated events', () => {
    expect(confirmationTarget({ type: 'booking_confirmed', id: 'bk-1', status: 'uncertain' })).toBeNull();
    expect(confirmationTarget({ type: 'booking_confirmed', status: 'applied' })).toBeNull();
    expect(confirmationTarget({ type: 'usage_notice', allowed: true })).toBeNull();
    expect(confirmationTarget(null)).toBeNull();
  });

  it('isSpeakShowEvent covers visuals and confirmations only', () => {
    expect(isSpeakShowEvent(bookingProposal())).toBe(true);
    expect(isSpeakShowEvent({ type: 'booking_confirmed', id: 'bk-1', status: 'applied' })).toBe(true);
    expect(isSpeakShowEvent({ type: 'business_context', profile: {} })).toBe(false);
  });
});

describe('scheduleTurnVisuals', () => {
  const visuals = visualsFromTurnEvent(bookingProposal(), AT);

  it('shows the first visual immediately and staggers the rest under the 1s budget', () => {
    const many: SpeakShowVisual[] = [...visuals, ...visuals, ...visuals];
    const scheduled = scheduleTurnVisuals(7, many);
    expect(scheduled.map(item => item.delayMs)).toEqual([0, SPEAK_SHOW_STAGGER_MS, 2 * SPEAK_SHOW_STAGGER_MS]);
    expect(scheduled.every(item => item.turnId === 7)).toBe(true);
    expect(Math.max(...scheduled.map(item => item.delayMs))).toBeLessThan(1000);
  });

  it('clamps a negative stagger to zero', () => {
    expect(scheduleTurnVisuals(1, [...visuals, ...visuals], -5).map(item => item.delayMs)).toEqual([0, 0]);
  });
});

describe('createVisualQueue — interruption (barge-in) semantics', () => {
  const twoTurns = () => {
    const queue = createVisualQueue();
    const a = visualsFromTurnEvent(bookingProposal(), AT);
    const b = visualsFromTurnEvent(bookingProposal({ id: 'bk-2' }), AT);
    queue.enqueue(scheduleTurnVisuals(1, a));
    queue.enqueue(scheduleTurnVisuals(2, b));
    return { queue, a, b };
  };

  it('cancelTurn drops only that turn’s pending visuals and returns them', () => {
    const { queue, a } = twoTurns();
    const dropped = queue.cancelTurn(1);
    expect(dropped).toEqual(a);
    expect(queue.pendingCount(1)).toBe(0);
    expect(queue.pendingCount(2)).toBe(1);
    expect(queue.pendingCount()).toBe(1);
  });

  it('a visual already shown is never cancelled (it reflects real data)', () => {
    const { queue, a } = twoTurns();
    queue.markShown(a[0].event.id);
    expect(queue.cancelTurn(1)).toEqual([]);
    expect(queue.isPending(a[0].event.id)).toBe(false);
  });

  it('cancelling twice is harmless; unknown turns cancel nothing', () => {
    const { queue } = twoTurns();
    queue.cancelTurn(1);
    expect(queue.cancelTurn(1)).toEqual([]);
    expect(queue.cancelTurn(99)).toEqual([]);
    expect(queue.pendingCount()).toBe(1);
  });
});
