import { describe, it, expect } from 'vitest';
import {
  registerSocialRoutes, handleSocialRequest, publishEnabled, publishSocialPost,
  socialConnectCards, orderedSocialCards, isSocialProvider,
  sealSocialSecret, openSocialSecret, socialTransport, socialSecretId,
  upsertSocialConnection, listPublishRecords, socialConnectionView,
  SOCIAL_PUBLISH_STATUSES, tSocial,
} from '../src/social';

/* ---------------- fakes: D1 + fetch, no real network ---------------- */

const TENANT = 't'.repeat(32), USER = 'user-1';
const actor = { tenantId: TENANT, userId: USER };
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

function fakeDb(role = 'owner') {
  const connections: any[] = [];
  const records: any[] = [];
  const rate = new Map<string, number>();
  const norm = (sql: string) => sql.replace(/\s+/g, ' ');
  const prepare = (sql: string) => {
    const s = norm(sql);
    return {
      bind: (...args: any[]) => {
        const bound: any = { __sql: s, __args: args };
        if (s.includes('agent_memberships')) {
          bound.first = async () => ({ tenant_id: args[0], user_id: args[1], role, status: 'active', expires_at: null });
        } else if (s.includes('mayor_rate_limits')) {
          const key = args[0] as string;
          bound.run = async () => { rate.set(key, (rate.get(key) ?? 0) + 1); return { meta: { changes: 1 } }; };
        } else if (s.includes('INSERT INTO mayor_social_connections')) {
          const [id, tenantId, userId, provider, label, ciphertext, now] = args;
          bound.run = async () => {
            const existing = connections.find((c) => c.tenant_id === tenantId && c.user_id === userId && c.provider === provider);
            if (existing) Object.assign(existing, { label, status: 'connected', ciphertext, has_secret: 1, revision: existing.revision + 1, updated_at: now });
            else connections.push({ id, tenant_id: tenantId, user_id: userId, provider, label, status: 'connected', ciphertext, has_secret: 1, last_checked_at: null, last_check_status: null, revision: 1, created_at: now, updated_at: now });
            return { meta: { changes: 1 } };
          };
        } else if (s.includes('UPDATE mayor_social_connections')) {
          bound.run = async () => {
            if (s.includes("status='disconnected'")) {
              const [now, id, tenantId, userId, revision] = args;
              const row = connections.find((c) => c.id === id && c.tenant_id === tenantId && c.user_id === userId);
              if (!row || row.revision !== revision) return { meta: { changes: 0 } };
              Object.assign(row, { status: 'disconnected', ciphertext: '', has_secret: 0, revision: row.revision + 1, updated_at: now });
              return { meta: { changes: 1 } };
            }
            const [status, checkedAt, checkStatus, updatedAt, id, tenantId, userId] = args;
            const row = connections.find((c) => c.id === id && c.tenant_id === tenantId && c.user_id === userId);
            if (row) Object.assign(row, { status, last_checked_at: checkedAt, last_check_status: checkStatus, updated_at: updatedAt });
            return { meta: { changes: 1 } };
          };
        } else if (s.includes('FROM mayor_social_connections')) {
          const rows = () => connections.filter((c) => c.tenant_id === args[1] && c.user_id === args[2]);
          bound.first = async () => {
            if (s.includes('WHERE id=?')) return connections.find((c) => c.id === args[0]) ?? null;
            return connections.find((c) => c.tenant_id === args[0] && c.user_id === args[1] && c.provider === args[2]) ?? null;
          };
          bound.all = async () => ({ results: rows() });
        } else if (s.includes('INSERT INTO mayor_social_publish_records')) {
          bound.run = async () => {
            const [id, tenantId, userId, connectionId, provider, caption, mediaUrl, status, providerPostId, errorCode, note, createdAt] = args;
            records.push({ id, tenant_id: tenantId, user_id: userId, connection_id: connectionId, provider, caption, media_url: mediaUrl, status, provider_post_id: providerPostId, error_code: errorCode, note, created_at: createdAt });
            return { meta: { changes: 1 } };
          };
        } else if (s.includes('FROM mayor_social_publish_records')) {
          bound.first = async () => records.find((r) => r.id === args[0]) ?? null;
          bound.all = async () => ({ results: records.filter((r) => r.connection_id === args[0]).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, args[3]) });
        } else {
          bound.first = async () => null; bound.all = async () => ({ results: [] }); bound.run = async () => ({ meta: { changes: 0 } });
        }
        return bound;
      },
    };
  };
  const batch = async (stmts: any[]) => stmts.map((st) => {
    if (st.__sql.includes('mayor_rate_limits')) {
      const key = st.__args[0] as string;
      const count = (rate.get(key) ?? 0) + 1; rate.set(key, count);
      return { results: [{ count }] };
    }
    return { results: [] };
  });
  return { prepare, batch, connections, records };
}

const baseEnv = (db: ReturnType<typeof fakeDb>, extra: Record<string, string> = {}) => ({
  AGENT_DB: db, APP_ORIGIN: 'https://mayor.mehyar.us', TOKEN_ENCRYPTION_KEY: KEY,
  META_APP_ID: 'meta-app-id', META_APP_SECRET: 'meta-app-secret', ...extra,
}) as any;

function mockFetch(handler: (url: string, init?: any) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: any }> = [];
  const fn = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const { status = 200, body } = handler(String(url), init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const req = (method: string, path: string, body?: unknown) =>
  new Request(`https://mayor.mehyar.us${path}`, {
    method, headers: { 'content-type': 'application/json', origin: 'https://mayor.mehyar.us' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function seedConnection(db: ReturnType<typeof fakeDb>, env: any, provider: 'instagram' | 'facebook' | 'tiktok' | 'x' = 'instagram') {
  const sealed = await sealSocialSecret(env, actor, socialSecretId(provider), { accessToken: 'seed-token', providerUserId: 'u1' });
  return upsertSocialConnection(env, actor, provider, `${provider} — seed`, sealed);
}

const metaOk = () => mockFetch((url) => {
  if (url.includes('/oauth/access_token')) return { body: { access_token: 'tok', expires_in: 3600 } };
  if (url.includes('/me/accounts')) return { body: { data: [{ id: 'page1', name: 'Page', instagram_business_account: { id: 'ig1', username: 'biz' } }] } };
  if (url.endsWith('/me?fields=id,name,picture%7Burl%7D') || url.includes('/me?fields=')) return { body: { id: 'fb1', name: 'Biz' } };
  if (url.includes('/media_publish')) return { body: { id: 'igpost123' } };
  if (url.includes('/media') && !url.includes('media_publish')) {
    if (url.includes('/ig1/media?')) return { body: { data: [{ id: 'm1', caption: 'hello', media_type: 'IMAGE', permalink: 'https://ig/m1', timestamp: '2026-10-01T00:00:00Z' }] } };
    return { body: { id: 'container1' } };
  }
  return { body: { data: [] } };
});

/* ---------------- definitions & copy honesty ---------------- */

describe('social connector definitions', () => {
  it('defines exactly the four providers with complete connect cards', () => {
    const cards = socialConnectCards('en');
    expect(cards.map((c) => c.provider).sort()).toEqual(['facebook', 'instagram', 'tiktok', 'x']);
    for (const card of cards) {
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.enables.length).toBeGreaterThan(0);
      expect(card.permissions.length).toBeGreaterThan(0);
      expect(card.publishNote.length).toBeGreaterThan(0);
      expect(card.capabilities).toContain('profile_read');
      expect(card.capabilities).toContain('posts_read');
    }
    expect(isSocialProvider('instagram')).toBe(true);
    expect(isSocialProvider('myspace')).toBe(false);
  });
  it('copy makes no follower/virality/engagement promises and discloses test mode (items 11-12)', () => {
    const banned = ['guaranteed viral', 'go viral', 'fake followers', 'buy followers', 'grow your followers',
      'boost engagement', 'fake reviews', 'get rich', 'guaranteed reach', '10x your'];
    const texts = socialConnectCards('en').flatMap((c) => [c.enables, c.permissions, c.publishNote, tSocial('en', 'publish_test_badge')]);
    for (const text of texts) {
      for (const phrase of banned) expect(text.toLowerCase()).not.toContain(phrase);
    }
    for (const card of socialConnectCards('en')) {
      expect(card.publishNote.toLowerCase()).toContain('test mode');
      expect(card.publishNote.toLowerCase()).toContain('nothing is published');
    }
    expect(tSocial('en', 'publish_test_gated').toLowerCase()).toContain('simulated');
    expect(tSocial('en', 'publish_test_gated').toLowerCase()).toContain('nothing was sent');
  });
  it('orders cards per vertical and falls back for unknown verticals', () => {
    expect(orderedSocialCards('salon', 'en')[0].provider).toBe('instagram');
    expect(orderedSocialCards('plumbing_hvac', 'en')[0].provider).toBe('facebook');
    expect(orderedSocialCards('nope' as any, 'en')).toHaveLength(4);
    expect(orderedSocialCards(null, 'en')).toHaveLength(4);
  });
  it('threads the language param and falls back to English', () => {
    expect(tSocial('es', 'connectors_title')).toBe(tSocial('en', 'connectors_title'));
  });
});

/* ---------------- custody ---------------- */

describe('social secret custody', () => {
  it('round-trips a sealed secret and rejects a different actor', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const sealed = await sealSocialSecret(env, actor, 'c1', { accessToken: 'abc' });
    expect(await openSocialSecret<{ accessToken: string }>(env, actor, 'c1', sealed)).toEqual({ accessToken: 'abc' });
    await expect(openSocialSecret(env, { tenantId: TENANT, userId: 'other' }, 'c1', sealed)).rejects.toThrow();
    await expect(openSocialSecret(env, actor, 'c2', sealed)).rejects.toThrow();
  });
  it('fails closed without a vault key', async () => {
    const db = fakeDb(), env = baseEnv(db, { TOKEN_ENCRYPTION_KEY: undefined } as any);
    delete env.TOKEN_ENCRYPTION_KEY;
    await expect(sealSocialSecret(env, actor, 'c1', {})).rejects.toThrow();
  });
});

/* ---------------- publish gate: THE critical behavior ---------------- */

describe('publish gate', () => {
  it('defaults to closed: no env flag means no real publish', () => {
    const db = fakeDb();
    expect(publishEnabled(baseEnv(db))).toBe(false);
    expect(publishEnabled(baseEnv(db, { SOCIAL_PUBLISH_ENABLED: 'TRUE' }))).toBe(true);
    expect(publishEnabled(baseEnv(db, { SOCIAL_PUBLISH_ENABLED: ' true ' }))).toBe(true);
    expect(publishEnabled(baseEnv(db, { SOCIAL_PUBLISH_ENABLED: 'yes' }))).toBe(false);
  });

  it('gate closed: publish makes ZERO provider calls and records test_simulated, never sent', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const row = await seedConnection(db, env, 'instagram');
    const { fn, calls } = mockFetch(() => { throw new Error('must not be called'); });
    const outcome = await publishSocialPost(env, actor, row.id, { caption: 'hello world' }, fn);
    expect(calls).toHaveLength(0);
    expect(outcome.simulated).toBe(true);
    expect(outcome.record.status).toBe('test_simulated');
    expect(outcome.record.providerPostId).toBeNull();
    expect(outcome.record.note.toLowerCase()).toContain('simulated');
    const records = await listPublishRecords(env, actor, row.id);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('test_simulated');
    expect(records[0].provider_post_id).toBeNull();
  });

  it('gate open + provider accepts: records sent with the real provider post id', async () => {
    const db = fakeDb(), env = baseEnv(db, { SOCIAL_PUBLISH_ENABLED: 'true' });
    const row = await seedConnection(db, env, 'instagram');
    const { fn, calls } = metaOk();
    const outcome = await publishSocialPost(env, actor, row.id, { caption: 'hi', mediaUrl: 'https://cdn/x.jpg' }, fn);
    expect(calls.length).toBeGreaterThan(0);
    expect(outcome.simulated).toBe(false);
    expect(outcome.record.status).toBe('sent');
    expect(outcome.record.providerPostId).toBe('igpost123');
  });

  it('gate open + provider rejects: records failed, throws, never claims sent', async () => {
    const db = fakeDb(), env = baseEnv(db, { SOCIAL_PUBLISH_ENABLED: 'true' });
    const row = await seedConnection(db, env, 'instagram');
    const { fn } = mockFetch((url) => {
      if (url.includes('/me/accounts')) return { body: { data: [{ id: 'page1', instagram_business_account: { id: 'ig1' } }] } };
      if (url.includes('/media_publish')) return { status: 400, body: { error: { message: 'denied' } } };
      return { body: { id: 'container1' } };
    });
    await expect(publishSocialPost(env, actor, row.id, { caption: 'hi', mediaUrl: 'https://cdn/x.jpg' }, fn)).rejects.toThrow();
    const records = await listPublishRecords(env, actor, row.id);
    expect(records[0].status).toBe('failed');
    expect(records[0].error_code).toBeTruthy();
    expect(records[0].provider_post_id).toBeNull();
  });

  it('publish statuses are an honest closed set', () => {
    expect([...SOCIAL_PUBLISH_STATUSES].sort()).toEqual(['draft', 'failed', 'scheduled', 'sent', 'test_simulated']);
  });
});

/* ---------------- transports: mock-only parsing ---------------- */

describe('social transports (mocked)', () => {
  it('parses an Instagram profile and recent media', async () => {
    const { fn } = metaOk();
    const t = socialTransport('instagram');
    const profile = await t.profile({ accessToken: 'x' }, fn);
    expect(profile.providerUserId).toBe('ig1');
    const posts = await t.recentPosts({ accessToken: 'x' }, 5, fn);
    expect(posts[0]).toMatchObject({ id: 'm1', caption: 'hello' });
  });
  it('parses a TikTok profile and video list', async () => {
    const { fn, calls } = mockFetch((url) => {
      if (url.includes('/user/info/')) return { body: { data: { user: { open_id: 'oid1', display_name: 'Biz' } } } };
      return { body: { data: { videos: [{ id: 'v1', title: 'clip', create_time: 1700000000 }] } } };
    });
    const t = socialTransport('tiktok');
    expect((await t.profile({ accessToken: 'x' }, fn)).providerUserId).toBe('oid1');
    const posts = await t.recentPosts({ accessToken: 'x' }, 5, fn);
    expect(posts[0].id).toBe('v1');
    expect(calls.length).toBeGreaterThan(0);
  });
  it('parses an X profile and recent posts', async () => {
    const { fn } = mockFetch((url) => {
      if (url.includes('/users/me')) return { body: { data: { id: 'x1', username: 'biz', name: 'Biz' } } };
      return { body: { data: [{ id: 't1', text: 'hello' }] } };
    });
    const t = socialTransport('x');
    expect((await t.profile({ accessToken: 'x' }, fn)).username).toBe('biz');
    expect((await t.recentPosts({ accessToken: 'x' }, 5, fn))[0].id).toBe('t1');
  });
  it('builds provider authorize URLs without network', () => {
    const t = socialTransport('facebook');
    const url = t.authorizeUrl({ clientId: 'cid', redirectUri: 'https://mayor.mehyar.us/cb', state: 's', scopes: [] });
    expect(url).toContain('facebook.com');
    expect(url).toContain('client_id=cid');
  });
});

/* ---------------- routes ---------------- */

describe('social routes', () => {
  it('registerSocialRoutes registers and returns the handler; non-social paths return null', async () => {
    const app: { routes?: Record<string, any> } = {};
    const handler = registerSocialRoutes(app);
    expect(app.routes!.social).toBe(handler);
    expect(await handler(new Request('https://mayor.mehyar.us/api/businesses/abc/other'), baseEnv(fakeDb()), actor)).toBeNull();
  });

  it('GET /connectors lists four cards, gate closed, no connections yet', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const res = await handleSocialRequest(req('GET', `/api/businesses/${TENANT}/social/connectors`), env, actor);
    const body = await res!.json();
    expect(res!.status).toBe(200);
    expect(body.connectors).toHaveLength(4);
    expect(body.connectors.every((c: any) => c.connection === null)).toBe(true);
    expect(body.publishGateOpen).toBe(false);
    expect(body.publishTestBadge.toLowerCase()).toContain('test mode');
  });

  it('owner-only mutations: staff cannot initiate, owner can', async () => {
    const staffEnv = baseEnv(fakeDb('staff'));
    const denied = await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connect/initiate`, { provider: 'instagram' }), staffEnv, actor);
    expect(denied!.status).toBe(403);
    const ok = await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connect/initiate`, { provider: 'instagram' }), baseEnv(fakeDb()), actor);
    expect(ok!.status).toBe(200);
    const body = await ok!.json();
    expect(body.authorizeUrl).toContain('facebook.com');
    expect(body.authorizeUrl).toContain('meta-app-id');
  });

  it('initiate fails closed when the provider app is not configured', async () => {
    const env = baseEnv(fakeDb());
    delete env.META_APP_ID;
    const res = await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connect/initiate`, { provider: 'facebook' }), env, actor);
    expect(res!.status).toBe(503);
    expect((await res!.json()).error).toBe('social_provider_not_configured');
  });

  it('OAuth callback exchanges the code and stores a sealed connection (mocked)', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const init = await (await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connect/initiate`, { provider: 'instagram' }), env, actor))!.json();
    const state = new URL(init.authorizeUrl).searchParams.get('state')!;
    const { fn, calls } = metaOk();
    const cb = await handleSocialRequest(
      new Request(`https://mayor.mehyar.us/api/businesses/${TENANT}/social/connect/callback?code=abc&state=${encodeURIComponent(state)}`),
      env, actor, fn);
    expect(cb!.status).toBe(200);
    const body = await cb!.json();
    expect(body.connection.status).toBe('connected');
    expect(body.connection.provider).toBe('instagram');
    expect(body.connection.hasSecret).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    // ciphertext in DB is sealed, not the raw token
    expect(JSON.stringify(db.connections)).not.toContain('tok');
  });

  it('OAuth callback rejects a tampered state', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const { fn } = metaOk();
    const cb = await handleSocialRequest(
      new Request(`https://mayor.mehyar.us/api/businesses/${TENANT}/social/connect/callback?code=abc&state=tampered`),
      env, actor, fn);
    expect(cb!.status).toBe(400);
    expect((await cb!.json()).error).toBe('social_oauth_state_invalid');
  });

  it('read-only profile/posts use the mock transport and redact tokens', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const row = await seedConnection(db, env, 'instagram');
    const { fn, calls } = metaOk();
    const profile = await (await handleSocialRequest(
      req('GET', `/api/businesses/${TENANT}/social/connections/${row.id}/profile`), env, actor, fn))!.json();
    expect(profile.profile.providerUserId).toBe('ig1');
    expect(JSON.stringify(profile)).not.toContain('seed-token');
    const posts = await (await handleSocialRequest(
      req('GET', `/api/businesses/${TENANT}/social/connections/${row.id}/posts?limit=5`), env, actor, fn))!.json();
    expect(posts.posts[0].id).toBe('m1');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('health check: reachable stays connected; failure flips to error with reconnect card', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const row = await seedConnection(db, env, 'instagram');
    const okT = metaOk();
    const ok = await (await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connections/${row.id}/check`, {}), env, actor, okT.fn))!.json();
    expect(ok.connection.status).toBe('connected');
    expect(ok.connection.lastCheckStatus).toBe('reachable');
    expect(ok.connection.reconnectRequired).toBe(false);
    const badT = mockFetch(() => ({ status: 500, body: { error: 'down' } }));
    const bad = await (await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connections/${row.id}/check`, {}), env, actor, badT.fn))!.json();
    expect(bad.connection.status).toBe('error');
    expect(bad.connection.reconnectRequired).toBe(true);
  });

  it('disconnect is revision-guarded and wipes the secret', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const row = await seedConnection(db, env, 'x');
    const view0 = socialConnectionView(row);
    const bad = await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connections/${row.id}/disconnect`, { revision: 999 }), env, actor);
    expect(bad!.status).toBe(409);
    const good = await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connections/${row.id}/disconnect`, { revision: view0.revision }), env, actor);
    expect((await good!.json()).status).toBe('disconnected');
    expect(db.connections[0].ciphertext).toBe('');
    expect(db.connections[0].has_secret).toBe(0);
  });

  it('route publish stays test-gated by default and records honestly', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const row = await seedConnection(db, env, 'tiktok');
    const { fn, calls } = mockFetch(() => { throw new Error('must not be called'); });
    const res = await handleSocialRequest(
      req('POST', `/api/businesses/${TENANT}/social/connections/${row.id}/publish`, { caption: 'test post' }), env, actor, fn);
    const body = await res!.json();
    expect(res!.status).toBe(200);
    expect(body.gateOpen).toBe(false);
    expect(body.publish.simulated).toBe(true);
    expect(body.publish.record.status).toBe('test_simulated');
    expect(calls).toHaveLength(0);
    const hist = await (await handleSocialRequest(
      req('GET', `/api/businesses/${TENANT}/social/connections/${row.id}/publish-records`), env, actor))!.json();
    expect(hist.records).toHaveLength(1);
    expect(hist.records[0].status).toBe('test_simulated');
  });

  it('unknown social action returns a clean 404, unknown connection a 404', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const res = await handleSocialRequest(req('GET', `/api/businesses/${TENANT}/social/nope`), env, actor);
    expect(res!.status).toBe(404);
    const missing = await handleSocialRequest(
      req('GET', `/api/businesses/${TENANT}/social/connections/12345678-1234-1234-1234-123456789012/profile`), env, actor);
    expect(missing!.status).toBe(404);
  });

  it('unauthenticated requests get a 401 without an actor', async () => {
    const db = fakeDb(), env = baseEnv(db);
    const res = await handleSocialRequest(req('GET', `/api/businesses/${TENANT}/social/connectors`), env);
    expect(res!.status).toBe(401);
  });
});
