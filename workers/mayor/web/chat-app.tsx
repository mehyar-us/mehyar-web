import { createRoot, type Root } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { TranscriptRowItem, type TranscriptRow } from './transcript-list';
import { ComposerCluster } from './composer-cluster';

/** ChatApp (chat reenvision Slice 1, 2026-10-21): ONE React root owns the
 * chat view — the presence bar, the onboarding progress host, and the
 * conversation section with the message timeline. main.ts keeps every
 * engine (voice, text chat, harness events, card mounts) and pushes a
 * snapshot, the same contract the S2 islands used. The composer cluster
 * renders from this tree through a portal into the dock host main.ts
 * provides; the dock form itself is ported in Slice 3.
 *
 * Two regions are deliberately NOT rendered here:
 *  - #chat-sign-in (signed-out home): a static, server-injected subtree
 *    (the worker SSR-fills #offer-block). main.ts adopts the live node
 *    into the conversation section; re-rendering it would destroy the
 *    SSR content.
 *  - Guide/connector cards: harness events mount them before/after the
 *    transcript, exactly as before — in-flow timeline items are Slice 5.
 * Constant hosts (#onboarding-progress, #chat-empty, #interim) render
 * once with constant props; main.ts keeps its imperative writes to them
 * (hidden toggles, interim text), which React never re-applies because
 * the virtual DOM for those nodes never changes. */

export interface ChatAppComposer {
  statusText: string;
  stopWaitingVisible: boolean;
  actionsHidden: boolean;
  newChatHidden: boolean;
  retryVisible: boolean;
}

export interface ChatAppSnapshot {
  businessName: string;
  statusText: string;
  rows: TranscriptRow[];
  assistantLabel: string;
  /** Slice 2: the server holds earlier history than what's loaded —
   * the timeline offers "Earlier ↑" instead of silently capping. */
  earlierVisible: boolean;
  composer: ChatAppComposer;
}

export interface ChatAppCallbacks {
  onCopyFailed: () => void;
  onStopWaiting: () => void;
  onNewChat: () => void;
  onRetry: () => void;
  onEarlier: () => void;
  onCancelQueued: (turnId: string) => void;
  onRetryTurn: () => void;
  onDismissError: () => void;
}

export interface ChatAppHosts {
  composerHost: HTMLElement;
}

export type TimelineItem =
  | { kind: 'message'; row: TranscriptRow; index: number }
  | { kind: 'day'; label: string };

/** Timeline model (Slice 1): message items + day dividers. At this
 * baseline the client row model carries no timestamps — saved history,
 * the conversation_history hydration, and the voice transcript merge
 * all move {role, text} only — so no day items are produced yet. The
 * divider branch below renders as soon as the row model gains dates
 * (Slice 2 history work); the model and the renderer land now. */
export function buildTimelineItems(rows: TranscriptRow[]): TimelineItem[] {
  return rows.map((row, index) => ({ kind: 'message', row, index }));
}

export function ChatApp(props: {
  snapshot: ChatAppSnapshot;
  callbacks: ChatAppCallbacks;
  hosts: ChatAppHosts;
}) {
  const { snapshot, callbacks, hosts } = props;
  const items = buildTimelineItems(snapshot.rows);
  // The presence bar renders only once a business is loaded (main.ts
  // pushes businessName from enterBusiness/useBusinessProfile). Signed
  // out — and during first-run naming, before any business exists — the
  // chat view carries no presence furniture, matching the pre-Slice-1
  // shell, whose heading was clipped and whose voice stage was hidden.
  return (
    <>
      {snapshot.businessName ? (
        <div className="presence-bar">
          <div className="portrait presence-avatar">
            <img src="/mayor-avatar.png" alt="The Mayor" width="1254" height="1254" />
            <span className="voice-ring"></span>
          </div>
          <div className="presence-meta">
            <h1 id="presence-name" className="presence-name">
              {snapshot.businessName}
            </h1>
            <span id="status" role="status">
              {snapshot.statusText}
            </span>
          </div>
        </div>
      ) : null}
      <div id="onboarding-progress" className="onboarding-progress" hidden></div>
      <section id="conversation" aria-label="Conversation">
        <p id="chat-empty" className="chat-empty" hidden>
          Share your website or tell me about your business. We’ll build your profile together.
        </p>
        {snapshot.earlierVisible ? (
          <button type="button" className="earlier-button" onClick={callbacks.onEarlier}>
            Earlier ↑
          </button>
        ) : null}
        <ol id="transcript" tabIndex={0} aria-live="off" role="log" aria-label="Conversation">
          {items.map((item) =>
            item.kind === 'day' ? (
              <li key={`day:${item.label}`} className="timeline-day">
                <span>{item.label}</span>
              </li>
            ) : (
              <TranscriptRowItem
                key={item.row.turnId ? `${item.row.role}:${item.row.turnId}` : item.index}
                row={item.row}
                assistantLabel={snapshot.assistantLabel}
                onCopyFailed={callbacks.onCopyFailed}
                onCancelQueued={callbacks.onCancelQueued}
                onRetryTurn={callbacks.onRetryTurn}
                onDismissError={callbacks.onDismissError}
              />
            ),
          )}
        </ol>
        <p id="interim"></p>
      </section>
      {createPortal(
        <ComposerCluster
          {...snapshot.composer}
          onStopWaiting={callbacks.onStopWaiting}
          onNewChat={callbacks.onNewChat}
          onRetry={callbacks.onRetry}
        />,
        hosts.composerHost,
      )}
    </>
  );
}

let root: Root | null = null;
let callbacksRef: ChatAppCallbacks | null = null;
let hostsRef: ChatAppHosts | null = null;

/** Mount the chat view's single React root. The first render is flushed
 * synchronously: main.ts wires DOM lookups (#conversation, #transcript,
 * #status, #onboarding-progress) immediately after this call. */
export function mountChatApp(
  element: HTMLElement,
  snapshot: ChatAppSnapshot,
  callbacks: ChatAppCallbacks,
  hosts: ChatAppHosts,
): void {
  if (root) return;
  callbacksRef = callbacks;
  hostsRef = hosts;
  root = createRoot(element);
  flushSync(() => {
    root!.render(<ChatApp snapshot={snapshot} callbacks={callbacks} hosts={hosts} />);
  });
}

export function pushChatApp(snapshot: ChatAppSnapshot): void {
  if (!root || !callbacksRef || !hostsRef) return;
  root.render(<ChatApp snapshot={snapshot} callbacks={callbacksRef} hosts={hostsRef} />);
}
