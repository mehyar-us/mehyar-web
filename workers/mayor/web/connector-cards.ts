/**
 * Crew 6h — in-conversation connector cards.
 *
 * Renders the `connector_card` chat events the worker emits during a turn
 * (see src/connector-cards.ts). Inserted right after the transcript so the
 * card pops up in the chat flow.
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

export interface ConnectorCardAction {
  id: 'connect_oauth' | 'show_guide' | 'enter_key' | 'reconnect' | 'dismiss' | 'open_connections';
  label: string;
  provider?: 'google' | 'microsoft' | 'zoho';
  capabilities?: string[];
  endpoint?: string;
}
export interface ConnectorCardPayload {
  id: string;
  kind: 'offer' | 'guide' | 'credential' | 'reconnect' | 'oauth';
  service: string;
  name: string;
  title: string;
  body: string;
  unlocks?: string;
  guide?: { steps: string[]; note?: string; docUrl?: string };
  endpoint?: string;
  actions: ConnectorCardAction[];
  state: string;
}
export interface ConnectorCardHooks {
  api: (path: string, body?: unknown) => Promise<any>;
  tenant: () => string;
  signIn: (provider: string, capabilities: string[]) => Promise<void>;
  onNotice: (message: string) => void;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
};
const button = (label: string, action: () => void, className = 'secondary') => {
  const el = node('button', label, className);
  el.type = 'button';
  el.onclick = action;
  return el;
};
const maskTail = (secret: string) => '••••' + secret.slice(-4);

/** Render one connector card. Returns the root element; the caller inserts it. */
export function renderConnectorCard(card: ConnectorCardPayload, hooks: ConnectorCardHooks): HTMLElement {
  const root = node('div', '', 'account-card connector-card');
  root.dataset.cardId = card.id;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', card.title);

  const head = node('div', '', 'connector-card-head');
  head.append(node('h2', card.title));
  const dismiss = button('Not now', () => root.remove(), 'quiet');
  dismiss.setAttribute('aria-label', 'Dismiss this card');
  head.append(dismiss);
  root.append(head);
  root.append(node('p', card.body, 'connector-card-body'));
  if (card.unlocks && card.kind === 'offer') root.append(node('p', card.unlocks, 'connector-card-unlocks'));

  const actions = node('div', '', 'connector-card-actions');
  root.append(actions);

  const status = node('p', '', 'connector-card-status');
  status.setAttribute('aria-live', 'polite');
  root.append(status);

  const showGuide = () => {
    actions.replaceChildren();
    const details = node('details', '', 'connector-guide');
    details.open = true;
    const summary = node('summary', `Getting your ${card.name} key`);
    details.append(summary);
    if (card.guide) {
      const list = node('ol', '');
      for (const step of card.guide.steps) list.append(node('li', step));
      details.append(list);
      if (card.guide.note) details.append(node('p', card.guide.note, 'connector-card-note'));
      if (card.guide.docUrl) {
        const link = node('a', `${card.name} documentation`);
        (link as HTMLAnchorElement).href = card.guide.docUrl;
        (link as HTMLAnchorElement).target = '_blank';
        (link as HTMLAnchorElement).rel = 'noopener noreferrer';
        details.append(link);
      }
    }
    root.insertBefore(details, actions);
    const again = button('Show steps', () => { details.open = !details.open; }, 'quiet');
    actions.append(button('I have my key', showCapture, 'primary'), again);
  };

  const showCapture = () => {
    actions.replaceChildren();
    const form = node('form', '', 'connector-capture-form');
    const keyLabel = node('label', '', 'connector-field');
    keyLabel.append(node('span', `Your ${card.name} key`));
    const keyInput = node('input', '') as HTMLInputElement;
    keyInput.type = 'password';
    keyInput.required = true;
    keyInput.minLength = 8;
    keyInput.maxLength = 4096;
    keyInput.autocomplete = 'new-password';
    keyInput.spellcheck = false;
    keyInput.placeholder = 'Paste your key here';
    keyLabel.append(keyInput);
    const endpointLabel = node('label', '', 'connector-field');
    endpointLabel.append(node('span', 'API endpoint'));
    const endpointInput = node('input', '') as HTMLInputElement;
    endpointInput.type = 'url';
    endpointInput.required = true;
    endpointInput.maxLength = 2048;
    endpointInput.value = card.endpoint ?? 'https://';
    endpointLabel.append(endpointInput);
    form.append(keyLabel, endpointLabel);
    form.append(node('p', 'Your key goes straight to secure encrypted storage. It never appears in this chat.', 'connector-card-note'));
    const row = node('div', '', 'connector-card-actions');
    const save = button('Save key', () => form.requestSubmit(), 'primary');
    const back = button('Back', showGuide, 'quiet');
    row.append(save, back);
    form.append(row);
    actions.append(form);
    keyInput.focus();

    form.onsubmit = event => {
      event.preventDefault();
      save.disabled = true;
      status.textContent = 'Saving…';
      void (async () => {
        const requestId = crypto.randomUUID();
        const body = {
          requestId,
          label: `${card.name} connection`,
          type: 'api',
          endpoint: endpointInput.value.trim(),
          authentication: 'api_key',
          secret: keyInput.value,
        };
        try {
          // Secret travels in the POST body to the encrypted store only.
          const result = await hooks.api(`/api/businesses/${encodeURIComponent(hooks.tenant())}/connections/add`, body);
          const masked = maskTail(keyInput.value);
          // Clear the DOM immediately: nothing secret lingers in the page.
          keyInput.value = '';
          (body as { secret?: string }).secret = '';
          root.replaceChildren();
          root.append(node('h2', `${card.name} connected`));
          root.append(node('p', `Your key is saved in secure storage and will never be shown again (${masked}).`, 'connector-card-body'));
          root.append(button('View in Connections', () => document.getElementById('open-connections')?.click(), 'secondary'));
          hooks.onNotice(`${card.name} connected. Key saved securely.`);
          void result;
        } catch (error) {
          keyInput.value = '';
          status.textContent = error instanceof Error ? error.message : 'The key could not be saved. Please try again.';
          save.disabled = false;
        }
      })();
    };
  };

  const connectOAuth = (action: ConnectorCardAction) => {
    if (!action.provider) return;
    status.textContent = 'Opening secure sign-in…';
    void hooks.signIn(action.provider, action.capabilities ?? []).catch(() => {
      status.textContent = 'Sign-in could not start. Please try again.';
    });
  };

  for (const action of card.actions ?? []) {
    switch (action.id) {
      case 'connect_oauth':
      case 'reconnect':
        actions.append(button(action.label, () => connectOAuth(action), 'primary'));
        break;
      case 'show_guide':
        actions.append(button(action.label, showGuide, 'secondary'));
        break;
      case 'enter_key':
        actions.append(button(action.label, showCapture, 'secondary'));
        break;
      case 'open_connections':
        actions.append(button(action.label, () => document.getElementById('open-connections')?.click(), 'secondary'));
        break;
      case 'dismiss':
        break; // the header "Not now" covers it; avoid a duplicate button
    }
  }

  // Pre-expand the teaching path for guide-kind cards.
  if (card.kind === 'guide') showGuide();
  if (card.kind === 'credential') showCapture();

  return root;
}

/** Minimal shape check before rendering an event payload. */
export function isConnectorCardPayload(value: unknown): value is ConnectorCardPayload {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  return typeof card.id === 'string' && typeof card.title === 'string' && typeof card.body === 'string'
    && ['offer', 'guide', 'credential', 'reconnect', 'oauth'].includes(card.kind as string)
    && Array.isArray(card.actions);
}
