// Checkout reuse regression test (node:sqlite D1 shim).
// Proves: creating a second checkout for the same product+email (pending <1h)
// does NOT rotate billing_payments.access_token — an earlier Stripe session's
// success_url (baked with the original token) keeps working.
// Usage: node test-checkout-reuse.js
import { DatabaseSync } from "node:sqlite";
import { onRequestPost } from "./functions/api/pay/checkout.js";

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(` FAIL ${name}${detail ? " — " + detail : ""}`); }
}

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
}
const s = new DatabaseSync(":memory:");
s.exec(`CREATE TABLE billing_products (
  id TEXT PRIMARY KEY, name TEXT, brand TEXT, price_cents INTEGER, currency TEXT,
  active INTEGER DEFAULT 1, fulfillment TEXT, billing_mode TEXT,
  success_url_template TEXT, cancel_url TEXT, allowed_return_hosts TEXT
)`);
s.exec(`CREATE TABLE billing_payments (
  id INTEGER PRIMARY KEY, product_id TEXT, brand TEXT, email TEXT,
  amount_cents INTEGER, currency TEXT, status TEXT DEFAULT 'pending',
  access_token TEXT, metadata_json TEXT, stripe_session_id TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);
const db = { prepare: (sql) => new Stmt(s, sql) };

db.prepare(`INSERT INTO billing_products
  (id, name, brand, price_cents, currency, fulfillment, success_url_template, allowed_return_hosts)
  VALUES ('test-widget', 'Test Widget', 'test', 1900, 'usd', 'none',
    'https://example.mehyar.us/success.html?token={access_token}', 'example.mehyar.us')`).run();

// ── mock Stripe: no network, returns a fresh fake session per call ──
let sessN = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  sessN++;
  return {
    ok: true,
    json: async () => ({ id: `cs_test_reuse_${sessN}`, url: `https://checkout.stripe.com/pay/cs_test_reuse_${sessN}` }),
  };
};

const env = { LEADS_DB: db, STRIPE_TEST_SECRET_KEY: "sk_test_fake" };
async function checkout() {
  const req = new Request("https://mehyar.us/api/pay/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.mehyar.us" },
    body: JSON.stringify({
      product_id: "test-widget",
      email: "buyer@example.com",
      params: {},
      success_url: "https://example.mehyar.us/success.html",
      cancel_url: "https://example.mehyar.us/",
      test: true,
    }),
  });
  const resp = await onRequestPost({ request: req, env });
  return resp.json();
}

console.log("== checkout reuse keeps the access token stable ==");
const r1 = await checkout();
check("first checkout ok", r1.ok === true && !!r1.checkout_url, JSON.stringify(r1).slice(0, 120));
const t1 = r1.token;
const p1 = r1.payment_id;
check("one payment row", db.prepare("SELECT COUNT(*) c FROM billing_payments").bind().first().c === 1);

const r2 = await checkout();
check("second checkout ok", r2.ok === true && !!r2.checkout_url, JSON.stringify(r2).slice(0, 120));
check("same payment row reused", r2.payment_id === p1, `got ${r2.payment_id} want ${p1}`);
check("token NOT rotated on reuse", r2.token === t1, "token changed between checkouts");
const row = db.prepare("SELECT access_token FROM billing_payments WHERE id = ?").bind(p1).first();
check("db access_token unchanged", row.access_token === t1);
// The earlier session's success_url token still resolves to this payment:
const lookup = db.prepare("SELECT id FROM billing_payments WHERE access_token = ?").bind(t1).first();
check("original token still gates the payment", !!lookup && lookup.id === p1);

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
