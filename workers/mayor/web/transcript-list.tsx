import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Conversation transcript (React migration S2d; chat reenvision
 * Slice 1): the message rows of the chat list. Rendered by React 19
 * from the row model main.ts maintains (saved history merged with the
 * live voice transcript) inside the ChatApp tree (web/chat-app.tsx);
 * scroll positioning, the ResizeObserver follow logic, and the interim
 * line stay in main.ts — this component owns only the <li> rows,
 * matching the imperative structure exactly:
 * <li><b>label</b><span>text</span>[Copy reply]</li>. Copy feedback
 * resets when the row's text changes (the imperative version kept a
 * sticky "Copied" on positionally reused rows, including across the
 * 200-row window shift; per-content reset is the sane transcription). */

export interface TranscriptRow {
  role: string;
  text: string;
  /** Chat reenvision Slice 2: live-turn states rendered in flow.
   * 'sending'/'queued' mark owner rows (queued carries a cancel);
   * 'acting' is the working item before the first delta; 'streaming'
   * fills token by token; 'stopped' keeps the partial with its marker;
   * 'error' keeps any partial plus the failure line and Try again. */
  state?: 'sending' | 'queued' | 'acting' | 'streaming' | 'stopped' | 'error';
  /** Engine requestId for turn actions (cancel queued). */
  turnId?: string;
  /** Failure line for state 'error' (server copy, verbatim). */
  error?: string;
}

export interface TranscriptListProps {
  rows: TranscriptRow[];
  assistantLabel: string;
  onCopyFailed: () => void;
  onCancelQueued?: (turnId: string) => void;
  onRetryTurn?: () => void;
  onDismissError?: () => void;
}

function CopyReply({ text, onFailed }: { text: string; onFailed: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
  }, [text]);
  return (
    <button
      type="button"
      className="copy-reply"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          onFailed();
        }
      }}
    >
      {copied ? 'Copied' : 'Copy reply'}
    </button>
  );
}

export function TranscriptRowItem({
  row,
  assistantLabel,
  onCopyFailed,
  onCancelQueued,
  onRetryTurn,
  onDismissError,
}: {
  row: TranscriptRow;
  assistantLabel: string;
  onCopyFailed: () => void;
  onCancelQueued?: (turnId: string) => void;
  onRetryTurn?: () => void;
  onDismissError?: () => void;
}) {
  const stateClass = row.state ? ` turn-${row.state}` : '';
  return (
    <li className={(row.role === 'user' ? 'message-user' : 'message-mayor') + stateClass}>
      <b>{row.role === 'user' ? 'You' : assistantLabel}</b>
      {row.state === 'acting' ? (
        <span className="turn-acting">
          <span className="turn-dots" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span className="turn-note">Working on it…</span>
        </span>
      ) : (
        <span>
          {row.text}
          {row.state === 'streaming' && <span className="turn-caret" aria-hidden="true"></span>}
        </span>
      )}
      {row.state === 'sending' && <span className="turn-note">Sending…</span>}
      {row.state === 'queued' && (
        <span className="turn-queued-row">
          <span className="turn-note">Queued</span>
          {row.turnId && onCancelQueued && (
            <button
              type="button"
              className="turn-cancel"
              aria-label="Cancel queued message"
              onClick={() => onCancelQueued(row.turnId!)}
            >
              ×
            </button>
          )}
        </span>
      )}
      {row.state === 'stopped' && <span className="turn-note">Stopped — here’s what I had</span>}
      {row.state === 'error' && (
        <span className="turn-error-row">
          <span className="turn-error">{row.error}</span>
          {onRetryTurn && (
            <button type="button" className="turn-action" onClick={onRetryTurn}>
              Try again
            </button>
          )}
          {onDismissError && (
            <button type="button" className="turn-action" onClick={onDismissError}>
              Dismiss
            </button>
          )}
        </span>
      )}
      {row.role !== 'user' && row.state !== 'acting' && row.text && (
        <CopyReply text={row.text} onFailed={onCopyFailed} />
      )}
    </li>
  );
}

export function TranscriptList({ rows, assistantLabel, onCopyFailed, onCancelQueued, onRetryTurn, onDismissError }: TranscriptListProps) {
  return (
    <>
      {rows.map((message, i) => (
        <TranscriptRowItem
          key={message.turnId ? `${message.role}:${message.turnId}` : i}
          row={message}
          assistantLabel={assistantLabel}
          onCopyFailed={onCopyFailed}
          onCancelQueued={onCancelQueued}
          onRetryTurn={onRetryTurn}
          onDismissError={onDismissError}
        />
      ))}
    </>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountTranscriptList(element: HTMLElement, props: TranscriptListProps): void {
  if (rootElement !== element) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  root.render(<TranscriptList {...props} />);
}
