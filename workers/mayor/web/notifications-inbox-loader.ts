import type { NotificationsInboxProps } from './notifications-inbox';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React notifications-inbox
 * chunk loads on the first inbox render, keeping react-dom out of the
 * initial app-shell bundle. DEF-037: the chunk promise comes from
 * lazyModule, so a failed load clears the cache and the next render
 * retries instead of losing the island for the whole session. */
const chunk = lazyModule(() => import('./notifications-inbox'));

export function loadNotificationsInbox(element: HTMLElement, props: NotificationsInboxProps): void {
  void chunk.get()
    .then((module) => module.mountNotificationsInbox(element, props))
    .catch(() => { /* a failed chunk leaves the inbox out; next push retries */ });
}
