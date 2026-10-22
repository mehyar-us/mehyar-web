import type { AuditReceiptProps } from './audit-receipt';

/** Thin loader (mirrors trendpost-loader): the React audit-receipt
 * chunk loads on the first receipt render, keeping react-dom out of
 * the audit page's initial bundle. */
let loaded: Promise<typeof import('./audit-receipt')> | null = null;

export function loadAuditReceipt(element: HTMLElement, props: AuditReceiptProps): void {
  loaded ??= import('./audit-receipt');
  void loaded
    .then((module) => module.mountAuditReceipt(element, props))
    .catch(() => { /* a failed chunk leaves the static panel; next push retries */ });
}
