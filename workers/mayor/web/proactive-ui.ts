/**
 * Crew 3 — Proactive engine UI (morning briefing, suggestion cards, ROI dashboard).
 *
 * Data and state live here; rendering is React 19 (./proactive-panels,
 * loaded lazily through ./proactive-panels-loader) driven by a derived
 * snapshot computed at refresh time plus a shared card-state map that
 * send actions sync across every mounted copy of a card — the same
 * contract the imperative renderer kept. When the backend is not live
 * yet the stub resolves to null and every section shows an honest empty
 * state — never invented numbers (compliance item 9).
 */
import {
  fetchBriefing, fetchSuggestions, sendSuggestion, editSuggestion, dismissSuggestion, fetchRoi, setRoiConfig,
  type Briefing, type SuggestionCard, type ProactiveRoi,
} from './proactive-stub';
import { loadProactivePanels } from './proactive-panels-loader';
import type { DerivedState, PanelActions, SectionResult, SharedCards } from './proactive-panels';
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

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const sentCopy = (audienceCount: number, simulated: boolean) =>
  `Sent to ${audienceCount} customer${audienceCount === 1 ? '' : 's'}${simulated ? ' (simulated — no real SMS was sent).' : '.'}`;

export function createProactive(hooks: ProactiveHooks) {
  let version = 0;
  /** Card ids the user already sent/dismissed this session — every derive consults this. */
  const cardStates = new Map<string, CardState>();
  /** Last send-result copy per card, so re-mounted "Sent" cards keep their honest result line. */
  const cardResults = new Map<string, string>();
  /** Freshest server copy of each card (edit updates draft in place). */
  const latestCards = new Map<string, SuggestionCard>();

  const stack = document.createElement('div');
  stack.className = 'proactive-stack';

  const roiSection = document.createElement('section');
  roiSection.className = 'roi-section';
  roiSection.id = 'proactive-roi';
  roiSection.setAttribute('aria-labelledby', 'proactive-roi-heading');

  // Crew 5 UX: the stack is briefing + suggestions (Today view + chat home).
  // The ROI dashboard lives on its own as the Feed collection's proof
  // stream — it mounts separately in the Feed view.
  const chatHome = document.createElement('section');
  chatHome.className = 'proactive-chat-home';
  chatHome.id = 'proactive-chat-home';
  chatHome.hidden = true;
  chatHome.setAttribute('aria-label', 'Today at a glance');

  const hosts = { stack, roi: roiSection, chatHome };

  const blankDerived = (): DerivedState => ({
    briefing: { kind: 'blank' },
    opportunities: [],
    suggestions: { kind: 'blank' },
    roi: { kind: 'blank' },
    chatBriefing: null,
    chatTopCard: null,
    cardsById: {},
    tz: hooks.timeZone(),
  });
  let derived: DerivedState = blankDerived();

  function sharedSnapshot(): SharedCards {
    const shared: SharedCards = {};
    for (const [id, state] of cardStates) {
      if (state === 'sent') shared[id] = { sent: true, result: cardResults.get(id) };
    }
    return shared;
  }

  function pushAll() {
    chatHome.hidden = derived.chatBriefing == null;
    loadProactivePanels(hosts, { derived, shared: sharedSnapshot(), actions });
  }

  function derive(
    briefingResult: SectionResult<Briefing>,
    suggestionsResult: SectionResult<SuggestionCard[]>,
    roiResult: SectionResult<ProactiveRoi>,
  ): DerivedState {
    const suggestions = suggestionsResult.kind === 'data' ? suggestionsResult.value : null;
    const cardsById: Record<string, SuggestionCard> = {};
    for (const card of suggestions ?? []) cardsById[card.id] = card;
    const briefing = briefingResult.kind === 'data' ? briefingResult.value : null;
    const opportunities = briefing
      ? briefing.opportunities.map((opportunity) => {
          const linked = opportunity.cardId
            ? suggestions?.find((card) => card.id === opportunity.cardId && cardStates.get(card.id) !== 'dismissed')
            : undefined;
          return {
            oneLine: opportunity.oneLine,
            cardId: linked?.id ?? null,
            showActions: Boolean(linked && cardStates.get(linked.id) !== 'sent'),
          };
        })
      : [];
    const filtered = (suggestions ?? []).filter(
      (card) => card.state !== 'dismissed' && cardStates.get(card.id) !== 'dismissed',
    );
    return {
      briefing: briefingResult,
      opportunities,
      suggestions:
        suggestionsResult.kind === 'data' ? { kind: 'data', value: filtered } : suggestionsResult,
      roi: roiResult,
      chatBriefing: briefing,
      chatTopCard: filtered[0] ?? null,
      cardsById,
      tz: hooks.timeZone(),
    };
  }

  const actions: PanelActions = {
    retry: () => void refresh(),
    send: async (card) => {
      const result = await sendSuggestion(hooks.api, hooks.tenant(), card.id);
      cardStates.set(card.id, 'sent');
      // Compliance item 12: honest copy — simulated sends must say so.
      const copy = sentCopy(result.audienceCount, result.simulated);
      cardResults.set(card.id, copy);
      // Sync every mounted copy of the card (stack + chat home) without
      // re-deriving the sections — the imperative sync did the same.
      pushAll();
      return copy;
    },
    editSave: async (card, message) => {
      const updated = await editSuggestion(hooks.api, hooks.tenant(), card.id, message);
      card.draft = { ...card.draft, message: updated.message, audience: updated.audience, audienceCount: updated.audienceCount };
      card.state = updated.state;
    },
    dismissCommit: (card) => {
      cardStates.set(card.id, 'dismissed');
      void dismissSuggestion(hooks.api, hooks.tenant(), card.id).catch((error) => {
        hooks.onNotice(errorMessage(error, 'Could not dismiss the suggestion.'));
      });
    },
    dismissUndo: (id) => {
      cardStates.delete(id);
    },
    saveTicket: async (cents) => {
      await setRoiConfig(hooks.api, hooks.tenant(), cents);
      hooks.onNotice('Average ticket saved — recovered revenue is now live.');
      void refresh();
    },
    navigateToday: () => hooks.onNavigate('today'),
    highlightSuggestion: (id) => highlight(`suggestion:${id}`),
    paint: () => hooks.paint(),
  };

  /* --------------------------------- public --------------------------------- */

  async function settled<T>(promise: Promise<T>): Promise<SectionResult<T>> {
    try {
      const value = await promise;
      return value == null ? { kind: 'unavailable' } : { kind: 'data', value };
    } catch (error) {
      return { kind: 'error', message: errorMessage(error, 'Please try again.') };
    }
  }

  async function refresh() {
    const current = ++version;
    derived = {
      ...derived,
      briefing: { kind: 'loading' },
      opportunities: [],
      suggestions: { kind: 'loading' },
      roi: { kind: 'loading' },
      tz: hooks.timeZone(),
    };
    pushAll();
    const tenantId = hooks.tenant();
    const [briefingResult, suggestionsResult, roiResult] = await Promise.all([
      settled(fetchBriefing(hooks.api, tenantId)),
      settled(fetchSuggestions(hooks.api, tenantId)),
      settled(fetchRoi(hooks.api, tenantId)),
    ]);
    if (current !== version) return;
    const suggestions = suggestionsResult.kind === 'data' ? suggestionsResult.value : null;
    latestCards.clear();
    for (const card of suggestions ?? []) latestCards.set(card.id, card);
    derived = derive(briefingResult, suggestionsResult, roiResult);
    pushAll();
  }

  function reset() {
    version++;
    derived = { ...derived, chatBriefing: null, chatTopCard: null };
    pushAll();
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

  // Warm the panels chunk and render the blank shells up front; the
  // first refresh replaces them with loading, then data.
  pushAll();

  return { stack, roi: roiSection, chatHome, refresh, reset, highlight };
}
