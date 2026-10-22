import { describe, expect, it } from 'vitest';
import {
  CANVAS_DAY_ANCHOR,
  canvasEventId,
  compareCanvasEvents,
  orderCanvasDayCards,
  orderCanvasEvents,
  selectMissedCallHighlights,
  upsertCanvasEvent,
  missedCallEvent,
  type CanvasEvent,
  type MissedCallLike,
} from '../web/canvas-model';

const ev = (id: string, kind: CanvasEvent['kind'], at: number): CanvasEvent => ({ id, kind, at });

describe('canvas event ordering', () => {
  it('orders the day segment by kind rank when timestamps tie at the anchor', () => {
    const events = [
      ev('suggestion:a', 'suggestion', CANVAS_DAY_ANCHOR),
      ev('message:1', 'message', CANVAS_DAY_ANCHOR),
      ev('money:week', 'money', CANVAS_DAY_ANCHOR),
      ev('briefing:today', 'briefing', CANVAS_DAY_ANCHOR),
      ev('setup:profile', 'setup', CANVAS_DAY_ANCHOR),
      ev('missed-call:c1', 'missed-call', CANVAS_DAY_ANCHOR),
    ];
    expect(orderCanvasEvents(events).map(e => e.kind)).toEqual([
      'setup', 'briefing', 'money', 'missed-call', 'suggestion', 'message',
    ]);
  });

  it('orders real timestamps ascending ahead of kind rank', () => {
    const early = ev('message:1', 'message', 1_000);
    const late = ev('briefing:today', 'briefing', 2_000);
    expect(compareCanvasEvents(early, late)).toBeLessThan(0);
    expect(orderCanvasEvents([late, early])).toEqual([early, late]);
  });

  it('day-anchor cards sort ahead of any real timestamp (day segment first)', () => {
    const card = ev('briefing:today', 'briefing', CANVAS_DAY_ANCHOR);
    const message = ev('message:1', 'message', 0);
    expect(orderCanvasEvents([message, card])).toEqual([card, message]);
  });

  it('breaks full ties by id so the order is total and deterministic', () => {
    const a = ev('suggestion:a', 'suggestion', 500);
    const b = ev('suggestion:b', 'suggestion', 500);
    expect(orderCanvasEvents([b, a])).toEqual([a, b]);
    expect(orderCanvasEvents([a, b])).toEqual([a, b]);
  });

  it('never mutates the input array', () => {
    const input = [ev('money:week', 'money', 2), ev('briefing:today', 'briefing', 1)];
    const snapshot = [...input];
    orderCanvasEvents(input);
    expect(input).toEqual(snapshot);
  });

  it('treats a non-finite timestamp as the day anchor', () => {
    const card = ev('money:week', 'money', Number.NaN);
    const message = ev('message:1', 'message', 123);
    expect(orderCanvasEvents([message, card])).toEqual([card, message]);
  });
});

describe('upsertCanvasEvent (the P3 speak-and-show injection point)', () => {
  it('inserts a timestamped card into the middle of the message segment', () => {
    const stream = [
      ev('message:1', 'message', 100),
      ev('message:2', 'message', 300),
    ];
    const next = upsertCanvasEvent(stream, ev('missed-call:c9', 'missed-call', 200));
    expect(next.map(e => e.id)).toEqual(['message:1', 'missed-call:c9', 'message:2']);
    expect(stream).toHaveLength(2); // original untouched
  });

  it('replaces an event with the same id instead of duplicating it', () => {
    const stream = [ev('suggestion:s1', 'suggestion', CANVAS_DAY_ANCHOR)];
    const next = upsertCanvasEvent(stream, ev('suggestion:s1', 'suggestion', CANVAS_DAY_ANCHOR));
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('suggestion:s1');
  });
});

describe('canvasEventId / orderCanvasDayCards', () => {
  it('builds stable kind:key ids', () => {
    expect(canvasEventId('missed-call', 'abc')).toBe('missed-call:abc');
    expect(canvasEventId('briefing', 'today')).toBe('briefing:today');
  });

  it('returns the card lane kinds in canvas order regardless of input order', () => {
    expect(orderCanvasDayCards(['suggestion', 'missed-call', 'money', 'briefing']))
      .toEqual(['briefing', 'money', 'missed-call', 'suggestion']);
    expect(orderCanvasDayCards(['briefing', 'money', 'missed-call', 'suggestion']))
      .toEqual(['briefing', 'money', 'missed-call', 'suggestion']);
  });
});

describe('selectMissedCallHighlights', () => {
  const call = (id: string, occurred_at: string, textback_sent_at: string | null = null): MissedCallLike => ({
    id, caller_number: '+15550130000', occurred_at, textback_sent_at,
    reply_received_at: null, booking_id: null, status: 'missed',
  });

  it('keeps only calls with no text-back yet, newest first', () => {
    const calls = [
      call('old', '2026-10-12T08:00:00Z'),
      call('done', '2026-10-12T11:00:00Z', '2026-10-12T11:05:00Z'),
      call('new', '2026-10-12T10:00:00Z'),
      call('mid', '2026-10-12T09:00:00Z'),
    ];
    expect(selectMissedCallHighlights(calls).map(c => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('caps the highlights at the limit (default 3)', () => {
    const calls = ['a', 'b', 'c', 'd'].map((id, i) => call(id, `2026-10-12T0${i}:00:00Z`));
    expect(selectMissedCallHighlights(calls)).toHaveLength(3);
    expect(selectMissedCallHighlights(calls, 2).map(c => c.id)).toEqual(['d', 'c']);
    expect(selectMissedCallHighlights(calls, 0)).toEqual([]);
  });

  it('sorts unparseable timestamps last but still shows the call', () => {
    const calls = [call('bad', 'not-a-date'), call('good', '2026-10-12T09:00:00Z')];
    expect(selectMissedCallHighlights(calls).map(c => c.id)).toEqual(['good', 'bad']);
  });

  it('returns an empty list when every call already got a text-back', () => {
    const calls = [call('a', '2026-10-12T09:00:00Z', '2026-10-12T09:01:00Z')];
    expect(selectMissedCallHighlights(calls)).toEqual([]);
  });
});

describe('missedCallEvent', () => {
  it('carries the call id and its real timestamp for stream placement', () => {
    const event = missedCallEvent({
      id: 'c1', caller_number: '+15550130000', occurred_at: '2026-10-12T09:00:00Z',
      textback_sent_at: null, reply_received_at: null, booking_id: null, status: 'missed',
    });
    expect(event).toEqual({ id: 'missed-call:c1', kind: 'missed-call', at: Date.parse('2026-10-12T09:00:00Z') });
  });

  it('falls back to the day anchor for an unparseable timestamp', () => {
    const event = missedCallEvent({
      id: 'c2', caller_number: '+15550130000', occurred_at: 'nope',
      textback_sent_at: null, reply_received_at: null, booking_id: null, status: 'missed',
    });
    expect(event.at).toBe(CANVAS_DAY_ANCHOR);
  });
});
