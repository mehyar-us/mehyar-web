import type { AuthEnv, OAuthProvider } from "./capabilities";
import { requireMembership, OPERATORS } from "../permissions";
import { HttpError } from "../http";

export type CredentialBinding = { userId: string; provider: OAuthProvider; accountId: string; tenantId: string | null };
export type ProviderCredential = { accountEmail: string; accessToken: string; refreshToken?: string; accessTokenExpiresAt?: string; refreshTokenExpiresAt?: string; grantedScopes: string[] };

function bytesToBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function base64ToBytes(value: string): Uint8Array { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
function associatedData(binding: CredentialBinding): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(["mehyar-provider-credential", binding.userId, binding.provider, binding.accountId, binding.tenantId]));
}
async function keyFromBase64(key: string): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(key); } catch { throw new Error("invalid_token_encryption_key"); }
  if (bytes.length !== 32) throw new Error("invalid_token_encryption_key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Versioned AES-256-GCM envelope. AAD makes swapped tenant/account rows fail closed. */
export async function encryptCredential(credential: ProviderCredential, binding: CredentialBinding, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData(binding) }, await keyFromBase64(key), new TextEncoder().encode(JSON.stringify(credential)));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptCredential(envelope: string, binding: CredentialBinding, key: string): Promise<ProviderCredential> {
  const [version, iv, ciphertext, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !ciphertext || extra) throw new Error("invalid_credential_envelope");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv), additionalData: associatedData(binding) }, await keyFromBase64(key), base64ToBytes(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as ProviderCredential;
}

export function mergeCredential(previous: ProviderCredential | null, incoming: ProviderCredential): ProviderCredential {
  return {
    ...incoming,
    // Google often omits this on incremental reauthorization. Never erase it.
    refreshToken: incoming.refreshToken || previous?.refreshToken,
    refreshTokenExpiresAt: incoming.refreshToken
      ? incoming.refreshTokenExpiresAt : previous?.refreshTokenExpiresAt,
    // Do not union old scopes: they may have been revoked or denied this time.
    grantedScopes: [...new Set(incoming.grantedScopes)],
  };
}

export async function requireConnectorManager(env: AuthEnv, tenantId: string, userId: string): Promise<void> {
  try { await requireMembership(env, { tenantId, userId }, OPERATORS); }
  catch (error) {
    if (error instanceof HttpError) throw new Error("tenant_connection_forbidden");
    throw error;
  }
  const tenant = await env.AGENT_DB.prepare("SELECT id FROM agent_tenants WHERE id = ? AND status != 'deleted'").bind(tenantId).first();
  if (!tenant) throw new Error("tenant_connection_forbidden");
}

export async function storeProviderGrant(env: AuthEnv, binding: CredentialBinding, incoming: ProviderCredential, selected: readonly string[]) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("token_custody_unavailable");
  if (binding.tenantId) await requireConnectorManager(env, binding.tenantId, binding.userId);
  const tenantScope = binding.tenantId ?? "";
  const previous = await env.AGENT_DB.prepare("SELECT id, ciphertext, status FROM auth_provider_grants WHERE user_id = ? AND provider = ? AND account_id = ? AND tenant_scope = ?")
    .bind(binding.userId, binding.provider, binding.accountId, tenantScope).first<{ id: string; ciphertext: string; status: string }>();
  const credential = mergeCredential(previous && previous.status === "authorized" ? await decryptCredential(previous.ciphertext, binding, env.TOKEN_ENCRYPTION_KEY) : null, incoming);
  const ciphertext = await encryptCredential(credential, binding, env.TOKEN_ENCRYPTION_KEY);
  const id = previous?.id ?? crypto.randomUUID();
  await env.AGENT_DB.prepare(`INSERT INTO auth_provider_grants
    (id, user_id, provider, account_id, tenant_scope, ciphertext, key_version, granted_scopes, selected_capabilities, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider, account_id, tenant_scope) DO UPDATE SET
      ciphertext = excluded.ciphertext, granted_scopes = excluded.granted_scopes,
      selected_capabilities = excluded.selected_capabilities, status = excluded.status, updated_at = excluded.updated_at`)
    .bind(id, binding.userId, binding.provider, binding.accountId, tenantScope, ciphertext,
      JSON.stringify(credential.grantedScopes), JSON.stringify(selected), credential.refreshToken ? "authorized" : "reconnect_required", new Date().toISOString()).run();
  return id;
}

/** Copies a signup grant into an explicitly authorized workspace; email alone never links it. */
export async function attachUnassignedGrant(env: AuthEnv, userId: string, grantId: string, tenantId: string) {
  await requireConnectorManager(env, tenantId, userId);
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("token_custody_unavailable");
  const row = await env.AGENT_DB.prepare("SELECT provider, account_id, ciphertext, selected_capabilities FROM auth_provider_grants WHERE id = ? AND user_id = ? AND tenant_scope = '' AND status != 'revoked'")
    .bind(grantId, userId).first<{ provider: OAuthProvider; account_id: string; ciphertext: string; selected_capabilities: string }>();
  if (!row) throw new Error("grant_not_found");
  const binding = { userId, provider: row.provider, accountId: row.account_id, tenantId: null };
  const credential = await decryptCredential(row.ciphertext, binding, env.TOKEN_ENCRYPTION_KEY);
  const id = await storeProviderGrant(env, { ...binding, tenantId }, credential, JSON.parse(row.selected_capabilities));
  return { id, provider: row.provider, tenantId };
}

/** Immediately withdraws local tool authorization without revoking shared identity login. */
export async function revokeProviderGrant(env: AuthEnv, userId: string, grantId: string, tenantId?: string) {
  const row = await env.AGENT_DB.prepare("SELECT tenant_scope FROM auth_provider_grants WHERE id = ? AND user_id = ?")
    .bind(grantId, userId).first<{ tenant_scope: string }>();
  if (!row || (tenantId !== undefined && tenantId !== row.tenant_scope)) throw new Error("grant_not_found");
  if (row.tenant_scope) await requireConnectorManager(env, row.tenant_scope, userId);
  await env.AGENT_DB.prepare(`UPDATE auth_provider_grants SET status = 'revoked', ciphertext = '',
    granted_scopes = '[]', selected_capabilities = '[]', updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(new Date().toISOString(), grantId, userId).run();
  return { id: grantId, tenantId: row.tenant_scope || null, status: "revoked", providerRevoked: false };
}
