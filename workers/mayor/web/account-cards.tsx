import { createRoot, type Root } from 'react-dom/client';

/** Settings account cards (React migration S2a): the Recurring account
 * check, Email notifications, and Business agent cards from the account
 * view, rendered by React 19 from state snapshots. Fetching, scheduling
 * semantics, and every action stay in main.ts — this panel only renders
 * the snapshots it is given and reports clicks. Copy is unchanged. */

export interface RoutineCardState {
  stateText: string;
  pauseVisible: boolean;
  pauseDisabled: boolean;
}
export interface EmailCardState {
  statusText: string;
  toggleLabel: string;
  toggleVisible: boolean;
  toggleDisabled: boolean;
}
export interface AccountCardsProps {
  visible: boolean;
  routine: RoutineCardState;
  email: EmailCardState;
  onPauseCheck: () => void;
  onTalkAboutCheck: () => void;
  onToggleEmail: () => void;
  onOpenAgent: () => void;
}

export function AccountCards({ visible, routine, email, onPauseCheck, onTalkAboutCheck, onToggleEmail, onOpenAgent }: AccountCardsProps) {
  if (!visible) return null;
  return (
    <>
      <div className="account-card">
        <h2>Recurring account check</h2>
        <p>Ask The Mayor to check your business profile and live calendar connection every day or on weekdays. Choose a time by talking. Issues appear in Notifications and follow your email alert preferences. This check does not monitor your email inbox or reviews.</p>
        <p role="status">{routine.stateText}</p>
        <button type="button" className="secondary" onClick={onTalkAboutCheck}>Set up or change in chat</button>
        {routine.pauseVisible && (
          <button type="button" className="secondary" disabled={routine.pauseDisabled} onClick={onPauseCheck}>Pause check</button>
        )}
      </div>
      <div className="account-card">
        <h2>Email notifications</h2>
        <p>Get a link to The Mayor when unread issues need your attention. You can also ask The Mayor to turn these emails on or off. Email delivery is currently a pilot for approved recipient addresses. At most one email every 24 hours per business. Your business details stay in the app. Turning this off cancels queued messages; mail already being sent cannot be recalled.</p>
        <p role="status">{email.statusText}</p>
        {email.toggleVisible && (
          <button type="button" className="secondary" disabled={email.toggleDisabled} onClick={onToggleEmail}>{email.toggleLabel}</button>
        )}
      </div>
      <div className="account-card">
        <h2>Business agent</h2>
        <p>Goals, saved skills, the review schedule and your latest AI review. Manage them in Today.</p>
        <button type="button" className="secondary" onClick={onOpenAgent}>Open Business agent</button>
      </div>
    </>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountAccountCards(element: HTMLElement, props: AccountCardsProps): void {
  if (rootElement !== element) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  root.render(<AccountCards {...props} />);
}
