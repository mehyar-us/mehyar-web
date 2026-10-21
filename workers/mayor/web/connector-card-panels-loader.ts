import type { ConnectorCardHooks, ConnectorCardPayload } from './connector-card-panels';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React connector-card
 * chunk loads on the first card render, keeping react-dom out of the
 * initial app-shell bundle. DEF-037: the chunk promise comes from
 * lazyModule, so a failed load clears the cache and the next card
 * retries instead of losing the island for the whole session. */
const chunk = lazyModule(() => import('./connector-card-panels'));

export function loadConnectorCardPanels(element: HTMLElement, card: ConnectorCardPayload, hooks: ConnectorCardHooks): void {
  void chunk.get()
    .then((module) => module.mountConnectorCard(element, card, hooks))
    .catch(() => { /* a failed chunk leaves the card empty; the next card retries */ });
}
