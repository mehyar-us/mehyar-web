import type { ComposerClusterProps } from './composer-cluster';

/** Thin loader (mirrors trendpost-loader): the React composer-cluster
 * chunk loads with the first composer render, keeping react-dom out of
 * the initial app-shell bundle. */
let loaded: Promise<typeof import('./composer-cluster')> | null = null;

export function loadComposerCluster(element: HTMLElement, props: ComposerClusterProps): void {
  loaded ??= import('./composer-cluster');
  void loaded
    .then((module) => module.mountComposerCluster(element, props))
    .catch(() => { /* a failed chunk leaves the cluster out; next push retries */ });
}
