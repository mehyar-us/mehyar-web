#!/usr/bin/env node
// scripts/test_sam_gov_search.mjs
// Verify the patched SAM.gov integration against the live API.
// Mirrors fetchSamOpportunities() in functions/api/_shared/govOpportunities.js
// (the patched 2026-07-13 version) without dragging in the LEADS_DB dep.
//
// Auth: X-Api-Key header (SAM.gov v2 recommended). Key read from $SAM_GOV_API_KEY
// or ~/.hermes/.env (the user's repo).
//
// Usage:
//   node scripts/test_sam_gov_search.mjs                  # last 30 days, all default keywords
//   node scripts/test_sam_gov_search.mjs --today          # only today
//   node scripts/test_sam_gov_search.mjs --keywords "software,automation" --limit 10
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadKey() {
  if (process.env.SAM_GOV_API_KEY) return process.env.SAM_GOV_API_KEY;
  if (process.env.SAM_API_KEY) return process.env.SAM_API_KEY;
  try {
    const raw = readFileSync(join(homedir(), ".hermes", ".env"), "utf-8");
    const m = raw.match(/^SAM_GOV_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

const KEYWORDS_DEFAULT = [
  "software development", "web application development", "website modernization",
  "workflow automation", "CRM implementation", "data dashboard", "business intelligence",
  "cloud migration", "API integration", "process automation",
  "case management system", "help desk modernization",
];
const LIMIT_DEFAULT = 40;

function fmtSamDate(d) {
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
}
function parseArgs(argv) {
  const args = { today: false, limit: LIMIT_DEFAULT, keywords: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--today") args.today = true;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--keywords") args.keywords = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

const KEY = loadKey();
if (!KEY) {
  console.error("ERROR: SAM_GOV_API_KEY not found in env or ~/.hermes/.env");
  process.exit(1);
}
const opts = parseArgs(process.argv);
const KEYWORDS = opts.keywords || KEYWORDS_DEFAULT;
const LIMIT = Math.max(1, Math.min(opts.limit, 100));
const endDate = new Date();
const startDate = opts.today ? endDate : new Date(Date.now() - 30 * 86400000);

console.log("== SAM.gov probe ==");
console.log(`  key length     : ${KEY.length}`);
console.log(`  date range     : ${fmtSamDate(startDate)} → ${fmtSamDate(endDate)}`);
console.log(`  keywords       : ${KEYWORDS.length} (${KEYWORDS.slice(0,3).join(", ")}, ...)`);
console.log(`  limit per kw   : ${LIMIT}`);
console.log();

const seen = new Set();
const merged = [];
const perKwStats = [];
let totalApiCalls = 0;
let failedCalls = 0;

for (const kw of KEYWORDS.slice(0, 12)) {
  if (merged.length >= LIMIT * 2) break;
  const params = new URLSearchParams({
    postedFrom: fmtSamDate(startDate),
    postedTo: fmtSamDate(endDate),
    limit: String(LIMIT),
    offset: "0",
    ptype: "o,k,r,s",
    title: kw,
  });
  const url = `https://api.sam.gov/opportunities/v2/search?${params.toString()}`;
  totalApiCalls++;
  let resp;
  try {
    resp = await fetch(url, { headers: { "X-Api-Key": KEY, "Accept": "application/json" } });
  } catch (e) {
    failedCalls++;
    perKwStats.push({ kw, ok: false, total: 0, new: 0, http: "ERR " + e.message });
    continue;
  }
  if (!resp.ok) {
    failedCalls++;
    perKwStats.push({ kw, ok: false, total: 0, new: 0, http: resp.status });
    continue;
  }
  const json = await resp.json();
  const totalRecords = json.totalRecords || 0;
  const items = json.opportunitiesData || [];
  let added = 0;
  for (const it of items) {
    const key = `sam.gov::${it.noticeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      noticeId: it.noticeId,
      title: it.title?.slice(0, 90) || "",
      naics: it.naicsCode || null,
      posted: it.postedDate || null,
      deadline: it.responseDeadLine || null,
      setAside: it.typeOfSetAsideDescription || it.typeOfSetAside || null,
      state: it.placeOfPerformance?.state?.name || null,
      dept: (it.department || "").slice(0, 60),
      solicitationNumber: it.solicitationNumber || null,
      uiLink: it.uiLink || (it.noticeId ? `https://sam.gov/opp/${it.noticeId}/view` : null),
    });
    added++;
    if (merged.length >= LIMIT) break;
  }
  perKwStats.push({ kw, ok: true, total: totalRecords, new: added, http: resp.status });
}

console.log("== Per-keyword stats ==");
for (const s of perKwStats) {
  const status = s.ok ? "OK " : "FAIL";
  console.log(`  [${status}] ${s.http.toString().padEnd(5)} '${s.kw.padEnd(30)}'  total=${s.total.toString().padEnd(5)} new=${s.new}`);
}
console.log();
console.log(`== Totals ==`);
console.log(`  API calls         : ${totalApiCalls}`);
console.log(`  Failed calls      : ${failedCalls}`);
console.log(`  Unique opps merged: ${merged.length}`);
console.log();

console.log("== First 10 unique opportunities ==");
for (const opp of merged.slice(0, 10)) {
  console.log(`  ${opp.noticeId.slice(0, 12)}  ${opp.title.slice(0, 60)}`);
  console.log(`    naics=${opp.naics}  state=${opp.state || "—"}  deadline=${opp.deadline || "—"}  set-aside=${opp.setAside || "—"}`);
  console.log(`    url: ${opp.uiLink}`);
  console.log();
}

process.exit(failedCalls === totalApiCalls ? 1 : 0);