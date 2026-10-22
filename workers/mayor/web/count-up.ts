/**
 * Count-up animation — pure math + a thin rAF driver (P3 speak-and-show).
 * ============================================================================
 * Vision (docs/mayor-vision.md, "Visual direction"): "a revenue number
 * counts up as it's spoken" — and every animation earns its milliseconds:
 * under 1s total, and interruption stops it immediately.
 *
 * Honesty rules baked into this module:
 *  - The FINAL value is the only real data. Intermediate frames are a
 *    visual transition, never data: callers put the real value in the
 *    element's aria-label from the first frame and keep the animated text
 *    aria-hidden until the final frame lands (see web/speak-show.ts and
 *    the money card in web/proactive-ui.ts).
 *  - Cancelling (barge-in) SNAPS to the final real value — a card left
 *    mid-animation must never sit displaying an intermediate number as if
 *    it were the figure.
 *  - prefers-reduced-motion (or an explicit reducedMotion flag) skips the
 *    animation entirely: the final value renders instantly.
 *
 * Values are integers in their own unit (cents for money, whole counts for
 * bookings) — frames round to integers so a count-up never flashes a
 * fractional booking or a sub-cent figure.
 */

/** Default count-up duration — comfortably inside the <1s budget. */
export const COUNT_UP_DURATION_MS = 800;

/** easeOutCubic: fast start, gentle settle into the real value. */
export function countUpEase(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - p, 3);
}

/**
 * The value to display at `elapsedMs` into an animation from `from` to `to`.
 * Clamped at both ends; at (or past) the duration the result is EXACTLY `to`.
 * Works in either direction (a figure can count down when the real value
 * dropped). Non-finite inputs collapse to `to` — the real value always wins.
 */
export function countUpValueAt(from: number, to: number, elapsedMs: number, durationMs: number = COUNT_UP_DURATION_MS): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return to;
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  if (elapsedMs <= 0) return Math.round(from);
  const eased = countUpEase(elapsedMs / durationMs);
  return Math.round(from + (to - from) * eased);
}

/** True when the OS/browser asks for reduced motion. Guarded for non-DOM tests. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface CountUpOptions {
  from: number;
  to: number;
  durationMs?: number;
  /** Format an integer value (in its own unit) for display. */
  format: (value: number) => string;
  /**
   * Paint one frame. phase 'final' fires exactly once, with the real value,
   * when the animation completes OR is cancelled OR reduced motion applies.
   */
  render: (text: string, phase: 'animating' | 'final') => void;
  reducedMotion?: boolean;
  /** Injectable clock/scheduler for tests; defaults to rAF + performance.now. */
  raf?: (callback: (time: number) => void) => number;
  cancelRaf?: (handle: number) => void;
  now?: () => number;
}

export interface CountUpHandle {
  /** Stop animating NOW and snap to the final real value. Idempotent. */
  cancel: () => void;
  readonly done: boolean;
}

/**
 * Animate a number from `from` to `to`. Returns a handle whose cancel()
 * is the interruption path: synchronous, final-value snap, no late frames
 * (a frame already queued in rAF is dropped by the done flag).
 */
export function startCountUp(options: CountUpOptions): CountUpHandle {
  const duration = options.durationMs ?? COUNT_UP_DURATION_MS;
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const raf = options.raf ?? ((cb: (time: number) => void) => requestAnimationFrame(cb));
  const cancelRaf = options.cancelRaf ?? ((handle: number) => cancelAnimationFrame(handle));
  const now = options.now ?? (() => performance.now());
  let done = false;
  let frame = 0;
  const finish = () => {
    if (done) return;
    done = true;
    if (frame) cancelRaf(frame);
    options.render(options.format(options.to), 'final');
  };
  if (reduced || !(duration > 0) || options.from === options.to) {
    // No animation: still go through render-final so callers have exactly
    // one code path for "the real value is on screen now".
    done = true;
    options.render(options.format(options.to), 'final');
    return { cancel: () => {}, get done() { return done; } };
  }
  const start = now();
  const step = () => {
    if (done) return;
    const elapsed = now() - start;
    if (elapsed >= duration) { finish(); return; }
    options.render(options.format(countUpValueAt(options.from, options.to, elapsed, duration)), 'animating');
    frame = raf(step);
  };
  options.render(options.format(countUpValueAt(options.from, options.to, 0, duration)), 'animating');
  frame = raf(step);
  return {
    cancel: () => { if (!done) { done = true; cancelRaf(frame); options.render(options.format(options.to), 'final'); } },
    get done() { return done; },
  };
}
