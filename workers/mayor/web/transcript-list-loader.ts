import type { TranscriptListProps } from './transcript-list';

/** Thin loader (mirrors trendpost-loader): the React transcript chunk
 * loads with the first transcript render. Every call re-mounts with the
 * caller's full row model, and calls queue in order on the shared chunk
 * promise, so the latest model always wins. */
let loaded: Promise<typeof import('./transcript-list')> | null = null;

export function loadTranscriptList(element: HTMLElement, props: TranscriptListProps): void {
  loaded ??= import('./transcript-list');
  void loaded
    .then((module) => module.mountTranscriptList(element, props))
    .catch(() => { /* a failed chunk leaves the list as-is; next render retries */ });
}
