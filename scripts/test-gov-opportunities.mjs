import assert from "node:assert/strict";
import {
  normalizeUsaspendingAwards,
  normalizeSamOpportunities,
  scoreGovOpportunity,
  upsertGovOpportunity,
  runGovOpportunityIngest,
  verifyAdminRequest,
  responseHeaders,
} from "../functions/api/_shared/govOpportunities.js";

function makeStatementRecorder() {
  const calls = [];
  const db = {
    opportunities: new Map(),
    events: [],
    prepare(sql) {
      const statement = {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async first() {
              if (sql.includes("SELECT id FROM gov_opportunities WHERE dedupe_key")) {
                const key = args[0];
                const existing = [...db.opportunities.values()].find((row) => row.dedupe_key === key);
                return existing ? { id: existing.id } : null;
              }
              if (sql.includes("COUNT(*) AS count FROM gov_opportunities")) return { count: db.opportunities.size };
              return null;
            },
            async all() {
              return { results: [...db.opportunities.values()] };
            },
            async run() {
              if (sql.startsWith("INSERT INTO gov_opportunities")) {
                const [id, dedupe_key, source, source_id, source_url, title, agency, office, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit, next_action, raw_json] = args;
                db.opportunities.set(id, { id, dedupe_key, source, source_id, source_url, title, agency, office, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit, next_action, raw_json });
              }
              if (sql.startsWith("UPDATE gov_opportunities SET")) {
                const [source_url, title, agency, office, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit, next_action, raw_json, id] = args;
                db.opportunities.set(id, { ...db.opportunities.get(id), source_url, title, agency, office, opportunity_type, status, posted_date, response_deadline, estimated_value, set_aside, naics_codes_json, summary, fit_score, confidence, why_fit, why_not_fit, next_action, raw_json });
              }
              if (sql.startsWith("INSERT INTO gov_opportunity_events")) db.events.push(args);
              if (sql.startsWith("INSERT INTO gov_opportunity_ingest_runs")) db.lastRun = args;
              return { success: true };
            },
          };
        },
        async all() {
          calls.push({ sql, args: [] });
          return { results: [...db.opportunities.values()] };
        },
      };
      return statement;
    },
  };
  return { db, calls };
}

const awards = normalizeUsaspendingAwards({
  results: [
    {
      Award: { generated_unique_award_id: "award-1" },
      Recipient: { recipient_name: "Integrator LLC" },
      AwardingAgency: { awarding_agency_name: "Department of Commerce", awarding_sub_agency_name: "NOAA" },
      AwardDescription: "Software development and dashboard modernization support",
      ActionDate: "2026-05-01",
      AwardAmount: "150000",
      naics_code: "541511",
    },
  ],
});
assert.equal(awards.length, 1);
assert.equal(awards[0].source, "usaspending");
assert.equal(awards[0].opportunity_type, "award_history_signal");
assert.match(awards[0].title, /Software development/);

const sam = normalizeSamOpportunities({
  opportunitiesData: [
    {
      noticeId: "sam-1",
      title: "Small business CRM workflow automation RFI",
      fullParentPathName: "Department of Health and Human Services",
      officeAddress: { city: "Baltimore" },
      type: "Sources Sought",
      postedDate: "05/12/2026",
      responseDeadLine: "06/15/2026 17:00:00",
      uiLink: "https://sam.gov/opp/sam-1/view",
      setAside: "Total Small Business Set-Aside",
      naicsCode: "541511",
      description: "Need CRM integration, data dashboard, website intake, and workflow automation support.",
    },
  ],
});
assert.equal(sam.length, 1);
assert.equal(sam[0].source, "sam.gov");
assert.equal(sam[0].source_id, "sam-1");
assert.match(sam[0].set_aside, /Small Business/);

const score = scoreGovOpportunity(sam[0], new Date("2026-05-13T00:00:00Z"));
assert.ok(score.fit_score >= 75, `expected strong fit, got ${score.fit_score}`);
assert.equal(score.confidence, "high");
assert.match(score.why_fit, /software|CRM|workflow|small business/i);
assert.match(score.next_action, /review|outline|RFI|deadline/i);

const badScore = scoreGovOpportunity({ title: "Construction hardware and medical equipment", summary: "facilities buildout", posted_date: "2026-05-01", response_deadline: "2026-05-14" }, new Date("2026-05-13T00:00:00Z"));
assert.ok(badScore.fit_score < 50);
assert.match(badScore.why_not_fit, /hardware|construction|deadline|outside/i);

const { db } = makeStatementRecorder();
const inserted = await upsertGovOpportunity(db, sam[0], "test-run", new Date("2026-05-13T00:00:00Z"));
assert.equal(inserted.action, "inserted");
const updated = await upsertGovOpportunity(db, { ...sam[0], summary: "Updated CRM summary" }, "test-run", new Date("2026-05-13T00:00:00Z"));
assert.equal(updated.action, "updated");
assert.equal(db.opportunities.size, 1, "dedupe should keep one record");
assert.equal(db.events.length, 2, "upsert events should be audited");

const headers = responseHeaders(new Request("https://api.test/v1/admin/gov-opportunities", { headers: { origin: "https://mehyar.us" } }), { ALLOWED_ORIGINS: "https://mehyar.us" });
assert.equal(headers["cache-control"], "no-store");
assert.equal(headers["access-control-allow-origin"], "https://mehyar.us");

const token = await makeAdminToken("secret", { sub: "owner", exp: Math.floor(Date.now() / 1000) + 600 });
assert.equal(await verifyAdminRequest(new Request("https://api.test", { headers: { authorization: `Bearer ${token}` } }), { ADMIN_SESSION_SECRET: "secret" }), true);
assert.equal(await verifyAdminRequest(new Request("https://api.test"), { ADMIN_SESSION_SECRET: "secret" }), false);

const ingestDb = makeStatementRecorder().db;
const fetchCalls = [];
const ingest = await runGovOpportunityIngest({
  env: { LEADS_DB: ingestDb, GOV_INGEST_LIMIT: "10" },
  now: new Date("2026-05-13T00:00:00Z"),
  fetchImpl: async (url) => {
    fetchCalls.push(String(url));
    if (String(url).includes("api.usaspending.gov")) return jsonResponse({ results: [{ Award: { generated_unique_award_id: "award-2" }, AwardingAgency: { awarding_agency_name: "GSA" }, AwardDescription: "API integration dashboard support", AwardAmount: 50000 }] });
    throw new Error("SAM should not be fetched without SAM_API_KEY");
  },
});
assert.equal(ingest.sam.skipped, true);
assert.ok(ingest.usaspending.fetched >= 1);
assert.equal(fetchCalls.length, 1, "no SAM call without key");
assert.ok(ingest.inserted >= 1);

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function makeAdminToken(secret, payload) {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

console.log(JSON.stringify({ ok: true, tests: ["normalize USAspending", "normalize SAM", "fit scoring", "dedupe upsert", "admin auth", "no-store headers", "SAM key fallback", "ingest audit"] }, null, 2));
