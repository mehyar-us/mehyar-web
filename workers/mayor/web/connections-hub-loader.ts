import type { ConnectionsHubProps } from './connections-hub';

/** Thin loader (mirrors trendpost-loader): the React connections-hub
 * chunk loads on the first hub render, keeping react-dom out of the
 * initial app-shell bundle. Calls queue in order on the shared chunk
 * promise, so the latest view always wins. */
let loaded: Promise<typeof import('./connections-hub')> | null = null;

export function loadConnectionsHub(element: HTMLElement, props: ConnectionsHubProps): void {
  loaded ??= import('./connections-hub');
  void loaded
    .then((module) => module.mountConnectionsHub(element, props))
    .catch(() => { /* a failed chunk leaves the hub out; next push retries */ });
}

export function unloadConnectionsHub(element: HTMLElement): void {
  if (!loaded) return;
  void loaded
    .then((module) => module.unmountConnectionsHub(element))
    .catch(() => { /* nothing mounted to unload */ });
}
