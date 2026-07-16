// /api/mayor/discover — Daily discovery loop
// Pulls fresh SAM.gov opps + scans a few local Brooklyn/NYC businesses.
// Called by cron at 8 AM ET. Logs all findings to mayor_events.

import { verifyAdminToken, json, corsHeaders } from "../_shared/adminAuth.js";
import { ensureMayorSchema, logEvent, getAllSettings, isPaused, setSetting } from "./_shared/mayorDb.js";
import { capRemaining } from "./_shared/mayorGuardrails.js";
import { buildSequenceSteps } from "./_shared/mayorSequences.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function authOk(request, env) {
  const a = await verifyAdminToken(request, env);
  return a.ok;
}

async function bearerAccepted(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const tok = h.slice(7);
  if (tok && env?.GOV_INGEST_TOKEN && tok === env.GOV_INGEST_TOKEN) return true;
  return await authOk(request, env);
}

// ── SAM.gov discovery ────────────────────────────────────────────────────

async function discoverSamGov(env, maxResults = 5) {
  const apiKey = env?.MEHYARSOFT_SAM_API_KEY || env?.SAM_GOV_API_KEY;
  if (!apiKey) return { ok: false, error: "no_sam_key", opps: [] };
  // SAM API requires MM/DD/YYYY (US format). Build with UTC explicitly
  // so the runtime's locale can't reorder the digits.
  const fmt = d => {
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const y = d.getUTCFullYear();
    return `${m}/${day}/${y}`;
  };
  const today = fmt(new Date());
  const future = fmt(new Date(Date.now() + 30 * 86400000));
  const naicsCodes = ["541511", "541512"];
  const allOpps = [];
  let totalRecords = 0;
  let firstErr = null;
  for (const naics of naicsCodes) {
     const url = `https://api.sam.gov/opportunities/v2/search?limit=${Math.ceil(maxResults / naicsCodes.length) + 2}&postedFrom=${today}&postedTo=${future}&naicsCode=${naics}&typeOfSetAside=SBA`;
     console.log("[mayor/discover] SAM url:", url);
     let data;
     try {
       const resp = await fetch(url, { headers: { "X-Api-Key": apiKey } });
       if (!resp.ok) {
        if (!firstErr) firstErr = `sam_http_${resp.status}_${naics} :: ${url}`;
        continue;
      }
       data = await resp.json();
     } catch (e) {
       if (!firstErr) firstErr = String(e?.message || e);
       continue;
     }
     totalRecords += data?.totalRecords || 0;
     for (const o of (data?.opportunitiesData || [])) {
       allOpps.push({
         title: o?.title || "(untitled)",
         agency: o?.fullParentPathName || o?.departmentName || "",
         solicitation: o?.solicitationNumber || "",
         notice_id: o?.noticeId || "",
         deadline: o?.responseDeadLine || "",
         naics: o?.naicsCode || naics,
         set_aside: o?.typeOfSetAsideDescription || "",
                 posted: o?.postedDate || "",
               });
             }
           }
           // dedupe by notice_id
  const seen = new Set();
  const dedup = [];
  for (const o of allOpps) {
    if (!o.notice_id || seen.has(o.notice_id)) continue;
    seen.add(o.notice_id);
    dedup.push(o);
    if (dedup.length >= maxResults) break;
  }
  return { ok: true, opps: dedup, total_records: totalRecords, error: firstErr };
}

// ── Local Brooklyn/NYC business discovery (uses Google free text search) ─

async function discoverLocalBiz(env, maxResults = 10) {
  const apiKey = env?.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { ok: false, error: "no_google_key", businesses: [] };
  const queries = ["bakery in Brooklyn NY", "cafe in Brooklyn NY", "dental office Brooklyn NY", "gym Brooklyn NY"];
  const found = [];
  for (const q of queries) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();
      for (const r of (data?.results || []).slice(0, 3)) {
        found.push({
          business_name: r?.name || "",
          website: r?.website || "",
          address: r?.formatted_address || "",
          vertical: q.split(" ")[0],
          city: "Brooklyn",
          state: "NY",
          rating: r?.rating || null,
        });
        if (found.length >= maxResults) break;
      }
    } catch (_) { /* skip this query */ }
    if (found.length >= maxResults) break;
  }
  return { ok: true, businesses: found };
}

// ── Insert prospects into DB + schedule sequence ─────────────────────────

async function ingestProspect(env, p) {
  if (!env?.LEADS_DB) return null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.LEADS_DB.prepare(
      `INSERT OR IGNORE INTO prospects
         (id, business_name, website, root_domain, email, phone,
          city, vertical, status, source_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', 'mayor_discovery', ?, ?)`
    ).bind(
      id,
      p.business_name || "(unknown)",
      p.website || "",
      p.root_domain || (p.website || "").replace(/^https?:\/\//, "").split("/")[0],
      p.email || "",
      p.phone || "",
      p.city || "",
      p.vertical || "",
      now, now,
    ).run();
  } catch (e) { /* table may not exist yet */ }
  return id;
}

async function scheduleSequenceFor(env, prospectId, prospect) {
  if (!env?.LEADS_DB) return false;
  const steps = buildSequenceSteps(prospect, new Date());
  for (const s of steps) {
    try {
      await env.LEADS_DB.prepare(
        `INSERT INTO prospect_sequences
           (id, prospect_id, step_no, subject, body_text, send_after_days,
            status, scheduled_for, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(), prospectId, s.step_no,
        s.subject, s.body_text, s.send_after_days,
        s.status, s.scheduled_for,
      ).run();
    } catch (_) { /* skip dupes */ }
  }
  return true;
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  const settings = await getAllSettings(env);
  if (isPaused(settings)) {
    return json({ ok: false, error: "paused", until: settings.paused_until?.value }, 403, request, env);
  }

  const start = Date.now();
  const sam = await discoverSamGov(env, 5);
  const biz = await discoverLocalBiz(env, 8);

  // Schedule outreach for new businesses
  const scheduled = [];
  for (const b of (biz.businesses || [])) {
    if (!b.website) continue;
    const id = await ingestProspect(env, b);
    if (id) {
      await scheduleSequenceFor(env, id, b);
      scheduled.push({ id, name: b.business_name });
    }
  }

  // Update warmup day
  const wd = parseInt(settings.warmup_day?.value || "0", 10);
  await setSetting(env, "warmup_day", String(wd + 1));
  await setSetting(env, "discovered_at", new Date().toISOString());
  const remaining = await capRemaining(env);

  await logEvent(env, "discovery",
    `SAM=${sam.opps.length} · local=${biz.businesses.length} · scheduled=${scheduled.length}`,
    {
      loop: "discovery",
      details: {
        sam_opps: sam.opps,
        businesses: biz.businesses,
        scheduled,
        sam_error: sam.error,
        biz_error: biz.error,
        cap_remaining: remaining,
        duration_ms: Date.now() - start,
      },
    });

  return json({
    ok: true,
    sam: { found: sam.opps.length, opps: sam.opps, error: sam.error },
    local: { found: biz.businesses.length, businesses: biz.businesses, scheduled: scheduled.length, error: biz.error },
    cap_remaining: remaining,
    duration_ms: Date.now() - start,
  }, 200, request, env);
}

// GET = status only (no run)
export async function onRequestGet({ request, env }) {
  if (!await bearerAccepted(request, env)) {
    return json({ ok: false, error: "unauthorized" }, 401, request, env);
  }
  await ensureMayorSchema(env);
  const settings = await getAllSettings(env);
  const remaining = await capRemaining(env);
  return json({
    ok: true,
    discovered_at: settings.discovered_at?.value || "",
    cap_remaining: remaining,
    paused: isPaused(settings),
  }, 200, request, env);
}