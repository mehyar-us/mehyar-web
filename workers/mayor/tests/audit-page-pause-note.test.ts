import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIT_PAUSED_NOTE_TEXT, injectAuditPagePausedLine, injectAuditPagePausedNote } from '../src/offer-block-ssr';
import { AUDIT_PAUSED_MESSAGE } from '../src/billing/audit';

/* 2026-10-24 (Product Chief order): the /business-audit intake's
 * checkout note — the small print directly under the submit button —
 * ships the live-checkout instruction ("Continue to Stripe to review
 * and pay. Enter payment details there.") in the static bytes, and
 * the client never rewrites it, so beside the rotation-633 paused
 * line the form still promised a Stripe payment at the same ask.
 * While the rail is generation-paused the note carries the rail's
 * one paused dialect instead (annotate-never-remove: the form, the
 * intake, and the note element stay; only the promise changes),
 * driven by the same live signal as the line; the bytes are
 * untouched otherwise, so the Stripe instruction returns with the
 * config on the day the pause lifts — because then it is true. */

const auditPage = readFileSync(new URL('../web/business-audit.html', import.meta.url), 'utf8');
const PROMISE = 'Continue to Stripe to review and pay. Enter payment details there.';

describe('injectAuditPagePausedNote — the audit page checkout note, paused', () => {
  it('paused: the note carries the paused dialect, stamped, exactly once — the Stripe promise is gone', () => {
    const out = injectAuditPagePausedNote(auditPage, true);
    expect(out).not.toBe(auditPage);
    expect(out).toContain(AUDIT_PAUSED_NOTE_TEXT);
    expect(out.split(AUDIT_PAUSED_NOTE_TEXT).length - 1).toBe(1);
    expect(out).not.toContain('Continue to Stripe');
    expect(out).not.toContain(PROMISE);
    expect(out).toContain('<p class="checkout-note" data-ssr="audit-state"');
    // The note's own furniture survives: the lock icon rides along,
    // only the span's words changed.
    expect(out).toContain('<i data-lucide="lock-keyhole" aria-hidden="true"></i><span>' + AUDIT_PAUSED_NOTE_TEXT + '</span>');
    // Nothing else on the page moves: the bytes before the note
    // element and after its close are the shipped page's, byte for byte.
    const openAt = auditPage.indexOf('<p class="checkout-note"');
    const closeAt = auditPage.indexOf('</p>', openAt) + '</p>'.length;
    expect(out.startsWith(auditPage.slice(0, openAt))).toBe(true);
    expect(out.endsWith(auditPage.slice(closeAt))).toBe(true);
  });
  it('not paused: byte-identical — the live checkout keeps its instruction', () => {
    expect(injectAuditPagePausedNote(auditPage, false)).toBe(auditPage);
    expect(injectAuditPagePausedNote(auditPage, false)).toContain(PROMISE);
  });
  it('element missing: unchanged even when paused (no guessing)', () => {
    const shell = '<html><body><form id="audit-intake-form"></form></body></html>';
    expect(injectAuditPagePausedNote(shell, true)).toBe(shell);
  });
  it('already stamped: unchanged (idempotent — never double-renders)', () => {
    const once = injectAuditPagePausedNote(auditPage, true);
    expect(injectAuditPagePausedNote(once, true)).toBe(once);
  });
  it('unexpected note content: unchanged (the guard refuses to guess)', () => {
    const tampered = auditPage.replace(PROMISE, 'Some other instruction entirely.');
    expect(injectAuditPagePausedNote(tampered, true)).toBe(tampered);
  });
  it('composed with the paused line: the page states one posture — pause at the ask, no promise at the form', () => {
    const out = injectAuditPagePausedNote(injectAuditPagePausedLine(auditPage, true), true);
    expect(out.split(AUDIT_PAUSED_MESSAGE).length - 1).toBe(1);
    expect(out).toContain('<p id="audit-availability" data-ssr="audit-state"');
    expect(out).not.toContain('Continue to Stripe');
    // The form and intake stand exactly as shipped.
    expect(out).toContain('id="audit-intake-form"');
    expect(out).toContain('id="audit-checkout-button"');
    expect(out).toContain('id="contact-email"');
    expect(out).toContain('id="audit-accepted-terms"');
  });
});
