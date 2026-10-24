import {env as testEnv} from 'cloudflare:workers';
import auditPageHtml from '../../web/business-audit.html?raw';
import {expect,it} from 'vitest';
import type {Env} from '../../src/env';
import worker from '../../src';
import {AUDIT_PAUSED_MESSAGE} from '../../src/billing/audit';

/* Rotation 633 (2026-10-24): the served /business-audit page renders
 * its paused line from the LIVE generation-pause signal — the same
 * MAYOR_AUDIT_GENERATION_PAUSED env read the offer endpoint answers
 * audit_paused from. Paused config → the line is in the served bytes
 * at the ask; no pause in config → the shipped placeholder stands
 * and the page makes no pause claim. Static-asset stub mirrors the
 * slice0-truth descriptor test's. */

const dbEnv=testEnv as unknown as Env;
const assets={fetch:async(request:Request)=>new Response(auditPageHtml,{headers:{'content-type':'text/html; charset=utf-8'}})};
function surfaceEnv(extra:Record<string,string>):Env{
 return {...dbEnv,MAYOR_STRIPE_MODE:'test',MAYOR_STRIPE_SECRET_KEY:'sk_test_fixture',MAYOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',MAYOR_STRIPE_PRICE_ID:'price_MayorPro',MAYOR_STRIPE_FOUNDING_PRICE_ID:'price_MayorFounding',MAYOR_STRIPE_PORTAL_CONFIGURATION:'bpc_Mayor',ASSETS:assets,...extra} as unknown as Env;
}

it('generation-paused: the served audit page states the pause at the ask',async()=>{
 const res=await worker.fetch(new Request('https://mayor.example.test/business-audit'),surfaceEnv({MAYOR_AUDIT_GENERATION_PAUSED:'true'}),{} as ExecutionContext);
 expect(res.status).toBe(200);
 const body=await res.text();
 expect(body).toContain(AUDIT_PAUSED_MESSAGE);
 expect(body).toContain('<p id="audit-availability" data-ssr="audit-state"');
 expect(body).not.toContain('Checking checkout availability…');
});

it('not paused: the served audit page makes no pause claim',async()=>{
 const res=await worker.fetch(new Request('https://mayor.example.test/business-audit'),surfaceEnv({}),{} as ExecutionContext);
 expect(res.status).toBe(200);
 const body=await res.text();
 expect(body).not.toContain(AUDIT_PAUSED_MESSAGE);
 expect(body).not.toContain('data-ssr="audit-state"');
 expect(body).toContain('Checking checkout availability…');
});

it('the /report surface shares the shell but not the line',async()=>{
 const res=await worker.fetch(new Request('https://mayor.example.test/business-audit/report'),surfaceEnv({MAYOR_AUDIT_GENERATION_PAUSED:'true'}),{} as ExecutionContext);
 expect(res.status).toBe(200);
 const body=await res.text();
 expect(body).not.toContain('data-ssr="audit-state"');
});
