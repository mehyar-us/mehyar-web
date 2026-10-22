import type { PlacesPanelsProps } from './places-onboarding-panels';

/** Thin loader (mirrors trendpost-loader): the React onboarding panels
 * chunk loads on the first wizard render. Calls queue in order on the
 * shared chunk promise, so the latest view state always wins. */
let loaded: Promise<typeof import('./places-onboarding-panels')> | null = null;

export function loadPlacesPanels(element: HTMLElement, props: PlacesPanelsProps): void {
  loaded ??= import('./places-onboarding-panels');
  void loaded
    .then((module) => module.mountPlacesPanels(element, props))
    .catch(() => { /* a failed chunk leaves the wizard out; next push retries */ });
}
