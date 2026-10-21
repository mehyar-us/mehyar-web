import type { ConnectionsDialogProps } from './connections-dialogs';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React connections-dialog
 * chunk loads on the first dialog open, keeping react-dom out of the
 * initial app-shell bundle. Calls queue in order on the shared chunk
 * promise, so the latest screen always wins. DEF-037: the chunk
 * promise comes from lazyModule, so a failed load clears the cache
 * and the next push retries instead of losing the island for the
 * whole session. */
const chunk = lazyModule(() => import('./connections-dialogs'));

export function loadConnectionsDialogs(element: HTMLElement, props: ConnectionsDialogProps): void {
  void chunk.get()
    .then((module) => module.mountConnectionsDialog(element, props))
    .catch(() => { /* a failed chunk leaves the dialog empty; the next push retries */ });
}

export function unloadConnectionsDialogs(element: HTMLElement): void {
  const loaded = chunk.peek();
  if (!loaded) return;
  void loaded
    .then((module) => module.unmountConnectionsDialog(element))
    .catch(() => { /* nothing mounted to unload */ });
}
