import type {Actor,Env} from './env';
import {OPERATORS,requireMembership} from './permissions';
import {verticalProfile} from './verticals';
import {
 localDayKey,localWeekBoundsUtc,shiftLocalDate,loadProactiveContext,
} from './proactive-detectors';
import {readAvgTicket} from './proactive';

/** P5 — "Money this week" glanceable card (GET /money-week).
 *
 * WHAT THE DATA ACTUALLY SUPPORTS (investigated 2026-10-12):
 * - Appointments carry NO price: mayor_appointment_jobs.input_json is the
 *   booking schema (title/type/staff/start/end) and the scheduling policy's
 *   appointmentTypes carry name + duration only — there is no priced services
 *   catalog and no per-booking amount anywhere.
 * - There is NO payments source: Square/Stripe exist only as API-key
 *   connection *guides* (src/connector-guides.ts); no transaction is ever read.
 *   Collected revenue / income therefore CANNOT be shown — that is P6.
 * - The one real dollar input a tenant can have is the average ticket the
 *   owner typed in themselves (mayor_memory 'roi_config'.avgTicketCents — the
 *   same input the ROI dashboard's recovered-revenue tile already uses).
 * - Booking COUNTS are real: confirmed Mayor appointments
 *   (mayor_appointments.state='confirmed'), counted by reserved_start exactly
 *   as buildBriefing/buildRoi count them.
 *
 * So the card shows BOOKED VALUE AS AN ESTIMATE: confirmed bookings scheduled
 * in the week × the owner's own average ticket, labeled as an estimate from
 * bookings — never as revenue, income, or money collected. When no average
 * ticket is configured the dollar value is null (never $0 dressed up as a
 * measurement) and the card shows the real booking counts plus the prompt to
 * set an average ticket. Last week's figures use the same method with the
 * CURRENT average ticket, and the comparison is labeled that way.
 *
 * WEEK: Monday 00:00 – Sunday 23:59 in the business's own time zone
 * (loadProactiveContext resolves it exactly like the proactive/quiet-hours
 * code: scheduling policy first, then profile, then America/New_York).
 * Boundary math lives in proactive-detectors (localWeekBoundsUtc). */

export interface MoneyWeekPeriod{bookings:number;bookedValueCents:number|null}

export interface MoneyWeekSummary{
 thisWeek:MoneyWeekPeriod;
 lastWeek:MoneyWeekPeriod;
 bookingsDelta:number;
 bookedValueDeltaCents:number|null;
}

/** Pure aggregation. A null average ticket means NO dollar figure exists —
 * values stay null rather than collapsing to a fake $0. With a ticket set,
 * 0 bookings honestly computes to a $0 booked value. */
export function summarizeMoneyWeek(thisWeekBookings:number,lastWeekBookings:number,avgTicketCents:number|null):MoneyWeekSummary{
 const value=(bookings:number)=>avgTicketCents==null?null:bookings*avgTicketCents;
 const thisValue=value(thisWeekBookings),lastValue=value(lastWeekBookings);
 return {
  thisWeek:{bookings:thisWeekBookings,bookedValueCents:thisValue},
  lastWeek:{bookings:lastWeekBookings,bookedValueCents:lastValue},
  bookingsDelta:thisWeekBookings-lastWeekBookings,
  bookedValueDeltaCents:thisValue!=null&&lastValue!=null?thisValue-lastValue:null,
 };
}

async function countConfirmedBookings(env:Env,tenantId:string,start:string,end:string):Promise<number>{
 // Same counting convention as buildBriefing/buildRoi: confirmed appointments
 // by reserved_start (the buffer-adjusted start stored on the job).
 const row=await env.AGENT_DB.prepare(`SELECT COUNT(*) AS n FROM mayor_appointments a
  JOIN mayor_appointment_jobs j ON j.id=a.id
  WHERE a.tenant_id=? AND a.state='confirmed' AND j.reserved_start>=? AND j.reserved_start<?`)
  .bind(tenantId,start,end).first<{n:number}>();
 return row?.n??0;
}

export async function buildMoneyWeek(env:Env,actor:Actor,nowMs=Date.now()){
 await requireMembership(env,actor,OPERATORS);
 const ctx=await loadProactiveContext(env,actor.tenantId,nowMs);
 const today=localDayKey(nowMs,ctx.timeZone);
 const thisWeek=localWeekBoundsUtc(today,ctx.timeZone);
 const lastWeek=localWeekBoundsUtc(shiftLocalDate(thisWeek.startDate,-7),ctx.timeZone);
 const [avgTicketCents,thisWeekBookings,lastWeekBookings]=await Promise.all([
  readAvgTicket(env,actor.tenantId),
  countConfirmedBookings(env,actor.tenantId,thisWeek.start,thisWeek.end),
  countConfirmedBookings(env,actor.tenantId,lastWeek.start,lastWeek.end),
 ]);
 // Discard the computed figures if access changed while D1 was reading.
 await requireMembership(env,actor,OPERATORS);
 const summary=summarizeMoneyWeek(thisWeekBookings,lastWeekBookings,avgTicketCents);
 const bookingWord=verticalProfile(ctx.vertical).vocabulary.booking;
 return {
  weekStart:thisWeek.startDate,
  weekEnd:thisWeek.endDate,
  lastWeekStart:lastWeek.startDate,
  lastWeekEnd:lastWeek.endDate,
  timeZone:ctx.timeZone,
  vertical:ctx.vertical,
  bookingNoun:`${bookingWord}s`,
  ...summary,
  avgTicketCents,
  avgTicketConfigured:avgTicketCents!=null,
  valueBasis:avgTicketCents!=null?'average_ticket_estimate' as const:'not_configured' as const,
  generatedAt:new Date(nowMs).toISOString(),
 };
}
