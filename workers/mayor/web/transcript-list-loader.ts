import type { TranscriptListProps } from './transcript-list';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React transcript chunk
 * loads with the first transcript render. Every call re-mounts with the
 * caller's full row model, and calls queue in order on the shared chunk
 * promise, so the latest model always wins. DEF-037: the chunk promise
 * comes from lazyModule, so a failed load clears the cache and the
 * next render retries instead of losing the island for the whole
 * session. */
const chunk = lazyModule(() => import('./transcript-list'));

export function loadTranscriptList(element: HTMLElement, props: TranscriptListProps): void {
  void chunk.get()
    .then((module) => module.mountTranscriptList(element, props))
    .catch(() => { /* a failed chunk leaves the list as-is; next render retries */ });
}
