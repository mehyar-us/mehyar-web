/**
 * desk/desk.tsx — The Desk v1 (Reinvention Slice 1, blueprint §3.1).
 *
 * One living strip at the head of the home view: the Morning Line
 * (pinned state), the intent stream (the carried-intent Ribbon, the
 * completion Receipt, attention Lines, today's people — all catalog
 * primitives, all data-fed), with the conversation (ChatApp) directly
 * beneath it and the Bar (the shell's dock) docked below. The Desk
 * renders intents pushed by main.ts — the same snapshot contract
 * ChatApp uses; it owns no data fetching and no DOM outside its root.
 *
 * mount/push mirror the ChatApp contract (chat-app.tsx): main.ts
 * mounts once, then pushes a fresh snapshot whenever the underlying
 * state changes (auth resolved, intent captured/consumed/dismissed,
 * overview/billing data landed, a purchase completed).
 */
import { createRoot, type Root } from 'react-dom/client';
import type { DeskIntent } from './intents';
import { IntentView, MorningLine } from './primitives';

export interface DeskSnapshot {
  /** True once a session exists; false renders the signed-out strip
   * (Ribbon + product line only — no business state is shown). */
  signedIn: boolean;
  businessName: string;
  statusLine?: string;
  stats?: Array<{ label: string; value: string; context?: string; stale?: string }>;
  intents: Array<DeskIntent | { type: string; version: number; summary?: string; id: string }>;
}

export interface DeskCallbacks {
  /** The owner dismissed the carried intent (Ribbon ✕): the carrier
   * is cleared host-side; the intent is NOT consumed toward billing. */
  onDismissIntent?: (id: string) => void;
  onRetryIntent?: (id: string) => void;
}

export function DeskStrip({ snapshot, callbacks }: { snapshot: DeskSnapshot; callbacks: DeskCallbacks }) {
  return (
    <div className="desk-strip" data-signed-in={snapshot.signedIn ? 'true' : 'false'}>
      <MorningLine businessName={snapshot.businessName} statusLine={snapshot.statusLine} stats={snapshot.signedIn ? snapshot.stats : undefined} />
      {snapshot.intents.length ? (
        <div className="desk-stream">
          {snapshot.intents.map((intent) => (
            <IntentView
              key={intent.id}
              intent={intent}
              onDismissIntent={callbacks.onDismissIntent}
              onRetryIntent={callbacks.onRetryIntent}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

let root: Root | null = null;
let currentSnapshot: DeskSnapshot | null = null;
let currentCallbacks: DeskCallbacks = {};

function render() {
  if (!root || !currentSnapshot) return;
  root.render(<DeskStrip snapshot={currentSnapshot} callbacks={currentCallbacks} />);
}

export function mountDesk(element: HTMLElement, snapshot: DeskSnapshot, callbacks: DeskCallbacks): void {
  currentSnapshot = snapshot;
  currentCallbacks = callbacks;
  if (!root) root = createRoot(element);
  render();
}

export function pushDesk(snapshot: DeskSnapshot): void {
  currentSnapshot = snapshot;
  render();
}

export function unmountDesk(): void {
  root?.unmount();
  root = null;
  currentSnapshot = null;
}
