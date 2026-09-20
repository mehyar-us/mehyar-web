// PillGuard fulfillment regression tests (node:sqlite D1 shim).
// Covers the two production money-path failures of 2026-09-20:
//   1. Missing accessToken bind -> NOT NULL crash, silent order loss.
//   2. Token rotation at fulfillment orphaned the checkout success URL
//      (status 404 + report 404 forever) — the order MUST reuse the
//      checkout-time token already in billing_payments.access_token.
// Also: exactly one order per payment, webhook replay idempotency, and
// legacy payments (no checkout token) minting + persisting a token.
// Usage: node test-pillguard-fulfillment.js
import { DatabaseSync } from "node:sqlite";
import { fulfillPillguard } from "./functions/api/_shared/fulfillPillguard.js";

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
  s.exec(`CREATE TABLE billing_payments (
    id INTEGER PRIMARY KEY, product_id TEXT, brand TEXT, email TEXT,
    amount_cents INTEGER, currency TEXT, status TEXT DEFAULT 'pending',
    access_token TEXT, metadata_json TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  s.exec(`CREATE TABLE pillguard_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT NOT NULL UNIQUE,
    product_id TEXT NOT NULL DEFAULT 'pillguard-scan',
    access_token TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    session_id TEXT,
    meds_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'paid',
    report_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  s.exec(`CREATE TABLE pillguard_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    meds_json TEXT, source TEXT, confirmed INTEGER NOT NULL DEFAULT 0,
    brand TEXT, tags TEXT, prefs_json TEXT, unsubscribed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  s.exec(`CREATE TABLE subscribers_global (
    email TEXT NOT NULL, brand TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'subscribed',
    unsubscribed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (email, brand)
  )`);
  return { prepare: (sql) => new Stmt(s, sql) };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(` FAIL ${name}${detail ? " — " + detail : ""}`); }
}

const emails = [];
const sendEmail = async (e, msg) => { emails.push(msg); return { ok: true, id: "test" }; };
const env = { PILLGUARD_BASE_URL: "https://pillguard.mehyar.us" };
// waitUntil that does NOT await: the scan-path background report generation
// stays out of this unit test (report build is covered by the E2E + FDA harness).
const waitUntil = () => {};

function insertPayment(db, { id, product, email, token, meds }) {
  db.prepare(`INSERT INTO billing_payments
    (id, product_id, brand, email, amount_cents, currency, status, access_token, metadata_json)
    VALUES (?, ?, 'pillguard', ?, 900, 'usd', 'paid', ?, ?)`).bind(
    id, product, email, token,
    JSON.stringify({ meds, session_id: null })
  ).run();
  return db.prepare("SELECT * FROM billing_payments WHERE id = ?").bind(id).first();
}

// ── Test 1: scan fulfillment reuses the checkout token (no rotation) ──
{
  const db = makeDb();
  const checkoutToken = "a".repeat(64);
  const payment = insertPayment(db, {
    id: 901, product: "pillguard-scan", email: "pgpay-qa@example.invalid",
    token: checkoutToken, meds: ["Metformin 500mg", "Lisinopril 10mg"],
  });
  const r = await fulfillPillguard({ db, env, waitUntil, sendEmail }, payment, { mode: "payment" });
  check("scan fulfill returns ok", r.ok === true, JSON.stringify(r));
  const orders = db.prepare("SELECT * FROM pillguard_orders").all().results;
  check("exactly one order row", orders.length === 1, `rows=${orders.length}`);
  check("order token == checkout token (no rotation)",
    orders[0] && orders[0].access_token === checkoutToken,
    orders[0] ? orders[0].access_token.slice(0, 16) + "…" : "no row");
  const pay = db.prepare("SELECT access_token FROM billing_payments WHERE id=901").first();
  check("payment token untouched", pay.access_token === checkoutToken, pay.access_token);

  // Simulate the success-page status lookup (status.js): payment by token → order by token.
  const row = db.prepare("SELECT id FROM billing_payments WHERE access_token = ?").bind(checkoutToken).first();
  const order = row
    ? db.prepare("SELECT status FROM pillguard_orders WHERE access_token = ?").bind(checkoutToken).first()
    : null;
  check("status lookup resolves via checkout token", !!order, order ? order.status : "not found");

  // ── Test 2: webhook replay is idempotent ──
  const r2 = await fulfillPillguard({ db, env, waitUntil, sendEmail }, payment, { mode: "payment" });
  check("replay returns replay:true", r2.replay === true, JSON.stringify(r2));
  const n2 = db.prepare("SELECT COUNT(*) AS n FROM pillguard_orders").first().n;
  check("still exactly one order after replay", n2 === 1, `rows=${n2}`);
}

// ── Test 3: legacy payment without a checkout token mints + persists one ──
{
  const db = makeDb();
  const payment = insertPayment(db, {
    id: 902, product: "pillguard-scan", email: "pgpay-legacy@example.invalid",
    token: null, meds: ["Metformin 500mg"],
  });
  const r = await fulfillPillguard({ db, env, waitUntil, sendEmail }, payment, { mode: "payment" });
  check("legacy fulfill returns ok", r.ok === true, JSON.stringify(r));
  const order = db.prepare("SELECT access_token FROM pillguard_orders WHERE payment_id='902'").first();
  check("legacy order got a 64-hex token",
    !!order && /^[0-9a-f]{64}$/.test(order.access_token), order && order.access_token);
  const pay = db.prepare("SELECT access_token FROM billing_payments WHERE id=902").first();
  check("legacy payment row updated with minted token",
    !!pay && pay.access_token === order.access_token, pay && pay.access_token);
  const r2 = await fulfillPillguard({ db, env, waitUntil, sendEmail }, payment, { mode: "payment" });
  check("legacy replay idempotent", r2.replay === true && db.prepare("SELECT COUNT(*) AS n FROM pillguard_orders").first().n === 1);
}

import { medName, parseMedsList } from "./functions/api/_shared/fulfillPillguard.js";

// ── Regression: object meds from scan sessions (the 2026-09-20 money-path
// bug — meds.map(String) turned {med:"Metformin 500mg",...} into
// "[object Object]", so the paid report matched nothing) ──
{
  check("medName extracts .med from session object",
    medName({ med: "Metformin 500mg", tokens: [["metformin"]], alias_of: null }) === "Metformin 500mg");
  check("medName falls back to .name/.drug", medName({ name: "Lisinopril" }) === "Lisinopril");
  check("medName passes plain strings through", medName("Atorvastatin 20mg") === "Atorvastatin 20mg");
  check("medName never yields [object Object]",
    !/\[object Object\]/.test(medName({ med: "Metformin 500mg" })));
  check("parseMedsList handles array of session objects",
    JSON.stringify(parseMedsList([{ med: "Metformin 500mg" }, { med: "Lisinopril 10mg" }])) ===
    JSON.stringify(["Metformin 500mg", "Lisinopril 10mg"]));
  check("parseMedsList handles JSON string of session objects",
    JSON.stringify(parseMedsList('[{"med":"Metformin 500mg"},{"name":"Lisinopril 10mg"}]')) ===
    JSON.stringify(["Metformin 500mg", "Lisinopril 10mg"]));
  check("parseMedsList still splits comma strings",
    JSON.stringify(parseMedsList("Metformin, Lisinopril")) === JSON.stringify(["Metformin", "Lisinopril"]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0); // node:sqlite teardown segfault workaround
