import type { PanelProps, ProactiveHosts } from './proactive-panels';
import { lazyModule } from './lazy-module';

/** Thin loader (mirrors trendpost-loader): the React proactive panels
 * chunk loads on the first proactive render, keeping react-dom out of
 * the initial app-shell bundle. Calls queue in order on the shared
 * chunk promise, so the latest derived state always wins. DEF-037:
 * the chunk promise comes from lazyModule, so a failed load clears the
 * cache and the next push retries instead of losing the island for
 * the whole session. */
const chunk = lazyModule(() => import('./proactive-panels'));

export function loadProactivePanels(hosts: ProactiveHosts, props: PanelProps): void {
  void chunk.get()
    .then((module) => module.mountProactivePanels(hosts, props))
    .catch(() => { /* a failed chunk leaves the panels out; next push retries */ });
}
