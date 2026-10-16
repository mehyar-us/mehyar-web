import { createRoot, type Root } from 'react-dom/client';

/** Composer cluster (React migration S2b): the conversation status line,
 * the startup Retry button, and the chat actions row (Stop waiting /
 * New chat) under the composer. Rendered by React 19 from a state
 * snapshot; the text-chat engine, photo uploads, and startup flow stay
 * in main.ts. DOM order, ids, classes, and the hidden-attribute rules
 * the mobile CSS keys on (:empty status, :has() collapse of the actions
 * row) are preserved exactly. */

export interface ComposerClusterProps {
  statusText: string;
  stopWaitingVisible: boolean;
  actionsHidden: boolean;
  newChatHidden: boolean;
  retryVisible: boolean;
  onStopWaiting: () => void;
  onNewChat: () => void;
  onRetry: () => void;
}

export function ComposerCluster(props: ComposerClusterProps) {
  return (
    <>
      <p id="composer-status" role="status">{props.statusText}</p>
      <button type="button" className="secondary" hidden={!props.retryVisible} onClick={props.onRetry}>
        Retry loading
      </button>
      <div className="chat-actions" hidden={props.actionsHidden}>
        <button type="button" className="secondary" hidden={!props.stopWaitingVisible} onClick={props.onStopWaiting}>
          Stop waiting
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Start a new conversation"
          hidden={props.newChatHidden}
          onClick={props.onNewChat}
        >
          New chat
        </button>
      </div>
    </>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountComposerCluster(element: HTMLElement, props: ComposerClusterProps): void {
  if (rootElement !== element) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  root.render(<ComposerCluster {...props} />);
}
