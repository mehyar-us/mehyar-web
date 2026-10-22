/**
 * Speak-and-show — DOM controller (P3).
 * ============================================================================
 * Wires the pure derivation (web/speak-show-model.ts) into the conversation
 * canvas: when a voice OR text turn produces a visualizable server event,
 * the corresponding card materializes in the canvas card lane (#canvas-cards)
 * at that moment, ordered into the canvas event stream via
 * upsertCanvasEvent() with the real arrival timestamp.
 *
 * Cards are rendered by THIS module only for shapes that have no existing
 * renderer (booking proposal/confirmation, appointment change, calendar
 * inventory). Money, briefing, missed calls and suggestions keep their
 * existing renderers (proactive-ui / canvas.ts) — when a booking settles,
 * this controller asks the host to refresh those cards quietly, and their
 * real new figures count up in place (web/count-up.ts). No card logic is
 * forked and no number is ever parsed out of reply prose.
 *
 * Interruption (barge-in): the host calls interrupt(turnId) from the voice
 * client's EXISTING interruption signals (owner speech detected while The
 * Mayor is speaking / status flip speaking→listening / Talk-button stop /
 * text "Stop waiting"). interrupt() is fully synchronous: it clears the
 * turn's pending timers, drops its pending visuals from the queue (they
 * never appear), and cancels in-flight count-ups/entrance animations on
 * cards already shown (they stay — real data — snapped to final state).
 * No awaits, no fetches: the <200ms budget is met by construction.
 *
 * Accessibility: the lane is not a live region and arrivals never move
 * focus; a card's entrance is <1s, transform/opacity only, and disabled
 * under prefers-reduced-motion (speak-show.css). Status badges carry the
 * honest state in text — a proposal awaiting confirmation never reads as
 * booked.
 */
import { upsertCanvasEvent, type CanvasEvent } from './canvas-model';
import {
  confirmationTarget, createVisualQueue, scheduleTurnVisuals, visualsFromTurnEvent,
  type AppointmentChangeProposalLike, type BookingProposalLike, type SpeakShowVisual,
} from './speak-show-model';

type Api = (path: string, body?: unknown, headers?: Record<string, string>) => Promise<any>;

export interface SpeakShowHooks {
  api: Api;
  tenant: () => string;
  timeZone: () => string;
  paint: () => void;
  /**
   * A booking settled on the calendar: the host refreshes the existing
   * money/briefing/missed-call/suggestion cards (quietly, no loading
   * flash) so their real figures update — and count up — in the canvas.
   */
  onBookingSettled?: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function icon(name: string) { const node = el('i'); node.dataset.lucide = name; node.setAttribute('aria-hidden', 'true'); return node; }

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft', zoho: 'Zoho' };

export function createSpeakShow(hooks: SpeakShowHooks) {
  const lane = el('div', '', 'speak-show-lane');
  lane.id = 'speak-show-lane';

  /** The canvas event stream for THIS lane, kept in upsertCanvasEvent order. */
  let stream: CanvasEvent[] = [];
  const nodes = new Map<string, HTMLElement>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queue = createVisualQueue();
  /** Real proposals seen this page session, by id — confirmation events
   * carry only an id, so the confirmed card upgrades the proposal card. */
  const proposals = new Map<string, BookingProposalLike>();
  const changeProposals = new Map<string, AppointmentChangeProposalLike>();
  let currentTurn = 0;

  const timeZone = (fallback?: string) => fallback || hooks.timeZone();
  const when = (iso: string, zone: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const clock = (iso: string, zone: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  /* ------------------------------ rendering ------------------------------ */

  function statusBadge(text: string, kind: 'confirmed' | 'pending' | 'info'): HTMLElement {
    const badge = el('span', text, `speak-show-badge speak-show-badge-${kind}`);
    return badge;
  }

  function bookingCard(visual: Extract<SpeakShowVisual, { type: 'booking' }>): HTMLElement {
    const { proposal, confirmed } = visual;
    const zone = timeZone(proposal.timeZone);
    const card = el('article', '', 'speak-show-card');
    card.setAttribute('aria-label', `${confirmed ? 'Booked' : 'Booking proposal'}: ${proposal.input.title}, ${proposal.input.appointmentType}, ${when(proposal.input.start, zone)}`);
    const head = el('div', '', 'speak-show-head');
    const title = el('h3'); title.append(icon('calendar-check'), document.createTextNode(' ' + proposal.input.title));
    head.append(title, confirmed
      ? statusBadge('Booked', 'confirmed')
      : statusBadge('Waiting for your yes', 'pending'));
    const timeline = el('div', '', 'speak-show-timeline');
    const start = el('div', '', 'speak-show-point');
    start.append(el('strong', when(proposal.input.start, zone)), el('span', 'Starts'));
    const end = el('div', '', 'speak-show-point');
    end.append(el('strong', clock(proposal.input.end, zone)), el('span', 'Ends'));
    timeline.append(start, el('span', '→', 'speak-show-arrow'), end);
    const details = el('p', [
      proposal.input.appointmentType,
      proposal.input.staff ? `with ${proposal.input.staff}` : '',
      proposal.customer ? `for ${proposal.customer.name}` : '',
      proposal.calendarName ? `on ${proposal.calendarName}` : '',
    ].filter(Boolean).join(' · '), 'speak-show-details');
    card.append(head, timeline, details);
    if (!confirmed) {
      card.append(el('p', 'Not booked yet — say yes and I’ll put it on the calendar.', 'speak-show-note'));
    }
    return card;
  }

  function changeCard(visual: Extract<SpeakShowVisual, { type: 'booking-change' }>): HTMLElement {
    const { proposal, confirmed } = visual;
    const zone = timeZone(proposal.timeZone);
    const cancelling = proposal.kind === 'cancel';
    const card = el('article', '', 'speak-show-card');
    const head = el('div', '', 'speak-show-head');
    const title = el('h3');
    title.append(icon(cancelling ? 'calendar-x' : 'calendar-clock'), document.createTextNode(` ${cancelling ? 'Cancel' : 'Reschedule'}: ${proposal.before.title}`));
    head.append(title, confirmed
      ? statusBadge(cancelling ? 'Cancelled' : 'Rescheduled', 'confirmed')
      : statusBadge('Waiting for your yes', 'pending'));
    card.append(head);
    const timeline = el('div', '', 'speak-show-timeline');
    const from = el('div', '', 'speak-show-point');
    from.append(el('strong', when(proposal.before.start, zone)), el('span', cancelling ? 'Was booked' : 'Was'));
    timeline.append(from);
    if (!cancelling) {
      const to = el('div', '', 'speak-show-point');
      to.append(el('strong', when(proposal.after.start, zone)), el('span', 'Moves to'));
      timeline.append(el('span', '→', 'speak-show-arrow'), to);
    }
    card.append(timeline);
    const detail = [proposal.before.appointmentType, proposal.customer ? `for ${proposal.customer.name}` : ''].filter(Boolean).join(' · ');
    if (detail) card.append(el('p', detail, 'speak-show-details'));
    if (!confirmed) card.append(el('p', 'Nothing has changed yet — say yes to apply it.', 'speak-show-note'));
    return card;
  }

  function calendarsCard(visual: Extract<SpeakShowVisual, { type: 'calendars' }>): HTMLElement {
    const card = el('article', '', 'speak-show-card');
    const head = el('div', '', 'speak-show-head');
    const title = el('h3'); title.append(icon('calendar-days'), document.createTextNode(' Your calendars'));
    head.append(title, statusBadge(visual.schedulingActive ? 'Booking rules active' : 'Booking rules not active yet', visual.schedulingActive ? 'confirmed' : 'info'));
    card.append(head);
    if (!visual.connections.length) {
      card.append(el('p', 'No calendar connections yet — connect one and I can book straight onto it.', 'speak-show-details'));
    } else {
      const list = el('ul', '', 'speak-show-list');
      for (const connection of visual.connections) {
        const label = PROVIDER_LABELS[connection.provider] ?? connection.provider;
        list.append(el('li', connection.available
          ? `${label}: ${connection.calendars.length} calendar${connection.calendars.length === 1 ? '' : 's'} available`
          : `${label}: couldn’t read its calendars — check the connection`));
      }
      card.append(list);
    }
    if (!visual.schedulingActive && visual.setupNextQuestion) {
      card.append(el('p', visual.setupNextQuestion, 'speak-show-note'));
    }
    return card;
  }

  function renderVisual(visual: SpeakShowVisual): HTMLElement {
    switch (visual.type) {
      case 'booking': return bookingCard(visual);
      case 'booking-change': return changeCard(visual);
      case 'calendars': return calendarsCard(visual);
    }
  }

  /** Insert/replace a card in the lane at its canvas-stream position. */
  function mount(visual: SpeakShowVisual) {
    stream = upsertCanvasEvent(stream, visual.event);
    const existing = nodes.get(visual.event.id);
    const node = renderVisual(visual);
    node.dataset.canvasEvent = visual.event.id;
    node.classList.add('speak-show-in');
    if (existing) {
      existing.replaceWith(node);
    } else {
      // Stream order: insert before the first mounted node that sorts after.
      const order = stream.map(event => event.id);
      const myIndex = order.indexOf(visual.event.id);
      let before: HTMLElement | null = null;
      for (const child of lane.children) {
        const id = (child as HTMLElement).dataset.canvasEvent;
        if (id && order.indexOf(id) > myIndex) { before = child as HTMLElement; break; }
      }
      lane.insertBefore(node, before);
    }
    nodes.set(visual.event.id, node);
    hooks.paint();
  }

  /* --------------------------- turn lifecycle ---------------------------- */

  /** Begin a new owner turn (voice utterance or text submit). Visuals from
   * server events are attributed to the most recently begun turn. */
  function beginTurn(): number {
    return ++currentTurn;
  }

  function showVisual(turnId: number, visual: SpeakShowVisual) {
    queue.markShown(visual.event.id);
    if (visual.type === 'booking') proposals.set(visual.proposal.id, visual.proposal);
    if (visual.type === 'booking-change') changeProposals.set(visual.proposal.id, visual.proposal);
    mount(visual);
    if (visual.type !== 'calendars' && visual.confirmed) hooks.onBookingSettled?.();
  }

  /**
   * Consume one server custom event (voice custommessage or a text turn's
   * events array — the same payloads). Returns true when speak-and-show
   * handled it. Visuals materialize staggered (first immediately); a
   * confirmation upgrades the matching proposal card in place, or resolves
   * the booking from the real GET /bookings endpoint when this page session
   * never saw the proposal. Unresolvable confirmations render nothing.
   */
  function handleEvent(event: unknown, at: number = Date.now()): boolean {
    const target = confirmationTarget(event);
    if (target) {
      void resolveConfirmation(target, at);
      return true;
    }
    const visuals = visualsFromTurnEvent(event, at);
    if (!visuals.length) return false;
    const turnId = currentTurn;
    const scheduled = scheduleTurnVisuals(turnId, visuals);
    queue.enqueue(scheduled);
    for (const item of scheduled) {
      if (item.delayMs <= 0) { showVisual(turnId, item.visual); continue; }
      const timer = setTimeout(() => {
        timers.delete(item.visual.event.id);
        if (!queue.isPending(item.visual.event.id)) return; // cancelled by barge-in
        showVisual(turnId, item.visual);
      }, item.delayMs);
      timers.set(item.visual.event.id, timer);
    }
    return true;
  }

  async function resolveConfirmation(target: { kind: 'booking' | 'booking-change'; id: string }, at: number) {
    if (target.kind === 'booking') {
      const cached = proposals.get(target.id);
      if (cached) {
        mount({ type: 'booking', event: { id: `booking:${target.id}`, kind: 'booking', at }, proposal: { ...cached, status: 'applied' }, confirmed: true });
        hooks.onBookingSettled?.();
        return;
      }
      // Not seen this session (e.g. proposed in an earlier visit): resolve
      // from the real bookings endpoint — the same list the Calendar
      // requests dialog renders. No match → no card, never a guess.
      try {
        const tenantId = hooks.tenant();
        if (!tenantId) return;
        const data = await hooks.api(`/api/businesses/${tenantId}/bookings`);
        const items: any[] = Array.isArray(data) ? data : data.requests ?? data.bookings ?? [];
        const item = items.find(entry => entry && entry.id === target.id && entry.status === 'applied' && entry.input);
        if (!item) return;
        const proposal: BookingProposalLike = {
          id: item.id, status: 'applied',
          input: {
            title: String(item.input.title ?? ''), appointmentType: String(item.input.appointmentType ?? ''),
            ...(item.input.staff ? { staff: String(item.input.staff) } : {}),
            start: String(item.input.start ?? ''), end: String(item.input.end ?? ''),
            attendees: Array.isArray(item.input.attendees) ? item.input.attendees.map(String) : [],
          },
        };
        if (!proposal.input.title || Number.isNaN(Date.parse(proposal.input.start))) return;
        proposals.set(proposal.id, proposal);
        mount({ type: 'booking', event: { id: `booking:${proposal.id}`, kind: 'booking', at }, proposal, confirmed: true });
        hooks.onBookingSettled?.();
      } catch { /* endpoint unavailable: no card rather than an invented one */ }
      return;
    }
    const cached = changeProposals.get(target.id);
    if (!cached) return; // no real endpoint lists changes by id — honest skip
    mount({ type: 'booking-change', event: { id: `booking:change-${target.id}`, kind: 'booking', at }, proposal: { ...cached, status: 'applied' }, confirmed: true });
    hooks.onBookingSettled?.();
  }

  /**
   * Barge-in / stop: halt this turn's visual sequence NOW, in sync with the
   * audio stopping. Pending visuals are dropped and never appear; cards
   * already shown stay (real data) with their entrance animation stopped.
   * Synchronous by construction — well inside the 200ms budget.
   */
  function interrupt(turnId: number = currentTurn): number {
    const dropped = queue.cancelTurn(turnId);
    for (const visual of dropped) {
      const timer = timers.get(visual.event.id);
      if (timer) { clearTimeout(timer); timers.delete(visual.event.id); }
    }
    for (const node of nodes.values()) node.classList.add('speak-show-settled');
    return dropped.length;
  }

  /** Workspace access ended / tenant switched: clear the lane entirely. */
  function reset() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    stream = [];
    nodes.clear();
    proposals.clear();
    changeProposals.clear();
    lane.replaceChildren();
  }

  return { element: lane, beginTurn, handleEvent, interrupt, reset };
}

export type SpeakShow = ReturnType<typeof createSpeakShow>;
