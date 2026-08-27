export async function callMehyarsoftAdmin(env, path, init = {}) {
  const base = (env?.MEHYARSOFT_API_BASE_URL || "https://api.mehyar.us").replace(/\/$/, "");
  const serviceToken = env?.MEHYARSOFT_SERVICE_TOKEN;
  if (serviceToken) {
    const headers = new Headers(init.headers || {});
    headers.set("x-mehyarsoft-service-token", serviceToken);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(`${base}${path}`, { ...init, headers });
  }
  const username = env?.MEHYARSOFT_API_ADMIN_USERNAME || "admin";
  const password = env?.MEHYARSOFT_API_ADMIN_PASSWORD;
  if (!password) throw new Error("mehyarsoft_api_admin_not_configured");

  const loginResponse = await fetch(`${base}/v1/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const login = await loginResponse.json().catch(() => ({}));
  if (!loginResponse.ok || !login?.token) throw new Error(`mehyarsoft_api_login_${loginResponse.status}`);

  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${login.token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}
