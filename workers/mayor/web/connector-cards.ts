/**
 * Crew 6h — in-conversation connector cards.
 *
 * Renders the `connector_card` chat events the worker emits during a turn
 * (see src/connector-cards.ts). Inserted right after the transcript so the
 * card pops up in the chat flow.
 *
 * React migration S5b: the card itself is a React 19 component
 * (./connector-card-panels, loaded lazily through
 * ./connector-card-panels-loader so react-dom stays out of the initial
 * bundle). This module keeps the synchronous contract — it creates the
 * host element with its classes/ARIA and returns it for the caller to
 * insert; the panels chunk fills it in.
 *
 * SECRET BOUNDARY (compliance-critical): the key capture form posts the
 * secret DIRECTLY to /connections/add, which encrypts it at rest. The secret
 * never goes into chat text, never reaches the model, and the input is
 * cleared from the DOM the moment the save finishes. Masked display after
 * save ("••••1234") is computed from the value the owner just typed — it is
 * never persisted or logged.
 *
 * Accessibility: real <button>s, native <details> for the guide, a real
 * <form> with labels, aria-live status for save results.
 */
import './connector-cards.css';
import { loadConnectorCardPanels } from './connector-card-panels-loader';
import type { ConnectorCardHooks, ConnectorCardPayload } from './connector-card-panels';

export type { ConnectorCardAction, ConnectorCardHooks, ConnectorCardPayload } from './connector-card-panels';

/** Render one connector card. Returns the root element; the caller inserts it. */
export function renderConnectorCard(card: ConnectorCardPayload, hooks: ConnectorCardHooks): HTMLElement {
  const root = document.createElement('div');
  root.className = 'account-card connector-card';
  root.dataset.cardId = card.id;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', card.title);
  loadConnectorCardPanels(root, card, hooks);
  return root;
}

/** Minimal shape check before rendering an event payload. */
export function isConnectorCardPayload(value: unknown): value is ConnectorCardPayload {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  return typeof card.id === 'string' && typeof card.title === 'string' && typeof card.body === 'string'
    && ['offer', 'guide', 'credential', 'reconnect', 'oauth', 'status'].includes(card.kind as string)
    && Array.isArray(card.actions);
}
