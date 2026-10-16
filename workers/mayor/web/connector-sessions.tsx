import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isConnectorCardPayload, renderConnectorCard, type ConnectorCardPayload } from './connector-cards';
import './connector-sessions.css';

/** One Connector in the Connectors view (P3 slice 3): the SAME engine
 * sessions the chat drives, on the session model — start or continue a
 * connection here and it is the identical attempt the chat card shows
 * (and the other way around). The session card itself is the shared
 * conversation renderer, hosted imperatively inside this React panel. */

export interface ConnectorSessionsHooks {
  api: (path: string, body?: unknown) => Promise<any>;
  tenant: () => string;
  signIn: (provider: string, capabilities: string[]) => Promise<void>;
  onNotice: (message: string) => void;
}

interface Recipe {
  service: string;
  name: string;
  unlocks: string;
  source: string;
  learnedState?: string | null;
  methodDetails: { kind: string; oneClick: boolean; successes: number; failures: number }[];
}
interface SessionLite { service: string; state: string }

const METHOD_LABEL: Record<string, string> = {
  oauth: 'Sign-in',
  api_key: 'API key',
  webhook: 'Webhook',
  mcp: 'Connected app',
  assisted: 'Guided steps',
};

function recipeHint(recipe: Recipe, open: boolean): string {
  const parts: string[] = [];
  if (recipe.methodDetails.some((m) => m.oneClick)) parts.push('One-click sign-in');
  else if (recipe.methodDetails.length) parts.push(METHOD_LABEL[recipe.methodDetails[0].kind] ?? 'Guided steps');
  if (recipe.learnedState === 'draft') parts.push('New — be the first to connect it');
  else if (recipe.source === 'learned') parts.push('Learned by The Mayor');
  if (open) parts.push('In progress — continue it here or in chat');
  return parts.join(' · ');
}

function ConnectorSessionsPanel({ hooks }: { hooks: ConnectorSessionsHooks }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [service, setService] = useState('');
  const [card, setCard] = useState<ConnectorCardPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const tenantId = hooks.tenant();
  const base = `/api/businesses/${encodeURIComponent(tenantId)}/connector-engine`;

  const load = useCallback(async () => {
    try {
      const [recipeData, sessionData] = await Promise.all([
        hooks.api(`${base}/recipes`),
        hooks.api(`${base}/sessions`),
      ]);
      const list: Recipe[] = recipeData?.recipes ?? [];
      setRecipes(list);
      setSessions(sessionData?.sessions ?? []);
      setService((current) => current || list[0]?.service || '');
      setError('');
    } catch {
      setError('The connector catalog could not load. Your existing connections below are unaffected.');
    }
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  // Host the shared (vanilla) session card: it manages its own in-place
  // refresh as the session advances, so React only mounts it per payload.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    if (card) {
      host.append(renderConnectorCard(card, {
        api: hooks.api,
        tenant: hooks.tenant,
        signIn: hooks.signIn,
        onNotice: hooks.onNotice,
      }));
    }
  }, [card]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSession = async () => {
    if (!service || busy) return;
    setBusy(true);
    setError('');
    try {
      const event = await hooks.api(`${base}/sessions/ensure`, { service });
      if (isConnectorCardPayload(event?.card)) {
        setCard(event.card);
        void load();
      } else {
        setError('That connection could not be started. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That connection could not be started. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const selected = recipes.find((r) => r.service === service);
  const openFor = (svc: string) => sessions.some((s) => s.service === svc && (s.state === 'offered' || s.state === 'capturing' || s.state === 'verifying'));

  return (
    <section className="cs-panel" aria-label="Connect a tool">
      <div className="cs-head">
        <h2>Connect a tool</h2>
        <button type="button" className="cs-btn cs-quiet" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="cs-summary">
        One connector for everything. Pick a tool and The Mayor walks you through the best way to connect it —
        one click when that exists, a key or guided steps when it doesn't. Anything you start here is the same
        attempt you can finish in chat, or on your phone.
      </p>
      {error && <p className="cs-error" role="alert">{error}</p>}
      <div className="cs-row">
        <label className="cs-label" htmlFor="cs-service">Tool</label>
        <select
          id="cs-service"
          className="cs-select"
          value={service}
          onChange={(e) => { setService(e.target.value); setCard(null); }}
        >
          {recipes.map((r) => (
            <option key={r.service} value={r.service}>{r.name}</option>
          ))}
        </select>
        <button type="button" className="cs-btn cs-primary" disabled={busy || !service} onClick={() => void openSession()}>
          {busy ? 'Starting…' : selected && openFor(selected.service) ? 'Continue connecting' : 'Connect'}
        </button>
      </div>
      {selected && <p className="cs-hint">{recipeHint(selected, openFor(selected.service))} — unlocks: {selected.unlocks}</p>}
      <div className="cs-host" ref={hostRef} />
    </section>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountConnectorSessions(element: HTMLElement, hooks: ConnectorSessionsHooks): void {
  if (rootElement !== element) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  root.render(<ConnectorSessionsPanel hooks={hooks} />);
}
