// Local test: WhatsApp chat-lane webhook + reply engine.
// Simulated Meta payloads through the REAL onRequestPost/onRequestGet with
// a fake D1 (in-memory social_inbox_log) and a mocked global fetch standing
// in for graph.facebook.com. No network, no secrets.
// Run: node scripts/test-whatsapp-chat-lane.mjs
import { createHmac } from "node:crypto";
import { onRequestPost, onRequestGet } from "../functions/api/social/webhook.js";

const APP_SECRET = "testsecret";
const PHONE_ID = "111222333";

// ---------- fake D1 ----------
function makeFakeDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        _args: [],
        bind(...args) { this._args = args; return this; },
        async first() {
          if (sql.includes("SELECT ref_id FROM social_inbox_log WHERE ref_id")) {
            return rows.find((r) => r.ref_id === this._args[0]) || null;
          }
          return null;
        },
        async all() {
          if (sql.includes("kind = 'wa'")) {
            const [account, author] = this._args;
            return { results: rows.filter((r) => r.account === account && r.kind === "wa" && r.author === author) };
          }
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("INSERT OR IGNORE INTO social_inbox_log")) {
            const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((s) => s.trim());
            const row = {};
            cols.forEach((c, i) => { row[c] = this._args[i]; });
            if (!rows.some((r) => r.ref_id === row.ref_id)) rows.push(row);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
}

// ---------- mocked Graph API ----------
const fetchCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  fetchCalls.push({ url, method: opts.method, headers: opts.headers, body });
  return {
    ok: true, status: 200,
    json: async () => (body?.type === "text" ? { messages: [{ id: "wamid.out1" }] } : {}),
  };
};
const textSends = () => fetchCalls.filter((c) => c.body?.type === "text");
const readMarks = () => fetchCalls.filter((c) => c.body?.status === "read");
const lastReply = () => textSends()[textSends().length - 1]?.body?.text?.body || "";

// ---------- env + request helpers ----------
const db = makeFakeDb();
const env = {
  LEADS_DB: db,
  META_VERIFY_TOKEN: "vtok",
  META_APP_SECRET: APP_SECRET,
  WHATSAPP_TOKEN: "TESTTOKEN",
  WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
};

function sign(raw) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(raw).digest("hex");
}
async function post(payload, { badSig = false } = {}) {
  const raw = JSON.stringify(payload);
  const req = new Request("https://mehyar.us/api/social/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": badSig ? "sha256=deadbeef" : sign(raw) },
    body: raw,
  });
  return onRequestPost({ request: req, env });
}
function waBody({ messages = [], statuses = [] }) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "28122300090719897", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "17477772687", phone_number_id: PHONE_ID },
      messages, statuses,
    } }] }],
  };
}
function waText(from, id, body, referral) {
  const m = { from, id, timestamp: "1792000000", type: "text", text: { body } };
  if (referral) m.referral = referral;
  return m;
}

// ---------- assertions ----------
let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}

// 1) GET subscription verification (WhatsApp uses the same handshake)
{
  const req = new Request("https://mehyar.us/api/social/webhook?hub.mode=subscribe&hub.verify_token=vtok&hub.challenge=CH123");
  const res = await onRequestGet({ request: req, env });
  check("GET verify echoes challenge", res.status === 200 && (await res.text()) === "CH123");
}

// 2) Bad signature is rejected
{
  const res = await post(waBody({ messages: [waText("15550000000", "wamid.BAD", "hi")] }), { badSig: true });
  check("bad signature -> 403", res.status === 403);
}

// 3) AUDIT via CTWA referral -> free step delivers the checklist
{
  const before = textSends().length;
  const res = await post(waBody({ messages: [waText("15551234567", "wamid.A1", "Hi, I want the checklist",
    { source_type: "ad", headline: "Your shop missed 11 calls last month. Each one was a customer.", body: "ad body" })] }));
  check("audit webhook 200", res.status === 200);
  check("audit: one reply sent", textSends().length === before + 1);
  const call = textSends()[textSends().length - 1];
  check("audit: send hits Graph messages endpoint for payload phone id",
    call.url === `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
  check("audit: bearer token from env", call.headers.Authorization === "Bearer TESTTOKEN");
  check("audit: reply is the free Missed-Call Checklist",
    lastReply().includes("https://mehyar.us/free-checklist/") && lastReply().includes("Missed-Call Checklist"));
  check("audit: message marked read", readMarks().some((c) => c.body.message_id === "wamid.A1"));
  const row = db.rows.find((r) => r.ref_id === "wa:wamid.A1");
  check("audit: inbound logged as product=audit", row?.product_id === "audit" && row?.kind === "wa");
}

// 4) MAYOR full flow: free -> qualify -> close ($99 live / $79.20 founding, site checkout) -> off-script fallback + review
{
  const num = "15550001111";
  await post(waBody({ messages: [waText(num, "wamid.M1", "Hi! Tell me about the Mayor for my business")] }));
  check("mayor: free step delivers Business AI Checklist", lastReply().includes("Business AI Checklist"));
  await post(waBody({ messages: [waText(num, "wamid.M2", "Auto repair shop — customers reach me by phone and text")] }));
  check("mayor: second message -> qualifiers", lastReply().includes("most annoying recurring task"));
  await post(waBody({ messages: [waText(num, "wamid.M3", "Sounds good, let's do it")] }));
  check("mayor: third message -> close at live $99/mo + founding $79.20",
    lastReply().includes("$99/mo") && lastReply().includes("$79.20") && lastReply().includes("https://mayor.mehyar.us"));
  check("mayor: close has no unfilled [PAYMENT LINK] slot", !lastReply().includes("[PAYMENT LINK]"));
  await post(waBody({ messages: [waText(num, "wamid.M4", "Do you also do my taxes, and what's your home address?")] }));
  check("mayor: off-script -> safe fallback, no invented answer", lastReply().includes("flagged it for a human"));
  const row = db.rows.find((r) => r.ref_id === "wa:wamid.M4");
  check("mayor: off-script inbound flagged review=1", row?.review === 1);
}

// 5) PROMPTVAULT via keyword -> free step offers the finished piece
{
  await post(waBody({ messages: [waText("15559998888", "wamid.P1", "I need PromptPack Pro for my real estate listings")] }));
  check("promptvault: detected from keyword", lastReply().includes("finished version, free"));
  const row = db.rows.find((r) => r.ref_id === "wa:wamid.P1");
  check("promptvault: logged product=promptvault", row?.product_id === "promptvault");
}

// 6) Unknown first message -> menu, no product forced
{
  await post(waBody({ messages: [waText("15550002222", "wamid.U1", "hello there")] }));
  check("unknown: default menu lists products", lastReply().includes("PromptPack Pro") && lastReply().includes("reply with the name"));
}

// 7) Status callback: logged, no reply sent
{
  const before = textSends().length;
  const res = await post(waBody({ statuses: [{ id: "wamid.A1", status: "delivered", recipient_id: "15551234567", timestamp: "1792000100" }] }));
  check("status callback 200", res.status === 200);
  check("status callback sends no reply", textSends().length === before);
  check("status logged as wa_status", db.rows.some((r) => r.ref_id === "was:wamid.A1:delivered" && r.kind === "wa_status"));
}

// 8) Idempotency: same wamid redelivered -> no second reply
{
  const before = textSends().length;
  await post(waBody({ messages: [waText("15551234567", "wamid.A1", "Hi, I want the checklist",
    { source_type: "ad", headline: "Your shop missed 11 calls last month. Each one was a customer." })] }));
  check("duplicate wamid -> no duplicate reply", textSends().length === before);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
