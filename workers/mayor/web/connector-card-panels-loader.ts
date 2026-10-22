import type { ConnectorCardHooks, ConnectorCardPayload } from './connector-card-panels';

/** Thin loader (mirrors trendpost-loader): the React connector-card
 * chunk loads on the first card render, keeping react-dom out of the
 * initial app-shell bundle. */
let loaded: Promise<typeof import('./connector-card-panels')> | null = null;

export function loadConnectorCardPanels(element: HTMLElement, card: ConnectorCardPayload, hooks: ConnectorCardHooks): void {
  loaded ??= import('./connector-card-panels');
  void loaded
    .then((module) => module.mountConnectorCard(element, card, hooks))
    .catch(() => { /* a failed chunk leaves the card empty; the next card retries */ });
}
