/**
 * Conversation canvas — DOM composition (P2).
 * ============================================================================
 * The canvas is the app's primary home surface: one scrolling conversation
 * with The Mayor, with live cards materialized in the flow (see
 * canvas-model.ts for the event-stream contract the lane projects).
 *
 * Composition, top to bottom (the day segment, in canvas event order):
 *   setup card        — #onboarding-progress (owned by main.ts; sits in the
 *                       chat view directly above this lane while onboarding
 *                       is incomplete, and renders nothing once complete)
 *   briefing card     — proactive-ui section (createProactive().sections)
 *   money card        — proactive-ui section ("Money this week")
 *   missed-call card  — THIS module (highlights that still need follow-up)
 *   suggestion cards  — proactive-ui section
 * then the conversation itself (#conversation / #transcript — message
 * events, owned by main.ts) and the pinned composer.
 *
 * This module owns ONLY the missed-call highlights card; every other card
 * stays owned by its existing component (proactive-ui / proactive-stub
 * contracts are reused, never forked). Honest states throughout: while the
 * fetch is in flight the card stays out of the stream (the lane loads
 * progressively, card by card — no spinner ever covers the canvas); on
 * failure it shows the same honest empty + retry pattern the proactive
 * sections use; when no call needs follow-up it renders nothing at all —
 * never a fake "all clear" card.
 *
 * Accessibility: the card is a <section> with a real heading; arrivals
 * never move focus and the section is NOT a live region (the conversation
 * owns announcements). Its single action is a real <button> (44px+ target
 * via canvas.css). P3 note: to spawn this card mid-voice-turn, build its
 * event with missedCallEvent() from canvas-model.ts and upsert it into
 * the stream — the section element below is the mount node.
 */
import { selectMissedCallHighlights, type MissedCallLike } from './canvas-model';

type Api = (path: string, body?: unknown, headers?: Record<string, string>) => Promise<any>;

export interface CanvasHooks {
  api: Api;
  tenant: () => string;
  timeZone: () => string;
  /** Opens the existing missed-calls dialog (workday) — the card's one-tap depth. */
  onOpenMissedCalls: () => void;
  paint: () => void;
}

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

export function createCanvas(hooks: CanvasHooks) {
  let version = 0;
  /** True once real content (highlights or an error) has rendered — a later
   * failed refresh keeps the good content instead of replacing it. */
  let hasRendered = false;

  const missedSection = el('section', '', 'missed-calls-section');
  missedSection.id = 'canvas-missed-calls';
  missedSection.setAttribute('aria-labelledby', 'canvas-missed-calls-heading');
  missedSection.hidden = true;

  const fullTime = (value: string) => new Intl.DateTimeFormat(undefined, { timeZone: hooks.timeZone(), dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  function renderHighlights(calls: MissedCallLike[]) {
    const highlights = selectMissedCallHighlights(calls);
    if (!highlights.length) {
      // Nothing needs follow-up: the card leaves the stream entirely.
      missedSection.hidden = true;
      missedSection.replaceChildren();
      hasRendered = false;
      hooks.paint();
      return;
    }
    hasRendered = true;
    missedSection.hidden = false;
    const heading = sectionHeading('Missed calls', 'phone', highlights.length === 1 ? '1 waiting' : `${highlights.length} waiting`);
    heading.querySelector('h2')!.id = 'canvas-missed-calls-heading';
    const list = el('div', '', 'missed-call-list');
    for (const call of highlights) {
      const row = el('article', '', 'missed-call-row');
      const copy = el('div', '', 'row-copy');
      copy.append(
        el('h3', call.caller_number),
        el('p', `${fullTime(call.occurred_at)} · no text-back yet${call.source === 'test' ? ' · test call' : ''}`),
      );
      row.append(copy);
      list.append(row);
    }
    const actions = el('div', '', 'card-actions missed-call-actions');
    actions.append(button('Review missed calls', () => hooks.onOpenMissedCalls(), 'secondary'));
    missedSection.replaceChildren(
      heading,
      el('p', 'These callers haven’t heard back yet. A quick text-back can still win the booking.', 'missed-call-intro'),
      list,
      actions,
    );
    hooks.paint();
  }

  function renderError(error: unknown) {
    if (hasRendered) return; // keep the last good card; never swap in an error over real data
    hasRendered = true;
    missedSection.hidden = false;
    const heading = sectionHeading('Missed calls', 'phone');
    heading.querySelector('h2')!.id = 'canvas-missed-calls-heading';
    missedSection.replaceChildren(
      heading,
      empty('Missed calls could not load.', error instanceof Error ? error.message : 'Please try again.', button('Try again', () => void refresh(), 'secondary')),
    );
    hooks.paint();
  }

  async function refresh() {
    const current = ++version;
    const tenantId = hooks.tenant();
    if (!tenantId) return;
    try {
      const data = await hooks.api(`/api/businesses/${tenantId}/missed-calls`);
      if (current !== version) return;
      renderHighlights((data.missedCalls ?? []) as MissedCallLike[]);
    } catch (error) {
      if (current !== version) return;
      renderError(error);
    }
  }

  function reset() {
    version++;
    hasRendered = false;
    missedSection.hidden = true;
    missedSection.replaceChildren();
  }

  return { missedCalls: missedSection, refresh, reset };
}
