import type { BillingPanelProps } from './billing';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React billing panel chunk
 * loads only when Plan & usage renders, keeping react-dom out of the
 * initial app-shell bundle. DEF-037: the chunk promise comes from
 * lazyModule, so a failed load clears the cache and the next show
 * retries instead of losing the island for the whole session. */
const chunk = lazyModule(() => import('./billing'));

export function loadBillingPanel(element: HTMLElement, props: BillingPanelProps, isCurrent: () => boolean): void {
  void chunk.get()
    .then((module) => module.mountBilling(element, props, isCurrent))
    .catch(() => { /* a failed chunk leaves the loading state; next show retries */ });
}
