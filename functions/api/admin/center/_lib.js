// Shared helpers for the /api/admin/center/* brand command-center endpoints.
// All endpoints are gated by verifyAdminToken (same admin login as before).
// Missing D1 bindings or tables are reported as ok:false + missing info —
// the UI renders "not wired yet" instead of crashing.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

// Re-exported so endpoint modules can import everything from "./_lib.js".
export { json, corsHeaders };

export function onOptions(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function guard(request, env) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return { res: json({ ok: false, error: auth.message }, auth.status, request, env) };
  return { session: auth.session };
}

export async function qAll(db, sql, params = []) {
  const r = await db.prepare(sql).bind(...params).all();
  return r.results || [];
}

export async function qOne(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

// Soft query: returns [] instead of throwing when a table is missing.
export async function qAllSoft(db, sql, params = []) {
  try {
    return await qAll(db, sql, params);
  } catch {
    return [];
  }
}

// ── Dates (campaign days are recorded in America/New_York) ────────────────
export function etDate(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
export function etDateMinus(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
export function etMonthPrefix() {
  return etDate().slice(0, 7); // "2026-09"
}

// ── Brand registry (mirrors client/src/center/data/brands.ts) ────────────
// sources: intel = campaign_intel brands.id, jobs = mehyar-jobs warmup brand key
export const REGISTRY = [
  { id: "mehyarsoft",  name: "MehyarSoft",      domain: "mehyar.us",              url: "https://mehyar.us",              kind: "agency",         instagram: "@mehyar.us",       status: "live",    sources: { intel: "mehyarsoft", leads: "audit" } },
  { id: "aimech",      name: "AI Mechanic",     domain: "aimech.app",             url: "https://aimech.app",             kind: "app",            instagram: "@aimechanicapp", status: "live",    sources: {} },
  { id: "babypeek",    name: "BabyPeek",        domain: "baby.mehyar.us",         url: "https://baby.mehyar.us",         kind: "digital-product", price: "$5 portrait",     status: "live",    sources: { intel: "babypeek", jobs: "babypeek" } },
  { id: "roastme",     name: "RoastMe",         domain: "roast.mehyar.us",        url: "https://roast.mehyar.us",        kind: "digital-product", price: "$5 roast card",  status: "live",    sources: { intel: "roastme", jobs: "roastme" } },
  { id: "crayonkid",   name: "Crayon Kid",      domain: "crayonkid.mehyar.us",    url: "https://crayonkid.mehyar.us",    kind: "digital-product", price: "$6 coloring book", status: "live", sources: { intel: "crayonkid", jobs: "crayonkid" } },
  { id: "mehyarjobs",  name: "mehyar.jobs",     domain: "jobs.mehyar.us",         url: "https://jobs.mehyar.us",         kind: "tool",           status: "live",    sources: { intel: "mehyar_jobs", jobs: "mehyar.jobs" } },
  { id: "spg",         name: "Stuff Pretty Good", domain: "stuffprettygood.com", url: "https://stuffprettygood.com",    kind: "digital-product", price: "$7–9 guides",   status: "live",    sources: { intel: "spg", jobs: "stuffprettygood" } },
  { id: "rizza",       name: "Rizza",           domain: "rizza.app",              url: "https://rizza.app",              kind: "app",            status: "parked",  sources: {} },
  { id: "designful",   name: "Designful",       domain: "designful.mehyar.us",   url: "https://designful.mehyar.us",    kind: "tool",           status: "building", sources: { intel: "designful" } },
  { id: "truesketch",  name: "TrueSketch",      domain: "truesketch.mehyar.us",   url: "https://truesketch.mehyar.us",   kind: "tool",           status: "building", sources: {} },
  { id: "hustlekit",   name: "HustleKit",       domain: "hustlekit.mehyar.us",    url: "https://hustlekit.mehyar.us",    kind: "digital-product", price: "$27 kit",      status: "live",    sources: {} },
  { id: "plrvault",    name: "PLR Vault",       domain: "plrvault.mehyar.us",     url: "https://plrvault.mehyar.us",     kind: "digital-product", status: "live",   sources: {} },
  { id: "prepguide",   name: "PrepGuide",       domain: "prepguide.mehyar.us",    url: "https://prepguide.mehyar.us",    kind: "digital-product", status: "live",   sources: {} },
  { id: "sprint30",    name: "Sprint30",        domain: "sprint30.mehyar.us",     url: "https://sprint30.mehyar.us",     kind: "digital-product", status: "live",   sources: {} },
  { id: "tiktokgrowth", name: "TikTokGrowth",   domain: "tiktokgrowth.mehyar.us", url: "https://tiktokgrowth.mehyar.us", kind: "digital-product", status: "live",   sources: {} },
  { id: "bizbuilder",  name: "BizBuilder",      domain: "bizbuilder.mehyar.us",   url: "https://bizbuilder.mehyar.us",   kind: "digital-product", status: "live",   sources: {} },
  { id: "creditfix",   name: "CreditFix Kit",   domain: "creditfix.mehyar.us",    url: "https://creditfix.mehyar.us",    kind: "digital-product", status: "live",   sources: {} },
  { id: "freelanceros", name: "FreelancerOS",   domain: "freelanceros.mehyar.us", url: "https://freelanceros.mehyar.us", kind: "digital-product", status: "live",   sources: {} },
  { id: "lib",         name: "Link in Bio",     domain: "lib.mehyar.us",          url: "https://lib.mehyar.us",          kind: "hub",            status: "live",    sources: {} },
];

export const WARMUP_LADDER = [5, 10, 15, 25, 40, 65, 105, 170, 275];
export const WARMUP_CAP = 300;

// jobs-brand-key -> registry id (for pivoting warmup_campaign_daily rows)
export const JOBS_TO_REG = {
  crayonkid: "crayonkid",
  "mehyar.jobs": "mehyarjobs",
  roastme: "roastme",
  stuffprettygood: "spg",
  babypeek: "babypeek",
};

export function missingBindings(env) {
  return { intel: !env?.INTEL_DB, jobs: !env?.JOBS_DB, leads: !env?.LEADS_DB };
}

// Warmup pause state for a brand (checks both jobs key and intel key).
export async function warmupPause(env, sources) {
  if (!env?.JOBS_DB) return { paused: false, pauseReason: null, unknown: true };
  const keys = [sources.jobs, sources.intel].filter(Boolean);
  if (!keys.length) return { paused: false, pauseReason: null, unknown: true };
  const rows = await qAllSoft(
    env.JOBS_DB,
    `SELECT brand, paused, pause_reason FROM warmup_control WHERE brand IN (${keys.map(() => "?").join(",")})`,
    keys
  );
  const hit = rows.find((r) => r.paused === 1) || rows[0];
  if (!hit) return { paused: false, pauseReason: null, unknown: false };
  return { paused: hit.paused === 1, pauseReason: hit.pause_reason || null, unknown: false };
}

// 7d click total for an intel brand id via short_link_daily_clicks.
export async function clicks7d(env, intelId) {
  if (!env?.INTEL_DB || !intelId) return 0;
  const r = await qOne(
    env.INTEL_DB,
    `SELECT COALESCE(SUM(sdc.clicks),0) AS n
       FROM short_link_daily_clicks sdc
       JOIN short_links sl ON sl.code = sdc.code
      WHERE sl.brand_id = ? AND sdc.date >= date('now','-7 days')`,
    [intelId]
  ).catch(() => null);
  return Number(r?.n || 0);
}

// Revenue cents for an intel brand id since a date prefix (YYYY-MM-DD or YYYY-MM).
export async function revenueSince(env, intelId, prefix) {
  if (!env?.INTEL_DB || !intelId) return 0;
  const r = await qOne(
    env.INTEL_DB,
    `SELECT COALESCE(SUM(p.amount_cents),0) AS n
       FROM purchases p JOIN offers o ON o.id = p.offer_id
      WHERE o.brand_id = ? AND substr(p.purchased_at,1,?) = ?`,
    [intelId, prefix.length, prefix]
  ).catch(() => null);
  return Number(r?.n || 0);
}

// Latest deliverability snapshot for a domain.
export async function latestSnapshot(env, domain) {
  if (!env?.INTEL_DB || !domain) return null;
  return qOne(
    env.INTEL_DB,
    `SELECT * FROM deliverability_snapshots WHERE domain = ? ORDER BY date DESC LIMIT 1`,
    [domain]
  ).catch(() => null);
}
