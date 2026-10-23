import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {chaseStepForDaysOverdue, dateAddDays, daysBetween, fridayOfWeek, fridaySummaryText, mondayOfWeek, zonedMidnightUtcMs, zonedParts} from '../src/cashtext/cadence';

/* Phase 4 unit pins (integration spec §3.4/§3.6): the cadence math —
 * chase step thresholds, Friday-of-week across every weekday, and
 * tenant-timezone parts — is pure and pinned here; the stateful
 * behavior (scan + summary writing) is proven in
 * tests/integration/cashtext-phase4.test.ts. */

it('chase steps: due+2 -> 1, due+7 -> 2, due+14 -> 3, and nothing before due+2', () => {
 expect(chaseStepForDaysOverdue(-3)).toBe(0);
 expect(chaseStepForDaysOverdue(0)).toBe(0);
 expect(chaseStepForDaysOverdue(1)).toBe(0);
 expect(chaseStepForDaysOverdue(2)).toBe(1);
 expect(chaseStepForDaysOverdue(6)).toBe(1);
 expect(chaseStepForDaysOverdue(7)).toBe(2);
 expect(chaseStepForDaysOverdue(13)).toBe(2);
 expect(chaseStepForDaysOverdue(14)).toBe(3);
 expect(chaseStepForDaysOverdue(45)).toBe(3);
});

it('fridayOfWeek: every weekday of one week resolves to the same Friday; weekend dates belong to the week just ended', () => {
 // Week of Mon 2026-10-19 … Sun 2026-10-25; Friday is 2026-10-23.
 for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  expect(fridayOfWeek(d)).toBe('2026-10-23');
 expect(mondayOfWeek('2026-10-23')).toBe('2026-10-19');
 expect(mondayOfWeek('2026-10-25')).toBe('2026-10-19');
 expect(dateAddDays('2026-10-23', 3)).toBe('2026-10-26');
 expect(daysBetween('2026-10-21', '2026-10-23')).toBe(2);
});

it('zonedParts: 21:00Z is Friday 17:00 in New York (EDT) and Friday 14:00 in Los Angeles', () => {
 const now = new Date('2026-10-23T21:00:00.000Z');
 expect(zonedParts(now, 'America/New_York')).toMatchObject({ date: '2026-10-23', weekday: 'Fri', hour: 17, minute: 0 });
 expect(zonedParts(now, 'America/Los_Angeles')).toMatchObject({ date: '2026-10-23', weekday: 'Fri', hour: 14, minute: 0 });
 // Standard time (EST, UTC-5): 22:00Z is 17:00.
 expect(zonedParts(new Date('2026-12-04T22:00:00.000Z'), 'America/New_York')).toMatchObject({ date: '2026-12-04', weekday: 'Fri', hour: 17 });
});

it('zonedMidnightUtcMs: local midnight round-trips through zonedParts in DST and standard time', () => {
 for (const [date, tz] of [['2026-10-23', 'America/New_York'], ['2026-12-04', 'America/New_York'], ['2026-10-23', 'Pacific/Kiritimati'], ['2026-10-23', 'America/Los_Angeles']] as const) {
  const ms = zonedMidnightUtcMs(date, tz);
  expect(zonedParts(new Date(ms), tz)).toMatchObject({ date, hour: 0, minute: 0 });
 }
 // Friday 17:00 New York (EDT) is 21:00Z — the summary fire instant.
 expect(new Date(zonedMidnightUtcMs('2026-10-23', 'America/New_York') + 17 * 3_600_000).toISOString()).toBe('2026-10-23T21:00:00.000Z');
});

it('fridaySummaryText: a zero week is the one-line quiet summary; a real week names who paid and what waits', () => {
 expect(fridaySummaryText({ collectedThisWeekCents: 0, collectedThisWeekCount: 0, paidBy: [], stillOutCents: 0, stillOutCount: 0, oldestOutDays: 0, chasesWaiting: 0, draftsWaiting: 0 }))
  .toBe('Friday cash summary — quiet week: nothing collected, nothing outstanding, nothing waiting on you.');
 const text = fridaySummaryText({ collectedThisWeekCents: 40000, collectedThisWeekCount: 1, paidBy: ['Maria Lopez'], stillOutCents: 25000, stillOutCount: 2, oldestOutDays: 9, chasesWaiting: 1, draftsWaiting: 1 });
 expect(text).toContain('Collected this week: $400 (1 payment — Maria Lopez).');
 expect(text).toContain('Still out: $250 across 2 invoices (oldest 9 days).');
 expect(text).toContain('Waiting on you: 1 chase to approve, 1 draft invoice.');
});

it('wiring pins: the cron calls the cadence, the Desk renders the stored summary, the scan is approval-first by construction', () => {
 const index = readFileSync('src/index.ts', 'utf8');
 expect(index).toContain("import {runCashTextCadence} from './cashtext/cadence';");
 expect(index).toContain('runCashTextCadence(env)');
 const surface = readFileSync('src/engine/surface.ts', 'utf8');
 expect(surface).toContain('cashtext-summary-');
 expect(surface).toContain('mayor_cashtext_summaries');
 const cadence = readFileSync('src/cashtext/cadence.ts', 'utf8');
 // The scan PREPARES cards — it never imports the executor and never
 // calls Stripe: sending stays behind per-chase approval, forever.
 expect(cadence).not.toContain('executeCashTextSend');
 expect(cadence).not.toContain('StripeClient');
 expect(cadence).toContain('cashtext_friday_summary');
 const migration = readFileSync('migrations/0081_cashtext_cadence.sql', 'utf8');
 expect(migration).toContain('mayor_cashtext_summaries');
 expect(migration).toContain('cashtext_friday_summary');
 expect(migration).toContain('UNIQUE(tenant_id, week_key)');
});
