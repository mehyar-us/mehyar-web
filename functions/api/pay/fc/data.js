// functions/api/pay/fc/data.js
// POST /api/pay/fc/data — server-to-server ONLY (Billcut worker),
// guarded by the BILLCUT_FC_SECRET shared secret header.
//
// { action: "sync", audit_token, account_ids?: string[] }
//   -> { ok, accounts: [{id, institution, last4, subtype}], transactions,
//        range: {from, to, count} }
//   Account ids default to the audit's stored link; provided ids are
//   intersected with the FC customer's own accounts before use.
//
// { action: "disconnect", audit_token }
//   -> disconnects every linked account at Stripe; the worker clears
//      its link columns after a successful call.

import { stripeFC, getBillcutAudit, syncAccountTransactions, getAccountSummary, disconnectAccount, fcJson } from "../../_shared/fc.js";

export async function onRequestPost({ request, env }) {
  const J = (d, s = 200) => fcJson(d, s);
  try {
    const secret = request.headers.get("x-billcut-fc-secret") || "";
    if (!env?.BILLCUT_FC_SECRET || secret !== env.BILLCUT_FC_SECRET) {
      return J({ ok: false, error: "unauthorized" }, 401);
    }
    if (!env?.LEADS_DB) return J({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;
    const body = await request.json().catch(() => ({}));
    const found = await getBillcutAudit(db, body.audit_token);
    if (!found) return J({ ok: false, error: "audit_not_found" }, 404);
    const { audit, testMode } = found;

    let linkedIds = [];
    try { linkedIds = (JSON.parse(audit.fc_accounts_json || "[]") || []).map((a) => a.id).filter(Boolean); } catch {}

    if (body.action === "diag") {
      // Diagnostic: which Stripe account does each key belong to?
      // A failing call's request_log_url embeds the account id.
      const probe = async (key) => {
        const r = await fetch("https://api.stripe.com/v1/charges/ch_diag_probe", {
          headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
        });
        const d = await r.json().catch(() => ({}));
        const url = (d && d.error && d.error.request_log_url) || "";
        const m = url.match(/acct_[A-Za-z0-9]+/);
        return { status: r.status, acct: m ? m[0] : null, err: (d && d.error && d.error.message) || null };
      };
      return J({
        ok: true,
        test_secret: await probe(env.STRIPE_TEST_SECRET_KEY),
        test_publishable: await probe(env.STRIPE_TEST_PUBLISHABLE_KEY),
        live_secret: await probe(env.STRIPE_SECRET_KEY),
        live_publishable: await probe(env.STRIPE_PUBLISHABLE_KEY),
        qa_secret: await probe(env.STRIPE_QA_SECRET_KEY),
      });
    }

    if (body.action === "list") {
      if (!audit.fc_customer_id) return J({ ok: true, accounts: [] });
      const owned = await stripeFC(env, testMode, "GET",
        `/v1/financial_connections/accounts?account_holder[customer]=${encodeURIComponent(audit.fc_customer_id)}&limit=50`);
      return J({ ok: true, accounts: (owned.data || []).map((a) => ({
        id: a.id, institution: a.institution_name, status: a.status,
        permissions: a.permissions, features: a.features ? Object.keys(a.features) : [],
      })) });
    }

    if (body.action === "disconnect") {
      let n = 0;
      for (const id of linkedIds) { if (await disconnectAccount(env, testMode, id)) n++; }
      return J({ ok: true, disconnected: n });
    }

    if (body.action === "sync") {
      let ids = Array.isArray(body.account_ids) ? body.account_ids.filter((x) => typeof x === "string") : [];
      // Safety: only accept account ids that belong to this audit's
      // Stripe customer (prevents pointing one audit at another's bank).
      if (ids.length && audit.fc_customer_id) {
        const owned = await stripeFC(env, testMode, "GET",
          `/v1/financial_connections/accounts?account_holder[customer]=${encodeURIComponent(audit.fc_customer_id)}&limit=50`);
        const ownedIds = new Set((owned.data || []).map((a) => a.id));
        ids = ids.filter((id) => ownedIds.has(id));
      }
      if (!ids.length) ids = linkedIds;
      if (!ids.length) return J({ ok: false, error: "no_accounts" }, 400);

      const accounts = [];
      const transactions = [];
      const errors = [];
      for (const id of ids.slice(0, 6)) {
        try {
          accounts.push(await getAccountSummary(env, testMode, id));
          transactions.push(...await syncAccountTransactions(env, testMode, id));
        } catch (e) {
          errors.push({ account: id, message: String((e && e.message) || e).slice(0, 160) });
        }
      }
      transactions.sort((a, b) => (a.date < b.date ? -1 : 1));
      const range = transactions.length
        ? { from: transactions[0].date, to: transactions[transactions.length - 1].date, count: transactions.length }
        : { from: null, to: null, count: 0 };
      return J({ ok: true, accounts, transactions, range, errors });
    }

    return J({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("pay/fc/data error", e && e.message);
    return J({ ok: false, error: "fc_data_failed", message: String((e && e.message) || e).slice(0, 200) }, 502);
  }
}
