// Self-contained owner login. Bypasses the SPA bundle + the service worker
// so the user can always sign in even if their browser has a stale SW or an
// extension is blocking cross-origin fetches.
//
// Usage:
//   GET  /api/owner-login      → returns the HTML form
//   POST /api/owner-login      { username, password } → proxies the Worker login
//                                 and sets the token in a Set-Cookie the SPA reads.
//
// Why a function and not a static file: the static-file `/* → /index.html`
// SPA fallback in `_redirects` catches every static path and forces it through
// the bundle. A Pages function is its own route and gets the path verbatim.

export function onRequest({ request, env }) {
  const origin = (request.headers.get("origin") || "");
  const allowed = (env?.ALLOWED_ORIGINS || "https://mehyar.us,https://www.mehyar.us")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const corsHeaders = (req) => ({
    "access-control-allow-origin": allowed.includes(origin) ? origin : "https://mehyar.us",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  });

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method === "GET") {
    return new Response(HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders(request) },
    });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders(request) });
  }
  return handleLogin(request, env, corsHeaders);
}

async function handleLogin(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_json", 400, request, corsHeaders);
  }
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    return jsonError("missing_credentials", 400, request, corsHeaders);
  }

  // Forward to the Worker (api.mehyar.us / v1/admin/login).
  // We do this server-to-server so the request always succeeds regardless of
  // browser CORS quirks, SW caches, or extensions.
  const workerBase = "https://api.mehyar.us";
  let upstream;
  try {
    const resp = await fetch(`${workerBase}/v1/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    upstream = await resp.json().catch(() => ({}));
    if (!resp.ok || upstream.error) {
      return jsonError(
        upstream.error || `http_${resp.status}`,
        resp.status === 401 || resp.status === 403 ? 401 : 502,
        request,
        corsHeaders
      );
    }
  } catch (e) {
    return jsonError(`upstream_failed: ${e?.message || "unknown"}`, 502, request, corsHeaders);
  }

  // Bridge the token back into the SPA. The bundle reads `mehyarsoft_admin_token`
  // from sessionStorage, but with HttpOnly cookies JS can't write the value.
  // Instead we return a tiny HTML page that sets sessionStorage and redirects.
  const safeJSON = JSON.stringify(upstream).replace(/</g, "\\u003c");
  const token = upstream.token || "";
  const html = `<!doctype html><meta charset="utf-8"><title>Login OK</title>
<script>
try {
  sessionStorage.setItem("mehyarsoft_admin_token", ${JSON.stringify(token)});
  ${upstream.expires_in_seconds ? `sessionStorage.setItem("mehyarsoft_admin_expires_in", String(Date.now() + ${Number(upstream.expires_in_seconds)} * 1000));` : ""}
} catch (e) { document.body && (document.body.textContent = 'sessionStorage failed: ' + e); }
window.location.replace("/admin");
</script>
<p>Signed in. Redirecting to <a href="/admin">/admin</a>...</p>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders(request) },
  });
}

function jsonError(error, status, request, corsHeaders) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request) },
  });
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Owner Login | MehyarSoft</title>
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0b0f1a;color:#e5e7eb;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#111827;border:1px solid #1f2937;border-radius:14px;padding:32px;max-width:420px;width:100%;box-shadow:0 8px 28px rgba(0,0,0,.4)}
    h1{font-size:22px;font-weight:600;color:#f3f4f6;margin-bottom:8px}
    p.sub{color:#9ca3af;font-size:14px;margin-bottom:24px}
    label{display:block;font-size:13px;color:#d1d5db;margin-bottom:6px;font-weight:500}
    input{width:100%;padding:10px 12px;background:#1f2937;border:1px solid #374151;border-radius:8px;color:#f3f4f6;font-size:14px;outline:none}
    input:focus{border-color:#60a5fa}
    .field{margin-bottom:16px}
    button{width:100%;padding:12px;background:#2563eb;border:none;color:#fff;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px}
    button:hover:not(:disabled){background:#1d4ed8}
    button:disabled{opacity:.5;cursor:not-allowed}
    .err{background:#7f1d1d;border:1px solid #991b1b;color:#fee2e2;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:16px;display:none;word-break:break-word}
    .err.show{display:block}
    a.back{color:#9ca3af;font-size:12px;text-decoration:none;display:inline-block;margin-top:16px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Owner Login</h1>
    <p class="sub">Server-relay login. The POST is handled by the MehyarWeb Pages function which forwards credentials to the admin Worker — there's no direct browser-to-Worker fetch, so a stale service worker or extension can't interfere.</p>
    <div class="err" id="err"></div>
    <form id="f">
      <div class="field">
        <label for="u">Username</label>
        <input id="u" name="u" type="text" autocomplete="username" value="mehyar500" required />
      </div>
      <div class="field">
        <label for="p">Password</label>
        <input id="p" name="p" type="password" autocomplete="current-password" required />
      </div>
      <button type="submit" id="btn">Sign in</button>
    </form>
    <a class="back" href="https://mehyar.us/admin">← back to admin</a>
  </div>
<script>
(()=>{
  const $u=document.getElementById('u'),$p=document.getElementById('p'),$f=document.getElementById('f'),
        $btn=document.getElementById('btn'),$err=document.getElementById('err');
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(rs=>{for (const r of rs) r.unregister();}).catch(()=>{});
  }
  function showErr(msg){$err.textContent=msg;$err.classList.add('show')}
  $f.addEventListener('submit', async ev=>{
    ev.preventDefault(); $err.classList.remove('show');
    $btn.disabled=true; $btn.textContent='Signing in…';
    try {
      const r = await fetch('/api/owner-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: $u.value.trim(), password: $p.value }),
      });
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); msg += ': ' + (j.error || JSON.stringify(j)); } catch {}
        showErr(msg);
        $btn.disabled = false; $btn.textContent = 'Sign in';
        return;
      }
      // Server returned HTML that does sessionStorage.setItem + redirect to /admin.
      // If we got here the response is the redirect script page — render it.
      const html = await r.text();
      document.open(); document.write(html); document.close();
    } catch (e) {
      showErr('Fetch failed: ' + (e && e.message ? e.message : e));
      $btn.disabled = false; $btn.textContent = 'Sign in';
    }
  });
})();
</script>
</body>
</html>`;
