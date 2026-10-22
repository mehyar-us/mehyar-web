/**
 * Crew 3 — Proactive engine UI (morning briefing, suggestion cards, ROI dashboard).
 *
 * Renders strictly from the contract in ./proactive-stub. When the backend is
 * not live yet the stub resolves to null and every section shows an honest
 * empty state — never invented numbers (compliance item 9).
 *
 * Accessibility: real <button>s, visible focus (global CSS), role="status" for
 * send results, aria-hidden decorative icons, reduced-motion respected via the
 * global prefers-reduced-motion rules (flash animation stays under 900ms).
 */
import {
  fetchBriefing, fetchSuggestions, sendSuggestion, editSuggestion, dismissSuggestion, fetchRoi, setRoiConfig,
  formatMoney, pluralize, formatClock, formatDuration, formatBriefingDate, formatAsOf, sparklinePoints,
  type Briefing, type SuggestionCard, type ProactiveRoi,
} from './proactive-stub';
import { Sun, Lightbulb, Send, Pencil, Undo2, TrendingUp } from 'lucide';

/** Merge into workday.ts's icons map so <i data-lucide="…"> paints. (X is already registered by workday.ts.) */
export const proactiveIcons = { Sun, Lightbulb, Send, Pencil, Undo2, TrendingUp };

type Api = (path: string, body?: unknown, headers?: Record<string, string>) => Promise<any>;
export interface ProactiveHooks {
  api: Api;
  tenant: () => string;
  timeZone: () => string;
  onNotice: (message: string) => void;
  onNavigate: (view: 'today' | 'chat') => void;
  paint: () => void;
}

type CardState = 'sent' | 'dismissed';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function icon(name: string) { const node = el('i'); node.dataset.lucide = name; node.setAttribute('aria-hidden', 'true'); return node; }
function button(label: string, action: () => void, className = 'secondary') {
  const node = el('button', label, className); node.type = 'button'; node.onclick = action; return node;
}
function empty(title: string, detail: string, action?: HTMLElement) {
  const node = el('div', '', 'empty-state'); node.append(el('h3', title), el('p', detail)); if (action) node.append(action); return node;
}
function sectionHeading(title: string, iconName: string, aside?: string) {
  const heading = el('div', '', 'section-heading');
  const titleEl = el('h2'); titleEl.append(icon(iconName), document.createTextNode(' ' + title));
  heading.append(titleEl);
  if (aside) heading.append(el('span', aside, 'source-note'));
  return heading;
}

export function createProactive(hooks: ProactiveHooks) {
  let version = 0;
  const tz = () => hooks.timeZone();
  /** Card ids the user already sent/dismissed this session — every mount consults this. */
  const cardStates = new Map<string, CardState>();
  /** Last send-result copy per card, so re-mounted "Sent" cards keep their honest result line. */
  const cardResults = new Map<string, string>();

  const stack = el('div', '', 'proactive-stack');

  const briefingSection = el('section', '', 'briefing-section');
  briefingSection.id = 'proactive-briefing';
  briefingSection.setAttribute('aria-labelledby', 'proactive-briefing-heading');

  const suggestionsSection = el('section', '', 'suggestions-section');
  suggestionsSection.id = 'proactive-suggestions';
  suggestionsSection.setAttribute('aria-labelledby', 'proactive-suggestions-heading');

  const roiSection = el('section', '', 'roi-section');
  roiSection.id = 'proactive-roi';
  roiSection.setAttribute('aria-labelledby', 'proactive-roi-heading');

  // Crew 5 UX: the stack is briefing + suggestions (Today view + chat home).
  // The ROI dashboard lives on its own as the Feed collection's proof
  // stream — it mounts separately in the Feed view.
  stack.append(briefingSection, suggestionsSection);

  const chatHome = el('section', '', 'proactive-chat-home');
  chatHome.id = 'proactive-chat-home';
  chatHome.hidden = true;
  chatHome.setAttribute('aria-label', 'Today at a glance');

  /* ------------------------------- briefing ------------------------------- */

  function renderBriefing(result: { value: Briefing | null } | { error: unknown }, suggestions: SuggestionCard[] | null) {
    if ('error' in result) {
      briefingSection.replaceChildren(
        sectionHeading('Morning briefing', 'sun'),
        empty('The briefing could not load.', result.error instanceof Error ? result.error.message : 'Please try again.', button('Try again', () => void refresh(), 'secondary')),
      );
      hooks.paint(); return;
    }
    const data = result.value;
    if (!data) {
      briefingSection.replaceChildren(
        sectionHeading('Morning briefing', 'sun'),
        empty('The morning briefing isn’t available yet.', 'Your assistant’s proactive engine is still being connected — no numbers are shown until it is live.'),
      );
      hooks.paint(); return;
    }
    const heading = sectionHeading('Morning briefing', 'sun', `as of ${formatAsOf(data.generatedAt, tz())}`);
    heading.querySelector('h2')!.id = 'proactive-briefing-heading';

    const dateLine = el('p', '', 'briefing-date');
    dateLine.append(icon('sun'), document.createTextNode(formatBriefingDate(data.date)));

    const lines = el('ul', '', 'briefing-lines');
    const revenue = data.yesterday.revenueCents == null ? 'revenue not configured' : formatMoney(data.yesterday.revenueCents);
    const yesterdayLine = el('li');
    yesterdayLine.append(el('strong', 'Yesterday: '), document.createTextNode(
      `${pluralize(data.yesterday.appointments, 'appointment')} · ${pluralize(data.yesterday.noShows, 'no-show')} · ${revenue}`));
    const missed = data.missedCalls;
    const missedLine = el('li');
    missedLine.append(el('strong', 'Missed calls: '), document.createTextNode(
      missed.total === 0 ? 'none' : `${missed.total} — ${missed.textedBack} texted back, ${missed.recovered} rebooked ✓`));
    const gaps = data.today.gaps.length
      ? ` · gap ${data.today.gaps.map(gap => `${formatClock(gap.start, tz())}–${formatClock(gap.end, tz())}`).join(', ')}`
      : '';
    const todayLine = el('li');
    todayLine.append(el('strong', 'Today: '), document.createTextNode(
      `${pluralize(data.today.appointments, 'appointment')}${gaps}`));
    lines.append(yesterdayLine, missedLine, todayLine);

    briefingSection.replaceChildren(heading, dateLine, lines);

    if (data.opportunities.length) {
      const list = el('div', '', 'opportunity-list');
      for (const opportunity of data.opportunities) {
        const row = el('div', '', 'opportunity-row');
        const copy = el('p'); copy.append(icon('lightbulb'), document.createTextNode(opportunity.oneLine));
        row.append(copy);
        const linked = suggestions?.find(card => card.id === opportunity.cardId && cardStates.get(card.id) !== 'dismissed');
        if (linked && cardStates.get(linked.id) !== 'sent') {
          const actions = el('div', '', 'opportunity-actions');
          const resultLine = el('p', '', 'opportunity-result'); resultLine.setAttribute('role', 'status');
          const send = button('Send', () => void sendFromOpportunity(linked, send, resultLine));
          const details = button('Details', () => highlight(`suggestion:${linked.id}`), 'quiet');
          actions.append(send, details);
          row.append(actions, resultLine);
        }
        list.append(row);
      }
      briefingSection.append(list);
    }
    hooks.paint();
  }

  async function sendFromOpportunity(card: SuggestionCard, sendButton: HTMLButtonElement, resultLine: HTMLElement) {
    sendButton.disabled = true;
    try {
      const result = await sendSuggestion(hooks.api, hooks.tenant(), card.id);
      cardStates.set(card.id, 'sent');
      resultLine.textContent = `Sent to ${result.audienceCount} customer${result.audienceCount === 1 ? '' : 's'}${result.simulated ? ' (simulated — no real SMS was sent).' : '.'}`;
      syncCardStates(card.id);
    } catch (error) {
      resultLine.textContent = error instanceof Error ? error.message : 'Could not send. Please try again.';
      sendButton.disabled = false;
    }
  }

  /* ------------------------------ suggestions ------------------------------ */

  function renderSuggestions(result: { value: SuggestionCard[] | null } | { error: unknown }) {
    if ('error' in result) {
      suggestionsSection.replaceChildren(
        sectionHeading('Suggestions', 'lightbulb'),
        empty('Suggestions could not load.', result.error instanceof Error ? result.error.message : 'Please try again.', button('Try again', () => void refresh(), 'secondary')),
      );
      hooks.paint(); return;
    }
    const cards = (result.value ?? []).filter(card => card.state !== 'dismissed' && cardStates.get(card.id) !== 'dismissed');
    const heading = sectionHeading('Suggestions', 'lightbulb', cards.length ? `${cards.length} for you` : undefined);
    heading.querySelector('h2')!.id = 'proactive-suggestions-heading';
    if (!result.value) {
      suggestionsSection.replaceChildren(heading,
        empty('Suggestions aren’t available yet.', 'Your assistant’s proactive engine is still being connected — suggested messages will appear here.'));
      hooks.paint(); return;
    }
    if (!cards.length) {
      suggestionsSection.replaceChildren(heading,
        empty('Nothing needs a nudge right now.', 'When your assistant spots a win-back, review, or rebooking opportunity, it will appear here.'));
      hooks.paint(); return;
    }
    const list = el('div', '', 'suggestion-list');
    const visible = cards.slice(0, 3);
    for (const card of visible) list.append(mountSuggestionCard(card, false));
    suggestionsSection.replaceChildren(heading, list);
    if (cards.length > 3) {
      const more = button(`+${cards.length - 3} more`, () => {
        for (const card of cards.slice(3)) list.append(mountSuggestionCard(card, false));
        more.remove(); hooks.paint();
      }, 'quiet');
      suggestionsSection.append(more);
    }
    const note = el('p', 'Quiet hours and daily limits are handled for you — what you see here is ready to act on.', 'source-note');
    suggestionsSection.append(note);
    hooks.paint();
  }

  /** Render one suggestion card. chatHome=true mounts the compact chat-view copy (no section id). */
  function mountSuggestionCard(card: SuggestionCard, inChat: boolean): HTMLElement {
    const node = el('article', '', 'suggestion-card');
    node.dataset.suggestionCard = card.id;
    if (!inChat) node.id = `proactive-suggestion-${card.id}`;

    const copy = el('div', '', 'row-copy');
    copy.append(el('h3', card.title), el('p', card.body));
    const quote = el('blockquote', card.draft.message, 'draft-preview');
    quote.setAttribute('aria-label', 'Drafted message preview');
    const audience = el('p', `to ${card.draft.audienceCount} ${card.draft.audience}`, 'audience-line');
    copy.append(quote, audience);

    const actions = el('div', '', 'card-actions');
    const resultLine = el('p', '', 'send-result'); resultLine.setAttribute('role', 'status');

    const refreshActions = () => {
      actions.replaceChildren();
      const state = cardStates.get(card.id) ?? (card.state === 'sent' ? 'sent' : undefined);
      if (state === 'sent') {
        const badge = el('span', 'Sent', 'sent-badge'); badge.append(icon('check'));
        actions.append(badge);
        const saved = cardResults.get(card.id);
        if (saved) resultLine.textContent = saved;
        hooks.paint(); return;
      }
      const send = button('Send', () => void doSend());
      send.prepend(icon('send'));
      const edit = button('Edit', () => startEdit());
      edit.prepend(icon('pencil'));
      const dismiss = button('Dismiss', () => doDismiss());
      dismiss.prepend(icon('x'));
      actions.append(send, edit, dismiss);
      hooks.paint();
    };

    async function doSend() {
      for (const control of actions.querySelectorAll('button')) (control as HTMLButtonElement).disabled = true;
      try {
        const result = await sendSuggestion(hooks.api, hooks.tenant(), card.id);
        cardStates.set(card.id, 'sent');
        // Compliance item 12: honest copy — simulated sends must say so.
        const copy = `Sent to ${result.audienceCount} customer${result.audienceCount === 1 ? '' : 's'}${result.simulated ? ' (simulated — no real SMS was sent).' : '.'}`;
        cardResults.set(card.id, copy);
        resultLine.textContent = copy;
        syncCardStates(card.id);
      } catch (error) {
        resultLine.textContent = error instanceof Error ? error.message : 'Could not send. Please try again.';
        for (const control of actions.querySelectorAll('button')) (control as HTMLButtonElement).disabled = false;
      }
    }

    function startEdit() {
      const area = el('textarea', '', 'edit-area');
      area.value = card.draft.message;
      area.setAttribute('aria-label', `Edit message for “${card.title}”`);
      // Server caps messages at 320 chars (z.string().max(320)) — match it.
      area.rows = 4; area.maxLength = 320;
      quote.replaceWith(area);
      actions.replaceChildren();
      const save = button('Save', () => void doSave(), 'primary');
      const cancel = button('Cancel', () => { area.replaceWith(quote); refreshActions(); }, 'secondary');
      actions.append(save, cancel);
      area.focus();
      async function doSave() {
        const message = area.value.trim();
        if (!message) { resultLine.textContent = 'The message can’t be empty.'; area.focus(); return; }
        save.disabled = true; cancel.disabled = true;
        try {
          const updated = await editSuggestion(hooks.api, hooks.tenant(), card.id, message);
          card.draft = { ...card.draft, message: updated.message, audience: updated.audience, audienceCount: updated.audienceCount };
          card.state = updated.state;
          quote.textContent = updated.message;
          audience.textContent = `to ${updated.audienceCount} ${updated.audience}`;
          resultLine.textContent = 'Preview updated.';
        } catch (error) {
          resultLine.textContent = error instanceof Error ? error.message : 'Could not save. Please try again.';
        } finally {
          area.replaceWith(quote); refreshActions();
        }
      }
    }

    function doDismiss() {
      // Capture position before detaching — after() on a detached node is a no-op.
      const parent = node.parentNode, next = node.nextSibling;
      node.remove();
      const bar = el('div', '', 'undo-bar');
      bar.setAttribute('role', 'status');
      bar.append(document.createTextNode('Suggestion dismissed.'));
      const undo = button('Undo', () => {
        window.clearTimeout(timer);
        cardStates.delete(card.id);
        bar.replaceWith(node);
        hooks.paint();
      }, 'quiet');
      undo.prepend(icon('undo-2'));
      bar.append(undo);
      if (parent) parent.insertBefore(bar, next);
      // Commit the dismiss only after the 5s undo window — undo means no API call.
      const timer = window.setTimeout(() => {
        cardStates.set(card.id, 'dismissed');
        bar.remove();
        void dismissSuggestion(hooks.api, hooks.tenant(), card.id).catch(error => {
          hooks.onNotice(error instanceof Error ? error.message : 'Could not dismiss the suggestion.');
        });
      }, 5000);
      hooks.paint();
    }

    node.append(copy, actions, resultLine);
    refreshActions();
    return node;
  }

  /** Re-render every mounted copy of a card after its state changes. */
  function syncCardStates(id: string) {
    const card = latestCards.get(id);
    if (!card) return;
    for (const mounted of document.querySelectorAll<HTMLElement>(`[data-suggestion-card="${CSS.escape(id)}"]`)) {
      mounted.replaceWith(mountSuggestionCard(card, mounted.closest('.proactive-chat-home') !== null));
    }
    hooks.paint();
  }

  /** Freshest server copy of each card (edit updates draft in place). */
  const latestCards = new Map<string, SuggestionCard>();

  /* ---------------------------------- ROI ---------------------------------- */

  /**
   * The recovered-revenue tile is a real <button>: tapping it opens the
   * average-ticket editor inline, so the owner can switch the money tile on
   * in seconds instead of hitting a "Not configured" dead end.
   */
  function revenueTile(data: ProactiveRoi, onSaved: () => void): HTMLElement {
    const wrap = el('div', '', 'roi-tile-wrap');

    function showTile() {
      const configured = data.recoveredRevenueCents != null;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roi-tile';
      btn.setAttribute('aria-label', configured
        ? `Recovered revenue ${formatMoney(data.recoveredRevenueCents as number)}. Activate to change your average ticket.`
        : 'Recovered revenue is not configured. Activate to set your average ticket.');
      btn.append(
        el('h3', 'Recovered revenue'),
        el('p', configured ? formatMoney(data.recoveredRevenueCents as number) : 'Not configured', 'roi-value'),
        el('p', configured ? 'Tap to change your average ticket' : 'Tap to set your average ticket — 10 seconds', 'roi-note'),
      );
      btn.onclick = () => {
        wrap.replaceChildren(showEditor());
        const input = wrap.querySelector('input');
        if (input) input.focus();
        hooks.paint();
      };
      wrap.replaceChildren(btn);
    }

    function showEditor(): HTMLElement {
      const panel = el('div', '', 'roi-tile roi-config');
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', 'Average ticket');
      const label = el('label', 'Average ticket ($)');
      label.setAttribute('for', 'roi-avg-ticket');
      const input = document.createElement('input');
      input.id = 'roi-avg-ticket';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = '75';
      if (data.avgTicketCents != null) input.value = (data.avgTicketCents / 100).toFixed(2).replace(/\.00$/, '');
      const err = el('p', '', 'roi-config-error');
      err.setAttribute('role', 'alert');
      const row = el('div', '', 'row');
      const save = button('Save', () => void doSave(), 'primary');
      const cancel = button('Cancel', () => { showTile(); hooks.paint(); }, 'secondary');
      row.append(save, cancel);
      panel.append(label, input, err, row);

      async function doSave() {
        const dollars = Number(input.value.trim().replace(/[$,\s]/g, ''));
        if (!Number.isFinite(dollars) || dollars <= 0) {
          err.textContent = 'Enter an amount greater than $0.'; input.focus(); return;
        }
        const cents = Math.round(dollars * 100);
        if (cents > 100_000_00) {
          err.textContent = 'That looks too high — enter your average ticket.'; input.focus(); return;
        }
        save.disabled = true; cancel.disabled = true;
        try {
          await setRoiConfig(hooks.api, hooks.tenant(), cents);
          hooks.onNotice('Average ticket saved — recovered revenue is now live.');
          onSaved();
        } catch (error) {
          err.textContent = error instanceof Error ? error.message : 'Could not save. Please try again.';
          save.disabled = false; cancel.disabled = false;
        }
      }
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); void doSave(); }
      });
      return panel;
    }

    showTile();
    return wrap;
  }

  function renderRoi(result: { value: ProactiveRoi | null } | { error: unknown }) {
    if ('error' in result) {
      roiSection.replaceChildren(
        sectionHeading('This month with The Mayor', 'trending-up'),
        empty('The ROI dashboard could not load.', result.error instanceof Error ? result.error.message : 'Please try again.', button('Try again', () => void refresh(), 'secondary')),
      );
      hooks.paint(); return;
    }
    const data = result.value;
    const heading = sectionHeading('This month with The Mayor', 'trending-up', data ? `as of ${formatAsOf(data.generatedAt, tz())}` : undefined);
    heading.querySelector('h2')!.id = 'proactive-roi-heading';
    if (!data) {
      roiSection.replaceChildren(heading,
        empty('Your ROI dashboard will live here.', 'Every number here will come from your real business data, with the time it was measured — nothing is estimated.'));
      hooks.paint(); return;
    }
    const grid = el('div', '', 'roi-grid');
    const tile = (label: string, value: string, note: string, spark?: string) => {
      const card = el('article', '', 'roi-tile');
      card.append(el('h3', label), el('p', value, 'roi-value'));
      if (spark) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 120 36');
        svg.setAttribute('class', 'sparkline');
        svg.setAttribute('role', 'img');
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'No-show rate trend, last 6 months';
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute('points', spark);
        svg.append(title, line);
        card.append(svg);
      }
      card.append(el('p', note, 'roi-note'));
      return card;
    };
    const asOf = `as of ${formatAsOf(data.generatedAt, tz())}`;
    grid.append(
      revenueTile(data, () => void refresh()),
      tile('Appointments booked by Mayor', String(data.appointmentsBookedByMayor), `${asOf} · this month`),
      tile('Missed calls recovered', `${data.missedCallsRecovered.recovered}/${data.missedCallsRecovered.total}`, `${asOf} · this month`),
      tile('Avg response time', data.avgResponseTimeSeconds == null ? 'No data yet' : formatDuration(data.avgResponseTimeSeconds), asOf),
      tile('No-show rate', data.noShowRate == null ? 'No data yet' : `${Math.round(data.noShowRate * 100)}%`, `${asOf} · last 6 months`, sparklinePoints(data.noShowTrend)),
    );
    roiSection.replaceChildren(heading, grid);
    hooks.paint();
  }

  /* -------------------------------- chat home ------------------------------- */

  function renderChatHome(briefing: Briefing | null, suggestions: SuggestionCard[] | null) {
    chatHome.replaceChildren();
    const cards = (suggestions ?? []).filter(card => card.state !== 'dismissed' && cardStates.get(card.id) !== 'dismissed');
    if (!briefing) { chatHome.hidden = true; hooks.paint(); return; }
    chatHome.hidden = false;
    const heading = el('h2', 'Today at a glance');
    const summary = el('p', '', 'chat-home-summary');
    summary.textContent = `${formatBriefingDate(briefing.date)} · ${pluralize(briefing.today.appointments, 'appointment')} · ${briefing.missedCalls.total === 0 ? 'no missed calls' : pluralize(briefing.missedCalls.total, 'missed call')}`;
    chatHome.append(heading, summary);
    const top = cards[0];
    if (top) chatHome.append(mountSuggestionCard(top, true));
    const view = button('Review in Today', () => { hooks.onNavigate('today'); }, 'quiet');
    chatHome.append(view);
    hooks.paint();
  }

  /* --------------------------------- public --------------------------------- */

  async function settled<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
    try { return { value: await promise }; } catch (error) { return { error }; }
  }

  async function refresh() {
    const current = ++version;
    briefingSection.replaceChildren(sectionHeading('Morning briefing', 'sun'), el('p', 'Loading your morning briefing…', 'loading-state'));
    suggestionsSection.replaceChildren(sectionHeading('Suggestions', 'lightbulb'), el('p', 'Loading suggestions…', 'loading-state'));
    roiSection.replaceChildren(sectionHeading('This month with The Mayor', 'trending-up'), el('p', 'Loading your ROI dashboard…', 'loading-state'));
    hooks.paint();
    const tenantId = hooks.tenant();
    const [briefingResult, suggestionsResult, roiResult] = await Promise.all([
      settled(fetchBriefing(hooks.api, tenantId)),
      settled(fetchSuggestions(hooks.api, tenantId)),
      settled(fetchRoi(hooks.api, tenantId)),
    ]);
    if (current !== version) return;
    const suggestions = 'error' in suggestionsResult ? null : suggestionsResult.value;
    latestCards.clear();
    for (const card of suggestions ?? []) latestCards.set(card.id, card);
    renderBriefing(briefingResult, suggestions);
    renderSuggestions(suggestionsResult);
    renderRoi(roiResult);
    renderChatHome('error' in briefingResult ? null : briefingResult.value, suggestions);
  }

  function reset() {
    version++;
    chatHome.hidden = true;
    chatHome.replaceChildren();
  }

  /**
   * Deep-link target from notifications. The backend crew can pass
   * item.anchor = 'briefing' | 'suggestions' | 'roi' | 'suggestion:<cardId>'.
   */
  function highlight(anchor: string) {
    const id = anchor === 'briefing' ? 'proactive-briefing'
      : anchor === 'suggestions' ? 'proactive-suggestions'
      : anchor === 'roi' ? 'proactive-roi'
      : anchor.startsWith('suggestion:') ? `proactive-suggestion-${anchor.slice('suggestion:'.length)}`
      : null;
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth; // restart the animation if re-triggered
    target.classList.add('flash');
    window.setTimeout(() => target.classList.remove('flash'), 900);
  }

  return { stack, roi: roiSection, chatHome, refresh, reset, highlight };
}
