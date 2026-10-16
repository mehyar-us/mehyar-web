import type { AccountCardsProps } from './account-cards';

/** Thin loader (mirrors trendpost-loader): the React account-cards chunk
 * loads only when the Settings view first renders its cards. */
let loaded: Promise<typeof import('./account-cards')> | null = null;

export function loadAccountCards(element: HTMLElement, props: AccountCardsProps): void {
  loaded ??= import('./account-cards');
  void loaded
    .then((module) => module.mountAccountCards(element, props))
    .catch(() => { /* a failed chunk leaves the cards out; next visit retries */ });
}
