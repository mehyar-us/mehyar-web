import assert from "node:assert/strict";
import { onRequestGet as health } from "../functions/api/health.js";
import { onRequestPost as intake } from "../functions/api/intake.js";

class MockKV {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    return this.map.get(key) ?? null;
  }
  async put(key, value) {
    this.map.set(key, value);
  }
}

class MockD1 {
  constructor() {
    this.leads = [];
    this.events = [];
    this.suppression = [];
  }
  prepare(sql) {
    const db = this;
    const statement = { values: [] };
    statement.bind = (...values) => {
      statement.values = values;
      return statement;
    };
    statement.first = async () => {
      if (sql.includes("FROM suppression_list")) {
        const [, valueHash] = statement.values;
        return db.suppression.some((row) => row.type === "email" && row.value_hash === valueHash) ? { 1: 1 } : null;
      }
      return null;
    };
    statement.run = async () => {
      if (sql.includes("INSERT INTO leads")) {
        const [
          id,
          created_at,
          updated_at,
          form_type,
          name,
          email,
          phone,
          company,
          website,
          service_interest,
          budget_range,
          timeline,
          message,
          consent_contact,
          consent_marketing,
          ip_hash,
          user_agent_hash,
          referrer,
          utm_source,
          utm_medium,
          utm_campaign,
        ] = statement.values;
        db.leads.push({ id, created_at, updated_at, source: "website", form_type, status: "new", name, email, phone, company, website, service_interest, budget_range, timeline, message, consent_contact, consent_marketing, ip_hash, user_agent_hash, referrer, utm_source, utm_medium, utm_campaign, turnstile_passed: 1, notification_status: "pending" });
      } else if (sql.includes("INSERT INTO lead_events")) {
        const [id, lead_id, event_type, metadata_json] = statement.values;
        db.events.push({ id, lead_id, event_type, actor: "system", metadata_json });
      } else if (sql.includes("UPDATE leads SET notification_status")) {
        const [notification_status, notification_error, id] = statement.values;
        const lead = db.leads.find((row) => row.id === id);
        if (lead) Object.assign(lead, { notification_status, notification_error });
      }
      return { success: true };
    };
    return statement;
  }
}

function request(path, body, headers = {}) {
  return new Request(`https://mehyar.us${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://mehyar.us",
      "cf-connecting-ip": "203.0.113.10",
      "user-agent": "intake-test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function env() {
  const db = new MockD1();
  const email = { sent: [], async send(message) { this.sent.push(message); } };
  return {
    ENVIRONMENT: "test",
    TURNSTILE_TEST_BYPASS: "true",
    TURNSTILE_SECRET_KEY: "unit-test-secret",
    HMAC_SECRET: "unit-test-hmac",
    ALLOWED_ORIGINS: "https://mehyar.us,http://localhost:5173",
    CONTACT_TO_EMAIL: "owner@example.test",
    CONTACT_FROM_EMAIL: "leads@example.test",
    LEADS_DB: db,
    INTAKE_KV: new MockKV(),
    NOTIFY_EMAIL: email,
    __db: db,
    __email: email,
  };
}

const healthEnv = { ENVIRONMENT: "test" };
const healthResponse = await health({ env: healthEnv });
assert.equal(healthResponse.status, 200);
assert.deepEqual(await healthResponse.json(), { ok: true, service: "mehyar-web-intake", environment: "test" });

const validEnv = env();
const validPayload = {
  form_type: "contact",
  name: "Unit Test",
  email: "Unit@Test.Example",
  company: "Test Co",
  website: "https://example.test",
  service_interest: "CRM intake",
  budget_range: "$1k-$5k",
  timeline: "this month",
  message: "Please test the intake path.",
  consent_contact: true,
  consent_marketing: false,
  turnstile_token: "test-valid",
  hp_field: "",
  utm: { source: "unit", medium: "script", campaign: "intake" },
};
const validResponse = await intake({ request: request("/api/intake", validPayload), env: validEnv });
const validJson = await validResponse.json();
assert.equal(validResponse.status, 200);
assert.equal(validJson.ok, true);
assert.match(validJson.lead_id, /^[0-9a-f-]{36}$/);
assert.equal(validEnv.__db.leads.length, 1);
assert.equal(validEnv.__db.leads[0].email, "unit@test.example");
assert.equal(validEnv.__db.leads[0].consent_contact, 1);
assert.equal(validEnv.__db.leads[0].notification_status, "sent");
assert.equal(validEnv.__email.sent.length, 1);
assert.equal(validEnv.__db.events.some((event) => event.event_type === "lead_created"), true);
assert.equal(validEnv.__db.events.some((event) => event.event_type === "notification_sent"), true);

const invalidEnv = env();
const invalidResponse = await intake({ request: request("/api/intake", { ...validPayload, turnstile_token: "bad-token" }), env: invalidEnv });
assert.equal(invalidResponse.status, 403);
assert.equal((await invalidResponse.json()).ok, false);
assert.equal(invalidEnv.__db.leads.length, 0);
assert.equal(invalidEnv.__db.events.some((event) => event.event_type === "turnstile_failed"), true);

const noConsentEnv = env();
const noConsentResponse = await intake({ request: request("/api/intake", { ...validPayload, consent_contact: false }), env: noConsentEnv });
assert.equal(noConsentResponse.status, 400);
assert.equal(noConsentEnv.__db.leads.length, 0);

console.log(JSON.stringify({
  ok: true,
  tests: ["health", "valid submission", "invalid turnstile rejection", "D1/audit row", "notification path", "consent rejection"],
  leads_created: validEnv.__db.leads.length,
  audit_events: validEnv.__db.events.map((event) => event.event_type),
  notifications_sent: validEnv.__email.sent.length,
}, null, 2));
