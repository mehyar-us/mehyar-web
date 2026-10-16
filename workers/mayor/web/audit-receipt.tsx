import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RefreshCw, FileText, Copy, Check } from 'lucide-react';

/** Audit receipt panel (React migration S6): the /business-audit
 * status panel — heading, summary, detail list, and the refresh /
 * report / support actions — rendered by React 19 from the view state
 * audit-main.ts computes from the verified receipt. The intake form
 * stays a native FormData form and the pure intake/checkout/receipt
 * logic in audit-main.ts is untouched; audit-main.ts keeps the token
 * bootstrap, the status fetch with its strict receipt validation, and
 * the panel's hidden lifecycle. */

export interface ReceiptDetail {
  label: string;
  value: string;
  /* Reference-data pattern: a detail whose value is an identifier the
   * owner may need elsewhere (the audit request reference) carries a
   * one-tap copy button with Copied feedback on its row. */
  copy?: boolean;
}

function ReceiptCopyButton({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="receipt-copy"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState('copied');
          } catch {
            setState('failed');
          }
          window.setTimeout(() => setState('idle'), 2000);
        })();
      }}
    >
      {state === 'copied' ? <Check aria-hidden="true" focusable="false" /> : <Copy aria-hidden="true" focusable="false" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy unavailable' : 'Copy'}
    </button>
  );
}

export interface ReceiptView {
  heading: string;
  summary: string;
  details: ReceiptDetail[];
  refreshDisabled: boolean;
  reportHref: string | null;
  supportHref: string | null;
}

export interface AuditReceiptProps {
  view: ReceiptView;
  onRefresh: () => void;
}

export function AuditReceiptPanel({ view, onRefresh }: AuditReceiptProps) {
  return (
    <>
      <div className="section-kicker">YOUR AUDIT REQUEST</div>
      <h1 id="receipt-heading">{view.heading}</h1>
      <p id="receipt-summary" role="status">
        {view.summary}
      </p>
      <dl id="receipt-details">
        {view.details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>
              {detail.value}
              {detail.copy && <ReceiptCopyButton value={detail.value} />}
            </dd>
          </div>
        ))}
      </dl>
      <div className="receipt-actions">
        <button id="receipt-refresh" className="button" type="button" disabled={view.refreshDisabled} onClick={onRefresh}>
          Refresh status <RefreshCw aria-hidden="true" focusable="false" />
        </button>
        {view.reportHref && (
          <a id="audit-report-link" className="button button-outline" target="_blank" rel="noopener noreferrer" href={view.reportHref}>
            Open your report <FileText aria-hidden="true" focusable="false" />
          </a>
        )}
        {view.supportHref && (
          <a
            className="button button-outline"
            href={view.supportHref}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            aria-label="Contact support (opens in a new tab)"
          >
            Contact support
          </a>
        )}
        <a className="text-link" href="#start-audit">
          Back to audit details
        </a>
      </div>
      <p className="small-copy">Your private receipt link provides access to this status. Keep it for your records.</p>
    </>
  );
}

let root: Root | null = null;
let rootElement: HTMLElement | null = null;

export function mountAuditReceipt(element: HTMLElement, props: AuditReceiptProps): void {
  if (rootElement !== element || !root) {
    root?.unmount();
    root = createRoot(element);
    rootElement = element;
  }
  const current: Root = root;
  current.render(<AuditReceiptPanel {...props} />);
}
