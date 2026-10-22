/** Social connectors UI: connect cards for Instagram/Facebook/TikTok/X.
 * Read-only where connected; publishing stays visibly test-gated until the
 * MehyarSoft app review is approved. Mounted by the integrator via
 * mountSocialConnectors() — web/main.ts is not touched by this workstream. */
import './social-connectors.css';

export type SocialConnectorsHooks = {
  api: (path: string, body?: unknown) => Promise<any>;
  tenant: () => string;
  canManage: () => boolean;
};

type Card = {
  provider: string; name: string; icon: string; enables: string;
  permissions: string; publishNote: string; capabilities: string[];
  connection: null | {
    id: string; label: string; status: string; hasSecret: boolean; revision: number;
    lastCheckedAt: string | null; lastCheckStatus: string | null; reconnectRequired: boolean;
  };
};
type PublishRecord = {
  id: string; status: string; providerPostId: string | null; note: string; createdAt: string; caption: string;
};

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const el = document.createElement(tag); el.textContent = text; el.className = className; return el;
};
const button = (label: string, action: () => void, className = 'secondary', ariaLabel?: string) => {
  const el = node('button', label, className); el.type = 'button'; el.onclick = action;
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  return el;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : 'This could not finish. Please try again.';
const dateText = (value: string | null) => {
  if (!value) return 'Never';
  const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Unavailable';
};
const statusLabel: Record<string, string> = {
  connected: 'Connected', pending: 'Connection pending', error: 'Needs attention',
  disconnected: 'Disconnected',
};

export function mountSocialConnectors(hooks: SocialConnectorsHooks): HTMLElement {
  const element = node('section', '', 'social-connectors');
  element.setAttribute('aria-label', 'Social connectors');
  let epoch = 0, active = false, gateOpen = false, cards: Card[] = [], captions: Record<string, string> = {};
  let histories: Record<string, PublishRecord[]> = {}, busy: Record<string, boolean> = {};

  const base = () => `/api/businesses/${encodeURIComponent(hooks.tenant())}/social`;
  const announce = (message: string) => {
    const status = element.querySelector<HTMLElement>('.social-status');
    if (status) { status.textContent = message; status.setAttribute('role', 'status'); }
  };
  const setBusy = (key: string, value: boolean) => { busy[key] = value; render(); };

  async function load() {
    const saved = ++epoch;
    try {
      const data = await hooks.api(`${base()}/connectors?language=en`);
      if (saved !== epoch) return;
      gateOpen = data.publishGateOpen === true;
      cards = data.connectors as Card[];
      announce(data.publishGateOpen ? 'Social connectors loaded.' : 'Social connectors loaded. Publishing is in test mode.');
    } catch (error) {
      if (saved !== epoch) return;
      announce(errorText(error));
    }
    render();
  }

  async function connect(card: Card) {
    setBusy(card.provider, true);
    try {
      const data = await hooks.api(`${base()}/connect/initiate`, { provider: card.provider, language: 'en' });
      const popup = window.open(data.authorizeUrl, 'mayor-social-connect', 'width=560,height=700');
      if (!popup) { announce('Allow popups to connect your account, then try again.'); return; }
      const timer = window.setInterval(async () => {
        if (popup.closed) { window.clearInterval(timer); await load(); announce(`${card.name} connection flow finished. Check the card status.`); }
      }, 800);
    } catch (error) { announce(errorText(error)); }
    finally { setBusy(card.provider, false); }
  }

  async function check(card: Card) {
    const id = card.connection?.id; if (!id) return;
    setBusy(id + ':check', true);
    try {
      const data = await hooks.api(`${base()}/connections/${id}/check`, {});
      const next = data.connection;
      cards = cards.map((c) => c.provider === card.provider ? { ...c, connection: next } : c);
      announce(next.status === 'connected' ? `${card.name} is reachable.` : `${card.name} needs attention. Reconnect to resume.`);
    } catch (error) { announce(errorText(error)); }
    finally { setBusy(id + ':check', false); }
  }

  async function disconnect(card: Card) {
    const conn = card.connection; if (!conn) return;
    if (!window.confirm(`Disconnect ${card.name}? Stored credentials are deleted.`)) return;
    setBusy(conn.id + ':dc', true);
    try {
      await hooks.api(`${base()}/connections/${conn.id}/disconnect`, { revision: conn.revision });
      cards = cards.map((c) => c.provider === card.provider ? { ...c, connection: null } : c);
      announce(`${card.name} disconnected.`);
    } catch (error) { announce(errorText(error)); }
    finally { setBusy(conn.id + ':dc', false); }
  }

  async function readOnly(card: Card, kind: 'profile' | 'posts') {
    const id = card.connection?.id; if (!id) return;
    setBusy(id + ':' + kind, true);
    try {
      const data = await hooks.api(`${base()}/connections/${id}/${kind}${kind === 'posts' ? '?limit=5' : ''}`);
      const pretty = JSON.stringify(kind === 'profile' ? data.profile : data.posts, null, 2);
      announce(`${card.name} ${kind}: ${pretty.slice(0, 300)}`);
    } catch (error) { announce(errorText(error)); }
    finally { setBusy(id + ':' + kind, false); }
  }

  async function testPublish(card: Card) {
    const id = card.connection?.id; if (!id) return;
    const caption = (captions[id] ?? '').trim();
    if (!caption) { announce('Type a caption first to simulate a publish.'); return; }
    setBusy(id + ':pub', true);
    try {
      const data = await hooks.api(`${base()}/connections/${id}/publish`, { caption, language: 'en' });
      const rec = data.publish.record;
      histories[id] = [rec, ...(histories[id] ?? [])].slice(0, 10);
      announce(data.publish.simulated
        ? `Simulated post recorded — nothing was posted to ${card.name}. Status: ${rec.status}.`
        : `Post sent to ${card.name}. Status: ${rec.status}.`);
    } catch (error) { announce(errorText(error)); }
    finally { setBusy(id + ':pub', false); }
  }

  async function loadHistory(card: Card) {
    const id = card.connection?.id; if (!id || histories[id]) return;
    try {
      const data = await hooks.api(`${base()}/connections/${id}/publish-records`);
      histories[id] = (data.records as PublishRecord[]).slice(0, 10);
      render();
    } catch { /* history is best-effort */ }
  }

  function badge(text: string, kind: string) {
    const el = node('span', text, `social-badge social-badge-${kind}`);
    return el;
  }

  function renderCard(card: Card) {
    const wrap = node('article', '', 'social-card');
    const head = node('div', '', 'social-card-head');
    head.append(node('h3', card.name, 'social-card-name'));
    head.append(card.connection
      ? badge(statusLabel[card.connection.status] ?? card.connection.status, card.connection.status === 'connected' ? 'ok' : card.connection.status === 'error' ? 'warn' : 'muted')
      : badge('Not connected', 'muted'));
    wrap.append(head);
    wrap.append(node('p', card.enables, 'social-card-text'));
    wrap.append(node('p', card.permissions, 'social-card-perms'));
    const pubRow = node('div', '', 'social-pubnote');
    pubRow.append(badge(gateOpen ? 'Publishing enabled' : 'Test mode — nothing is posted', gateOpen ? 'ok' : 'warn'));
    pubRow.append(node('p', card.publishNote, 'social-card-text'));
    wrap.append(pubRow);

    const actions = node('div', '', 'social-actions');
    const manage = hooks.canManage();
    if (!card.connection && manage) {
      actions.append(button(`Connect ${card.name}`, () => connect(card), 'primary', `Connect ${card.name}`));
    }
    if (card.connection) {
      const conn = card.connection;
      wrap.append(node('p', `${conn.label} · Last checked: ${dateText(conn.lastCheckedAt)}${conn.lastCheckStatus ? ` (${conn.lastCheckStatus})` : ''}`, 'social-card-meta'));
      if (conn.reconnectRequired) {
        const rc = node('div', '', 'social-reconnect');
        rc.append(node('strong', 'Reconnect this account'));
        rc.append(node('p', 'The last check failed, so this connection is paused. Reconnect to resume reading your profile and posts.'));
        if (manage) rc.append(button('Reconnect', () => connect(card), 'primary', `Reconnect ${card.name}`));
        wrap.append(rc);
      }
      actions.append(button('Read profile', () => readOnly(card, 'profile'), 'secondary', `Read ${card.name} profile`));
      actions.append(button('Read recent posts', () => readOnly(card, 'posts'), 'secondary', `Read recent ${card.name} posts`));
      actions.append(button('Check connection', () => check(card), 'secondary', `Check ${card.name} connection`));
      if (manage) actions.append(button('Disconnect', () => disconnect(card), 'danger', `Disconnect ${card.name}`));

      if (manage) {
        const pub = node('div', '', 'social-publish');
        pub.append(node('label', 'Caption to test', 'social-label'));
        const area = document.createElement('textarea');
        area.className = 'social-caption'; area.rows = 2; area.maxLength = 2000;
        area.placeholder = 'Type a caption to see what a test publish would record…';
        area.value = captions[conn.id] ?? '';
        area.setAttribute('aria-label', `Test caption for ${card.name}`);
        area.oninput = () => { captions[conn.id] = area.value; };
        pub.append(area);
        const pubBtn = button(gateOpen ? 'Publish' : 'Simulate publish', () => testPublish(card), 'secondary',
          gateOpen ? `Publish to ${card.name}` : `Simulate a publish to ${card.name} without posting`);
        pub.append(pubBtn);
        wrap.append(pub);
      }
      const hist = histories[conn.id];
      if (hist && hist.length) {
        const list = node('ul', '', 'social-history');
        for (const r of hist) {
          const li = node('li', '', 'social-history-item');
          li.append(badge(r.status, r.status === 'sent' ? 'ok' : r.status === 'test_simulated' ? 'warn' : 'muted'));
          li.append(node('span', `${r.caption.slice(0, 80)}${r.providerPostId ? ` · post ${r.providerPostId}` : ''} · ${dateText(r.createdAt)} — ${r.note.slice(0, 120)}`, 'social-history-text'));
          list.append(li);
        }
        wrap.append(node('h4', 'Publish history (honest statuses)', 'social-history-title'));
        wrap.append(list);
      } else if (conn) { void loadHistory(card); }
    }
    for (const b of Array.from(actions.querySelectorAll('button'))) b.toggleAttribute('disabled', Object.values(busy).some(Boolean));
    wrap.append(actions);
    return wrap;
  }

  function render() {
    element.replaceChildren();
    element.append(node('h2', 'Social connectors', 'social-heading'));
    element.append(node('p', 'See your social profiles and recent posts inside The Mayor.', 'social-sub'));
    const banner = node('div', '', gateOpen ? 'social-banner social-banner-ok' : 'social-banner social-banner-warn');
    banner.setAttribute('role', 'status');
    banner.textContent = gateOpen
      ? 'Publishing is enabled. Posts go to the real public channels.'
      : 'Test mode — nothing is posted to any public channel. Publishing stays dark until the MehyarSoft app review is approved.';
    element.append(banner);
    const grid = node('div', '', 'social-grid');
    for (const card of cards) grid.append(renderCard(card));
    element.append(grid);
    element.append(node('p', '', 'social-status'));
    active = true;
  }

  void active;
  load();
  return element;
}
