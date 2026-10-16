import type { ConnectorSessionsHooks } from './connector-sessions';

/** Thin loader (mirrors trendpost-loader): the React connector-sessions
 * chunk loads only when the signed-in owner opens the Connectors view. */
export function loadConnectorSessions(hooks: ConnectorSessionsHooks): void {
  const element = document.getElementById('connector-sessions-root');
  if (!element || !hooks.tenant()) return;
  void import('./connector-sessions')
    .then(({ mountConnectorSessions }) => mountConnectorSessions(element, hooks))
    .catch(() => { /* the classic connections hub below still works */ });
}
