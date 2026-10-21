import type { AccountCardsProps } from './account-cards';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React account-cards chunk
 * loads only when the Settings view first renders its cards. DEF-037:
 * the chunk promise comes from lazyModule, so a failed load clears the
 * cache and the next render retries instead of losing the island for
 * the whole session. */
const chunk = lazyModule(() => import('./account-cards'));

export function loadAccountCards(element: HTMLElement, props: AccountCardsProps): void {
  void chunk.get()
    .then((module) => module.mountAccountCards(element, props))
    .catch(() => { /* a failed chunk leaves the cards out; next visit retries */ });
}
