import { describe, expect, it } from 'vitest';
import { COUNT_UP_DURATION_MS, countUpEase, countUpValueAt, startCountUp } from '../web/count-up';

describe('countUpValueAt — framing math', () => {
  it('starts exactly at from and lands exactly on the real value', () => {
    expect(countUpValueAt(0, 12500, 0)).toBe(0);
    expect(countUpValueAt(0, 12500, COUNT_UP_DURATION_MS)).toBe(12500);
    expect(countUpValueAt(0, 12500, COUNT_UP_DURATION_MS * 3)).toBe(12500);
    expect(countUpValueAt(500, 900, -50)).toBe(500);
  });

  it('stays inside the from→to range and moves monotonically', () => {
    let previous = -Infinity;
    for (let elapsed = 0; elapsed <= COUNT_UP_DURATION_MS; elapsed += 40) {
      const value = countUpValueAt(0, 700, elapsed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(700);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBe(700);
  });

  it('counts DOWN when the real value dropped, still landing exactly', () => {
    expect(countUpValueAt(900, 300, COUNT_UP_DURATION_MS)).toBe(300);
    const mid = countUpValueAt(900, 300, COUNT_UP_DURATION_MS / 2);
    expect(mid).toBeLessThan(900);
    expect(mid).toBeGreaterThan(300);
  });

  it('always returns integers (no fractional bookings or sub-cent frames)', () => {
    for (let elapsed = 0; elapsed < COUNT_UP_DURATION_MS; elapsed += 37) {
      expect(Number.isInteger(countUpValueAt(0, 12345, elapsed))).toBe(true);
    }
  });

  it('the real value wins over broken inputs (zero duration, NaN)', () => {
    expect(countUpValueAt(0, 42, 100, 0)).toBe(42);
    expect(countUpValueAt(Number.NaN, 42, 100)).toBe(42);
    expect(countUpValueAt(0, Number.NaN, 100)).toBeNaN(); // to itself is the (broken) input — callers never pass it
  });

  it('eases out: most of the distance is covered early, then it settles', () => {
    expect(countUpEase(0)).toBe(0);
    expect(countUpEase(1)).toBe(1);
    expect(countUpEase(0.5)).toBeGreaterThan(0.5);
    expect(countUpEase(-1)).toBe(0);
    expect(countUpEase(2)).toBe(1);
  });

  it('the default duration respects the <1s animation budget', () => {
    expect(COUNT_UP_DURATION_MS).toBeLessThan(1000);
    expect(COUNT_UP_DURATION_MS).toBeGreaterThan(0);
  });
});

/** A controllable rAF + clock: frames fire only when the test pumps them. */
function fakeClock() {
  let time = 0;
  const queue = new Map<number, (t: number) => void>();
  let nextHandle = 1;
  return {
    now: () => time,
    raf: (cb: (t: number) => void) => { const handle = nextHandle++; queue.set(handle, cb); return handle; },
    cancelRaf: (handle: number) => { queue.delete(handle); },
    pump(elapsedMs: number) {
      time += elapsedMs;
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb(time);
    },
    get pendingFrames() { return queue.size; },
  };
}

describe('startCountUp — driver', () => {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  it('renders eased frames then exactly one final frame with the real value', () => {
    const clock = fakeClock();
    const frames: Array<[string, string]> = [];
    const handle = startCountUp({
      from: 0, to: 10000, durationMs: 800, format: money,
      render: (text, phase) => frames.push([text, phase]),
      raf: clock.raf, cancelRaf: clock.cancelRaf, now: clock.now,
    });
    expect(frames[0]).toEqual(['$0.00', 'animating']);
    clock.pump(400);
    expect(frames.at(-1)?.[1]).toBe('animating');
    expect(frames.at(-1)?.[0]).not.toBe('$100.00');
    clock.pump(400);
    expect(frames.at(-1)).toEqual(['$100.00', 'final']);
    expect(frames.filter(([, phase]) => phase === 'final')).toHaveLength(1);
    expect(handle.done).toBe(true);
    clock.pump(400); // no late frames after completion
    expect(frames.filter(([, phase]) => phase === 'final')).toHaveLength(1);
  });

  it('cancel (barge-in) snaps to the final real value and stops all frames', () => {
    const clock = fakeClock();
    const frames: Array<[string, string]> = [];
    const handle = startCountUp({
      from: 0, to: 5000, durationMs: 800, format: money,
      render: (text, phase) => frames.push([text, phase]),
      raf: clock.raf, cancelRaf: clock.cancelRaf, now: clock.now,
    });
    clock.pump(200);
    handle.cancel();
    // The card left on screen shows the REAL figure, never an intermediate.
    expect(frames.at(-1)).toEqual(['$50.00', 'final']);
    expect(handle.done).toBe(true);
    const rendered = frames.length;
    clock.pump(1000);
    expect(frames).toHaveLength(rendered); // nothing renders after cancel
    handle.cancel(); // idempotent
    expect(frames).toHaveLength(rendered);
  });

  it('reduced motion renders the final value instantly, with no animation frames', () => {
    const frames: Array<[string, string]> = [];
    const handle = startCountUp({
      from: 0, to: 2500, format: money, reducedMotion: true,
      render: (text, phase) => frames.push([text, phase]),
    });
    expect(frames).toEqual([['$25.00', 'final']]);
    expect(handle.done).toBe(true);
  });

  it('from === to renders final only (a refresh with the same real value does not animate)', () => {
    const frames: Array<[string, string]> = [];
    startCountUp({ from: 700, to: 700, format: money, render: (text, phase) => frames.push([text, phase]) });
    expect(frames).toEqual([['$7.00', 'final']]);
  });
});
