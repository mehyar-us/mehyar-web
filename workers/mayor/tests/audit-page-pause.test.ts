import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { injectAuditPagePausedLine } from '../src/offer-block-ssr';
import { AUDIT_PAUSED_MESSAGE } from '../src/billing/audit';

/* Rotation 633 (Product Chief order, 2026-10-24): the /business-audit
 * page carries its own paused line at its ask (#audit-availability,
 * directly above the #start-audit intake form), rendered from the
 * live generation-pause signal on the homepage band's fail-closed
 * discipline — the paused form ONLY when the server state says
 * paused; the bytes untouched otherwise (open, or unavailable for a
 * non-pause reason — no statement the state cannot back). */

const auditPage = readFileSync(new URL('../web/business-audit.html', import.meta.url), 'utf8');

describe('injectAuditPagePausedLine — the audit page paused line', () => {
  it('paused: the availability line renders the offer endpoint message, stamped, exactly once', () => {
    const out = injectAuditPagePausedLine(auditPage, true);
    expect(out).not.toBe(auditPage);
    expect(out).toContain(AUDIT_PAUSED_MESSAGE);
    expect(out.split(AUDIT_PAUSED_MESSAGE).length - 1).toBe(1);
    expect(out).toContain('<p id="audit-availability" data-ssr="audit-state"');
    expect(out).not.toContain('Checking checkout availability…');
    // Nothing else on the page moves: the bytes before the element
    // and after its close are the shipped page's, byte for byte.
    const openAt = auditPage.indexOf('<p id="audit-availability"');
    const closeAt = auditPage.indexOf('</p>', openAt) + '</p>'.length;
    expect(out.startsWith(auditPage.slice(0, openAt))).toBe(true);
    expect(out.endsWith(auditPage.slice(closeAt))).toBe(true);
  });
  it('not paused: byte-identical — open keeps the client-resolved presentation', () => {
    expect(injectAuditPagePausedLine(auditPage, false)).toBe(auditPage);
  });
  it('element missing: unchanged even when paused (no guessing)', () => {
    const shell = '<html><body><section id="start-audit"></section></body></html>';
    expect(injectAuditPagePausedLine(shell, true)).toBe(shell);
  });
  it('already stamped: unchanged (idempotent — never double-renders)', () => {
    const once = injectAuditPagePausedLine(auditPage, true);
    expect(injectAuditPagePausedLine(once, true)).toBe(once);
  });
  it('unexpected element content: unchanged (the guard refuses to guess)', () => {
    const tampered = auditPage.replace('Checking checkout availability…', 'Some other line entirely');
    expect(injectAuditPagePausedLine(tampered, true)).toBe(tampered);
  });
});
