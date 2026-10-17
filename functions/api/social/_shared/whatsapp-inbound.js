// WhatsApp inbound pipeline — mirrors webhook.js processInbound:
// idempotency (social_inbox_log ref_id) -> history -> engine -> log -> send.
// Inbound rows:  account='whatsapp', kind='wa',        ref_id='wa:<wamid>'
// Outbound rows: account='whatsapp', kind='wa_out',    ref_id='waout:<wamid>'
// Status rows:   account='whatsapp', kind='wa_status', ref_id='was:<wamid>:<status>'
// review=1 flags rows a human must pick up (off-script, media, human steps).
// detail is a small JSON: { step, sent, reason?, type?, text? } (text <= 500).
import { WA_ACCOUNT, WA_SCRIPTS, decideWhatsAppReply } from "./whatsapp.js";
import { sendWhatsAppReply, markWhatsAppRead } from "../send.js";

async function logRow(db, row) {
  if (!db) return;
  const detail = row.detail ? JSON.stringify(row.detail).slice(0, 900) : null;
  try {
    await db.prepare(
      "INSERT OR IGNORE INTO social_inbox_log (ref_id, account, kind, author, product_id, replied_at, review, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(row.ref_id, row.account, row.kind, row.author || "", row.product_id || null,
      row.at, row.review ? 1 : 0, detail).run();
  } catch (e) {
    // Pre-migration schema (no review/detail columns yet): base insert,
    // same columns webhook.js processInbound has always written.
    await db.prepare(
      "INSERT OR IGNORE INTO social_inbox_log (ref_id, account, kind, author, product_id, replied_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(row.ref_id, row.account, row.kind, row.author || "", row.product_id || null,
      row.at).run().catch((err) => console.log("[wa-lane] log write failed", err));
  }
}

async function seenBefore(db, refId) {
  if (!db) return false;
  const seen = await db.prepare("SELECT ref_id FROM social_inbox_log WHERE ref_id = ?")
    .bind(refId).first().catch(() => null);
  return !!seen;
}

async function historyFor(db, author) {
  if (!db) return [];
  const out = await db.prepare(
    "SELECT product_id FROM social_inbox_log WHERE account = ? AND kind = 'wa' AND author = ? ORDER BY rowid"
  ).bind(WA_ACCOUNT, String(author)).all().catch(() => null);
  return out?.results || [];
}

export async function processWhatsAppMessage(env, msg, value) {
  const db = env.LEADS_DB;
  const from = msg?.from;
  const wamid = msg?.id;
  if (!from || !wamid) return { ok: false, reason: "bad_message" };
  const refId = `wa:${wamid}`;
  if (await seenBefore(db, refId)) return { ok: true, duplicate: true };

  const phoneNumberId = value?.metadata?.phone_number_id || env.WHATSAPP_PHONE_NUMBER_ID;
  const text = msg.type === "text" ? (msg.text?.body || "") : "";
  const history = await historyFor(db, from);
  const decision = decideWhatsAppReply({
    text, type: msg.type, referral: msg.referral || null, history,
  });
  const now = new Date().toISOString();

  await logRow(db, {
    ref_id: refId, account: WA_ACCOUNT, kind: "wa", author: from,
    product_id: decision.product_id, at: now, review: decision.needs_review,
    detail: { step: decision.step, type: msg.type, text: text.slice(0, 500) },
  });

  await markWhatsAppRead(env, phoneNumberId, wamid);
  const send = await sendWhatsAppReply(env, phoneNumberId, from, decision.reply_text);
  await logRow(db, {
    ref_id: `waout:${wamid}`, account: WA_ACCOUNT, kind: "wa_out", author: from,
    product_id: decision.product_id, at: new Date().toISOString(),
    review: decision.needs_review,
    detail: { step: decision.step, sent: !!send.sent, reason: send.reason || null },
  });
  return { ok: true, product_id: decision.product_id, step: decision.step, ...send };
}

export async function processWhatsAppStatus(env, st) {
  const db = env.LEADS_DB;
  if (!st?.id || !st?.status) return { ok: false, reason: "bad_status" };
  await logRow(db, {
    ref_id: `was:${st.id}:${st.status}`, account: WA_ACCOUNT, kind: "wa_status",
    author: st.recipient_id || "", product_id: null,
    at: new Date().toISOString(), review: st.status === "failed",
    detail: { status: st.status, errors: st.errors ? JSON.stringify(st.errors).slice(0, 300) : null },
  });
  return { ok: true, status: st.status };
}

// Entry point for one webhook body with object=whatsapp_business_account.
export async function processWhatsAppBody(env, body) {
  const results = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (change.field === "messages") {
        for (const msg of value.messages || []) {
          results.push(await processWhatsAppMessage(env, msg, value));
        }
        for (const st of value.statuses || []) {
          results.push(await processWhatsAppStatus(env, st));
        }
      } else if (change.field === "message_template_status_update" ||
                 change.field === "phone_number_quality_update") {
        console.log(`[wa-lane] ${change.field}:`, JSON.stringify(value).slice(0, 300));
      }
    }
  }
  return results;
}

// Re-exported for tests/tools that want the script table by product id.
export function scriptFor(productId) {
  return WA_SCRIPTS[productId] || null;
}
