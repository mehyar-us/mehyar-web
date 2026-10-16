import { useState, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Plug, CalendarDays, Mail, Globe, Webhook, Braces, Server, Plus, RefreshCw, Unplug, KeyRound, Play, Copy, Check,
} from 'lucide-react';

/** Connections hub (React migration S5a): the Connectors view's main
 * render — accounts grid, custom connections, and the MCP section —
 * rendered by React 19 from the view model createConnections
 * (connections.ts) computes. All data loading, the epoch/stamp race
 * guards, announce(), and the entire dialog system (add / tools /
 * tokens / disconnect) stay in connections.ts for this slice; per-item
 * actions ride the view model as closures, exactly the computations
 * the imperative renderer made. Icons are lucide-react components
 * (same lucide 0.453.0 set the imperative createElement calls used). */

export interface HubAction {
  label: string;
  icon: string;
  className: string;
  disabled?: boolean;
  run: () => void;
}

export interface ProviderCardView {
  key: string;
  title: string;
  detail: string;
  icon: string;
  stateText: string;
  gmailLine?: string;
  selectionLine?: string;
  setupLine?: string;
  actions: HubAction[];
}

export interface PendingCardView {
  key: string;
  title: string;
  detail: string;
  status: string;
}

export interface CustomCardView {
  key: string;
  title: string;
  detail: string;
  icon: string;
  stateText: string;
  lastCheckLine?: string;
  endpointRef?: string;
  actions: HubAction[] | null;
}

export interface TokenView {
  id: string;
  label: string;
  line: string;
  revoke: (() => void) | null;
}

export interface ConnectionsHubView {
  loading: boolean;
  canManage: boolean;
  builtInError: string;
  providers: ProviderCardView[];
  pending: PendingCardView[];
  customError: string;
  customEmpty: boolean;
  customs: CustomCardView[];
  mcpError: string;
  mcpEndpoint: string;
  tokens: TokenView[];
  activeTokenCount: number;
}

export interface ConnectionsHubActions {
  refresh: () => void;
  addConnection: () => void;
  copyText: (text: string) => Promise<boolean>;
  createToken: () => void;
}

export interface ConnectionsHubProps {
  view: ConnectionsHubView;
  actions: ConnectionsHubActions;
}

const ICONS: Record<string, ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false'; focusable?: boolean | 'true' | 'false' }>> = {
  plug: Plug,
  calendar: CalendarDays,
  mail: Mail,
  globe: Globe,
  webhook: Webhook,
  braces: Braces,
  server: Server,
  plus: Plus,
  refresh: RefreshCw,
  unplug: Unplug,
  key: KeyRound,
  play: Play,
  copy: Copy,
  check: Check,
};

function HubIcon({ name }: { name: string }) {
  const Shape = ICONS[name];
  if (!Shape) return null;
  return <Shape aria-hidden="true" focusable="false" />;
}

function ActionButtons({ actions }: { actions: HubAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="connection-actions">
      {actions.map((action, i) => (
        <button
          key={`${action.label}-${i}`}
          type="button"
          className={action.className}
          disabled={action.disabled}
          onClick={action.run}
        >
          <HubIcon name={action.icon} />
          {action.label}
        </button>
      ))}
    </div>
  );
}

/* Reference-data pattern (Mayor's Robinhood rule, standing design order):
 * an identifier a user may need elsewhere renders as a small muted label
 * above (qualifier in parentheses), the value large and legible, and a
 * one-tap copy button with honest Copied feedback on the row itself. */
export function ReferenceRow({ label, qualifier, value, copyText }: { label: string; qualifier?: string; value: string; copyText: (text: string) => Promise<boolean> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="reference-row">
      <div className="reference-main">
        <p className="reference-label">
          {label}
          {qualifier ? <span>{` (${qualifier})`}</span> : null}
        </p>
        <p className="reference-value">{value}</p>
      </div>
      <button
        type="button"
        className="quiet reference-copy"
        onClick={() => {
          void (async () => {
            if (await copyText(value)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }
          })();
        }}
      >
        <HubIcon name={copied ? 'check' : 'copy'} />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function CardShell({
  title,
  detail,
  icon,
  stateText,
  children,
}: {
  title: string;
  detail: string;
  icon: string;
  stateText: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="connection-card">
      <div className="connection-card-header">
        <span className="connection-mark">
          <HubIcon name={icon} />
        </span>
        <div>
          <h3>{title}</h3>
          <p className="connection-subtle">{detail}</p>
        </div>
      </div>
      <p className="connection-state">{stateText}</p>
      {children}
    </article>
  );
}

export function ConnectionsHub({ view, actions }: ConnectionsHubProps) {
  if (view.loading) return <p className="connections-status">Loading connections…</p>;
  return (
    <>
      <div className="connections-heading">
        <div>
          <h2>Connections</h2>
          <p className="connection-subtle">Bring your tools together.</p>
        </div>
        <button type="button" className="connection-icon-button" aria-label="Check connection status" onClick={actions.refresh}>
          <HubIcon name="refresh" />
        </button>
      </div>
      <p className="connections-status" role="status"></p>
      <section className="connection-section">
        <h3>Your accounts</h3>
        <div className="connection-grid">
          {!view.canManage ? (
            <p className="connection-subtle">Your business owner manages shared connections.</p>
          ) : view.builtInError ? (
            <p className="connection-error" role="alert">
              {view.builtInError}
            </p>
          ) : (
            view.providers.map((provider) => (
              <CardShell key={provider.key} title={provider.title} detail={provider.detail} icon={provider.icon} stateText={provider.stateText}>
                {provider.gmailLine && <p className="connection-subtle">{provider.gmailLine}</p>}
                {provider.selectionLine && <p className="connection-selection">{provider.selectionLine}</p>}
                {provider.setupLine && <p className="connection-subtle">{provider.setupLine}</p>}
                <ActionButtons actions={provider.actions} />
              </CardShell>
            ))
          )}
          {view.pending.map((pending) => (
            <article key={pending.key} className="connection-card connection-pending">
              <div className="connection-card-header">
                <span className="connection-mark">
                  <HubIcon name="globe" />
                </span>
                <div>
                  <h3>{pending.title}</h3>
                  <p className="connection-subtle">{pending.detail}</p>
                </div>
              </div>
              <p className="connection-state">{pending.status}</p>
            </article>
          ))}
        </div>
      </section>
      {view.canManage && (
        <section className="connection-section">
          <div className="connection-section-heading">
            <h3>Custom connections</h3>
            <button type="button" className="secondary" onClick={actions.addConnection}>
              <HubIcon name="plus" />
              Add
            </button>
          </div>
          <div className="connection-grid">
            {view.customError ? (
              <p className="connection-error" role="alert">
                {view.customError}
              </p>
            ) : view.customEmpty ? (
              <p className="connection-subtle">Connect an API, webhook, or HTTP MCP server.</p>
            ) : (
              view.customs.map((connection) => (
                <CardShell key={connection.key} title={connection.title} detail={connection.detail} icon={connection.icon} stateText={connection.stateText}>
                  {connection.endpointRef && <ReferenceRow label="Endpoint" value={connection.endpointRef} copyText={actions.copyText} />}
                  {connection.lastCheckLine && <p className="connection-subtle">{connection.lastCheckLine}</p>}
                  {connection.actions && <ActionButtons actions={connection.actions} />}
                </CardShell>
              ))
            )}
          </div>
        </section>
      )}
      <section className="connection-section">
        <div className="connection-section-heading">
          <h3>Use Mayor in another assistant</h3>
        </div>
        {view.mcpError ? (
          <p className="connection-error" role="alert">
            {view.mcpError}
          </p>
        ) : (
          <>
            <p className="connection-subtle">Read your saved business records through MCP.</p>
            {view.mcpEndpoint && (
              <div className="reference-list">
                <ReferenceRow label="MCP endpoint" value={view.mcpEndpoint} copyText={actions.copyText} />
              </div>
            )}
            <div className="connection-actions">
              <button type="button" className="secondary" onClick={actions.createToken}>
                <HubIcon name="key" />
                Create token
              </button>
            </div>
            <details className="connection-details">
              <summary>{`Your tokens (${view.activeTokenCount})`}</summary>
              {!view.tokens.length && <p className="connection-subtle">No tokens yet.</p>}
              {view.tokens.map((token) => (
                <div key={token.id} className="connection-token reference-token">
                  <ReferenceRow label={token.label} qualifier={token.line} value={token.id} copyText={actions.copyText} />
                  {token.revoke && (
                    <button type="button" className="quiet" onClick={token.revoke}>
                      <HubIcon name="unplug" />
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </details>
          </>
        )}
      </section>
    </>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountConnectionsHub(element: HTMLElement, props: ConnectionsHubProps): void {
  if (rootElement !== element || !root) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  const current: Root = root;
  current.render(<ConnectionsHub {...props} />);
}

export function unmountConnectionsHub(element: HTMLElement): void {
  if (rootElement === element && root) {
    root.unmount();
    root = null;
    rootElement = null;
  }
}
