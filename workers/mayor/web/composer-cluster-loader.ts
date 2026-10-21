import type { ComposerClusterProps } from './composer-cluster';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React composer-cluster
 * chunk loads with the first composer render, keeping react-dom out of
 * the initial app-shell bundle. DEF-037: the chunk promise comes from
 * lazyModule, so a failed load clears the cache and the next render
 * retries instead of losing the island for the whole session. */
const chunk = lazyModule(() => import('./composer-cluster'));

export function loadComposerCluster(element: HTMLElement, props: ComposerClusterProps): void {
  void chunk.get()
    .then((module) => module.mountComposerCluster(element, props))
    .catch(() => { /* a failed chunk leaves the cluster out; next push retries */ });
}
