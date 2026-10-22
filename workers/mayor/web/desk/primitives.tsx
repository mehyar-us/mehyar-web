/**
 * desk/primitives.tsx — the primitive catalog (Reinvention
 * Slice 1, blueprint §3.2; Slice 2 adds the engine's cards). One
 * renderer per primitive; the Desk stream is a composition of these
 * and nothing else. Chrome never shares the Draft register: the
 * Draft is paper within the product, rendered only inside the
 * action and shadow cards that carry one.
 *
 * Token discipline (§3.4): type sizes come only from the scale
 * (13/15/17/20/24/32/40), weights 400/600/700, targets ≥44px — the
 * values live in desk.css; a style not expressible there does not
 * exist. Confidence, where a surface ever implies it, is a visual
 * treatment only — no primitive in this catalog can render a number
 * as a confidence.
 */
import { useState, type ReactNode } from 'react';
import {
  degradeIntent,
  isRenderable,
  type ActionCardIntent,
  type ChipIntent,
  type DeskIntent,
  type EmptyIntent,
  type FactIntent,
  type GrantCardIntent,
  type InlineErrorIntent,
  type IntentRibbonIntent,
  type LineIntent,
  type PersonIntent,
  type ReceiptIntent,
  type ScenarioCardIntent,
  type SeatsLineIntent,
  type ShadowCardIntent,
  type SkeletonIntent,
  type StatIntent,
} from './intents';

export type ActionVerb = 'approve' | 'dismiss' | 'edit';
export type ActionVerbHandler = (actionId: string, verb: ActionVerb, text?: string) => void;
export type ScenarioRulingHandler = (scenarioId: string, allowed: boolean) => void;
export type RevokeGrantHandler = (grantId: string) => void;

export function Line({ intent }: { intent: LineIntent }) {
  return <p className={`desk-line${intent.tone === 'muted' ? ' desk-line-muted' : ''}`}>{intent.text}</p>;
}

export function Receipt({ intent }: { intent: ReceiptIntent }) {
  return (
    <div className="desk-receipt" role="status">
      <p className="desk-receipt-text">{intent.text}</p>
      {intent.detail ? <p className="desk-receipt-detail">{intent.detail}</p> : null}
    </div>
  );
}

export function Fact({ intent }: { intent: FactIntent }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(intent.value).then(done, done);
    } else done();
  };
  return (
    <div className="desk-fact">
      <span className="desk-fact-label">
        {intent.label}
        {intent.qualifier ? <span className="desk-fact-qualifier"> · {intent.qualifier}</span> : null}
      </span>
      <span className="desk-fact-row">
        <span className="desk-fact-value">{intent.value}</span>
        {intent.copyable ? (
          <button type="button" className="desk-copy" onClick={copy} aria-label={`Copy ${intent.label}`}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function Stat({ intent }: { intent: StatIntent }) {
  return (
    <div className="desk-stat">
      <span className="desk-stat-value">{intent.value}</span>
      <span className="desk-stat-label">{intent.label}</span>
      {intent.context ? <span className="desk-stat-context">{intent.context}</span> : null}
      {intent.stale ? <span className="desk-stat-stale">{intent.stale}</span> : null}
    </div>
  );
}

export function Person({ intent }: { intent: PersonIntent }) {
  const initials = intent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div className="desk-person">
      <span className="desk-person-avatar" aria-hidden="true">
        {initials || '·'}
      </span>
      <span className="desk-person-copy">
        <span className="desk-person-name">{intent.name}</span>
        {intent.context ? <span className="desk-person-context">{intent.context}</span> : null}
      </span>
      {intent.state === 'new' ? <span className="desk-person-state">New</span> : null}
    </div>
  );
}

export function Chip({ intent, onSelect }: { intent: ChipIntent; onSelect?: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`desk-chip${intent.selected ? ' desk-chip-selected' : ''}`}
      aria-pressed={intent.selected ? true : undefined}
      onClick={onSelect ? () => onSelect(intent.id) : undefined}
    >
      {intent.label}
      {typeof intent.count === 'number' ? <span className="desk-chip-count">{intent.count}</span> : null}
    </button>
  );
}

export function Skeleton({ intent }: { intent: SkeletonIntent }) {
  return <div className={`desk-skeleton desk-skeleton-${intent.shape}`} aria-hidden="true" />;
}

export function Empty({ intent, onAction }: { intent: EmptyIntent; onAction?: (id: string) => void }) {
  return (
    <div className="desk-empty">
      <p className="desk-empty-text">{intent.text}</p>
      {intent.actionLabel && onAction ? (
        <button type="button" className="desk-empty-action" onClick={() => onAction(intent.id)}>
          {intent.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function InlineError({ intent, onRetry }: { intent: InlineErrorIntent; onRetry?: (id: string) => void }) {
  return (
    <div className="desk-inline-error" role="alert">
      <p className="desk-inline-error-text">{intent.text}</p>
      {intent.retryLabel && onRetry ? (
        <button type="button" className="desk-inline-error-retry" onClick={() => onRetry(intent.id)}>
          {intent.retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function SeatsLine({ intent }: { intent: SeatsLineIntent }) {
  if (intent.soldOut) {
    return (
      <p className="desk-seats-line">
        {intent.seats
          ? `Founding is full — all ${intent.seats.total} seats are claimed. The standard plan is the way in now.`
          : 'Founding is full. The standard plan is the way in now.'}
      </p>
    );
  }
  // Fail-quiet is a designed state: a count we cannot verify renders
  // the static line with NO number — never a guessed count (§3.2).
  if (!intent.seats) {
    return <p className="desk-seats-line">Founding pricing — {intent.priceLabel}, for the first owners while seats last.</p>;
  }
  return (
    <p className="desk-seats-line">
      Founding — {intent.priceLabel} · {intent.seats.remaining} of {intent.seats.total} seats left
    </p>
  );
}

export function IntentRibbon({
  intent,
  onDismiss,
}: {
  intent: IntentRibbonIntent;
  onDismiss?: (id: string) => void;
}) {
  return (
    <div className={`desk-ribbon desk-ribbon-${intent.state}`} role="status">
      <div className="desk-ribbon-copy">
        <p className="desk-ribbon-headline">{intent.headline}</p>
        {intent.detail ? <p className="desk-ribbon-detail">{intent.detail}</p> : null}
        {intent.state !== 'unhonorable' && intent.priceLabel ? (
          <p className="desk-ribbon-price">
            {intent.priceLabel}
            {intent.seats ? ` · ${intent.seats.remaining} of ${intent.seats.total} seats left` : ''}
          </p>
        ) : null}
        {intent.state === 'unhonorable' && intent.alternativeLabel ? (
          <p className="desk-ribbon-price">{intent.alternativeLabel}</p>
        ) : null}
      </div>
      {onDismiss ? (
        <button type="button" className="desk-ribbon-dismiss" aria-label="Dismiss this plan" onClick={() => onDismiss(intent.id)}>
          ×
        </button>
      ) : null}
    </div>
  );
}

/** The Draft register: the words that would go to a customer,
 * rendered as paper within the product (the paper ground, its own
 * block) — visibly distinct from chrome, which never uses it. */
export function Draft({ text }: { text: string }) {
  return (
    <div className="desk-draft">
      <p className="desk-draft-text">{text}</p>
    </div>
  );
}

export function ActionCard({
  intent,
  onActionVerb,
}: {
  intent: ActionCardIntent;
  onActionVerb?: ActionVerbHandler;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(intent.draftText ?? '');
  return (
    <div className={`desk-card desk-action-card desk-action-${intent.state}`}>
      <div className="desk-card-head">
        <p className="desk-card-headline">{intent.headline}</p>
        {intent.personName ? <p className="desk-card-person">{intent.personName}</p> : null}
      </div>
      {intent.draftText ? <Draft text={intent.draftText} /> : null}
      {intent.basisLine ? <p className="desk-card-basis">{intent.basisLine}</p> : null}
      {editing ? (
        <div className="desk-card-edit-wrap">
          <label className="desk-card-edit-label" htmlFor={`desk-edit-${intent.id}`}>
            Edit the message
          </label>
          <textarea
            id={`desk-edit-${intent.id}`}
            className="desk-card-edit"
            value={draft}
            rows={4}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      ) : null}
      <div className="desk-card-actions">
        <button
          type="button"
          className="desk-card-primary"
          onClick={onActionVerb ? () => onActionVerb(intent.actionId, 'approve') : undefined}
        >
          {intent.primaryLabel}
        </button>
        {intent.draftText ? (
          editing ? (
            <button
              type="button"
              className="desk-card-verb"
              onClick={
                onActionVerb
                  ? () => {
                      onActionVerb(intent.actionId, 'edit', draft);
                      setEditing(false);
                    }
                  : undefined
              }
            >
              Save
            </button>
          ) : (
            <button type="button" className="desk-card-verb" onClick={() => setEditing(true)}>
              Edit
            </button>
          )
        ) : null}
        <button
          type="button"
          className="desk-card-quiet"
          onClick={onActionVerb ? () => onActionVerb(intent.actionId, 'dismiss') : undefined}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function ShadowCard({
  intent,
  onActionVerb,
}: {
  intent: ShadowCardIntent;
  onActionVerb?: ActionVerbHandler;
}) {
  return (
    <div className="desk-card desk-shadow-card">
      <div className="desk-card-head">
        <p className="desk-card-headline">{intent.headline}</p>
        {intent.personName ? <p className="desk-card-person">{intent.personName}</p> : null}
      </div>
      {intent.draftText ? <Draft text={intent.draftText} /> : null}
      <div className="desk-card-provenance">
        <p className="desk-card-provenance-line">Under your rule: “{intent.provenance.ruleText}”</p>
        <p className="desk-card-provenance-line">Because: {intent.provenance.predicate}</p>
      </div>
      {intent.nearBoundary ? (
        <p className="desk-card-near">Close to the edge of your rule — worth a look.</p>
      ) : null}
      <div className="desk-card-actions">
        <button
          type="button"
          className="desk-card-primary"
          onClick={onActionVerb ? () => onActionVerb(intent.actionId, 'approve') : undefined}
        >
          {"That's right"}
        </button>
        <button
          type="button"
          className="desk-card-quiet"
          onClick={onActionVerb ? () => onActionVerb(intent.actionId, 'dismiss') : undefined}
        >
          Not right
        </button>
      </div>
    </div>
  );
}

export function ScenarioCard({
  intent,
  onRuleScenario,
}: {
  intent: ScenarioCardIntent;
  onRuleScenario?: ScenarioRulingHandler;
}) {
  return (
    <div className="desk-card desk-scenario-card">
      <p className="desk-scenario-prompt">{intent.prompt}</p>
      <div className="desk-card-actions">
        <button
          type="button"
          className="desk-card-primary"
          onClick={onRuleScenario ? () => onRuleScenario(intent.scenarioId, true) : undefined}
        >
          Allowed
        </button>
        <button
          type="button"
          className="desk-card-verb"
          onClick={onRuleScenario ? () => onRuleScenario(intent.scenarioId, false) : undefined}
        >
          Blocked
        </button>
      </div>
    </div>
  );
}

const GRANT_STATE_WORDS: Record<GrantCardIntent['state'], string> = {
  proposed: 'Proposed',
  probed: 'Checked',
  shadow: 'Watching — would-have-sent mode',
  live: 'Live',
  narrowed: 'Narrowed',
  revoked: 'Revoked',
  expired: 'Expired',
};

export function GrantCard({
  intent,
  onRevokeGrant,
}: {
  intent: GrantCardIntent;
  onRevokeGrant?: RevokeGrantHandler;
}) {
  const closed = intent.state === 'revoked' || intent.state === 'expired';
  return (
    <div className={`desk-card desk-grant-card desk-grant-${intent.state}${closed ? ' desk-grant-closed' : ''}`}>
      <p className="desk-grant-owner">“{intent.ownerWords}”</p>
      <p className="desk-grant-summary">{intent.summaryText}</p>
      {intent.neverLines.length ? (
        <ul className="desk-grant-never">
          {intent.neverLines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {intent.scopeChips.length ? (
        <div className="desk-grant-chips">
          {intent.scopeChips.map((chip, index) => (
            <span key={`${index}-${chip}`} className="desk-grant-chip">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      <p className="desk-grant-state">{GRANT_STATE_WORDS[intent.state]}</p>
      {intent.actsCount > 0 ? (
        <p className="desk-grant-acts">
          {intent.actsCount} {intent.actsCount === 1 ? 'act' : 'acts'} under this rule
        </p>
      ) : null}
      {!closed ? (
        <div className="desk-card-actions">
          <button
            type="button"
            className="desk-card-quiet"
            onClick={onRevokeGrant ? () => onRevokeGrant(intent.grantId) : undefined}
          >
            Revoke
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The dispatcher: exactly one renderer per catalog primitive.
 * Unknown types and newer versions degrade to a Line carrying the
 * intent's mandatory summary; money intents degrade non-actionably
 * (a plain Line, no controls) — §3.2's degradation contract. */
export function IntentView({
  intent,
  onDismissIntent,
  onRetryIntent,
  onActionVerb,
  onRuleScenario,
  onRevokeGrant,
}: {
  intent: DeskIntent | { type: string; version: number; summary?: string; id: string };
  onDismissIntent?: (id: string) => void;
  onRetryIntent?: (id: string) => void;
  onActionVerb?: ActionVerbHandler;
  onRuleScenario?: ScenarioRulingHandler;
  onRevokeGrant?: RevokeGrantHandler;
}) {
  if (!isRenderable(intent)) {
    const degraded = degradeIntent(intent);
    return <p className="desk-line desk-line-degraded">{degraded.text}</p>;
  }
  const known = intent as DeskIntent;
  switch (known.type) {
    case 'line':
      return <Line intent={known} />;
    case 'receipt':
      return <Receipt intent={known} />;
    case 'fact':
      return <Fact intent={known} />;
    case 'stat':
      return <Stat intent={known} />;
    case 'person':
      return <Person intent={known} />;
    case 'chip':
      return <Chip intent={known} />;
    case 'skeleton':
      return <Skeleton intent={known} />;
    case 'empty':
      return <Empty intent={known} />;
    case 'inline-error':
      return <InlineError intent={known} onRetry={onRetryIntent} />;
    case 'intent-ribbon':
      return <IntentRibbon intent={known} onDismiss={onDismissIntent} />;
    case 'seats-line':
      return <SeatsLine intent={known} />;
    case 'action-card':
      return <ActionCard intent={known} onActionVerb={onActionVerb} />;
    case 'shadow-card':
      return <ShadowCard intent={known} onActionVerb={onActionVerb} />;
    case 'scenario-card':
      return <ScenarioCard intent={known} onRuleScenario={onRuleScenario} />;
    case 'grant-card':
      return <GrantCard intent={known} onRevokeGrant={onRevokeGrant} />;
    default:
      return <p className="desk-line desk-line-degraded">{degradeIntent(known).text}</p>;
  }
}

/** The Morning Line (§3.2): the pinned state strip — business name,
 * up to 3 Stats, and the one-line status. Part of the Desk chrome,
 * not a stream intent. */
export function MorningLine({
  businessName,
  statusLine,
  stats,
}: {
  businessName: string;
  statusLine?: string;
  stats?: Array<{ label: string; value: string; context?: string; stale?: string }>;
}) {
  return (
    <div className="desk-morning-line">
      <div className="desk-morning-head">
        <span className="desk-morning-name">{businessName}</span>
        {statusLine ? <span className="desk-morning-status">{statusLine}</span> : null}
      </div>
      {stats && stats.length ? (
        <div className="desk-morning-stats">
          {stats.slice(0, 3).map((stat, index) => (
            <Stat
              key={`${stat.label}-${index}`}
              intent={{
                id: `morning-stat-${index}`,
                version: 1,
                type: 'stat',
                summary: `${stat.label}: ${stat.value}`,
                label: stat.label,
                value: stat.value,
                context: stat.context,
                stale: stat.stale,
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The Bar (§3.1): the composer, permanently docked — mic primary,
 * text field, send. Voice is not a mode; the mic is a button in the
 * same breath as typing. In the live shell the existing dock serves
 * this role in v1; this component is the catalog's Bar — rendered by
 * the Desk fixtures and ready to own the dock in the view-merge
 * slice. All targets ≥44px (desk.css). */
export function Bar({
  placeholder = 'Ask Mayor…',
  disabled = false,
  onSubmit,
  onTalk,
}: {
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: (text: string) => void;
  onTalk?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    onSubmit?.(text);
    setDraft('');
  };
  return (
    <form className="desk-bar" onSubmit={submit}>
      <button type="button" className="desk-bar-talk" aria-label="Talk to The Mayor" disabled={disabled} onClick={onTalk}>
        <span aria-hidden="true">●</span>
      </button>
      <label className="desk-bar-label" htmlFor="desk-bar-input">
        Ask The Mayor about your business
      </label>
      <input
        id="desk-bar-input"
        className="desk-bar-input"
        type="text"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="desk-bar-send" aria-label="Send message" disabled={disabled || !draft.trim()}>
        ↑
      </button>
    </form>
  );
}

export type { ReactNode };
