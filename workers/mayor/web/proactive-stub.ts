/**
 * Crew 3 — Proactive engine frontend adapter (STUB).
 * ============================================================================
 * The Crew 3 backend (GET /briefing, GET /suggestions, POST .../send|edit|
 * dismiss, GET /roi under /api/businesses/{tenantId}/) is being built in
 * parallel by the backend crew and is NOT live yet.
 *
 * This module is the single seam between the UI and those endpoints:
 *  - It exports the exact contract types the backend will serve.
 *  - Every fetcher calls the REAL contract URL first.
 *  - When the worker answers 404 {error:'not_found'} (route not registered
 *    yet), the fetcher resolves to null instead of throwing, so the UI renders
 *    an honest "not available yet" empty state — NEVER invented numbers
 *    (compliance item 9: no dark patterns, honest numbers only).
 *  - Any other failure still throws, so the UI can show a real error + retry.
 *
 * Swap-in is one line: when the backend goes live these functions need NO
 * changes — the 404 path simply stops triggering. Remove the STUB banner then.
 *
 * ADAPTED 2026-10-08: the backend crew landed src/proactive.ts on this branch.
 * Real shapes differ from the draft contract in two places, handled below:
 *  - POST suggestions/{id}/edit returns {id,message,audience,audienceCount,state}
 *    (NOT {card}).
 *  - POST suggestions/{id}/dismiss returns {dismissed:true} (NOT {ok:true}).
 *  - Suggestion cards carry no `detector` field (optional in the type).
 *  - Edit messages are capped at 320 chars server-side.
 *  - GET /roi adds revenueSource + avgTicketConfigured.
 * ============================================================================
 */

export interface BriefingYesterday { appointments: number; noShows: number; revenueCents: number | null }
export interface BriefingGap { start: string; end: string }
export interface BriefingToday { appointments: number; gaps: BriefingGap[]; firstAt: string | null; lastAt: string | null }
export interface BriefingMissed { total: number; textedBack: number; recovered: number }
export interface BriefingOpportunity { cardId: string; title: string; oneLine: string }
export interface Briefing {
  date: string; businessName: string; vertical: string | null;
  yesterday: BriefingYesterday; today: BriefingToday;
  missedCalls: BriefingMissed; opportunities: BriefingOpportunity[]; generatedAt: string;
}

export interface SuggestionDraft { message: string; audience: string; audienceCount: number }
export interface SuggestionCard {
  id: string; kind: string; detector?: string; title: string; body: string;
  draft: SuggestionDraft; state: string; createdAt: string;
}
export interface SendResult { sent: boolean; audienceCount: number; simulated: boolean }
/** Real edit response shape (differs from the draft contract's {card}). */
export interface EditResult { id: string; message: string; audience: string; audienceCount: number; state: string }

export interface RoiMonth { month: string; rate: number }
export interface ProactiveRoi {
  month: string; recoveredRevenueCents: number | null; appointmentsBookedByMayor: number;
  missedCallsRecovered: { recovered: number; total: number };
  avgResponseTimeSeconds: number | null; noShowRate: number | null;
  noShowTrend: RoiMonth[]; generatedAt: string;
  revenueSource?: 'configured_avg_ticket' | 'recorded_amounts' | 'not_configured';
  avgTicketConfigured?: boolean;
}

type Api = (path: string, body?: unknown, headers?: Record<string, string>) => Promise<any>;

/**
 * The worker answers 404 {error:'not_found'} for routes that are not
 * registered yet; the app api() helper surfaces that as an Error with
 * code 'not_found'. That is the "backend crew hasn't landed this yet" signal.
 */
export function isNotLive(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'not_found';
}

const base = (tenantId: string) => `/api/businesses/${tenantId}`;

export async function fetchBriefing(api: Api, tenantId: string): Promise<Briefing | null> {
  try { return await api(`${base(tenantId)}/briefing`) as Briefing; }
  catch (error) { if (isNotLive(error)) return null; throw error; }
}

export async function fetchSuggestions(api: Api, tenantId: string): Promise<SuggestionCard[] | null> {
  try { return (await api(`${base(tenantId)}/suggestions`) as { cards: SuggestionCard[] }).cards ?? []; }
  catch (error) { if (isNotLive(error)) return null; throw error; }
}

export async function sendSuggestion(api: Api, tenantId: string, id: string): Promise<SendResult> {
  // POST (non-empty body) per the contract: POST suggestions/{id}/send
  return await api(`${base(tenantId)}/suggestions/${encodeURIComponent(id)}/send`, {}) as SendResult;
}

export async function editSuggestion(api: Api, tenantId: string, id: string, message: string): Promise<EditResult> {
  // Real backend returns {id,message,audience,audienceCount,state} (not {card}).
  return await api(`${base(tenantId)}/suggestions/${encodeURIComponent(id)}/edit`, { message }) as EditResult;
}

export async function dismissSuggestion(api: Api, tenantId: string, id: string): Promise<void> {
  // Real backend returns {dismissed:true}; the result carries no UI data.
  await api(`${base(tenantId)}/suggestions/${encodeURIComponent(id)}/dismiss`, {});
}

export async function fetchRoi(api: Api, tenantId: string): Promise<ProactiveRoi | null> {
  try { return await api(`${base(tenantId)}/roi`) as ProactiveRoi; }
  catch (error) { if (isNotLive(error)) return null; throw error; }
}

/* ------------------------------------------------------------------ */
/* Pure contract helpers — shared by the UI and the unit tests.        */
/* ------------------------------------------------------------------ */

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function pluralize(count: number, one: string, many?: string): string {
  return `${count} ${count === 1 ? one : many ?? one + 's'}`;
}

/**
 * Format an ISO timestamp as a short clock time in the business time zone.
 * Passes display strings (e.g. "11:30 AM") through untouched.
 */
export function formatClock(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
}

/** "2026-10-08" -> "Thursday, Oct 8" */
export function formatBriefingDate(date: string): string {
  const parsed = new Date(date.length === 10 ? `${date}T12:00:00Z` : date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed);
}

/** generatedAt ISO -> "8:32 AM" for the "as of" captions. */
export function formatAsOf(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(parsed);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Polyline points for the no-show trend sparkline (viewBox 0 0 120 36). */
export function sparklinePoints(trend: Array<{ rate: number }>, width = 120, height = 36, pad = 3): string {
  if (!trend.length) return '';
  const max = Math.max(...trend.map(point => point.rate), 0.0001);
  return trend.map((point, index) => {
    const x = trend.length === 1 ? width / 2 : pad + (index * (width - 2 * pad)) / (trend.length - 1);
    const y = height - pad - (point.rate / max) * (height - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
