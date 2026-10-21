import type { ConnectionsHubProps } from './connections-hub';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React connections-hub
 * chunk loads on the first hub render, keeping react-dom out of the
 * initial app-shell bundle. Calls queue in order on the shared chunk
 * promise, so the latest view always wins. DEF-037: the chunk promise
 * comes from lazyModule, so a failed load clears the cache and the
 * next push retries instead of losing the island for the whole
 * session. */
const chunk = lazyModule(() => import('./connections-hub'));

export function loadConnectionsHub(element: HTMLElement, props: ConnectionsHubProps): void {
  void chunk.get()
    .then((module) => module.mountConnectionsHub(element, props))
    .catch(() => { /* a failed chunk leaves the hub out; next push retries */ });
}

export function unloadConnectionsHub(element: HTMLElement): void {
  const loaded = chunk.peek();
  if (!loaded) return;
  void loaded
    .then((module) => module.unmountConnectionsHub(element))
    .catch(() => { /* nothing mounted to unload */ });
}
