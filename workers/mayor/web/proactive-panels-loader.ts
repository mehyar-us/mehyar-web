import type { PanelProps, ProactiveHosts } from './proactive-panels';

/** Thin loader (mirrors trendpost-loader): the React proactive panels
 * chunk loads on the first proactive render, keeping react-dom out of
 * the initial app-shell bundle. Calls queue in order on the shared
 * chunk promise, so the latest derived state always wins. */
let loaded: Promise<typeof import('./proactive-panels')> | null = null;

export function loadProactivePanels(hosts: ProactiveHosts, props: PanelProps): void {
  loaded ??= import('./proactive-panels');
  void loaded
    .then((module) => module.mountProactivePanels(hosts, props))
    .catch(() => { /* a failed chunk leaves the panels out; next push retries */ });
}
