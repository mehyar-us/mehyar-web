import type { NotificationsInboxProps } from './notifications-inbox';

/** Thin loader (mirrors trendpost-loader): the React notifications-inbox
 * chunk loads on the first inbox render, keeping react-dom out of the
 * initial app-shell bundle. */
let loaded: Promise<typeof import('./notifications-inbox')> | null = null;

export function loadNotificationsInbox(element: HTMLElement, props: NotificationsInboxProps): void {
  loaded ??= import('./notifications-inbox');
  void loaded
    .then((module) => module.mountNotificationsInbox(element, props))
    .catch(() => { /* a failed chunk leaves the inbox out; next push retries */ });
}
