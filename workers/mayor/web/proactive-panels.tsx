import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  formatMoney, pluralize, formatClock, formatDuration, formatBriefingDate, formatAsOf, sparklinePoints,
  type Briefing, type SuggestionCard, type ProactiveRoi,
} from './proactive-stub';

/** Proactive panels (React migration S3): the morning briefing, the
 * suggestion cards, the ROI dashboard, and the chat-home glance —
 * rendered by React 19 from the derived state + shared card-state map
 * that createProactive (proactive-ui.ts) maintains. All fetching, the
 * refresh race guard, and the send/edit/dismiss commits stay in the
 * module; per-mount interaction state (editing, the 5-second undo
 * window, the ticket editor) lives in the components, exactly where
 * the imperative version kept it (per DOM node). */

export type SectionResult<T> =
  | { kind: 'blank' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' }
  | { kind: 'data'; value: T };

export interface OpportunityView {
  oneLine: string;
  cardId: string | null;
  showActions: boolean;
}

export interface DerivedState {
  briefing: SectionResult<Briefing>;
  opportunities: OpportunityView[];
  suggestions: SectionResult<SuggestionCard[]>;
  roi: SectionResult<ProactiveRoi>;
  chatBriefing: Briefing | null;
  chatTopCard: SuggestionCard | null;
  cardsById: Record<string, SuggestionCard>;
  tz: string;
}

export interface SharedCards {
  [id: string]: { sent: boolean; result?: string };
}

export interface PanelActions {
  retry: () => void;
  send: (card: SuggestionCard) => Promise<string>;
  editSave: (card: SuggestionCard, message: string) => Promise<void>;
  dismissCommit: (card: SuggestionCard) => void;
  dismissUndo: (id: string) => void;
  saveTicket: (cents: number) => Promise<void>;
  navigateToday: () => void;
  highlightSuggestion: (id: string) => void;
  paint: () => void;
}

export interface PanelProps {
  derived: DerivedState;
  shared: SharedCards;
  actions: PanelActions;
}

function Icon({ name }: { name: string }) {
  return <i data-lucide={name} aria-hidden="true" />;
}

function SectionHeading({ title, icon, aside, headingId }: { title: string; icon: string; aside?: string; headingId?: string }) {
  return (
    <div className="section-heading">
      <h2 id={headingId}>
        <Icon name={icon} /> {title}
      </h2>
      {aside && <span className="source-note">{aside}</span>}
    </div>
  );
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function TryAgain({ actions }: { actions: PanelActions }) {
  return (
    <button type="button" className="secondary" onClick={actions.retry}>
      Try again
    </button>
  );
}

function usePaint(actions: PanelActions) {
  useEffect(() => {
    actions.paint();
  });
}

/* ------------------------------ suggestion card ------------------------------ */

type CardMode = 'view' | 'edit' | 'undo' | 'gone';

function SuggestionCardView({
  card,
  inChat,
  shared,
  actions,
}: {
  card: SuggestionCard;
  inChat: boolean;
  shared: SharedCards;
  actions: PanelActions;
}) {
  const [mode, setMode] = useState<CardMode>('view');
  const [sending, setSending] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [localResult, setLocalResult] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState(card.draft.message);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const sharedEntry = shared[card.id];
  const sent = sharedEntry ? sharedEntry.sent : card.state === 'sent';
  const resultText = sent ? (sharedEntry?.result ?? localResult ?? '') : (localResult ?? '');

  useEffect(() => {
    if (mode !== 'undo') return;
    // Commit the dismiss only after the 5s undo window — undo means no API call.
    const timer = window.setTimeout(() => {
      actions.dismissCommit(card);
      setMode('gone');
    }, 5000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (mode === 'gone') return null;
  if (mode === 'undo') {
    return (
      <div className="undo-bar" role="status">
        {'Suggestion dismissed.'}
        <button
          type="button"
          className="quiet"
          onClick={() => {
            actions.dismissUndo(card.id);
            setMode('view');
          }}
        >
          <Icon name="undo-2" />
          Undo
        </button>
      </div>
    );
  }

  const doSend = async () => {
    setSending(true);
    try {
      const copy = await actions.send(card);
      setLocalResult(copy);
    } catch (error) {
      setLocalResult(error instanceof Error ? error.message : 'Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const doSaveEdit = async () => {
    const message = draft.trim();
    if (!message) {
      setLocalResult('The message can’t be empty.');
      areaRef.current?.focus();
      return;
    }
    setSavingEdit(true);
    try {
      await actions.editSave(card, message);
      setLocalResult('Preview updated.');
    } catch (error) {
      setLocalResult(error instanceof Error ? error.message : 'Could not save. Please try again.');
    } finally {
      setSavingEdit(false);
      setMode('view');
    }
  };

  return (
    <article className="suggestion-card" data-suggestion-card={card.id} id={inChat ? undefined : `proactive-suggestion-${card.id}`}>
      <div className="row-copy">
        <h3>{card.title}</h3>
        <p>{card.body}</p>
        {mode === 'edit' ? (
          <textarea
            ref={areaRef}
            className="edit-area"
            value={draft}
            rows={4}
            maxLength={320}
            aria-label={`Edit message for “${card.title}”`}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <blockquote className="draft-preview" aria-label="Drafted message preview">
            {card.draft.message}
          </blockquote>
        )}
        <p className="audience-line">{`to ${card.draft.audienceCount} ${card.draft.audience}`}</p>
      </div>
      <div className="card-actions">
        {mode === 'edit' ? (
          <>
            <button type="button" className="primary" disabled={savingEdit} onClick={() => void doSaveEdit()}>
              Save
            </button>
            <button
              type="button"
              className="secondary"
              disabled={savingEdit}
              onClick={() => setMode('view')}
            >
              Cancel
            </button>
          </>
        ) : sent ? (
          <span className="sent-badge">
            Sent
            <Icon name="check" />
          </span>
        ) : (
          <>
            <button type="button" className="secondary" disabled={sending} onClick={() => void doSend()}>
              <Icon name="send" />
              Send
            </button>
            <button
              type="button"
              className="secondary"
              disabled={sending}
              onClick={() => {
                setDraft(card.draft.message);
                setMode('edit');
              }}
            >
              <Icon name="pencil" />
              Edit
            </button>
            <button type="button" className="secondary" disabled={sending} onClick={() => setMode('undo')}>
              <Icon name="x" />
              Dismiss
            </button>
          </>
        )}
      </div>
      <p className="send-result" role="status">
        {resultText}
      </p>
    </article>
  );
}

/* --------------------------------- briefing --------------------------------- */

function OpportunityRow({
  op,
  card,
  actions,
}: {
  op: OpportunityView;
  card: SuggestionCard | undefined;
  actions: PanelActions;
}) {
  const [sending, setSending] = useState(false);
  const [latched, setLatched] = useState(false);
  const [result, setResult] = useState('');
  const doSend = async () => {
    if (!card) return;
    setSending(true);
    try {
      const copy = await actions.send(card);
      setResult(copy);
      setLatched(true);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Could not send. Please try again.');
      setSending(false);
    }
  };
  return (
    <div className="opportunity-row">
      <p>
        <Icon name="lightbulb" />
        {op.oneLine}
      </p>
      {op.showActions && card && (
        <>
          <div className="opportunity-actions">
            <button type="button" className="secondary" disabled={sending || latched} onClick={() => void doSend()}>
              Send
            </button>
            <button type="button" className="quiet" onClick={() => actions.highlightSuggestion(card.id)}>
              Details
            </button>
          </div>
          <p className="opportunity-result" role="status">
            {result}
          </p>
        </>
      )}
    </div>
  );
}

function BriefingSection({ derived, shared, actions }: PanelProps) {
  usePaint(actions);
  const result = derived.briefing;
  if (result.kind === 'blank') return <section className="briefing-section" id="proactive-briefing" aria-labelledby="proactive-briefing-heading" />;
  if (result.kind === 'loading') {
    return (
      <section className="briefing-section" id="proactive-briefing" aria-labelledby="proactive-briefing-heading">
        <SectionHeading title="Morning briefing" icon="sun" />
        <p className="loading-state">Loading your morning briefing…</p>
      </section>
    );
  }
  if (result.kind === 'error') {
    return (
      <section className="briefing-section" id="proactive-briefing" aria-labelledby="proactive-briefing-heading">
        <SectionHeading title="Morning briefing" icon="sun" />
        <EmptyState title="The briefing could not load." detail={result.message} action={<TryAgain actions={actions} />} />
      </section>
    );
  }
  if (result.kind === 'unavailable') {
    return (
      <section className="briefing-section" id="proactive-briefing" aria-labelledby="proactive-briefing-heading">
        <SectionHeading title="Morning briefing" icon="sun" />
        <EmptyState
          title="The morning briefing isn’t available yet."
          detail="Your assistant’s proactive engine is still being connected — no numbers are shown until it is live."
        />
      </section>
    );
  }
  const data = result.value;
  const revenue = data.yesterday.revenueCents == null ? 'revenue not configured' : formatMoney(data.yesterday.revenueCents);
  const missed = data.missedCalls;
  const gaps = data.today.gaps.length
    ? ` · gap ${data.today.gaps.map((gap) => `${formatClock(gap.start, derived.tz)}–${formatClock(gap.end, derived.tz)}`).join(', ')}`
    : '';
  return (
    <section className="briefing-section" id="proactive-briefing" aria-labelledby="proactive-briefing-heading">
      <SectionHeading title="Morning briefing" icon="sun" aside={`as of ${formatAsOf(data.generatedAt, derived.tz)}`} headingId="proactive-briefing-heading" />
      <p className="briefing-date">
        <Icon name="sun" />
        {formatBriefingDate(data.date)}
      </p>
      <ul className="briefing-lines">
        <li>
          <strong>Yesterday: </strong>
          {`${pluralize(data.yesterday.appointments, 'appointment')} · ${pluralize(data.yesterday.noShows, 'no-show')} · ${revenue}`}
        </li>
        <li>
          <strong>Missed calls: </strong>
          {missed.total === 0 ? 'none' : `${missed.total} — ${missed.textedBack} texted back, ${missed.recovered} rebooked ✓`}
        </li>
        <li>
          <strong>Today: </strong>
          {`${pluralize(data.today.appointments, 'appointment')}${gaps}`}
        </li>
      </ul>
      {data.opportunities.length > 0 && (
        <div className="opportunity-list">
          {data.opportunities.map((opportunity, i) => {
            const opView = derived.opportunities[i] ?? { oneLine: opportunity.oneLine, cardId: null, showActions: false };
            return (
              <OpportunityRow
                key={opportunity.cardId ?? `op-${i}`}
                op={opView}
                card={opView.cardId ? derived.cardsById[opView.cardId] : undefined}
                actions={actions}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/* -------------------------------- suggestions -------------------------------- */

function SuggestionsSection({ derived, shared, actions }: PanelProps) {
  usePaint(actions);
  const [expanded, setExpanded] = useState(false);
  const result = derived.suggestions;
  // A fresh fetch resets the "+N more" expansion, like the imperative
  // renderer's fresh DOM did. Sync pushes keep the same result object.
  useEffect(() => {
    setExpanded(false);
  }, [result]);
  if (result.kind === 'blank') return <section className="suggestions-section" id="proactive-suggestions" aria-labelledby="proactive-suggestions-heading" />;
  if (result.kind === 'loading') {
    return (
      <section className="suggestions-section" id="proactive-suggestions" aria-labelledby="proactive-suggestions-heading">
        <SectionHeading title="Suggestions" icon="lightbulb" />
        <p className="loading-state">Loading suggestions…</p>
      </section>
    );
  }
  if (result.kind === 'error') {
    return (
      <section className="suggestions-section" id="proactive-suggestions" aria-labelledby="proactive-suggestions-heading">
        <SectionHeading title="Suggestions" icon="lightbulb" />
        <EmptyState title="Suggestions could not load." detail={result.message} action={<TryAgain actions={actions} />} />
      </section>
    );
  }
  if (result.kind === 'unavailable') {
    return (
      <section className="suggestions-section" id="proactive-suggestions" aria-labelledby="proactive-suggestions-heading">
        <SectionHeading title="Suggestions" icon="lightbulb" headingId="proactive-suggestions-heading" />
        <EmptyState
          title="Suggestions aren’t available yet."
          detail="Your assistant’s proactive engine is still being connected — suggested messages will appear here."
        />
      </section>
    );
  }
  const cards = result.value;
  const visible = expanded ? cards : cards.slice(0, 3);
  return (
    <section className="suggestions-section" id="proactive-suggestions" aria-labelledby="proactive-suggestions-heading">
      <SectionHeading
        title="Suggestions"
        icon="lightbulb"
        aside={cards.length ? `${cards.length} for you` : undefined}
        headingId="proactive-suggestions-heading"
      />
      {cards.length === 0 ? (
        <EmptyState
          title="Nothing needs a nudge right now."
          detail="When your assistant spots a win-back, review, or rebooking opportunity, it will appear here."
        />
      ) : (
        <>
          <div className="suggestion-list">
            {visible.map((card) => (
              <SuggestionCardView key={card.id} card={card} inChat={false} shared={shared} actions={actions} />
            ))}
          </div>
          {!expanded && cards.length > 3 && (
            <button type="button" className="quiet" onClick={() => setExpanded(true)}>
              {`+${cards.length - 3} more`}
            </button>
          )}
          <p className="source-note">Quiet hours and daily limits are handled for you — what you see here is ready to act on.</p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------ ROI ------------------------------------ */

function RoiTile({ label, value, note, spark }: { label: string; value: string; note: string; spark?: string }) {
  return (
    <article className="roi-tile">
      <h3>{label}</h3>
      <p className="roi-value">{value}</p>
      {spark && (
        <svg viewBox="0 0 120 36" className="sparkline" role="img">
          <title>No-show rate trend, last 6 months</title>
          <polyline points={spark} />
        </svg>
      )}
      <p className="roi-note">{note}</p>
    </article>
  );
}

function RevenueTile({ data, actions }: { data: ProactiveRoi; actions: PanelActions }) {
  const configured = data.recoveredRevenueCents != null;
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openEditor = () => {
    setErr('');
    setInputVal(data.avgTicketCents != null ? (data.avgTicketCents / 100).toFixed(2).replace(/\.00$/, '') : '');
    setEditing(true);
  };

  const doSave = async () => {
    const dollars = Number(inputVal.trim().replace(/[$,\s]/g, ''));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setErr('Enter an amount greater than $0.');
      inputRef.current?.focus();
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents > 100_000_00) {
      setErr('That looks too high — enter your average ticket.');
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await actions.saveTicket(cents);
      // Success triggers a module refresh, which re-renders this tile.
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not save. Please try again.');
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="roi-tile-wrap">
        <button
          type="button"
          className="roi-tile"
          aria-label={
            configured
              ? `Recovered revenue ${formatMoney(data.recoveredRevenueCents as number)}. Activate to change your average ticket.`
              : 'Recovered revenue is not configured. Activate to set your average ticket.'
          }
          onClick={openEditor}
        >
          <h3>Recovered revenue</h3>
          <p className="roi-value">{configured ? formatMoney(data.recoveredRevenueCents as number) : 'Not configured'}</p>
          <p className="roi-note">{configured ? 'Tap to change your average ticket' : 'Tap to set your average ticket — 10 seconds'}</p>
        </button>
      </div>
    );
  }
  return (
    <div className="roi-tile-wrap">
      <div className="roi-tile roi-config" role="group" aria-label="Average ticket">
        <label htmlFor="roi-avg-ticket">Average ticket ($)</label>
        <input
          ref={inputRef}
          id="roi-avg-ticket"
          inputMode="decimal"
          autoComplete="off"
          placeholder="75"
          value={inputVal}
          autoFocus
          onChange={(event) => setInputVal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void doSave();
            }
          }}
        />
        <p className="roi-config-error" role="alert">
          {err}
        </p>
        <div className="row">
          <button type="button" className="primary" disabled={saving} onClick={() => void doSave()}>
            Save
          </button>
          <button
            type="button"
            className="secondary"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function RoiSection({ derived, shared, actions }: PanelProps) {
  usePaint(actions);
  const result = derived.roi;
  if (result.kind === 'blank') return null;
  if (result.kind === 'loading') {
    return (
      <>
        <SectionHeading title="This month with The Mayor" icon="trending-up" />
        <p className="loading-state">Loading your ROI dashboard…</p>
      </>
    );
  }
  if (result.kind === 'error') {
    return (
      <>
        <SectionHeading title="This month with The Mayor" icon="trending-up" />
        <EmptyState title="The ROI dashboard could not load." detail={result.message} action={<TryAgain actions={actions} />} />
      </>
    );
  }
  if (result.kind === 'unavailable') {
    return (
      <>
        <SectionHeading title="This month with The Mayor" icon="trending-up" headingId="proactive-roi-heading" />
        <EmptyState
          title="Your ROI dashboard will live here."
          detail="Every number here will come from your real business data, with the time it was measured — nothing is estimated."
        />
      </>
    );
  }
  const data = result.value;
  const asOf = `as of ${formatAsOf(data.generatedAt, derived.tz)}`;
  return (
    <>
      <SectionHeading title="This month with The Mayor" icon="trending-up" aside={asOf} headingId="proactive-roi-heading" />
      <div className="roi-grid">
        <RevenueTile data={data} actions={actions} />
        <RoiTile label="Appointments booked by Mayor" value={String(data.appointmentsBookedByMayor)} note={`${asOf} · this month`} />
        <RoiTile
          label="Missed calls recovered"
          value={`${data.missedCallsRecovered.recovered}/${data.missedCallsRecovered.total}`}
          note={`${asOf} · this month`}
        />
        <RoiTile
          label="Avg response time"
          value={data.avgResponseTimeSeconds == null ? 'No data yet' : formatDuration(data.avgResponseTimeSeconds)}
          note={asOf}
        />
        <RoiTile
          label="No-show rate"
          value={data.noShowRate == null ? 'No data yet' : `${Math.round(data.noShowRate * 100)}%`}
          note={`${asOf} · last 6 months`}
          spark={sparklinePoints(data.noShowTrend)}
        />
      </div>
    </>
  );
}

/* --------------------------------- chat home --------------------------------- */

export function ChatHomePanel({ derived, shared, actions }: PanelProps) {
  usePaint(actions);
  const briefing = derived.chatBriefing;
  if (!briefing) return null;
  const summary = `${formatBriefingDate(briefing.date)} · ${pluralize(briefing.today.appointments, 'appointment')} · ${
    briefing.missedCalls.total === 0 ? 'no missed calls' : pluralize(briefing.missedCalls.total, 'missed call')
  }`;
  return (
    <>
      <h2>Today at a glance</h2>
      <p className="chat-home-summary">{summary}</p>
      {derived.chatTopCard && (
        <SuggestionCardView key={derived.chatTopCard.id} card={derived.chatTopCard} inChat={true} shared={shared} actions={actions} />
      )}
      <button type="button" className="quiet" onClick={actions.navigateToday}>
        Review in Today
      </button>
    </>
  );
}

/* ---------------------------------- mounts ---------------------------------- */

export interface ProactiveHosts {
  stack: HTMLElement;
  roi: HTMLElement;
  chatHome: HTMLElement;
}

const roots = new Map<HTMLElement, Root>();

function renderInto(element: HTMLElement, node: React.ReactNode): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(node);
}

export function mountProactivePanels(hosts: ProactiveHosts, props: PanelProps): void {
  renderInto(
    hosts.stack,
    <>
      <BriefingSection {...props} />
      <SuggestionsSection {...props} />
    </>,
  );
  renderInto(hosts.roi, <RoiSection {...props} />);
  renderInto(hosts.chatHome, <ChatHomePanel {...props} />);
}
