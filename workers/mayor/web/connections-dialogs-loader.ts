import type { ConnectionsDialogProps } from './connections-dialogs';

/** Thin loader (mirrors trendpost-loader): the React connections-dialog
 * chunk loads on the first dialog open, keeping react-dom out of the
 * initial app-shell bundle. Calls queue in order on the shared chunk
 * promise, so the latest screen always wins. */
let loaded: Promise<typeof import('./connections-dialogs')> | null = null;

export function loadConnectionsDialogs(element: HTMLElement, props: ConnectionsDialogProps): void {
  loaded ??= import('./connections-dialogs');
  void loaded
    .then((module) => module.mountConnectionsDialog(element, props))
    .catch(() => { /* a failed chunk leaves the dialog empty; the next push retries */ });
}

export function unloadConnectionsDialogs(element: HTMLElement): void {
  if (!loaded) return;
  void loaded
    .then((module) => module.unmountConnectionsDialog(element))
    .catch(() => { /* nothing mounted to unload */ });
}
