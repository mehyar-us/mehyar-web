import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * In-conversation connector cards (React migration S5b).
 *
 * Renders the `connector_card` chat events the worker emits during a
 * turn (see src/connector-cards.ts). The exported mount fills the host
 * element renderConnectorCard (connector-cards.ts) creates, so callers
 * keep the same synchronous insert-then-render contract.
 *
 * SECRET BOUNDARY (compliance-critical, unchanged): the key capture
 * form posts the secret DIRECTLY to /connections/add, which encrypts
 * it at rest. The secret never goes into chat text, never reaches the
 * model, and — by deliberate design here — never enters React state:
 * the capture inputs are uncontrolled, read from the DOM at submit,
 * and cleared the moment the save finishes. Masked display after save
 * ("••••1234") is computed from the value the owner just typed — it is
 * never persisted or logged.
 *
 * Accessibility: real <button>s, native <details> for the guide, a real
 * <form> with labels, aria-live status for save results.
 */

export interface ConnectorCardAction {
  id: 'connect_oauth' | 'show_guide' | 'enter_key' | 'reconnect' | 'dismiss' | 'open_connections' | 'confirm_done' | 'phone_handoff';
  label: string;
  provider?: 'google' | 'microsoft' | 'zoho';
  capabilities?: string[];
  endpoint?: string;
}
export interface ConnectorCardPayload {
  id: string;
  kind: 'offer' | 'guide' | 'credential' | 'reconnect' | 'oauth' | 'status';
  service: string;
  name: string;
  title: string;
  body: string;
  unlocks?: string;
  guide?: { steps: string[]; note?: string; docUrl?: string };
  endpoint?: string;
  actions: ConnectorCardAction[];
  state: string;
  /** One Connector session backing (P3): actions drive this engine session. */
  sessionId?: string;
  sessionState?: string;
  /** Phone-handoff deep link for this session (P3 slice 2). */
  handoffUrl?: string;
}
export interface ConnectorCardHooks {
  api: (path: string, body?: unknown) => Promise<any>;
  tenant: () => string;
  signIn: (provider: string, capabilities: string[]) => Promise<void>;
  onNotice: (message: string) => void;
}

/** Minimal shape check before rendering an event payload (mirrors the
 * copy in connector-cards.ts; kept local to avoid an import cycle). */
function isCardPayload(value: unknown): value is ConnectorCardPayload {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  return typeof card.id === 'string' && typeof card.title === 'string' && typeof card.body === 'string'
    && ['offer', 'guide', 'credential', 'reconnect', 'oauth', 'status'].includes(card.kind as string)
    && Array.isArray(card.actions);
}

const maskTail = (secret: string) => '••••' + secret.slice(-4);

type Mode = 'default' | 'guide' | 'capture' | 'saved' | 'saved-unlinked';

function ConnectorCardInner({ card, hooks, onDismiss }: { card: ConnectorCardPayload; hooks: ConnectorCardHooks; onDismiss: () => void }) {
  const [current, setCurrent] = useState(card);
  const [generation, setGeneration] = useState(0);
  return (
    <ConnectorCardGeneration
      key={generation}
      card={current}
      hooks={hooks}
      onDismiss={onDismiss}
      onRefreshed={(fresh) => {
        setCurrent(fresh);
        setGeneration((value) => value + 1);
      }}
    />
  );
}

function ConnectorCardGeneration({
  card,
  hooks,
  onDismiss,
  onRefreshed,
}: {
  card: ConnectorCardPayload;
  hooks: ConnectorCardHooks;
  onDismiss: () => void;
  onRefreshed: (fresh: ConnectorCardPayload) => void;
}) {
  const [mode, setMode] = useState<Mode>(card.kind === 'guide' ? 'guide' : card.kind === 'credential' ? 'capture' : 'default');
  const [status, setStatus] = useState('');
  const [guideOpen, setGuideOpen] = useState(true);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [masked, setMasked] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);
  const endpointRef = useRef<HTMLInputElement>(null);

  const sessionBase = card.sessionId
    ? `/api/businesses/${encodeURIComponent(hooks.tenant())}/connector-engine/sessions/${card.sessionId}`
    : null;

  useEffect(() => {
    if (mode === 'capture') keyRef.current?.focus();
  }, [mode]);

  /* One Connector session cards (P3): actions drive the engine session and
   * the card re-reads itself from the server after each step, so a failed
   * verify that walks to the next method simply renders the next card. */
  const refreshCard = async () => {
    if (!sessionBase) return;
    const event = await hooks.api(`${sessionBase}/card`);
    const fresh = (event as { card?: unknown })?.card;
    if (fresh && isCardPayload(fresh)) onRefreshed(fresh);
  };
  const driveSession = async () => {
    if (!sessionBase) return;
    try { await hooks.api(`${sessionBase}/begin`, {}); } catch { /* begin is idempotent; a moved-on state still gets verified and re-read */ }
    try {
      await hooks.api(`${sessionBase}/verify`, {});
    } catch (error) {
      hooks.onNotice(error instanceof Error ? error.message : 'The connection could not be verified yet.');
    }
    await refreshCard().catch(() => { /* the pre-action card stays if the re-read fails */ });
  };

  const connectOAuth = (action: ConnectorCardAction) => {
    if (!action.provider) return;
    setStatus('Opening secure sign-in…');
    void (async () => {
      try {
        await hooks.signIn(action.provider!, action.capabilities ?? []);
        if (sessionBase) {
          setStatus('Checking the connection…');
          await driveSession();
        }
      } catch {
        setStatus('Sign-in could not start. Please try again.');
      }
    })();
  };

  const copyHandoff = () => {
    void navigator.clipboard?.writeText(card.handoffUrl!).then(
      () => { setStatus('Link copied — open it on your phone.'); },
      () => { setStatus('Copy the link above and open it on your phone.'); });
  };

  const submitCapture = (event: React.FormEvent) => {
    event.preventDefault();
    const keyInput = keyRef.current;
    const endpointInput = endpointRef.current;
    if (!keyInput || !endpointInput || saving) return;
    setSaving(true);
    setStatus('Saving…');
    void (async () => {
      const requestId = crypto.randomUUID();
      const body: Record<string, unknown> = {
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
        const maskedValue = maskTail(keyInput.value);
        // Clear the DOM immediately: nothing secret lingers in the page.
        keyInput.value = '';
        body.secret = '';
        if (sessionBase) {
          // Session card: link the saved connection to the engine session
          // and let the engine's verify be the only "connected" truth.
          const connectionId = (result as { id?: string; connection?: { id?: string } })?.id
            ?? (result as { connection?: { id?: string } })?.connection?.id;
          if (!connectionId) throw new Error('Your key was saved, but it could not be linked to this connection attempt. Open Connections to finish it.');
          setStatus('Key saved — checking it now…');
          try { await hooks.api(`${sessionBase}/begin`, {}); } catch { /* idempotent */ }
          await hooks.api(`${sessionBase}/attach`, { connectionId });
          try {
            await hooks.api(`${sessionBase}/verify`, {});
          } catch (error) {
            hooks.onNotice(error instanceof Error ? error.message : 'The key could not be verified.');
          }
          await refreshCard().catch(() => {
            setMode('saved-unlinked');
          });
          return;
        }
        setMasked(maskedValue);
        setMode('saved');
        hooks.onNotice(`${card.name} connected. Key saved securely.`);
      } catch (error) {
        keyInput.value = '';
        setStatus(error instanceof Error ? error.message : 'The key could not be saved. Please try again.');
        setSaving(false);
      }
    })();
  };

  if (mode === 'saved') {
    return (
      <>
        <h2>{`${card.name} connected`}</h2>
        <p className="connector-card-body">{`Your key is saved in secure storage and will never be shown again (${masked}).`}</p>
        <button type="button" className="secondary" onClick={() => document.getElementById('open-connections')?.click()}>
          View in Connections
        </button>
      </>
    );
  }
  if (mode === 'saved-unlinked') {
    return (
      <>
        <h2>{`${card.name} key saved`}</h2>
        <p className="connector-card-body">Your key is saved in secure storage. Ask The Mayor in chat to finish checking the connection.</p>
      </>
    );
  }

  return (
    <>
      <div className="connector-card-head">
        <h2>{card.title}</h2>
        <button type="button" className="quiet" aria-label="Dismiss this card" onClick={onDismiss}>
          Not now
        </button>
      </div>
      <p className="connector-card-body">{card.body}</p>
      {card.unlocks && card.kind === 'offer' && <p className="connector-card-unlocks">{card.unlocks}</p>}
      {mode === 'guide' && (
        <details
          className="connector-guide"
          open={guideOpen}
          onToggle={(event) => setGuideOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary>{`Getting your ${card.name} key`}</summary>
          {card.guide && (
            <>
              <ol>
                {card.guide.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {card.guide.note && <p className="connector-card-note">{card.guide.note}</p>}
              {card.guide.docUrl && (
                <a href={card.guide.docUrl} target="_blank" rel="noopener noreferrer">
                  {`${card.name} documentation`}
                </a>
              )}
            </>
          )}
        </details>
      )}
      {handoffOpen && (
        <div className="connector-handoff">
          <p className="connector-card-note">Scan with your phone to finish there — you will sign in as usual and pick up this exact step. The link only works for your business account.</p>
          {sessionBase && (
            <img src={`${sessionBase}/qr.svg`} alt={`QR code to continue connecting ${card.name} on your phone`} width={220} height={220} loading="lazy" />
          )}
          {card.handoffUrl && (
            <>
              <a className="connector-handoff-link" href={card.handoffUrl}>
                {card.handoffUrl}
              </a>
              <button type="button" className="secondary" onClick={copyHandoff}>
                Copy link
              </button>
            </>
          )}
        </div>
      )}
      <div className="connector-card-actions">
        {mode === 'guide' && (
          <>
            <button type="button" className="primary" onClick={() => setMode('capture')}>
              I have my key
            </button>
            <button type="button" className="quiet" onClick={() => setGuideOpen((value) => !value)}>
              Show steps
            </button>
          </>
        )}
        {mode === 'capture' && (
          <form className="connector-capture-form" onSubmit={submitCapture}>
            <label className="connector-field">
              <span>{`Your ${card.name} key`}</span>
              <input
                ref={keyRef}
                type="password"
                required
                minLength={8}
                maxLength={4096}
                autoComplete="new-password"
                spellCheck={false}
                placeholder="Paste your key here"
              />
            </label>
            <label className="connector-field">
              <span>API endpoint</span>
              <input
                ref={endpointRef}
                type="url"
                required
                maxLength={2048}
                defaultValue={card.endpoint ?? 'https://'}
              />
            </label>
            <p className="connector-card-note">Your key goes straight to secure encrypted storage. It never appears in this chat.</p>
            <div className="connector-card-actions">
              <button type="submit" className="primary" disabled={saving}>
                Save key
              </button>
              <button type="button" className="quiet" onClick={() => setMode('guide')}>
                Back
              </button>
            </div>
          </form>
        )}
        {mode === 'default' &&
          (card.actions ?? []).map((action, i) => {
            switch (action.id) {
              case 'connect_oauth':
              case 'reconnect':
                return (
                  <button key={i} type="button" className="primary" onClick={() => connectOAuth(action)}>
                    {action.label}
                  </button>
                );
              case 'show_guide':
                return (
                  <button key={i} type="button" className="secondary" onClick={() => setMode('guide')}>
                    {action.label}
                  </button>
                );
              case 'enter_key':
                return (
                  <button key={i} type="button" className="secondary" onClick={() => setMode('capture')}>
                    {action.label}
                  </button>
                );
              case 'confirm_done':
                return (
                  <button
                    key={i}
                    type="button"
                    className="primary"
                    onClick={() => {
                      setStatus('Checking…');
                      void driveSession();
                    }}
                  >
                    {action.label}
                  </button>
                );
              case 'phone_handoff':
                return (
                  <button key={i} type="button" className="secondary" onClick={() => setHandoffOpen((value) => !value)}>
                    {action.label}
                  </button>
                );
              case 'open_connections':
                return (
                  <button key={i} type="button" className="secondary" onClick={() => document.getElementById('open-connections')?.click()}>
                    {action.label}
                  </button>
                );
              default:
                return null; // 'dismiss' — the header "Not now" covers it; avoid a duplicate button
            }
          })}
      </div>
      <p className="connector-card-status" aria-live="polite">
        {status}
      </p>
    </>
  );
}

export function ConnectorCard({ card, hooks, onDismiss }: { card: ConnectorCardPayload; hooks: ConnectorCardHooks; onDismiss: () => void }) {
  return <ConnectorCardInner card={card} hooks={hooks} onDismiss={onDismiss} />;
}

const roots = new Map<HTMLElement, Root>();

export function mountConnectorCard(element: HTMLElement, card: ConnectorCardPayload, hooks: ConnectorCardHooks): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(
    <ConnectorCard
      card={card}
      hooks={hooks}
      onDismiss={() => {
        roots.get(element)?.unmount();
        roots.delete(element);
        element.remove();
      }}
    />,
  );
}
