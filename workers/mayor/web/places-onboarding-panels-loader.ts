import type { PlacesPanelsProps } from './places-onboarding-panels';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React onboarding panels
 * chunk loads on the first wizard render. Calls queue in order on the
 * shared chunk promise, so the latest view state always wins. DEF-037:
 * the chunk promise comes from lazyModule, so a failed load clears the
 * cache and the next render retries instead of losing the island for
 * the whole session. */
const chunk = lazyModule(() => import('./places-onboarding-panels'));

export function loadPlacesPanels(element: HTMLElement, props: PlacesPanelsProps): void {
  void chunk.get()
    .then((module) => module.mountPlacesPanels(element, props))
    .catch(() => { /* a failed chunk leaves the wizard out; next push retries */ });
}
