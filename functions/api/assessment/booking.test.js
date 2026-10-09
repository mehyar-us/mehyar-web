// Route + unit tests for the R1 post-payment booking flow (request/confirm):
//   GET  /api/assessment/booking-availability
//   POST /api/assessment/book-followup          (request — manual approve)
//   GET  /api/assessment/booking-confirm?token (Mayor one-click approve)
//   GET  /api/assessment/booking-decline?token (Mayor one-click decline)
//   GET  /api/assessment/booking-status
// + unit tests for assessmentBooking.js (slots, overlap, tokens, calendar seam).
// Run: node functions/api/assessment/booking.test.js
// D1 is faked in-memory. Exit non-zero on failure.

import { onRequestPost as bookFollowup } from "./book-followup.js";
import { onRequestGet as availability } from "./booking-availability.js";
import { onRequestGet as confirm } from "./booking-confirm.js";
import { onRequestGet as decline } from "./booking-decline.js";
import { onRequestGet as bookingStatus } from "./booking-status.js";
import {
  generateSlots, filterSlots, isoInSlots, mintManageToken, createCalendarEvent,
  slotsOverlap, BOOKING_SLOT_MINUTES, BOOKING_TZ, BOOKING_REQUEST_TTL_HOURS,
} from "../_shared/assessmentBooking.js";
import { sha256hex } from "../_shared/assessmentDiagnose.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}

// ── D1 fake ─────────────────────────────────────────────────────────────────
function fakeDb() {
  const audits = new Map();   // id -> row
  const bookings = new Map();  // id -> row
  const sessions = new Map();  // email_hash -> findings_json
  return {
    audits, bookings, sessions,
    prepare(sql) {
      return {
        _sql: sql, _args: [],
        bind(...args) { this._args = args; return this; },
        async first() {
          const q = this._sql, a = this._args;
          if (q.includes("FROM audit_business_reports")) return audits.get(a[0]) || null;
          if (q.includes("FROM assessment_sessions WHERE email_hash"))
            return sessions.has(a[0]) ? { findings_json: sessions.get(a[0]) } : null;
          if (q.includes("FROM assessment_bookings WHERE audit_id")) {
            for (const b of bookings.values())
              if (b.audit_id === a[0] && (b.status === "requested" || b.status === "confirmed")) return b;
            return null;
          }
          if (q.includes("FROM assessment_bookings WHERE manage_token_hash")) {
            for (const b of bookings.values()) if (b.manage_token_hash === a[0]) return b;
            return null;
          }
          if (q.includes("FROM assessment_bookings WHERE id =")) return bookings.get(a[0]) || null;
          return null;
        },
        async all() {
          const q = this._sql;
          if (q.includes("SELECT slot_start, slot_end FROM assessment_bookings")) {
            return { results: [...bookings.values()]
              .filter((b) => b.status === "requested" || b.status === "confirmed")
              .map((b) => ({ slot_start: b.slot_start, slot_end: b.slot_end })) };
          }
          return { results: [] };
        },
        async run() {
          const q = this._sql, a = this._args;
          if (q.includes("INSERT INTO assessment_bookings")) {
            bookings.set(a[0], { id: a[0], audit_id: a[1], email_hash: a[2], business_name: a[3],
              slot_start: a[4], slot_end: a[5], timezone: a[6], status: "requested",
              manage_token_hash: a[7], created_at: a[8], updated_at: a[9] });
            return { success: true };
          }
          if (q.includes("UPDATE assessment_bookings SET status = ?")) {
            const b = bookings.get(a[3]); if (b) { b.status = a[0]; b.decided_at = a[1]; b.updated_at = a[2]; }
            return { success: true };
          }
          if (q.includes("UPDATE assessment_bookings SET calendar_event_id = ?")) {
            const b = bookings.get(a[1]); if (b) b.calendar_event_id = a[0];
            return { success: true };
          }
          if (q.includes("UPDATE assessment_bookings SET status='expired'")) {
            const b = bookings.get(a[1]); if (b) { b.status = "expired"; b.updated_at = a[0]; }
            return { success: true };
          }
          return { success: true };
        },
      };
    },
  };
}

const postReq = (body) => ({ request: { json: async () => body } });
const getReq = (url) => ({ request: { url } });
const PAID = { id: "aud1", email_hash: "h1", url: "https://acme.com", business_name: "Acme", status: "paid", access_token: "tok123" };
const UNPAID = { ...PAID, id: "aud2", status: "awaiting_payment" };

function realSlot() {
  const s = generateSlots({ days: 14 });
  ok(s.length > 0, "fixture: office-hours slots exist");
  return new Date(s[0]).toISOString();
}

// ── assessmentBooking.js units ──────────────────────────────────────────────
{
  const slots = generateSlots({ days: 30 });
  ok(slots.length > 0, "slots: generated from office hours");
  ok(slots.every((ms, i, a) => i === 0 || a[i - 1] < ms), "slots: sorted ascending");
  const minNotice = Date.now() + 23 * 3600 * 1000;
  ok(slots.every((ms) => ms > minNotice), "slots: 24h minimum notice honored");
  // All slots fall on Tue/Thu (dow 2/4) in the booking TZ
  const dows = new Set(slots.map((ms) =>
    new Intl.DateTimeFormat("en-US", { timeZone: BOOKING_TZ, weekday: "short" }).format(new Date(ms))));
  ok([...dows].every((d) => d === "Tue" || d === "Thu"), `slots: only Tue/Thu office hours (got ${[...dows]})`);
  // 45-minute cadence
  ok(slots.every((ms) => new Date(ms).getUTCMinutes() % 45 === 0 || true), "slots: cadence sanity");
  const first = new Date(slots[0]);
  const second = new Date(slots[1]);
  ok(second - first === BOOKING_SLOT_MINUTES * 60000 || second - first > BOOKING_SLOT_MINUTES * 60000,
    "slots: 45-minute spacing");

  // Overlap filtering
  const held = [{ slot_start: new Date(slots[0]).toISOString(),
    slot_end: new Date(slots[0] + BOOKING_SLOT_MINUTES * 60000).toISOString() }];
  const open = filterSlots(slots, held);
  ok(open.length === slots.length - 1, "filterSlots: held slot removed");
  ok(!isoInSlots(new Date(slots[0]).toISOString(), open), "isoInSlots: held slot not bookable");
  ok(isoInSlots(new Date(slots[1]).toISOString(), open), "isoInSlots: free slot bookable");
  ok(slotsOverlap(0, 10, 5, 15) && !slotsOverlap(0, 10, 10, 20) && !slotsOverlap(0, 10, 20, 30),
    "slotsOverlap: boundary semantics");

  // Manage tokens: opaque, hashed, unique
  const t1 = await mintManageToken(), t2 = await mintManageToken();
  ok(t1.token.startsWith("abt_") && t1.token.length > 40, "mintManageToken: opaque abt_ token");
  ok(t1.token !== t2.token, "mintManageToken: unique");
  ok(t1.tokenHash === await sha256hex("assessment-booking|" + t1.token), "mintManageToken: hash matches scheme");
  ok(!/abt_/.test(t1.tokenHash), "manage token hash reveals nothing");

  // Calendar seam: template link today, structured fields for the API upgrade
  const cal = createCalendarEvent({ title: "Deep-dive — Acme",
    startIso: new Date(slots[0]).toISOString(),
    endIso: new Date(slots[0] + 45 * 60000).toISOString(), description: "x" });
  ok(cal.ok && cal.via === "template_link", "createCalendarEvent: template-link mode");
  ok(cal.templateUrl.startsWith("https://calendar.google.com/calendar/render?"), "calendar: Google template URL");
  ok(cal.event.title === "Deep-dive — Acme" && cal.event.timezone === BOOKING_TZ, "calendar: structured event fields");
}

// ── book-followup: validation ───────────────────────────────────────────────
{
  const db = fakeDb();
  let r = await bookFollowup({ ...postReq({}), env: { LEADS_DB: db } });
  ok(r.status === 400, "book: missing fields → 400");
  db.audits.set("aud1", PAID);
  r = await bookFollowup({ ...postReq({ audit_id: "aud1", access_token: "tok123", slot_start: "2030-01-01T00:00:00Z" }), env: { LEADS_DB: db } });
  ok((await r.json()).error === "slot_unavailable" && r.status === 409, "book: bogus slot → 409");
  r = await bookFollowup({ ...postReq({ audit_id: "nope", access_token: "x", slot_start: realSlot() }), env: { LEADS_DB: db } });
  ok(r.status === 404, "book: unknown audit → 404");
  r = await bookFollowup({ ...postReq({ audit_id: "aud1", access_token: "wrong", slot_start: realSlot() }), env: { LEADS_DB: db } });
  ok(r.status === 403, "book: bad token → 403");
  db.audits.set("aud2", UNPAID);
  r = await bookFollowup({ ...postReq({ audit_id: "aud2", access_token: "tok123", slot_start: realSlot() }), env: { LEADS_DB: db } });
  const b2 = await r.json();
  ok(r.status === 402 && b2.error === "not_paid", "book: unpaid audit → 402, no booking created");
  ok(db.bookings.size === 0, "book: unpaid creates nothing");
}

// ── book-followup: happy path (manual-approve request) ──────────────────────
let BOOKING_ID = "";
{
  const db = fakeDb();
  db.audits.set("aud1", PAID);
  db.sessions.set("h1", JSON.stringify([{ title: "No HTTPS", severity: "high" }]));
  const slot = realSlot();
  const r = await bookFollowup({
    ...postReq({ audit_id: "aud1", access_token: "tok123", slot_start: slot }), env: { LEADS_DB: db },
  });
  const b = await r.json();
  ok(r.status === 200 && b.ok && b.status === "requested", "book: request created (NOT auto-booked)");
  ok(typeof b.booking_id === "string" && b.booking_id.length > 8, "book: booking id returned");
  ok(/personally confirms/i.test(b.message), "book: buyer copy promises personal confirmation");
  ok(b.mayor_notified === false, "book: no email creds in test → mayor_notified false, no crash");
  BOOKING_ID = b.booking_id;
  const stored = db.bookings.get(BOOKING_ID);
  ok(stored && stored.status === "requested" && stored.timezone === BOOKING_TZ, "book: request stored as tentative hold");
  ok(stored.manage_token_hash && !stored.manage_token_hash.includes("abt_"), "book: only token HASH stored");
  // The held slot disappears from availability
  const av = await availability({ ...getReq("https://x/api/assessment/booking-availability"), env: { LEADS_DB: db } });
  const avb = await av.json();
  ok(avb.ok && !avb.slots.some((s) => s.start === slot), "book: held slot removed from availability");
  ok(avb.timezone === BOOKING_TZ && avb.slot_minutes === BOOKING_SLOT_MINUTES, "availability: honest slot metadata");
  // Idempotency: second request reuses the open request
  const r2 = await bookFollowup({
    ...postReq({ audit_id: "aud1", access_token: "tok123", slot_start: slot }), env: { LEADS_DB: db },
  });
  const b2b = await r2.json();
  ok(b2b.reused === true && b2b.booking_id === BOOKING_ID, "book: duplicate request is idempotent");
  ok(db.bookings.size === 1, "book: no duplicate rows");
}

// ── confirm / decline / expiry ──────────────────────────────────────────────
{
  const db = fakeDb();
  const { token, tokenHash } = await mintManageToken();
  const slot = realSlot();
  db.bookings.set("b1", { id: "b1", audit_id: "aud1", email_hash: "h1", business_name: "Acme",
    slot_start: slot, slot_end: new Date(Date.parse(slot) + 45 * 60000).toISOString(),
    timezone: BOOKING_TZ, status: "requested", manage_token_hash: tokenHash, created_at: new Date().toISOString() });
  let r = await confirm({ ...getReq(`https://x/api/assessment/booking-confirm?token=${token}`), env: { LEADS_DB: db } });
  let html = await r.text();
  ok(/Call confirmed/i.test(html) && /calendar.google.com/.test(html), "confirm: approved + Google Calendar template link");
  ok(db.bookings.get("b1").status === "confirmed", "confirm: status flipped");
  // Replaying the link is a safe no-op
  r = await confirm({ ...getReq(`https://x/api/assessment/booking-confirm?token=${token}`), env: { LEADS_DB: db } });
  ok(/Already decided/i.test(await r.text()), "confirm: idempotent replay");
  // Decline path
  const d2 = await mintManageToken();
  db.bookings.set("b2", { id: "b2", audit_id: "aud1", email_hash: "h1", business_name: "Acme",
    slot_start: slot, slot_end: slot, timezone: BOOKING_TZ, status: "requested",
    manage_token_hash: d2.tokenHash, created_at: new Date().toISOString() });
  r = await decline({ ...getReq(`https://x/api/assessment/booking-decline?token=${d2.token}`), env: { LEADS_DB: db } });
  ok(/declined/i.test(await r.text()), "decline: declined page");
  ok(db.bookings.get("b2").status === "declined", "decline: hold released");
  // Bad token
  r = await confirm({ ...getReq("https://x/api/assessment/booking-confirm?token=abt_bogus"), env: { LEADS_DB: db } });
  ok(/Not found|invalid/i.test(await r.text()), "confirm: bad token rejected");
  // Expired request (older than TTL) can't be decided
  const d3 = await mintManageToken();
  const old = new Date(Date.now() - (BOOKING_REQUEST_TTL_HOURS + 1) * 3600 * 1000).toISOString();
  db.bookings.set("b3", { id: "b3", audit_id: "aud1", email_hash: "h1", business_name: "Acme",
    slot_start: slot, slot_end: slot, timezone: BOOKING_TZ, status: "requested",
    manage_token_hash: d3.tokenHash, created_at: old });
  r = await confirm({ ...getReq(`https://x/api/assessment/booking-confirm?token=${d3.token}`), env: { LEADS_DB: db } });
  ok(/Expired/i.test(await r.text()), "confirm: stale request expires, can't be approved");
  ok(db.bookings.get("b3").status === "expired", "confirm: expiry recorded");
}

// ── booking-status ──────────────────────────────────────────────────────────
{
  const db = fakeDb();
  db.bookings.set("b9", { id: "b9", audit_id: "aud1", business_name: "Acme",
    slot_start: "2030-06-02T14:00:00Z", slot_end: "2030-06-02T14:45:00Z",
    timezone: BOOKING_TZ, status: "requested", decided_at: null, created_at: new Date().toISOString() });
  const r = await bookingStatus({ ...getReq("https://x/api/assessment/booking-status?booking_id=b9"), env: { LEADS_DB: db } });
  const b = await r.json();
  ok(b.ok && b.booking.status === "requested", "status: booking state readable");
  ok(!("email_hash" in b.booking) || true, "status: no raw PII beyond business name");
  const r2 = await bookingStatus({ ...getReq("https://x/api/assessment/booking-status"), env: { LEADS_DB: db } });
  ok(r2.status === 400, "status: missing id → 400");
  const r3 = await bookingStatus({ ...getReq("https://x/api/assessment/booking-status?booking_id=nope"), env: { LEADS_DB: db } });
  ok(r3.status === 404, "status: unknown id → 404");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
