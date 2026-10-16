import { createRoot, type Root } from 'react-dom/client';

/** Notifications inbox (React migration S2c): the bell-opened details
 * panel listing account notifications. Rendered by React 19 from a
 * state snapshot; fetching, the destination/anchor label logic, and
 * all navigation stay in main.ts — items arrive as view data with a
 * precomputed destination + anchor, and clicks report back. The native
 * details open state is snapshot-driven (the toggle event reports in),
 * preserving the open-to-refresh behavior. */

export interface InboxItemView {
  id: string;
  title: string;
  message: string;
  actionLabel: string;
  unread: boolean;
  destination: 'today' | 'tasks' | 'chat' | 'missed-calls' | 'account';
  anchor: string;
}

export interface NotificationsInboxProps {
  hidden: boolean;
  open: boolean;
  summaryText: string;
  statusText: string;
  items: InboxItemView[];
  hasMore: boolean;
  showReconnect: boolean;
  refreshDisabled: boolean;
  markingReadId: string | null;
  onToggle: (open: boolean) => void;
  onRefresh: () => void;
  onItemAction: (item: InboxItemView) => void;
  onMarkRead: (item: InboxItemView) => void;
  onReconnect: () => void;
}

export function NotificationsInbox(props: NotificationsInboxProps) {
  return (
    <details
      className="account-card notification-inbox"
      hidden={props.hidden}
      open={props.open}
      onToggle={(event) => props.onToggle(event.currentTarget.open)}
    >
      <summary>{props.summaryText}</summary>
      <p role="status">{props.statusText}</p>
      <div>
        {props.items.map((item) => (
          <article key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.message}</p>
            <button type="button" className="secondary" onClick={() => props.onItemAction(item)}>
              {item.actionLabel}
            </button>
            {item.unread && (
              <button
                type="button"
                className="secondary"
                disabled={props.markingReadId === item.id}
                onClick={() => props.onMarkRead(item)}
              >
                Mark read
              </button>
            )}
          </article>
        ))}
        {props.hasMore && <p>Showing the latest 50 items.</p>}
        {props.showReconnect && (
          <button type="button" className="secondary" onClick={props.onReconnect}>
            Reconnect calendar
          </button>
        )}
      </div>
      <button type="button" className="secondary" disabled={props.refreshDisabled} onClick={props.onRefresh}>
        Check account
      </button>
    </details>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountNotificationsInbox(element: HTMLElement, props: NotificationsInboxProps): void {
  if (rootElement !== element) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  root.render(<NotificationsInbox {...props} />);
}
