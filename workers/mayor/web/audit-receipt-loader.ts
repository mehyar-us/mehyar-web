import type { AuditReceiptProps } from './audit-receipt';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React audit-receipt
 * chunk loads on the first receipt render, keeping react-dom out of
 * the audit page's initial bundle. DEF-037: the chunk promise comes
 * from lazyModule, so a failed load clears the cache and the next
 * render retries instead of losing the island for the whole session. */
const chunk = lazyModule(() => import('./audit-receipt'));

export function loadAuditReceipt(element: HTMLElement, props: AuditReceiptProps): void {
  void chunk.get()
    .then((module) => module.mountAuditReceipt(element, props))
    .catch(() => { /* a failed chunk leaves the static panel; next push retries */ });
}
