import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Reference-data pattern (Mayor's Robinhood rule; Product Chief standing
 * order 2026-10-16): identifiers a user may need elsewhere render as
 * label-above/value rows with a one-tap copy button and Copied feedback —
 * the MCP endpoint and token IDs in the Connectors hub, custom-connection
 * endpoints, and the audit request reference on the receipt panel. The
 * MCP token's show-once rule is untouched (the list shows the token's ID
 * reference, never the secret). */

const hub = readFileSync(new URL('../web/connections-hub.tsx', import.meta.url), 'utf8');
const connections = readFileSync(new URL('../web/connections.ts', import.meta.url), 'utf8');
const receipt = readFileSync(new URL('../web/audit-receipt.tsx', import.meta.url), 'utf8');
const auditMain = readFileSync(new URL('../web/audit-main.ts', import.meta.url), 'utf8');

describe('reference-data pattern', () => {
  it('hub renders a shared reference row with label above, value, and copy feedback', () => {
    expect(hub).toContain('reference-label');
    expect(hub).toContain('reference-value');
    expect(hub).toContain("'Copied' : 'Copy'");
  });
  it('MCP endpoint is shown as a value row (not hidden behind a button)', () => {
    expect(hub).toContain('label="MCP endpoint" value={view.mcpEndpoint}');
    expect(hub).not.toContain('Copy endpoint');
  });
  it('token rows show the token ID as the copyable value', () => {
    expect(hub).toContain('value={token.id}');
    expect(hub).toContain('qualifier={token.line}');
  });
  it('custom connection cards carry an Endpoint reference row', () => {
    expect(hub).toContain('label="Endpoint" value={connection.endpointRef}');
    expect(connections).toContain('endpointRef=connection.endpoint??connection.origin');
  });
  it('copy rides the module clipboard helper with stamp guard', () => {
    expect(connections).toContain('async function copyValue(text:string):Promise<boolean>');
    expect(connections).toContain('copyText:(text:string)=>copyValue(text)');
  });
  it('audit receipt: the Audit request reference is copyable, other details are not forced', () => {
    expect(auditMain).toContain("{label:'Audit request',value:receipt.orderId,copy:true}");
    expect(receipt).toContain('ReceiptCopyButton');
    expect(receipt).toContain("detail.copy &&");
  });
});
