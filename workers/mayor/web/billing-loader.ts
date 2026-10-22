import type { BillingPanelProps } from './billing';

/** Thin loader (mirrors trendpost-loader): the React billing panel chunk
 * loads only when Plan & usage renders, keeping react-dom out of the
 * initial app-shell bundle. */
let loaded: Promise<typeof import('./billing')> | null = null;

export function loadBillingPanel(element: HTMLElement, props: BillingPanelProps, isCurrent: () => boolean): void {
  loaded ??= import('./billing');
  void loaded
    .then((module) => module.mountBilling(element, props, isCurrent))
    .catch(() => { /* a failed chunk leaves the loading state; next show retries */ });
}
