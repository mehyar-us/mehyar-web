import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env as testEnv } from "cloudflare:workers";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import worker from "../src";
import type { Env } from "../src/env";
import { handleAuthRequest, getSession, createAuth } from "../src/auth";
import { capabilityStatus, grantedCapabilities, scopesForSelection, type AuthEnv } from "../src/auth/capabilities";
import { decryptCredential, encryptCredential, mergeCredential, attachUnassignedGrant, storeProviderGrant, type CredentialBinding } from "../src/auth/vault";
import {grantAccountEmail} from '../src/auth/grant-label';

const origin = "https://agent.example.test";
const key = btoa("12345678901234567890123456789012"); // Test fixture, never deployment configuration.
const binding: CredentialBinding = { userId: "user-a", provider: "google", accountId: "google-a", tenantId: "tenant-a" };
let env: AuthEnv;

beforeAll(async () => {
  env = {
    AGENT_DB: (testEnv as unknown as AuthEnv).AGENT_DB,
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: "fixture-secret-ZmU5T8o2L1b6Q4n0R9p3K7v5",
    GOOGLE_CLIENT_ID: "fixture-google-client",
    GOOGLE_CLIENT_SECRET: "fixture-google-secret",
    MICROSOFT_CLIENT_ID: "fixture-ms-client",
    MICROSOFT_CLIENT_SECRET: "fixture-ms-secret",
    TOKEN_ENCRYPTION_KEY: key,
    GOOGLE_ENABLED_CAPABILITIES: "gmail_read,gmail_send,calendar_read,calendar_manage",
  };
}, 30000);
afterEach(() => { vi.restoreAllMocks(); });

function request(path: string, body?: unknown, cookie?: string) {
  return new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", "cf-connecting-ip": "192.0.2.1", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookies(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).filter((cookie) => !cookie.endsWith("=")).join("; ");
}

describe("explicit provider scope selection", () => {
  it("defaults to identity-only and never enables mail merely because Google is configured", () => {
    expect(scopesForSelection(env, "google", [])).toEqual([]);
    const status = capabilityStatus({ ...env, GOOGLE_ENABLED_CAPABILITIES: undefined });
    expect(status.providers.google.configured).toBe(true);
    expect(status.providers.google.capabilities.every((capability) => !capability.enabled)).toBe(true);
    expect(() => scopesForSelection(env, "google", ["drive_read"])).toThrow("capability_unavailable");
    expect(() => scopesForSelection(env, "google", ["https://mail.google.com/"])).toThrow("unknown_capability");
  });
  it("uses actual grants and does not infer sending from requested read permission", () => {
    expect(grantedCapabilities("google", ["https://www.googleapis.com/auth/gmail.readonly"], ["gmail_read", "gmail_send"])).toEqual(["gmail_read"]);
    expect(grantedCapabilities("google", [], ["gmail_read"])).toEqual([]);
  });
  it("does not silently add Microsoft mail or offline scopes to identity-only signup", async () => {
    const response = await handleAuthRequest(request("/api/auth/start/microsoft", { capabilities: [] }), env);
    const url = new URL((await response.json() as { url: string }).url);
    expect(url.searchParams.get("scope")!.split(" ")).toEqual(["openid", "profile", "email"]);
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const selected = scopesForSelection({ ...env, MICROSOFT_ENABLED_CAPABILITIES: "calendar_manage" }, "microsoft", ["calendar_manage"]);
    expect(selected).toEqual(["Calendars.ReadWrite", "offline_access"]);
  });
  it("blocks browser credential APIs, alternate path spellings, and raw scope entrypoints", async () => {
    for (const path of ["/get-access-token", "/refresh-token", "/account-info", "//get-access-token", "/get-access-token/", "/sign-in/social", "/link-social"]) {
      const response = await handleAuthRequest(request("/api/auth" + path, { provider: "google", scopes: ["https://mail.google.com/"] }), env);
      expect(response.status).toBe(404);
    }
    const untrusted = new Request(origin + "/api/auth/start/google", { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}" });
    expect((await handleAuthRequest(untrusted, env)).status).toBe(403);
  });
  it("bounds OAuth bodies by streamed UTF-8 bytes before parsing or creating state", async () => {
    const response = await handleAuthRequest(request("/api/auth/start/google", { capabilities: [], padding: "💼".repeat(1500) }), env);
    expect(response.status).toBe(413);
  });
});

describe("tenant-bound encrypted token custody", () => {
  it('exposes only the bound provider email and hides invalid, swapped or revoked labels',async()=>{
    const scoped={...binding,tenantId:null};
    const ciphertext=await encryptCredential({accountEmail:'business@example.test',accessToken:'never-expose-access',refreshToken:'never-expose-refresh',grantedScopes:[]},scoped,key);
    expect(await grantAccountEmail(env,scoped,ciphertext,'authorized')).toBe('business@example.test');
    expect(await grantAccountEmail(env,{...scoped,accountId:'other-account'},ciphertext,'authorized')).toBeNull();
    expect(await grantAccountEmail(env,scoped,ciphertext,'revoked')).toBeNull();
    const invalid=await encryptCredential({accountEmail:'invalid\nlabel',accessToken:'private',grantedScopes:[]},scoped,key);
    expect(await grantAccountEmail(env,scoped,invalid,'authorized')).toBeNull();
  });
  it("encrypts tokens and authenticates tenant, owner, provider and account identity", async () => {
    const credential = { accountEmail: "mailbox@example.test", accessToken: "secret-access", refreshToken: "secret-refresh", grantedScopes: ["scope-a"] };
    const encrypted = await encryptCredential(credential, binding, key);
    expect(encrypted).not.toContain("secret");
    expect(await decryptCredential(encrypted, binding, key)).toEqual(credential);
    for (const other of [{ ...binding, tenantId: "tenant-b" }, { ...binding, userId: "user-b" }, { ...binding, accountId: "google-b" }]) {
      await expect(decryptCredential(encrypted, other, key)).rejects.toThrow();
    }
    const parts = encrypted.split(".");
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    await expect(decryptCredential(parts.join("."), binding, key)).rejects.toThrow();
    await expect(encryptCredential(credential, binding, btoa("short"))).rejects.toThrow("invalid_token_encryption_key");
  });
  it("preserves an omitted refresh token while dropping permissions missing from the new actual grant", () => {
    expect(mergeCredential({ accountEmail: "mailbox@example.test", accessToken: "old", refreshToken: "keep", grantedScopes: ["read", "send"] }, { accountEmail: "mailbox@example.test", accessToken: "new", grantedScopes: ["read"] }))
      .toMatchObject({ accessToken: "new", refreshToken: "keep", grantedScopes: ["read"] });
  });
});

describe("Better Auth 1.7.5 with real local D1 and signed provider fixtures", () => {
  it("persists expiring state and emits only selected scopes with PKCE and nonce", async () => {
    const response = await handleAuthRequest(request("/api/auth/start/google", { capabilities: ["gmail_read", "gmail_send"] }), env);
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    const url = new URL(body.url);
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")!.length).toBeGreaterThan(20);
    expect(url.searchParams.get("redirect_uri")).toBe(origin + "/api/auth/callback/google");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const state = await env.AGENT_DB.prepare("SELECT value FROM auth_verification WHERE identifier = ?").bind(url.searchParams.get("state")).first<{ value: string }>();
    expect(state).not.toBeNull();
    expect(JSON.parse(state!.value).serverContext.mehyar.selected).toEqual(["gmail_read", "gmail_send"]);
    expect(cookies(response)).not.toContain("account_data");
  });

  it("verifies incremental consent, preserves identity refresh tokens, and enforces attachment and revocation boundaries", async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(keys.publicKey), kid: "fixture-key", alg: "RS256", use: "sig" };
    let refreshToken: string | undefined = "provider-refresh-private";
    let idToken = "";
    let grantedScope = "openid email profile";
    let wrongNonce = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "provider-access-private", refresh_token: refreshToken, id_token: idToken, token_type: "Bearer", expires_in: 3600, scope: grantedScope }), { headers: { "content-type": "application/json" } });
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
      throw new Error("unexpected_external_request");
    });
    async function authorize(cookie?: string, capabilities = ["gmail_read", "gmail_send"], identity = { email: "owner@example.test", subject: "google-fixture-owner" }) {
      const start = await handleAuthRequest(request("/api/auth/start/google", { capabilities }, cookie), env);
      expect(start.status).toBe(200);
      const url = new URL((await start.json() as { url: string }).url);
      idToken = await new SignJWT({ email: identity.email, email_verified: true, name: "Fixture Owner", nonce: wrongNonce ? "not-the-request-nonce" : url.searchParams.get("nonce") })
        .setProtectedHeader({ alg: "RS256", kid: "fixture-key" }).setIssuer("https://accounts.google.com").setAudience("fixture-google-client").setSubject(identity.subject).setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
      const callback = new Request(origin + "/api/auth/callback/google?code=fixture-code&state=" + encodeURIComponent(url.searchParams.get("state")!), { headers: { cookie: [cookie, cookies(start)].filter(Boolean).join("; ") } });
      return handleAuthRequest(callback, env);
    }
    const callback = await authorize(undefined, []);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(origin + "/?connected=google");
    const sessionCookie = cookies(callback);
    const session = await getSession(request("/api/session", undefined, sessionCookie), env);
    expect(session?.user.email).toBe("owner@example.test");
    const account = await env.AGENT_DB.prepare("SELECT accessToken, refreshToken, idToken FROM auth_account WHERE accountId = ?").bind("google-fixture-owner").first<{ accessToken: string; refreshToken: string; idToken: string | null }>();
    expect(account!.accessToken).not.toContain("provider-access-private");
    expect(account!.refreshToken).not.toContain("provider-refresh-private");
    expect(account!.idToken).toBeNull();
    expect(await env.AGENT_DB.prepare("SELECT id FROM auth_provider_grants WHERE user_id = ?").bind(session!.user.id).first()).toBeNull();
    refreshToken = undefined;
    grantedScope += " https://www.googleapis.com/auth/gmail.readonly";
    const incremental = await authorize(sessionCookie);
    expect(incremental.headers.get("location")).toBe(origin + "/?connected=google");
    const grant = await env.AGENT_DB.prepare("SELECT * FROM auth_provider_grants WHERE user_id = ? AND tenant_scope = ''").bind(session!.user.id).first<{ id: string; ciphertext: string; granted_scopes: string }>();
    expect(JSON.parse(grant!.granted_scopes)).not.toContain("https://www.googleapis.com/auth/gmail.send");
    expect(grant!.ciphertext).not.toContain("provider-access-private");
    expect((await authorize(sessionCookie)).headers.get("location")).toBe(origin + "/?connected=google");
    const updated = await env.AGENT_DB.prepare("SELECT ciphertext FROM auth_provider_grants WHERE id = ?").bind(grant!.id).first<{ ciphertext: string }>();
    expect((await decryptCredential(updated!.ciphertext, { userId: session!.user.id, provider: "google", accountId: "google-fixture-owner", tenantId: null }, key)).refreshToken).toBe("provider-refresh-private");
    await expect(attachUnassignedGrant(env, session!.user.id, grant!.id, "unowned-tenant")).rejects.toThrow("tenant_connection_forbidden");
    const now = new Date().toISOString();
    await env.AGENT_DB.prepare("INSERT INTO agent_tenants(id,name,website,goal,agent_name,status,plan_id,owner_id,created_at,updated_at,trial_expires_at) VALUES (?, 'Fixture', 'https://example.test', 'test', 'Agent', 'trial', 'trial', ?, ?, ?, ?)")
      .bind("owned-tenant", session!.user.id, now, now, now).run();
    await env.AGENT_DB.prepare("INSERT INTO agent_memberships (tenant_id,user_id,role,status,created_at) VALUES (?, ?, 'owner', 'active', ?)").bind("owned-tenant", session!.user.id, now).run();
    const attached = await attachUnassignedGrant(env, session!.user.id, grant!.id, "owned-tenant");
    const attachedRow = await env.AGENT_DB.prepare("SELECT ciphertext FROM auth_provider_grants WHERE id = ?").bind(attached.id).first<{ ciphertext: string }>();
    await expect(decryptCredential(attachedRow!.ciphertext, { userId: session!.user.id, provider: "google", accountId: "google-fixture-owner", tenantId: "other-tenant" }, key)).rejects.toThrow();
    const metadata = await handleAuthRequest(request("/api/auth/grants", undefined, sessionCookie), env);
    const metadataText = await metadata.text();
    expect(metadataText).not.toContain("ciphertext");
    expect(metadataText).not.toContain("provider-refresh-private");
    expect(JSON.parse(metadataText).grants.every((item:{accountEmail:string})=>item.accountEmail==='owner@example.test')).toBe(true);
    expect(JSON.parse(metadataText).grants.every((item: { status: string }) => item.status === "authorized")).toBe(true);
    await env.AGENT_DB.prepare("UPDATE agent_memberships SET expires_at = '2000-01-01T00:00:00.000Z' WHERE tenant_id = 'owned-tenant'").run();
    const restricted=await handleAuthRequest(request('/api/auth/grants',undefined,sessionCookie),env);
    expect((await restricted.json() as {grants:{id:string;accountEmail:string|null}[]}).grants.find(item=>item.id===attached.id)?.accountEmail).toBeNull();
    await expect(attachUnassignedGrant(env, session!.user.id, grant!.id, "owned-tenant")).rejects.toThrow("tenant_connection_forbidden");
    await env.AGENT_DB.prepare("UPDATE agent_memberships SET expires_at = NULL WHERE tenant_id = 'owned-tenant'").run();
    await env.AGENT_DB.prepare("UPDATE agent_tenants SET status = 'deleted' WHERE id = 'owned-tenant'").run();
    await expect(attachUnassignedGrant(env, session!.user.id, grant!.id, "owned-tenant")).rejects.toThrow("tenant_connection_forbidden");
    await env.AGENT_DB.prepare("UPDATE agent_tenants SET status = 'trial' WHERE id = 'owned-tenant'").run();
    const revoke = await handleAuthRequest(request("/api/auth/grants/revoke", { grantId: attached.id, tenantId: "owned-tenant" }, sessionCookie), env);
    expect(await revoke.json()).toMatchObject({ status: "revoked", providerRevoked: false });
    const revoked = await env.AGENT_DB.prepare("SELECT ciphertext, granted_scopes FROM auth_provider_grants WHERE id = ?").bind(attached.id).first<{ ciphertext: string; granted_scopes: string }>();
    expect(revoked).toMatchObject({ ciphertext: "", granted_scopes: "[]" });
    expect((await getSession(request("/api/session", undefined, sessionCookie), env))?.user.id).toBe(session!.user.id);
    await handleAuthRequest(request("/api/auth/grants/revoke", { grantId: grant!.id }, sessionCookie), env);
    await expect(attachUnassignedGrant(env, session!.user.id, grant!.id, "owned-tenant")).rejects.toThrow("grant_not_found");

    // Cross-layer fixture: genuine signed OAuth session through the public Worker,
    // D1 membership creation, dedicated Durable Object, memory and immediate revocation.
    const workerEnv = { ...testEnv, ...env } as unknown as Env;
    const createRequest = request("/api/tenants", { name: "OAuth Fixture Salon", website: "https://example.com", goal: "Schedule appointments" }, sessionCookie);
    createRequest.headers.set("x-idempotency-key", crypto.randomUUID());
    const createdResponse = await worker.fetch(createRequest, workerEnv);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { tenant: { id: string } };
    const tenantPath = `/api/tenants/${created.tenant.id}`;
    const snapshot = await worker.fetch(request(tenantPath, undefined, sessionCookie), workerEnv);
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ membership: { role: "owner" }, memory: [] });
    const usageResponse=await worker.fetch(request(tenantPath+'/usage',undefined,sessionCookie),workerEnv);
    const jobsPath=tenantPath+'/mailbox-analysis/section-jobs',jobId=crypto.randomUUID();
    const jobDirectory=await worker.fetch(request(jobsPath,undefined,sessionCookie),workerEnv);
    expect(await jobDirectory.json()).toEqual({jobs:[]});expect(jobDirectory.headers.get('cache-control')).toContain('no-store');
    expect((await worker.fetch(request(jobsPath),workerEnv)).status).toBe(401);
    expect((await worker.fetch(request(jobsPath+'?after=invalid',undefined,sessionCookie),workerEnv)).status).toBe(400);
    expect((await worker.fetch(request(jobsPath+'/'+jobId,undefined,sessionCookie),workerEnv)).status).toBe(404);
    expect((await worker.fetch(request(jobsPath+'/'+jobId+'/cancel',{},sessionCookie),workerEnv)).status).toBe(404);
    expect((await worker.fetch(request(jobsPath,{offerId:jobId},sessionCookie),workerEnv)).status).toBe(400);
    const backgroundApproval={version:1,maximumHours:24,includesAggregation:false};
    expect((await worker.fetch(request(jobsPath,{offerId:jobId,backgroundApproval:{...backgroundApproval,includesAggregation:true}},sessionCookie),workerEnv)).status).toBe(400);
    const backgroundDisabled=await worker.fetch(request(jobsPath,{offerId:jobId,backgroundApproval},sessionCookie),workerEnv);
    expect(backgroundDisabled.status).toBe(503);expect(await backgroundDisabled.json()).toMatchObject({error:{code:'background_analysis_disabled'}});
    const foreignBackground=request(jobsPath,{offerId:jobId,backgroundApproval},sessionCookie);foreignBackground.headers.set('origin','https://attacker.example');
    expect((await worker.fetch(foreignBackground,workerEnv)).status).toBe(403);
    expect((await worker.fetch(request(jobsPath.replace(created.tenant.id,'another-business'),undefined,sessionCookie),workerEnv)).status).toBe(404);
    await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=? AND user_id=?").bind(created.tenant.id,session!.user.id).run();
    expect((await worker.fetch(request(jobsPath,undefined,sessionCookie),workerEnv)).status).toBe(403);
    expect((await worker.fetch(request(jobsPath,{offerId:jobId,backgroundApproval},sessionCookie),workerEnv)).status).toBe(403);
    await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='owner' WHERE tenant_id=? AND user_id=?").bind(created.tenant.id,session!.user.id).run();
    const reviewPath=tenantPath+'/connections/'+crypto.randomUUID()+'/mailbox/review-messages';
    expect((await worker.fetch(request(reviewPath),workerEnv)).status).toBe(401);
    const missingMailbox=await worker.fetch(request(reviewPath,undefined,sessionCookie),workerEnv);
    expect(missingMailbox.status).toBe(403);expect(missingMailbox.headers.get('cache-control')).toContain('no-store');
    expect((await worker.fetch(request(reviewPath+'?after=malformed',undefined,sessionCookie),workerEnv)).status).toBe(400);
    expect((await worker.fetch(request(reviewPath.replace(created.tenant.id,'another-business'),undefined,sessionCookie),workerEnv)).status).toBe(404);
    for(const route of ['sections/review','sections/confirm','aggregation/review','aggregation/confirm']){
      const path=tenantPath+'/mailbox-analysis/'+route;
      expect((await worker.fetch(request(path,{},sessionCookie),workerEnv)).status).toBe(400);
      expect((await worker.fetch(request(path,{}),workerEnv)).status).toBe(401);
      const crossOrigin=request(path,{},sessionCookie);crossOrigin.headers.set('origin','https://attacker.example');
      expect((await worker.fetch(crossOrigin,workerEnv)).status).toBe(403);
      expect((await worker.fetch(request('/api/tenants/another-business/mailbox-analysis/'+route,{},sessionCookie),workerEnv)).status).toBe(404);
      expect((await worker.fetch(request(path,undefined,sessionCookie),workerEnv)).status).toBe(404);
      const input=route.endsWith('/review')?{streamId:'fixture',messageId:'fixture',receipt:crypto.randomUUID()}:
        {offerId:crypto.randomUUID(),...(route.startsWith('sections/')?{sectionIndex:0}:{})};
      expect((await worker.fetch(request(path,{...input,textCredits:0},sessionCookie),workerEnv)).status).toBe(400);
      const unavailable=await worker.fetch(request(path,input,sessionCookie),workerEnv);
      expect(unavailable.status).toBe(route.endsWith('/confirm')?409:503);
      expect(unavailable.headers.get('cache-control')).toContain('no-store');
      expect(await unavailable.json()).toMatchObject({error:{code:route.endsWith('/confirm')?
        (route.startsWith('sections/')?'section_offer_expired':'aggregation_offer_expired'):
        (route.startsWith('sections/')?'mailbox_sync_disabled':'extended_triage_disabled')}});
    }
    expect(usageResponse.status).toBe(200);expect(usageResponse.headers.get('cache-control')).toContain('no-store');
    expect(await usageResponse.json()).toMatchObject({usage:{period:'trial',textCredits:{used:0,reserved:0,limit:50}}});
    expect((await worker.fetch(request('/api/tenants/another-business/usage',undefined,sessionCookie),workerEnv)).status).toBe(404);
    const researchResponse=await worker.fetch(request(tenantPath+'/research',undefined,sessionCookie),workerEnv);
    expect(researchResponse.status).toBe(200);expect(researchResponse.headers.get('cache-control')).toContain('no-store');
    expect(await researchResponse.json()).toEqual({jobs:[],nextOffset:null});
    const researchRequest=request(tenantPath+'/research',{url:'https://salon.example.com/'},sessionCookie);researchRequest.headers.set('x-idempotency-key',crypto.randomUUID());
    const researchDisabled=await worker.fetch(researchRequest,workerEnv);expect(researchDisabled.status).toBe(503);
    expect(await researchDisabled.json()).toMatchObject({error:{code:'research_disabled'}});
    expect((await worker.fetch(request(tenantPath+'/research?offset=-1',undefined,sessionCookie),workerEnv)).status).toBe(400);
    expect((await worker.fetch(request('/api/tenants/another-business/research',undefined,sessionCookie),workerEnv)).status).toBe(404);
    expect((await worker.fetch(request(tenantPath+'/research/'+crypto.randomUUID(),undefined,sessionCookie),workerEnv)).status).toBe(404);
    expect((await worker.fetch(request(tenantPath+'/research'),workerEnv)).status).toBe(401);
    const memory = await worker.fetch(request(tenantPath + "/memory", { key: "Hours", value: "Monday through Friday" }, sessionCookie), workerEnv);
    expect(memory.status).toBe(201);
    const actionGrant = await storeProviderGrant(env,{userId:session!.user.id,tenantId:created.tenant.id,provider:'google',accountId:'review-fixture'},
      {accountEmail:'owner@example.test',accessToken:'private-action-fixture',refreshToken:'private-refresh-fixture',
        grantedScopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send']},['gmail_read','gmail_send']);
    const policyRequest={id:crypto.randomUUID(),expectedVersion:0,name:'Customer reply',trigger:'Owner request',operation:'mail.reply',provider:'google',grantId:actionGrant,
      mode:'approve',resources:['fixture-thread'],recipients:['customer@example.test'],startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),
      maxActionsPerDay:3,maxCostMicrosPerDay:0,escalation:'Ask the owner',enabled:true};
    const savedPolicy=await worker.fetch(request(tenantPath+'/action-policies',policyRequest,sessionCookie),workerEnv);
    expect(savedPolicy.status).toBe(200);
    const proposalRequest=request(tenantPath+'/actions',{policyId:policyRequest.id,policyVersion:1,
      action:{operation:'mail.reply',resourceId:'fixture-thread',messageId:'fixture-message',recipient:'customer@example.test',text:'Here is the reviewed draft.'}},sessionCookie);
    proposalRequest.headers.set('x-idempotency-key',crypto.randomUUID());
    const proposalResponse=await worker.fetch(proposalRequest,workerEnv);
    expect(proposalResponse.status).toBe(201);
    const {action}=await proposalResponse.json() as {action:{id:string;actionHash:string}};
    const decisionPath=tenantPath+'/actions/'+action.id+'/decision';
    const wrongOrigin=request(decisionPath,{decision:'approve',actionHash:action.actionHash},sessionCookie);
    wrongOrigin.headers.set('origin','https://unrelated.example');
    expect((await worker.fetch(wrongOrigin,workerEnv)).status).toBe(403);
    const accepted=await worker.fetch(request(decisionPath,{decision:'approve',actionHash:action.actionHash},sessionCookie),workerEnv);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({action:{status:'approved',executionAvailable:false}});
    const disabledExecution=await worker.fetch(request(tenantPath+'/actions/'+action.id+'/execute',{actionHash:action.actionHash},sessionCookie),workerEnv);
    expect(disabledExecution.status).toBe(503);
    expect(await disabledExecution.json()).toMatchObject({error:{code:'execution_disabled'}});
    const reviewed=await worker.fetch(request(tenantPath+'/actions/'+action.id,undefined,sessionCookie),workerEnv);
    expect(await reviewed.json()).toMatchObject({action:{decisions:[{decision:'approved'}]}});
    const paused = await worker.fetch(request(tenantPath + "/pause", { paused: true }, sessionCookie), workerEnv);
    expect(paused.status).toBe(200);
    expect(await (await worker.fetch(request(tenantPath, undefined, sessionCookie), workerEnv)).json()).toMatchObject({ usage: { paused: true }, memory: [{ key: "Hours" }] });
    await env.AGENT_DB.prepare("UPDATE agent_memberships SET status = 'revoked' WHERE tenant_id = ? AND user_id = ?").bind(created.tenant.id, session!.user.id).run();
    expect((await worker.fetch(request(tenantPath, undefined, sessionCookie), workerEnv)).status).toBe(404);

    // A separate work Google account must retain its own sender identity in the vault.
    refreshToken = "provider-work-refresh-private";
    const linked = await authorize(sessionCookie, ["gmail_read", "gmail_send"], { email: "work@example.test", subject: "google-work-fixture" });
    expect(linked.headers.get("location")).toBe(origin + "/?connected=google");
    const labels=await handleAuthRequest(request('/api/auth/grants',undefined,sessionCookie),env);
    const labelsText=await labels.text();expect(labelsText).toContain('work@example.test');expect(labelsText).not.toContain('owner@example.test');expect(labelsText).not.toContain('provider-work-refresh-private');
    const workGrant = await env.AGENT_DB.prepare("SELECT ciphertext FROM auth_provider_grants WHERE user_id = ? AND account_id = ? AND tenant_scope = ''")
      .bind(session!.user.id, "google-work-fixture").first<{ ciphertext: string }>();
    expect(await decryptCredential(workGrant!.ciphertext, { userId: session!.user.id, provider: "google", accountId: "google-work-fixture", tenantId: null }, key))
      .toMatchObject({ accountEmail: "work@example.test", refreshToken: "provider-work-refresh-private" });
    expect(workGrant!.ciphertext).not.toContain("work@example.test");
    await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='reconnect_required' WHERE user_id=? AND account_id=?")
      .bind(session!.user.id,'google-work-fixture').run();
    refreshToken=undefined;
    await authorize(sessionCookie,['gmail_read','gmail_send'],{email:'work@example.test',subject:'google-work-fixture'});
    const reconnectGrant=await env.AGENT_DB.prepare("SELECT ciphertext,status FROM auth_provider_grants WHERE user_id=? AND account_id=? AND tenant_scope=''")
      .bind(session!.user.id,'google-work-fixture').first<{ciphertext:string;status:string}>();
    expect(reconnectGrant!.status).toBe('reconnect_required');
    expect((await decryptCredential(reconnectGrant!.ciphertext,{userId:session!.user.id,provider:'google',accountId:'google-work-fixture',tenantId:null},key)).refreshToken).toBeUndefined();
    expect((await getSession(request("/api/session", undefined, sessionCookie), env))?.user.email).toBe("owner@example.test");
    wrongNonce = true;
    const mismatched = await authorize(sessionCookie);
    expect(mismatched.headers.get("location")).toContain("error=");
    expect(cookies(mismatched)).not.toContain("session_token");
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("rejects forged callback state without issuing a session", async () => {
    const response = await handleAuthRequest(request("/api/auth/callback/google?code=not-valid&state=not-issued"), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=");
    expect(cookies(response)).not.toContain("session_token");
  });

  it("never enables automatic same-email linking or browser account cookies", () => {
    const options = createAuth(env).options;
    expect(options.account?.accountLinking?.disableImplicitLinking).toBe(true);
    expect(options.account?.storeAccountCookie).toBe(false);
    expect(options.account?.encryptOAuthTokens).toBe(true);
  });
});
