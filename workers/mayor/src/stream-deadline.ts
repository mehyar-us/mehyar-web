/** Bounds a streamed model response so a stalled provider can never wedge a
 *  voice turn: if no value arrives within `idleMs`, or the stream runs past
 *  `totalMs` overall, iteration fails with a StreamDeadlineError and the
 *  source is closed. Healthy streams pass through untouched. */

export class StreamDeadlineError extends Error {
  readonly kind: 'idle' | 'total';
  constructor(kind: 'idle' | 'total') {
    super(`stream_${kind}_deadline`);
    this.name = 'StreamDeadlineError';
    this.kind = kind;
  }
}

export interface StreamDeadlineOptions {
  idleMs: number;
  totalMs: number;
  /** Called once, with the deadline kind, just before the error is thrown —
   *  the place to abort the underlying provider request. */
  onTimeout?: (kind: 'idle' | 'total') => void;
}

export async function* withStreamDeadline<T>(
  source: AsyncIterable<T>,
  options: StreamDeadlineOptions,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const startedAt = Date.now();
  let closed = false;
  const closeSource = () => {
    if (closed) return;
    closed = true;
    // Fire-and-forget: a wedged source may never answer return() either, and
    // awaiting it would re-create the hang this helper exists to prevent.
    try {
      void Promise.resolve(iterator.return?.()).catch(() => {});
    } catch { /* a hostile iterator must not break deadline handling */ }
  };
  try {
    for (;;) {
      const remainingTotal = options.totalMs - (Date.now() - startedAt);
      if (remainingTotal <= 0) {
        options.onTimeout?.('total');
        throw new StreamDeadlineError('total');
      }
      const waitMs = Math.min(options.idleMs, remainingTotal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<'deadline'>(resolve => {
        timer = setTimeout(() => resolve('deadline'), waitMs);
      });
      const next = iterator.next();
      // If the deadline wins, the pending next() may reject later (e.g. the
      // source was aborted); that rejection is expected and handled here.
      next.catch(() => {});
      const outcome = await Promise.race([next.then(step => ({ step })), deadline]);
      if (timer !== undefined) clearTimeout(timer);
      if (outcome === 'deadline') {
        const kind = Date.now() - startedAt >= options.totalMs ? 'total' : 'idle';
        options.onTimeout?.(kind);
        throw new StreamDeadlineError(kind);
      }
      const step = (outcome as { step: IteratorResult<T> }).step;
      if (step.done) return;
      yield step.value;
    }
  } finally {
    closeSource();
  }
}
