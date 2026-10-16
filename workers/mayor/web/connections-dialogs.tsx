import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { X, Check, ArrowLeft, Copy, ChevronRight, Play } from 'lucide-react';

/** Connections dialogs (React migration S5c): the inner screens of the
 * hub's native <dialog> flows — review/confirm, add-connection form,
 * tool browser + form + preview + result, MCP token form + one-time
 * token display. The <dialog> element itself (showModal, pending
 * guard, close cleanup, focus restore) stays owned by connections.ts;
 * this component renders heading + screen from the session view state
 * the module pushes, and reports clicks/submits back through the
 * session callbacks. All flow logic — idempotency signatures, proposal
 * validation, stamp guards, API calls — stays in the module.
 *
 * Form values live in module-owned bags: the component initializes
 * from the bag and writes through on change, so values survive the
 * form → review → back transitions exactly like the preserved form
 * DOM did. The add-form secret is uncontrolled and write-through only:
 * it is never kept in React state. */

export interface ToolView {
  name: string;
  title: string;
  description?: string;
  effect: 'read' | 'write';
}

export type DialogScreen =
  | { kind: 'review'; lines: string[]; confirmLabel: string; backLabel: string; message: string; alert: boolean; buttonsDisabled: boolean }
  | { kind: 'add-form'; message: string; alert: boolean }
  | { kind: 'tools'; message: string; alert: boolean; tools: ToolView[] | null }
  | { kind: 'tool-form'; connectionLabel: string; schemaPretty: string | null; message: string; alert: boolean; saveDisabled: boolean }
  | { kind: 'tool-preview'; detailTitle: string; lines: string[]; argsPretty: string; runLabel: string; status: string; statusAlert: boolean; buttonsDisabled: boolean }
  | { kind: 'tool-result'; text: string; truncated: boolean }
  | { kind: 'token-form' }
  | { kind: 'token-saved'; invalid: boolean; token: string; endpoint: string; message: string };

export interface DialogViewState {
  title: string;
  titleId: string;
  pending: boolean;
  screen: DialogScreen | null;
}

export interface AddFormBag {
  label: string;
  type: string;
  endpoint: string;
  authentication: string;
  secret: string;
  readNames: string;
}
export interface TokenFormBag {
  label: string;
  days: string;
}
export interface ToolFormBag {
  args: string;
}

export interface DialogCallbacks {
  close: () => void;
  reviewConfirm: () => void;
  reviewBack: () => void;
  addSubmit: () => void;
  toolOpen: (index: number) => void;
  toolFormSubmit: () => void;
  previewBack: () => void;
  previewRun: () => void;
  tokenSubmit: () => void;
  tokenCopy: () => void;
  tokenDone: () => void;
  resultDone: () => void;
}

export interface DialogBags {
  add: AddFormBag;
  token: TokenFormBag;
  tool: ToolFormBag;
}

export interface ConnectionsDialogProps {
  view: DialogViewState;
  bags: DialogBags;
  callbacks: DialogCallbacks;
}

function FormMessage({ text, alert }: { text: string; alert: boolean }) {
  return (
    <p className="connection-form-status" role={alert ? 'alert' : 'status'}>
      {text}
    </p>
  );
}

function AddForm({ view, bags, callbacks }: ConnectionsDialogProps & { view: DialogViewState & { screen: Extract<DialogScreen, { kind: 'add-form' }> } }) {
  const bag = bags.add;
  const [label, setLabel] = useState(bag.label);
  const [type, setType] = useState(bag.type);
  const [endpoint, setEndpoint] = useState(bag.endpoint);
  const [authentication, setAuthentication] = useState(bag.authentication);
  const [readNames, setReadNames] = useState(bag.readNames);
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    labelRef.current?.focus();
  }, []);
  const secretDisabled = authentication === 'none';
  return (
    <form
      className="connection-form"
      onSubmit={(event) => {
        event.preventDefault();
        callbacks.addSubmit();
      }}
    >
      <label className="connection-field">
        <span>Name</span>
        <input
          ref={labelRef}
          required
          maxLength={80}
          value={label}
          onChange={(event) => { bag.label = event.target.value; setLabel(event.target.value); }}
        />
      </label>
      <label className="connection-field">
        <span>Connection type</span>
        <select value={type} onChange={(event) => { bag.type = event.target.value; setType(event.target.value); }}>
          <option value="api">API</option>
          <option value="webhook">Webhook</option>
          <option value="mcp">MCP · HTTP</option>
        </select>
      </label>
      <label className="connection-field">
        <span>HTTPS endpoint</span>
        <input
          required
          type="url"
          maxLength={2048}
          placeholder="https://"
          value={endpoint}
          onChange={(event) => { bag.endpoint = event.target.value; setEndpoint(event.target.value); }}
        />
      </label>
      <details className="connection-details">
        <summary>Authentication & read permissions</summary>
        <label className="connection-field">
          <span>Authentication</span>
          <select
            value={authentication}
            onChange={(event) => {
              const value = event.target.value;
              bag.authentication = value;
              if (value === 'none') bag.secret = '';
              setAuthentication(value);
            }}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="api_key">API key</option>
          </select>
        </label>
        <label className="connection-field">
          <span>Key or token</span>
          <input
            key={authentication}
            type="password"
            minLength={8}
            maxLength={4096}
            autoComplete="new-password"
            spellCheck={false}
            disabled={secretDisabled}
            required={!secretDisabled}
            defaultValue={bag.secret}
            onChange={(event) => { bag.secret = event.target.value; }}
          />
        </label>
        <label className="connection-field" hidden={type !== 'mcp'}>
          <span>MCP tools you permit to run as reads</span>
          <textarea
            rows={2}
            maxLength={1200}
            placeholder="One tool name per line"
            value={readNames}
            onChange={(event) => { bag.readNames = event.target.value; setReadNames(event.target.value); }}
          />
        </label>
      </details>
      <FormMessage text={view.screen.message} alert={view.screen.alert} />
      <div className="connection-actions">
        <button type="submit" className="primary">
          Review connection
        </button>
      </div>
    </form>
  );
}

function TokenForm({ view, bags, callbacks }: ConnectionsDialogProps & { view: DialogViewState & { screen: Extract<DialogScreen, { kind: 'token-form' }> } }) {
  const bag = bags.token;
  const [label, setLabel] = useState(bag.label);
  const [days, setDays] = useState(bag.days);
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    labelRef.current?.focus();
  }, []);
  return (
    <form
      className="connection-form"
      onSubmit={(event) => {
        event.preventDefault();
        callbacks.tokenSubmit();
      }}
    >
      <label className="connection-field">
        <span>Token name</span>
        <input
          ref={labelRef}
          required
          maxLength={80}
          placeholder="My assistant"
          value={label}
          onChange={(event) => { bag.label = event.target.value; setLabel(event.target.value); }}
        />
      </label>
      <label className="connection-field">
        <span>Expires after</span>
        <select value={days} onChange={(event) => { bag.days = event.target.value; setDays(event.target.value); }}>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
      </label>
      <p className="connection-subtle">Read only. No task, booking, or message changes.</p>
      <div className="connection-actions">
        <button type="submit" className="primary">
          Review token
        </button>
      </div>
    </form>
  );
}

function ToolForm({ view, bags, callbacks }: ConnectionsDialogProps & { view: DialogViewState & { screen: Extract<DialogScreen, { kind: 'tool-form' }> } }) {
  const bag = bags.tool;
  const [args, setArgs] = useState(bag.args);
  const argsRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    argsRef.current?.focus();
  }, []);
  const screen = view.screen;
  return (
    <form
      className="connection-form"
      onSubmit={(event) => {
        event.preventDefault();
        callbacks.toolFormSubmit();
      }}
    >
      <p className="connection-subtle">{screen.connectionLabel}</p>
      <label className="connection-field">
        <span>Exact arguments · JSON</span>
        <textarea
          ref={argsRef}
          rows={6}
          spellCheck={false}
          maxLength={8192}
          value={args}
          onChange={(event) => { bag.args = event.target.value; setArgs(event.target.value); }}
        />
      </label>
      {screen.schemaPretty && (
        <details className="connection-details">
          <summary>Input fields</summary>
          <pre className="connection-code">{screen.schemaPretty}</pre>
        </details>
      )}
      <FormMessage text={screen.message} alert={screen.alert} />
      <div className="connection-actions">
        <button type="submit" className="primary" disabled={screen.saveDisabled}>
          Preview action
        </button>
      </div>
    </form>
  );
}

export function ConnectionsDialog({ view, bags, callbacks }: ConnectionsDialogProps) {
  const screen = view.screen;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const tokenRef = useRef<HTMLTextAreaElement>(null);
  const kind = screen?.kind;
  useEffect(() => {
    if (kind === 'review') confirmRef.current?.focus();
    else if (kind === 'tool-preview') runRef.current?.focus();
    else if (kind === 'tool-result') doneRef.current?.focus();
    else if (kind === 'token-saved' && tokenRef.current) {
      tokenRef.current.focus();
      tokenRef.current.select();
    }
  }, [kind]);
  return (
    <>
      <div className="dialog-heading">
        <h2 id={view.titleId}>{view.title}</h2>
        <button type="button" className="connection-icon-button" aria-label="Close" disabled={view.pending} onClick={callbacks.close}>
          <X aria-hidden="true" focusable="false" />
        </button>
      </div>
      {screen?.kind === 'review' && (
        <>
          <ul className="connection-readback">
            {screen.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <FormMessage text={screen.message} alert={screen.alert} />
          <div className="connection-actions">
            <button type="button" className="secondary" disabled={screen.buttonsDisabled} onClick={callbacks.reviewBack}>
              {screen.backLabel === 'Back' && <ArrowLeft aria-hidden="true" focusable="false" />}
              {screen.backLabel}
            </button>
            <button ref={confirmRef} type="button" className="primary" disabled={screen.buttonsDisabled} onClick={callbacks.reviewConfirm}>
              <Check aria-hidden="true" focusable="false" />
              {screen.confirmLabel}
            </button>
          </div>
        </>
      )}
      {screen?.kind === 'add-form' && <AddForm view={{ ...view, screen }} bags={bags} callbacks={callbacks} />}
      {screen?.kind === 'tools' && (
        <>
          <FormMessage text={screen.message} alert={screen.alert} />
          {screen.tools && (
            <div className="connection-tool-list">
              {screen.tools.map((tool, i) => (
                <article key={tool.name} className="connection-tool">
                  <h3>{tool.title}</h3>
                  {tool.description && <p className="connection-subtle">{tool.description}</p>}
                  <span className="connection-tool-effect">{tool.effect === 'read' ? 'Read' : 'Approval required'}</span>
                  <button type="button" className="secondary" onClick={() => callbacks.toolOpen(i)}>
                    <ChevronRight aria-hidden="true" focusable="false" />
                    Open
                  </button>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {screen?.kind === 'tool-form' && <ToolForm view={{ ...view, screen }} bags={bags} callbacks={callbacks} />}
      {screen?.kind === 'tool-preview' && (
        <>
          <FormMessage text={screen.status} alert={screen.statusAlert} />
          <div className="connection-tool-preview">
            <p>{screen.detailTitle}</p>
            {screen.lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
            <pre className="connection-code">{screen.argsPretty}</pre>
          </div>
          <div className="connection-actions">
            <button type="button" className="secondary" disabled={screen.buttonsDisabled} onClick={callbacks.previewBack}>
              <ArrowLeft aria-hidden="true" focusable="false" />
              Back
            </button>
            <button ref={runRef} type="button" className="primary" disabled={screen.buttonsDisabled} onClick={callbacks.previewRun}>
              <Play aria-hidden="true" focusable="false" />
              {screen.runLabel}
            </button>
          </div>
        </>
      )}
      {screen?.kind === 'tool-result' && (
        <>
          <pre className="connection-code">{screen.text}</pre>
          {screen.truncated && <p className="connection-subtle">This result is shortened for display.</p>}
          <button ref={doneRef} type="button" className="primary" onClick={callbacks.resultDone}>
            <Check aria-hidden="true" focusable="false" />
            Done
          </button>
        </>
      )}
      {screen?.kind === 'token-form' && <TokenForm view={{ ...view, screen }} bags={bags} callbacks={callbacks} />}
      {screen?.kind === 'token-saved' && (
        <>
          <p className="connection-subtle">Shown once. Keep it private.</p>
          {screen.invalid ? (
            <p className="connection-error">The token was not returned. Check your token list before creating another.</p>
          ) : (
            <>
              <textarea ref={tokenRef} value={screen.token} readOnly rows={3} spellCheck={false} aria-label="Your new private MCP token" />
              <FormMessage text={screen.message} alert={false} />
              <button type="button" className="primary" onClick={callbacks.tokenCopy}>
                <Copy aria-hidden="true" focusable="false" />
                Copy token
              </button>
              <button type="button" className="secondary" onClick={callbacks.tokenDone}>
                <Check aria-hidden="true" focusable="false" />
                Done
              </button>
              {screen.endpoint && <p className="connection-endpoint">{screen.endpoint}</p>}
            </>
          )}
        </>
      )}
    </>
  );
}

const roots = new Map<HTMLElement, Root>();

export function mountConnectionsDialog(element: HTMLElement, props: ConnectionsDialogProps): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(<ConnectionsDialog {...props} />);
}

export function unmountConnectionsDialog(element: HTMLElement): void {
  const root = roots.get(element);
  if (root) {
    root.unmount();
    roots.delete(element);
  }
}
