// GET  /api/admin/settings         → { ok, settings: { key: value, ... } }
// POST /api/admin/settings         → body { key, value } or { settings: {...} }
// Delete: POST body { delete: ["key1", "key2"] }
//
// Stores in INTAKE_KV under `settings:<key>`. Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";

const MAX_VALUE_BYTES = 8000; // protect against giant blobs

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.INTAKE_KV) return json({ ok: false, error: "missing_kv" }, 500, request, env);

  try {
    const list = await env.INTAKE_KV.list({ prefix: "settings:" });
    const out = {};
    for (const k of (list?.keys || [])) {
      const key = k.name.replace(/^settings:/, "");
      const v = await env.INTAKE_KV.get(k.name).catch(() => null);
      out[key] = v;
    }
    return json({ ok: true, settings: out, count: Object.keys(out).length }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "settings_read_failed", details: String(e?.message || e) }, 500, request, env);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.INTAKE_KV) return json({ ok: false, error: "missing_kv" }, 500, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  try {
    // Delete keys
    if (Array.isArray(body?.delete) && body.delete.length) {
      let deleted = 0;
      for (const k of body.delete) {
        const key = String(k).slice(0, 64);
        await env.INTAKE_KV.delete(`settings:${key}`).catch(() => null);
        deleted++;
      }
      return json({ ok: true, deleted }, 200, request, env);
    }

    // Bulk replace
    if (body?.settings && typeof body.settings === "object") {
      const written = [];
      for (const [k, v] of Object.entries(body.settings)) {
        const key = String(k).slice(0, 64);
        const value = typeof v === "string" ? v : JSON.stringify(v);
        if (value.length > MAX_VALUE_BYTES) {
          return json({ ok: false, error: "value_too_large", key, max: MAX_VALUE_BYTES }, 400, request, env);
        }
        await env.INTAKE_KV.put(`settings:${key}`, value);
        written.push(key);
      }
      return json({ ok: true, written: written.length, keys: written }, 200, request, env);
    }

    // Single key
    const key = String(body?.key || "").slice(0, 64);
    if (!key) return json({ ok: false, error: "missing_key" }, 400, request, env);
    const value = body?.value;
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);
    if (valueStr.length > MAX_VALUE_BYTES) {
      return json({ ok: false, error: "value_too_large", max: MAX_VALUE_BYTES }, 400, request, env);
    }
    await env.INTAKE_KV.put(`settings:${key}`, valueStr);
    return json({ ok: true, key, size: valueStr.length }, 200, request, env);
  } catch (e) {
    return json({ ok: false, error: "settings_write_failed", details: String(e?.message || e) }, 500, request, env);
  }
}
