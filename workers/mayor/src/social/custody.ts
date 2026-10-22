import type { Actor } from '../env';
import type { AuthEnv } from '../auth/capabilities';
import { socialFailure } from './messages';

/** Same AES-256-GCM custody pattern as auth/vault and custom-connectors, with a
 * separate social-connector domain so ciphertext never crosses stores. */
const aad = (actor: Actor, id: string) =>
  new TextEncoder().encode(JSON.stringify(['mayor-social-connection', actor.tenantId, actor.userId, id]));
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function vaultKey(env: AuthEnv) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw socialFailure('social_custody_unavailable', 503);
  let key: Uint8Array;
  try { key = bytes(env.TOKEN_ENCRYPTION_KEY); } catch { throw socialFailure('social_custody_unavailable', 503); }
  if (key.length !== 32) throw socialFailure('social_custody_unavailable', 503);
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealSocialSecret(env: AuthEnv, actor: Actor, id: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(actor, id) },
    await vaultKey(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}

export async function openSocialSecret<T>(env: AuthEnv, actor: Actor, id: string, ciphertext: string): Promise<T> {
  try {
    const [version, iv, data, extra] = ciphertext.split('.');
    if (version !== 'v1' || !iv || !data || extra) throw new Error('bad envelope');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(iv), additionalData: aad(actor, id) },
      await vaultKey(env),
      bytes(data),
    );
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plaintext)) as T;
  } catch {
    throw socialFailure('social_custody_unavailable', 503);
  }
}
