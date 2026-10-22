/**
 * P1 authority tiers — "How The Mayor acts" settings section.
 *
 * One row per action type with a 3-option tier selector in plain language:
 * "Ask me first" / "Draft for my approval" / "Act automatically".
 *
 * Compliance notes (product-compliance skill):
 * - Item 9 (no dark patterns): the three options are neutral peers — no
 *   option is pre-highlighted, "recommended"-badged, or styled as the
 *   default pick. The server default ('draft') is simply pre-selected.
 * - Item 12 (honest claims): descriptions come from the server contract
 *   (TIER_DESCRIPTIONS) and describe only implemented behavior.
 * - Items 13–15 (a11y): real radio inputs in a fieldset/legend, real
 *   <label>s, keyboard-operable, visible focus via the global CSS, 48px+
 *   touch targets, role="status" for save results.
 */
import {
  TIER_LABELS, ACTION_LABELS, TIER_DESCRIPTIONS,
  AUTHORITY_TIERS, AUTHORITY_ACTIONS,
  type AuthorityAction, type AuthorityTier,
} from '../src/authority-tiers';

type Api = (path: string, body?: unknown, headers?: Record<string, string>) => Promise<any>;
export interface AuthorityTiersHooks {
  api: Api;
  tenant: () => string;
  canManage: () => boolean;
  onNotice: (message: string) => void;
  paint: () => void;
}

interface TierRow { action: AuthorityAction; tier: AuthorityTier; explicit: boolean }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}

export function createAuthorityTiers(hooks: AuthorityTiersHooks) {
  const root = el('div', '', 'authority-tiers');
  const status = el('p', '', 'authority-status');
  status.setAttribute('role', 'status');

  function optionRow(action: AuthorityAction, tier: AuthorityTier, checked: boolean, name: string): HTMLElement {
    const label = document.createElement('label');
    label.className = 'authority-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = tier;
    input.checked = checked;
    input.disabled = !hooks.canManage();
    const copy = el('span', '', 'authority-option-copy');
    copy.append(el('strong', TIER_LABELS[tier]), el('span', TIER_DESCRIPTIONS[action][tier], 'authority-option-desc'));
    label.append(input, copy);
    input.addEventListener('change', () => { if (input.checked) void save(action, tier); });
    return label;
  }

  function render(rows: TierRow[]) {
    root.replaceChildren();
    for (const row of rows) {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'authority-row';
      const legend = document.createElement('legend');
      legend.textContent = ACTION_LABELS[row.action];
      fieldset.append(legend);
      const name = `authority-${row.action}`;
      for (const tier of AUTHORITY_TIERS) fieldset.append(optionRow(row.action, tier, row.tier === tier, name));
      root.append(fieldset);
    }
    const note = el('p', 'Automatic actions are always logged. Suggestion texts only reach real customers when live sending is on and a phone number is connected — otherwise sends are logged as simulated.', 'authority-note');
    root.append(note, status);
    hooks.paint();
  }

  async function save(action: AuthorityAction, tier: AuthorityTier) {
    for (const input of root.querySelectorAll('input')) (input as HTMLInputElement).disabled = true;
    status.textContent = 'Saving…';
    try {
      const result = await hooks.api(`/api/businesses/${hooks.tenant()}/authority-tiers`, { action, tier });
      const rows = (result.tiers ?? []) as TierRow[];
      render(rows);
      status.textContent = `Saved: ${ACTION_LABELS[action]} — ${TIER_LABELS[tier]}.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not save. Please try again.';
      for (const input of root.querySelectorAll('input')) (input as HTMLInputElement).disabled = !hooks.canManage();
    }
    hooks.paint();
  }

  async function refresh() {
    if (!hooks.canManage()) { root.replaceChildren(); return; }
    root.replaceChildren(el('p', 'Loading how The Mayor acts…', 'loading-state'));
    try {
      const result = await hooks.api(`/api/businesses/${hooks.tenant()}/authority-tiers`);
      const rows = (result.tiers ?? []) as TierRow[];
      render(rows.length ? rows : AUTHORITY_ACTIONS.map(action => ({ action, tier: 'draft' as AuthorityTier, explicit: false })));
    } catch (error) {
      root.replaceChildren(el('p', error instanceof Error ? error.message : 'Could not load. Please try again.', 'authority-status'));
    }
    hooks.paint();
  }

  function clear() {
    root.replaceChildren();
    status.textContent = '';
  }

  return { element: root, refresh, clear };
}
