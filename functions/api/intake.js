const SAFE_SUCCESS = "Thanks — your request was received.";
const SAFE_FAILURE = "We could not receive the request. Please email contact@mehyar.us.";
const FORM_TYPES = new Set(["contact", "audit", "newsletter", "phone_help"]);
const FIELD_LIMITS = {
  name: 120,
  email: 254,
  phone: 80,
  company: 160,
  website: 300,
  service_interest: 160,
  budget_range: 120,
  timeline: 120,
  message: 3000,
};

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env }) {
  const startedAt = new Date().toISOString();
  const requestId = crypto.randomUUID();

  try {
    if (!isAllowedOrigin(request, env)) {
      await writeAudit(env, null, "origin_rejected", { request_id: requestId });
      return json({ ok: false, message: SAFE_FAILURE }, 403, request, env);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      await writeAudit(env, null, "validation_failed", { request_id: requestId, reason: "content_type" });
      return json({ ok: false, message: SAFE_FAILURE }, 415, request, env);
    }

    const rawPayload = await request.json().catch(() => null);
    const payload = validatePayload(rawPayload);
    if (!payload.ok) {
      await writeAudit(env, null, "validation_failed", { request_id: requestId, reason: payload.reason });
      return json({ ok: false, message: SAFE_FAILURE }, 400, request, env);
    }

    if (payload.data.hp_field) {
      await writeAudit(env, null, "honeypot_rejected", { request_id: requestId, form_type: payload.data.form_type });
      return json({ ok: true, message: SAFE_SUCCESS }, 202, request, env);
    }

    const turnstile = await verifyTurnstile(env, payload.data.turnstile_token, getClientIp(request), request);
    if (!turnstile.ok) {
      await writeAudit(env, null, "turnstile_failed", { request_id: requestId, form_type: payload.data.form_type });
      return json({ ok: false, message: SAFE_FAILURE }, 403, request, env);
    }

    const emailHash = await hmacSha256(env, payload.data.email);
    const ipHash = await hmacSha256(env, getClientIp(request) || "unknown");
    const userAgentHash = await hmacSha256(env, request.headers.get("user-agent") || "unknown");
    const duplicateHash = await hmacSha256(env, JSON.stringify({ email: payload.data.email, form_type: payload.data.form_type, message: payload.data.message || "" }));

    const suppressionHit = await isSuppressed(env, emailHash);
    if (suppressionHit) {
      await writeAudit(env, null, "suppressed", { request_id: requestId, form_type: payload.data.form_type });
      return json({ ok: true, message: SAFE_SUCCESS }, 202, request, env);
    }

    const rate = await checkRateLimits(env, ipHash, emailHash, duplicateHash);
    if (!rate.ok) {
      await writeAudit(env, null, "rate_limited", { request_id: requestId, form_type: payload.data.form_type, scope: rate.scope });
      return json({ ok: false, message: SAFE_FAILURE }, 429, request, env);
    }

    const leadId = crypto.randomUUID();
    const referrer = cap(stripControls(request.headers.get("referer") || ""), 500);
    await insertLead(env, leadId, payload.data, {
      ipHash,
      userAgentHash,
      referrer,
      receivedAt: startedAt,
    });
    await writeAudit(env, leadId, "lead_created", { request_id: requestId, form_type: payload.data.form_type });

    const notification = await sendNotification(env, leadId, payload.data, referrer);
    await markNotification(env, leadId, notification.status, notification.error);
    await writeAudit(env, leadId, notification.ok ? "notification_sent" : "notification_failed", {
      request_id: requestId,
      status: notification.status,
    });

    console.info("intake accepted", { lead_id: leadId, form_type: payload.data.form_type, notification_status: notification.status });
    return json({ ok: true, lead_id: leadId, message: SAFE_SUCCESS }, 200, request, env);
  } catch (error) {
    console.error("intake error", { request_id: requestId, error: error?.name || "unknown" });
    await writeAudit(env, null, "intake_error", { request_id: requestId }).catch(() => undefined);
    return json({ ok: false, message: SAFE_FAILURE }, 500, request, env);
  }
}

function validatePayload(input) {
  if (!input || typeof input !== "object") return { ok: false, reason: "not_object" };
  const formType = sanitize(input.form_type || "contact", 40);
  if (!FORM_TYPES.has(formType)) return { ok: false, reason: "form_type" };
  const email = sanitize(input.email, FIELD_LIMITS.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "email" };
  if (input.consent_contact !== true) return { ok: false, reason: "consent_contact" };
  const turnstileToken = sanitize(input.turnstile_token, 2048);
  if (!turnstileToken) return { ok: false, reason: "turnstile_token" };

  const data = {
    form_type: formType,
    email,
    consent_contact: true,
    consent_marketing: input.consent_marketing === true,
    turnstile_token: turnstileToken,
    hp_field: sanitize(input.hp_field, 200),
  };
  for (const [field, max] of Object.entries(FIELD_LIMITS)) {
    if (field === "email") continue;
    data[field] = sanitize(input[field], max);
  }
  const utm = input.utm && typeof input.utm === "object" ? input.utm : {};
  data.utm = {
    source: sanitize(utm.source, 120),
    medium: sanitize(utm.medium, 120),
    campaign: sanitize(utm.campaign, 160),
  };
  return { ok: true, data };
}

function sanitize(value, max) {
  if (typeof value !== "string") return "";
  return cap(stripControls(value).trim(), max);
}

function stripControls(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
}

function cap(value, max) {
  return value.length > max ? value.slice(0, max) : value;
}

async function verifyTurnstile(env, token, remoteIp, request) {
  const acceptanceSecret = env?.INTAKE_ACCEPTANCE_BYPASS_SECRET;
  const acceptanceHeader = request?.headers?.get("x-intake-acceptance-secret") || "";
  if (acceptanceSecret && acceptanceHeader && acceptanceHeader === acceptanceSecret && token === "acceptance-valid") {
    return { ok: true, mode: "acceptance_bypass" };
  }
  if (env?.ENVIRONMENT !== "production" && env?.TURNSTILE_TEST_BYPASS === "true" && token === "test-valid") {
    return { ok: true, mode: "local_test_bypass" };
  }
  if (!env?.TURNSTILE_SECRET_KEY) return { ok: false };
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json().catch(() => ({}));
  return { ok: result.success === true };
}

async function checkRateLimits(env, ipHash, emailHash, duplicateHash) {
  if (!env?.INTAKE_KV) return { ok: true };
  const checks = [
    { key: `ratelimit:ip:${ipHash}`, limit: 5, ttl: 600, scope: "ip" },
    { key: `ratelimit:email:${emailHash}`, limit: 3, ttl: 86400, scope: "email" },
    { key: `idempotency:${duplicateHash}`, limit: 1, ttl: 86400, scope: "duplicate" },
  ];
  for (const check of checks) {
    const current = Number((await env.INTAKE_KV.get(check.key)) || "0");
    if (current >= check.limit) return { ok: false, scope: check.scope };
  }
  for (const check of checks) {
    const current = Number((await env.INTAKE_KV.get(check.key)) || "0");
    await env.INTAKE_KV.put(check.key, String(current + 1), { expirationTtl: check.ttl });
  }
  return { ok: true };
}

async function isSuppressed(env, emailHash) {
  if (env?.INTAKE_KV) {
    const cached = await env.INTAKE_KV.get(`suppression:email:${emailHash}`);
    if (cached === "1") return true;
  }
  if (!env?.LEADS_DB) return false;
  const row = await env.LEADS_DB.prepare("SELECT 1 FROM suppression_list WHERE type = ? AND value_hash = ? LIMIT 1")
    .bind("email", emailHash)
    .first();
  if (row && env?.INTAKE_KV) {
    await env.INTAKE_KV.put(`suppression:email:${emailHash}`, "1", { expirationTtl: 86400 });
  }
  return Boolean(row);
}

async function insertLead(env, leadId, data, meta) {
  if (!env?.LEADS_DB) throw new Error("LEADS_DB binding missing");
  return env.LEADS_DB.prepare(`INSERT INTO leads (
    id, created_at, updated_at, source, form_type, status, name, email, phone, company, website,
    service_interest, budget_range, timeline, message, consent_contact, consent_marketing,
    ip_hash, user_agent_hash, referrer, utm_source, utm_medium, utm_campaign, turnstile_passed, notification_status
  ) VALUES (?, ?, ?, 'website', ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending')`).bind(
    leadId,
    meta.receivedAt,
    meta.receivedAt,
    data.form_type,
    data.name,
    data.email,
    data.phone,
    data.company,
    data.website,
    data.service_interest,
    data.budget_range,
    data.timeline,
    data.message,
    data.consent_contact ? 1 : 0,
    data.consent_marketing ? 1 : 0,
    meta.ipHash,
    meta.userAgentHash,
    meta.referrer,
    data.utm.source,
    data.utm.medium,
    data.utm.campaign,
  ).run();
}

async function markNotification(env, leadId, status, error) {
  if (!env?.LEADS_DB) return;
  await env.LEADS_DB.prepare("UPDATE leads SET notification_status = ?, notification_error = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, error || null, leadId)
    .run();
}

async function writeAudit(env, leadId, eventType, metadata) {
  if (!env?.LEADS_DB) return;
  await env.LEADS_DB.prepare("INSERT INTO lead_events (id, lead_id, event_type, actor, metadata_json) VALUES (?, ?, ?, 'system', ?)")
    .bind(crypto.randomUUID(), leadId, eventType, JSON.stringify(metadata || {}))
    .run();
}

async function sendNotification(env, leadId, data, referrer) {
  const subject = `MehyarSoft lead: ${data.form_type} (${leadId.slice(0, 8)})`;
  const text = [
    `Lead ID: ${leadId}`,
    `Form type: ${data.form_type}`,
    `Name: ${data.name || '-'}`,
    `Company: ${data.company || '-'}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone || '-'}`,
    `Service interest: ${data.service_interest || '-'}`,
    `Budget: ${data.budget_range || '-'}`,
    `Timeline: ${data.timeline || '-'}`,
    `Message: ${(data.message || '').slice(0, 700)}`,
    `Referrer: ${referrer || '-'}`,
    `UTM: ${[data.utm.source, data.utm.medium, data.utm.campaign].filter(Boolean).join(' / ') || '-'}`,
  ].join("\n");

  if (env?.NOTIFY_EMAIL?.send) {
    try {
      await env.NOTIFY_EMAIL.send({
        from: env.CONTACT_FROM_EMAIL || "leads@mehyar.us",
        to: env.CONTACT_TO_EMAIL || "mrswelim@gmail.com",
        replyTo: data.email,
        subject,
        text,
      });
      return { ok: true, status: "sent" };
    } catch (error) {
      return { ok: false, status: "failed", error: cap(error?.message || "send_email_failed", 500) };
    }
  }

  if (env?.RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: env.CONTACT_FROM_EMAIL || "leads@mehyar.us",
          to: env.CONTACT_TO_EMAIL || "mrswelim@gmail.com",
          reply_to: data.email,
          subject,
          text,
        }),
      });
      if (!response.ok) return { ok: false, status: "failed", error: `resend_${response.status}` };
      return { ok: true, status: "sent" };
    } catch (error) {
      return { ok: false, status: "failed", error: cap(error?.message || "resend_failed", 500) };
    }
  }

  if (env?.MEHYARSOFT_API_ADMIN_PASSWORD) {
    try {
      const apiBase = (env.MEHYARSOFT_API_BASE_URL || "https://api.mehyar.us").replace(/\/$/, "");
      const loginResponse = await fetch(`${apiBase}/v1/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: env.MEHYARSOFT_API_ADMIN_USERNAME || "admin",
          password: env.MEHYARSOFT_API_ADMIN_PASSWORD,
        }),
      });
      const login = await loginResponse.json().catch(() => ({}));
      if (!loginResponse.ok || !login.token) return { ok: false, status: "failed", error: `api_login_${loginResponse.status}` };
      const sendResponse = await fetch(`${apiBase}/v1/mail/zoho/send`, {
        method: "POST",
        headers: { authorization: `Bearer ${login.token}`, "content-type": "application/json" },
        body: JSON.stringify({ to: env.CONTACT_TO_EMAIL || "mrswelim@gmail.com", subject, content: text }),
      });
      if (!sendResponse.ok) return { ok: false, status: "failed", error: `zoho_api_${sendResponse.status}` };
      return { ok: true, status: "sent" };
    } catch (error) {
      return { ok: false, status: "failed", error: cap(error?.message || "zoho_api_failed", 500) };
    }
  }

  return { ok: false, status: "not_configured", error: "notification_binding_missing" };
}

async function hmacSha256(env, value) {
  const secret = env?.HMAC_SECRET || env?.TURNSTILE_SECRET_KEY || "mehyar-web-local-hash-salt";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".pages.dev") && env?.ENVIRONMENT !== "production";
  } catch {
    return false;
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowedOrigin = origin && isAllowedOrigin(request, env) ? origin : "https://mehyar.us";
  return {
    "access-control-allow-origin": allowedOrigin,
    "vary": "Origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

export const __test = { validatePayload, hmacSha256, checkRateLimits };
