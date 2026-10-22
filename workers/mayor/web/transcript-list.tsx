import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Conversation transcript (React migration S2d): the message rows of
 * the chat list. Rendered by React 19 from the row model main.ts
 * maintains (saved history merged with the live voice transcript); the
 * list element itself, its scroll positioning, the ResizeObserver
 * follow logic, and the interim line stay in main.ts — this component
 * owns only the <li> rows, matching the imperative structure exactly:
 * <li><b>label</b><span>text</span>[Copy reply]</li>. Copy feedback
 * resets when the row's text changes (the imperative version kept a
 * sticky "Copied" on positionally reused rows, including across the
 * 200-row window shift; per-content reset is the sane transcription). */

export interface TranscriptRow {
  role: string;
  text: string;
}

export interface TranscriptListProps {
  rows: TranscriptRow[];
  assistantLabel: string;
  onCopyFailed: () => void;
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

export function TranscriptList({ rows, assistantLabel, onCopyFailed }: TranscriptListProps) {
  return (
    <>
      {rows.map((message, i) => (
        <li key={i} className={message.role === 'user' ? 'message-user' : 'message-mayor'}>
          <b>{message.role === 'user' ? 'You' : assistantLabel}</b>
          <span>{message.text}</span>
          {message.role !== 'user' && <CopyReply text={message.text} onFailed={onCopyFailed} />}
        </li>
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
