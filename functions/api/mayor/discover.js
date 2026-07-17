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

async function findContactEmail(env, website) {
  if (!website) return "";
  // Try common contact paths and extract any email from the HTML.
  const base = website.replace(/\/$/, "");
  const candidates = [
    website,
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/contact.html`,
    `${base}/about`,
    `${base}/about-us`,
    `${base}/team`,
    `${base}/get-in-touch`,
  ];
  const emailRe = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  // Preferred email prefixes (in priority order)
  const preferredPrefixes = ["info@", "contact@", "hello@", "owner@", "team@", "book@", "orders@"];
  // Known false positives — JS/asset paths and dev agencies that built the site
  const blacklist = [
    "example.com", "domain.com", "yourdomain.com",
    "intl-segmenter", "11.7.10", "11.8.0",  // ICU/JS internals
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
    "wixpress.com", "squarespace.com", "w3.org", "googleapis.com",
    "cloudflare.com", "jquery.com", "schema.org",
    "@11.",  // JS engine paths
  ];
  const collected = new Set();
  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 MehyarBot" },
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      const emails = html.match(emailRe) || [];
      for (const e of emails) {
        const lc = e.toLowerCase();
        if (blacklist.some(b => lc.includes(b))) continue;
        collected.add(e);
      }
    } catch (_) { /* skip */ }
  }
  if (collected.size === 0) return "";
  // Prefer contact/info emails over random ones
  for (const pref of preferredPrefixes) {
    for (const e of collected) {
      if (e.toLowerCase().startsWith(pref)) return e;
    }
  }
  // Otherwise, return the first one
  return [...collected][0];
}

async function discoverLocalBiz(env, maxResults = 10) {
  const apiKey = env?.GOOGLE_PLACES_API_KEY || env?.MEHYAR_GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { ok: false, error: "no_google_key", businesses: [] };
  const queries = ["bakery in Brooklyn NY", "cafe in Brooklyn NY", "dental office Brooklyn NY", "gym Brooklyn NY"];
  const found = [];
  for (const q of queries) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();
      for (const r of (data?.results || []).slice(0, 3)) {
        // Hit Place Details for website + phone
        let website = r?.website || "";
        let phone = r?.formatted_phone_number || "";
        if (r?.place_id) {
          try {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${r.place_id}&fields=website,formatted_phone_number,url&key=${apiKey}`;
            const dResp = await fetch(detailsUrl);
            const dData = await dResp.json();
            const d = dData?.result || {};
            website = website || d.website || "";
            phone = phone || d.formatted_phone_number || "";
          } catch (_) { /* fall back */ }
        }
        // Scrape website for contact email (Places API doesn't expose it)
        let email = "";
        if (website) {
          try { email = await findContactEmail(env, website); } catch (_) {}
        }
        found.push({
          business_name: r?.name || "",
          place_id: r?.place_id || "",
          website,
          phone,
          email,
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
  // Use a stable ID derived from place_id (or business_name) so we can
  // reliably upsert. INSERT OR IGNORE silently skips when the (source, source_ref)
  // already exists, which leaves sequences pointing at non-existent prospect IDs.
  const stableId = p.place_id
    ? `gp_${p.place_id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 36)}`
    : `bn_${(p.business_name || "unknown").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 36)}`;
  const sourceRef = p.place_id || p.business_name || "";
  try {
    // Upsert: insert if missing, otherwise update with freshest data
    await env.LEADS_DB.prepare(
      `INSERT INTO prospects
         (id, source, source_ref, business_name, website, root_domain,
          email, email_source, vertical, city, region, country, meta_json, status)
       VALUES (?, 'mayor_discovery', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'US', ?, 'new')
       ON CONFLICT(id) DO UPDATE SET
         business_name = excluded.business_name,
         website = excluded.website,
         email = COALESCE(NULLIF(excluded.email, ''), prospects.email),
         meta_json = excluded.meta_json,
         last_touched_at = datetime('now'),
         updated_at = datetime('now')`
    ).bind(
      stableId,
      sourceRef,
      p.business_name || "(unknown)",
      p.website || "",
      p.root_domain || (p.website || "").replace(/^https?:\/\//, "").split("/")[0] || "",
      p.email || "",
      p.email ? "scrape" : null,
      (p.vertical || "").slice(0, 80),
      p.city || "Brooklyn",
      p.state || "NY",
      JSON.stringify({ address: p.address, phone: p.phone, rating: p.rating, source: "google_places" }),
    ).run();
    return stableId;
  } catch (e) {
    console.log(`[mayor/discover] prospect UPSERT FAILED for ${p.business_name}: ${e?.message}`);
    await logEvent(env, "discovery",
      `Prospect UPSERT failed for ${p.business_name}: ${e?.message}`,
      { loop: "discovery", details: { biz: p.business_name, error: String(e?.message) } });
    return null;
  }
}

async function scheduleSequenceFor(env, prospectId, prospect) {
  if (!env?.LEADS_DB) return false;
  const steps = buildSequenceSteps(prospect, new Date());
  let inserted = 0, errors = 0;
  let lastErr = null;
  for (const s of steps) {
    try {
      // Log exactly what we're sending
      console.log(`[mayor/discover] inserting step ${s.step_no} for ${prospectId}:`, JSON.stringify({
        step_no: typeof s.step_no + ":" + s.step_no,
        subject: typeof s.subject + ":" + (s.subject || "(null)").slice(0, 30),
        body_text: typeof s.body_text + ":" + (s.body_text || "(null)").slice(0, 30),
        send_after_days: typeof s.send_after_days + ":" + s.send_after_days,
        status: typeof s.status + ":" + s.status,
        scheduled_for: typeof s.scheduled_for + ":" + s.scheduled_for,
      }));
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
      inserted++;
    } catch (e) {
      errors++;
      lastErr = String(e?.message || e);
      console.log(`[mayor/discover] INSERT err: ${lastErr}`);
    }
  }
  if (errors > 0) {
    await logEvent(env, "discovery",
      `Sequence INSERT failed for ${prospectId}: ${errors} errors, last: ${lastErr}`,
      { loop: "discovery", details: { prospectId, errors, lastErr } });
  }
  return inserted > 0;
}

// Clean up orphan sequences: delete sequences that reference a prospect_id
// that no longer exists in the prospects table. Triggered with ?cleanup=1
async function cleanupOrphanSequences(env) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  try {
    const r = await env.LEADS_DB.prepare(
      `DELETE FROM prospect_sequences
       WHERE prospect_id NOT IN (SELECT id FROM prospects)`
    ).run();
    return { ok: true, deleted: r.meta?.changes || 0 };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Reschedule sequences for prospects that have an email but no active sequence
async function rescheduleFromExistingProspects(env, limit = 30) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  try {
    // Find prospects with email but no queued sequence
    const { results } = await env.LEADS_DB.prepare(
      `SELECT p.id, p.business_name, p.email, p.vertical
       FROM prospects p
       WHERE p.email IS NOT NULL AND p.email != ''
         AND NOT EXISTS (
           SELECT 1 FROM prospect_sequences s
           WHERE s.prospect_id = p.id AND s.status = 'queued'
         )
       LIMIT ?`
    ).bind(limit).all();
    let scheduled = 0;
    for (const p of (results || [])) {
      const steps = buildSequenceSteps({
        business_name: p.business_name,
        vertical: p.vertical,
      }, new Date());
      for (const s of steps) {
        try {
          await env.LEADS_DB.prepare(
            `INSERT INTO prospect_sequences
               (id, prospect_id, step_no, subject, body_text, send_after_days,
                status, scheduled_for, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          ).bind(
            crypto.randomUUID(), p.id, s.step_no,
            s.subject, s.body_text, s.send_after_days,
            s.status, s.scheduled_for,
          ).run();
          scheduled++;
        } catch (_) {}
      }
    }
    return { ok: true, scanned: (results || []).length, scheduled };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// One-shot backfill: scrape emails for any existing prospects that have
// a website but no email yet. Triggered when env.MAYOR_BACKFILL_EMAILS=1
async function backfillEmails(env) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  try {
    const { results } = await env.LEADS_DB.prepare(
      `SELECT id, business_name, website FROM prospects
       WHERE (email IS NULL OR email = '')
         AND website IS NOT NULL AND website != ''
       LIMIT 50`
    ).all();
    let filled = 0;
    for (const p of (results || [])) {
      const email = await findContactEmail(env, p.website);
      if (email) {
        await env.LEADS_DB.prepare(
          `UPDATE prospects SET email = ?, email_source = 'backfill_scrape',
             last_touched_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        ).bind(email, p.id).run().catch(() => null);
        filled++;
      }
    }
    return { ok: true, scanned: (results || []).length, filled };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
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

  const url = new URL(request.url);
  const doBackfill = url.searchParams.get("backfill") === "1";
  const doCleanup = url.searchParams.get("cleanup") === "1";
  const doReschedule = url.searchParams.get("reschedule") === "1";

  const start = Date.now();
  const sam = await discoverSamGov(env, 5);
  const biz = await discoverLocalBiz(env, 8);

  // Schedule outreach for new businesses (include all, even without website)
  const scheduled = [];
  for (const b of (biz.businesses || [])) {
    const id = await ingestProspect(env, b);
    if (id) {
      await scheduleSequenceFor(env, id, b);
      scheduled.push({ id, name: b.business_name });
    }
  }

  // Optional backfill of emails for existing prospects
  let backfillResult = null;
  if (doBackfill) {
    backfillResult = await backfillEmails(env);
  }

  // Optional cleanup of orphan sequences
  let cleanupResult = null;
  if (doCleanup) {
    cleanupResult = await cleanupOrphanSequences(env);
  }

  // Optional reschedule for prospects that have email but no sequence
  let rescheduleResult = null;
  if (doReschedule) {
    rescheduleResult = await rescheduleFromExistingProspects(env);
  }

  // Update warmup day
  const wd = parseInt(settings.warmup_day?.value || "0", 10);
  await setSetting(env, "warmup_day", String(wd + 1));
  await setSetting(env, "discovered_at", new Date().toISOString());
  const remaining = await capRemaining(env);

  await logEvent(env, "discovery",
    `SAM=${sam.opps.length} · local=${biz.businesses.length} · scheduled=${scheduled.length}${backfillResult ? ` · backfill=${backfillResult.filled}/${backfillResult.scanned}` : ""}`,
    {
      loop: "discovery",
      details: {
        sam_opps: sam.opps,
        businesses: biz.businesses,
        scheduled,
        sam_error: sam.error,
        biz_error: biz.error,
        backfill: backfillResult,
        cap_remaining: remaining,
        duration_ms: Date.now() - start,
      },
    });

  return json({
    ok: true,
    sam: { found: sam.opps.length, opps: sam.opps, error: sam.error },
    local: { found: biz.businesses.length, businesses: biz.businesses, scheduled: scheduled.length, error: biz.error },
    backfill: backfillResult,
    cleanup: cleanupResult,
    reschedule: rescheduleResult,
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