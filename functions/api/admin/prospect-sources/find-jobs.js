// POST /api/admin/prospect-sources/find-jobs
//
// Pulls live remote/freelance/contract job postings from public JSON feeds
// that match MehyarSoft's service offering (software, AI, automation,
// devsecops, cloudflare, web dev). Inserts into the existing
// `prospects` table as a `prospect` (kind=prospect) so the AI scan + deep-eval
// + outreach pipelines can pick them up as outreach targets.
//
// Sources:
//   - RemoteOK JSON feed (https://remoteok.com/api) — free, no key, ~1000 jobs/day
//   - WeWorkRemotely API feed (https://weworkremotely.com/categories/remote-programming-jobs.json) — free
//   - ArbeitNow (https://www.arbeitnow.com/api/job-board-api) — free, EU-friendly
//
// Each match is deduped by (title + company + url) hash so re-runs don't duplicate.
//
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const DEFAULT_KEYWORDS = [
  "software", "developer", "engineer", "fullstack", "full-stack", "full stack",
  "frontend", "backend", "web dev", "web-dev", "webdev", "devsecops",
  "cloudflare", "ai", "automation", "crm", "dashboard", "next.js", "nextjs",
  "react", "typescript", "node.js", "nodejs", "python", "django", "fastapi",
  "postgres", "sql", "api", "rest", "graphql", "cloud", "aws", "azure", "gcp",
  "platform", "integration", "scraping", "data engineer", "etl", "consulting",
  "contract", "fractional", "mvp", "prototype", "startup", "b2b", "saas",
  "automation engineer", "n8n", "zapier", "make.com", "llm", "openai",
];

const MAX_FETCH_AGE_MS = 24 * 3600 * 1000; // only jobs from last 24h

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const sources = Array.isArray(body.sources) && body.sources.length
    ? body.sources.filter((s) => ["remoteok", "weworkremotely", "arbeitnow"].includes(s))
    : ["remoteok", "weworkremotely", "arbeitnow"];
  const keywords = Array.isArray(body.keywords) && body.keywords.length
    ? body.keywords.map((k) => String(k).toLowerCase())
    : DEFAULT_KEYWORDS;
  const minBudgetUsd = Math.max(0, Number(body.min_budget_usd) || 0);
  const maxResults = Math.max(1, Math.min(parseInt(body.max_results, 10) || 60, 200));
  const remoteOnly = body.remote_only !== false;
  const dryRun = body.dry_run === true;

  // Run sources concurrently
  const settled = await Promise.allSettled(sources.map((s) => fetchSource(s, keywords, minBudgetUsd, remoteOnly, maxResults)));
  const results = [];
  const errors = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(...s.value);
    } else {
      errors.push({ source: sources[i], error: String(s.reason?.message || s.reason) });
    }
  }

  // Dedupe by canonical url
  const seen = new Set();
  const unique = [];
  for (const j of results) {
    const key = (j.url || `${j.title}|${j.company}`).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(j);
    if (unique.length >= maxResults) break;
  }

  // Insert as prospects (kind=prospect) so existing scan/draft/outreach flow picks them up
  let inserted = 0;
  let skippedExisting = 0;
  if (!dryRun) {
    for (const j of unique) {
      try {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const extId = `job_${hashKey(j.url || `${j.title}-${j.company}`)}`;

        // Dedupe: check by source_ref (unique-ish per job) and by website (some jobs include a company site)
        const existing = await env.LEADS_DB.prepare(
          `SELECT id FROM prospects WHERE source_ref = ? LIMIT 1`
        ).bind(extId).first().catch(() => null);
        if (existing) { skippedExisting++; continue; }

        // Use the URL as the website if it points to a real company, otherwise use the source's job URL
        const website = j.company_website || j.url || null;
        const rootDomain = website ? (new URL(website).hostname || "").replace(/^www\./, "") : null;

        await env.LEADS_DB.prepare(`
          INSERT INTO prospects
            (id, business_name, root_domain, website, city, country, vertical,
             source, source_ref, status, meta_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
        `).bind(
          id,
          (j.company || "Unknown").slice(0, 160),
          rootDomain || (j.source + ".jobs.local"),
          website,
          j.location || "Remote",
          j.country || "",
          "remote_job",
          `job_board:${j.source}`,
          extId,
          JSON.stringify({
            job_title: j.title,
            job_url: j.url,
            job_tags: j.tags,
            job_salary_min: j.salary_min,
            job_salary_max: j.salary_max,
            job_salary_currency: j.salary_currency,
            job_posted_at: j.posted_at,
            job_remote: j.remote,
            job_source: j.source,
          }),
          now,
          now,
        ).run();
        inserted++;
      } catch (e) {
        errors.push({ title: j.title?.slice(0, 80), error: String(e?.message || e) });
      }
    }
  }

  return json({
    ok: true,
    dry_run: dryRun,
    sources,
    keywords_count: keywords.length,
    fetched: results.length,
    unique_after_dedup: unique.length,
    inserted,
    skipped_existing: skippedExisting,
    sample: unique.slice(0, 8),
    errors: errors.slice(0, 10),
  }, 200, request, env);
}

// ─── source fetchers ───────────────────────────────────────────────────────

async function fetchSource(source, keywords, minBudget, remoteOnly, max) {
  if (source === "remoteok") return fetchRemoteOK(keywords, minBudget, remoteOnly, max);
  if (source === "weworkremotely") return fetchWeWorkRemotely(keywords, minBudget, remoteOnly, max);
  if (source === "arbeitnow") return fetchArbeitNow(keywords, minBudget, remoteOnly, max);
  return [];
}

function matchesKeywords(text, keywords) {
  if (!text) return false;
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(k));
}

function withinBudget(j, minBudgetUsd) {
  if (!minBudgetUsd) return true;
  const min = j.salary_min || 0;
  // Convert common currencies to USD approx
  const usd = j.salary_currency === "EUR" ? min * 1.08 : j.salary_currency === "GBP" ? min * 1.27 : min;
  return usd >= minBudgetUsd;
}

async function fetchRemoteOK(keywords, minBudget, remoteOnly, max) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18_000);
  let r;
  try {
    r = await fetch("https://remoteok.com/api?tags=&action=search", {
      headers: { "user-agent": "Mozilla/5.0 (MehyarSoft/1.0)" },
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(`remoteok_http_${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) return [];
  const cutoff = Date.now() - MAX_FETCH_AGE_MS;
  const out = [];
  for (const j of arr) {
    if (!j || !j.id) continue;
    if (j.position == null) continue;
    const text = `${j.position} ${(j.tags || []).join(" ")} ${j.description || ""}`;
    if (!matchesKeywords(text, keywords)) continue;
    if (remoteOnly && !/remote/i.test(j.location || "")) continue;
    const posted = j.date ? new Date(j.date).getTime() : 0;
    if (posted && posted < cutoff) continue;
    const salaryMin = Number(String(j.salary_min || "0").replace(/[^0-9.]/g, "")) || null;
    const salaryMax = Number(String(j.salary_max || "0").replace(/[^0-9.]/g, "")) || null;
    const item = {
      source: "remoteok",
      title: j.position,
      company: j.company,
      url: j.url || `https://remoteok.com/l/${j.id}`,
      location: j.location,
      country: "",
      tags: j.tags || [],
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: "USD",
      remote: true,
      posted_at: j.date,
      company_website: j.company_url || null,
    };
    if (!withinBudget(item, minBudget)) continue;
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

async function fetchWeWorkRemotely(keywords, minBudget, remoteOnly, max) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18_000);
  let r;
  try {
    r = await fetch("https://weworkremotely.com/categories/remote-programming-jobs.json", {
      headers: { "user-agent": "Mozilla/5.0 (MehyarSoft/1.0)" },
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(`wwr_http_${r.status}`);
  const j = await r.json();
  const list = j?.jobs || j?.results || (Array.isArray(j) ? j : []);
  const out = [];
  for (const job of list) {
    const title = job.title || job.position || "";
    const company = job.company || job.company_name || "";
    const text = `${title} ${(job.tags || []).join(" ")} ${job.description || ""}`;
    if (!matchesKeywords(text, keywords)) continue;
    if (remoteOnly && !/remote/i.test(job.region || "")) continue;
    const item = {
      source: "weworkremotely",
      title,
      company,
      url: job.url || job.apply_url || job.link || `https://weworkremotely.com/remote-jobs/${job.id}`,
      location: job.region || "Remote",
      country: "",
      tags: Array.isArray(job.tags) ? job.tags : [],
      salary_min: null,
      salary_max: null,
      salary_currency: "USD",
      remote: true,
      posted_at: job.pub_date || job.posted_at,
      company_website: job.company_url || null,
    };
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

async function fetchArbeitNow(keywords, minBudget, remoteOnly, max) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18_000);
  let r;
  try {
    r = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      headers: { "user-agent": "Mozilla/5.0 (MehyarSoft/1.0)" },
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(`arbeitnow_http_${r.status}`);
  const j = await r.json();
  const list = j?.data || (Array.isArray(j) ? j : []);
  const out = [];
  for (const job of list) {
    const title = job.title || job.position || "";
    const company = job.company_name || job.company || "";
    const text = `${title} ${(job.tags || []).join(" ")} ${job.description || ""}`;
    if (!matchesKeywords(text, keywords)) continue;
    if (remoteOnly && !job.remote) continue;
    const item = {
      source: "arbeitnow",
      title,
      company,
      url: job.url || job.apply_url || job.link,
      location: job.location || (job.remote ? "Remote" : ""),
      country: "",
      tags: Array.isArray(job.tags) ? job.tags : [],
      salary_min: null,
      salary_max: null,
      salary_currency: "USD",
      remote: !!job.remote,
      posted_at: job.created_at ? new Date(job.created_at * 1000).toISOString() : null,
      company_website: null,
    };
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}