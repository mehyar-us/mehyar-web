// Fulfillment idempotency + replay test (node:sqlite D1 shim).
// Usage: node test-fulfill.js
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fulfillFloodlens } from "./functions/api/_shared/fulfillFloodlens.js";

// ── minimal D1 shim over node:sqlite ──
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...a) { this.args = a.flat(); return this; }
  first() {
    const r = this.db.prepare(this.sql).get(...this.args);
    return r === undefined ? null : r;
  }
  run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { meta: { last_row_id: Number(info.lastInsertRowid) } };
  }
  all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }
}
function makeDb() {
  const s = new DatabaseSync(":memory:");
  const mig = readFileSync("./migrations/0031_floodlens.sql", "utf8");
  s.exec(mig);
  s.exec(`CREATE TABLE billing_payments (
    id INTEGER PRIMARY KEY, product_id TEXT, brand TEXT, email TEXT,
    amount_cents INTEGER, currency TEXT, status TEXT DEFAULT 'pending',
    access_token TEXT, metadata_json TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  return { prepare: (sql) => new Stmt(s, sql) };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(` FAIL ${name}${detail ? " — " + detail : ""}`); }
}

const r2 = new Map();
const emails = [];
const env = {
  FLOODLENS_REPORTS: {
    async put(k, bytes, opts) { r2.set(k, { bytes, opts }); },
  },
  FLOODLENS_FROM_EMAIL: "team@mehyar.us",
};
const sendEmail = async (e, msg) => { emails.push(msg); return { ok: true, id: "test" }; };
let bg = null;
const waitUntil = (p) => { bg = Promise.resolve(p); return bg; };
async function flushBg() { if (bg) { const p = bg; bg = null; await p; } }

function insertLookup(db, token, zone = "AE") {
  db.prepare(`INSERT INTO floodlens_lookups
    (token, address, normalized, lat, lon, geohash, zone, sfha, risk, risk_plain, band,
     bfe, dfirm_id, firm_pan, data_as_of, queried_at, degraded, ip)
    VALUES (?, '123 Main St, Anytown, ST 00000', 'x', 40.0, -74.0, 'dr72', ?, 1,
      'high', 'High risk.', 'A', 10, '36047C', '3604700183H', '2020-01-01',
      '2026-09-20T00:00:00.000Z', 0, '1.2.3.4')`).bind(token, zone).run();
}
function insertPayment(db, id, productId, meta) {
  db.prepare(`INSERT INTO billing_payments (id, product_id, brand, email, amount_cents, status, access_token, metadata_json)
    VALUES (?, ?, 'floodlens', 'buyer@example.com', 1900, 'paid', 'paytoken-' || ?, ?)`)
    .bind(id, productId, id, JSON.stringify(meta)).run();
}

console.log("== single report fulfillment ==");
{
  const db = makeDb();
  insertLookup(db, "tok_single_0000000001");
  insertPayment(db, 1, "floodlens-report", { lookup_token: "tok_single_0000000001" });
  const payment = db.prepare("SELECT * FROM billing_payments WHERE id=1").bind().first();

  const r1 = await fulfillFloodlens({ db, env, waitUntil, sendEmail }, payment);
  await flushBg();
  check("first fulfill ok", r1.ok === true && !r1.replay, JSON.stringify(r1));
  const order = db.prepare("SELECT * FROM floodlens_orders WHERE payment_id=1").bind().first();
  check("one order row", !!order && order.status === "ready", order && order.status);
  check("r2 stored", r2.has(`reports/${order.token}.pdf`));
  const pdfBytes = r2.get(`reports/${order.token}.pdf`).bytes;
  check("pdf is 10 pages", pdfBytes.length > 5000);
  check("token unified on payment", db.prepare("SELECT access_token FROM billing_payments WHERE id=1").bind().first().access_token === order.token);
  // Regression (2026-09-20 E2E): fulfillment must NOT rotate the payment's
  // access_token — Stripe baked it into the success_url at checkout, and the
  // success page polls /api/pay/status with it. Rotating orphaned it (404).
  // NOTE: node:sqlite binds JS numbers as REAL, so 'paytoken-' || 1 → 'paytoken-1.0'.
  check("no retoken race: payment token unchanged", db.prepare("SELECT access_token FROM billing_payments WHERE id=1").bind().first().access_token === "paytoken-1.0");
  check("order reuses payment token", order.token === "paytoken-1.0");
  check("exactly one email", emails.length === 1, "got " + emails.length);
  check("email has download link", emails[0].text.includes(`/api/floodlens/download?token=${order.token}`));
  check("email has unsubscribe", emails[0].text.includes("/api/floodlens/unsubscribe?token="));
  check("email has List-Unsubscribe", !!emails[0].headers["List-Unsubscribe"]);
  check("subscriber converted", db.prepare("SELECT converted FROM floodlens_subscribers WHERE email='buyer@example.com'").bind().first().converted === 1);

  // replay: same webhook again
  const r2x = await fulfillFloodlens({ db, env, waitUntil, sendEmail }, payment);
  await flushBg();
  check("replay detected", r2x.replay === true, JSON.stringify(r2x));
  check("still one order", db.prepare("SELECT COUNT(*) c FROM floodlens_orders").bind().first().c === 1);
  check("no second email", emails.length === 1, "got " + emails.length);
}

console.log("== 3-pack fulfillment ==");
{
  const db = makeDb();
  insertLookup(db, "tok_3a_000000000001");
  insertLookup(db, "tok_3b_000000000002", "X");
  insertLookup(db, "tok_3c_000000000003", "D");
  insertPayment(db, 2, "floodlens-3pack", { lookup_tokens: "tok_3a_000000000001,tok_3b_000000000002,tok_3c_000000000003" });
  const payment = db.prepare("SELECT * FROM billing_payments WHERE id=2").bind().first();
  const before = emails.length;
  const r = await fulfillFloodlens({ db, env, waitUntil, sendEmail }, payment);
  await flushBg();
  check("3-pack ok", r.ok === true && r.mode === "3pack", JSON.stringify(r));
  const order = db.prepare("SELECT * FROM floodlens_orders WHERE payment_id=2").bind().first();
  const txt = new TextDecoder("latin1").decode(r2.get(`reports/${order.token}.pdf`).bytes);
  check("3-pack pdf = 30 pages", /\/Count 30\b/.test(txt));
  check("3-pack one email", emails.length === before + 1);
}

console.log("== missing lookup → failed, no email ==");
{
  const db = makeDb();
  insertPayment(db, 3, "floodlens-report", { lookup_token: "bogus_token_00000001" });
  const payment = db.prepare("SELECT * FROM billing_payments WHERE id=3").bind().first();
  const before = emails.length;
  const r = await fulfillFloodlens({ db, env, waitUntil, sendEmail }, payment);
  await flushBg();
  check("fails honestly", r.ok === false, JSON.stringify(r));
  check("order marked failed", db.prepare("SELECT status FROM floodlens_orders WHERE payment_id=3").bind().first().status === "failed");
  check("no email on failure", emails.length === before);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
