import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {platformSenderConfiguration,requirePlatformSender,PLATFORM_EMAIL_GATES} from '../src/email/readiness';
function fixture():Env{return {...env,ENVIRONMENT:'staging',APP_ORIGIN:'https://app.mehyar.us',AGENT_PLATFORM_EMAIL_ENABLED:'true',AGENT_PLATFORM_EMAIL_FROM:'notices@example.test',AGENT_PLATFORM_EMAIL_ROUTE:`resend:${crypto.randomUUID()}`,AGENT_PLATFORM_RESEND_API_KEY:'re_synthetic_fixture'} as unknown as Env;}
async function evidence(e:Env){const config=await platformSenderConfiguration(e),now=Date.now();await e.AGENT_DB.batch(PLATFORM_EMAIL_GATES.map(gate=>e.AGENT_DB.prepare("INSERT INTO agent_platform_email_readiness(route_ref,gate,configuration_hash,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test-operator',?,?)").bind(config.routeRef,gate,config.configurationHash,new Date(now-1000).toISOString(),new Date(now+86400000).toISOString())));return config;}
describe('dedicated platform sender readiness',()=>{
  it('remains disabled before touching provider configuration or the database and never falls back to legacy keys',async()=>{
    const e={AGENT_PLATFORM_EMAIL_ENABLED:'false'} as Env;await expect(requirePlatformSender(e)).rejects.toMatchObject({code:'platform_email_disabled'});
    const legacy={...fixture(),AGENT_PLATFORM_RESEND_API_KEY:undefined,RESEND_API_KEY:'re_legacy',RESEND_FROM_EMAIL:'legacy@example.test'};await expect(requirePlatformSender(legacy)).rejects.toMatchObject({code:'platform_email_unconfigured'});
  });
  it('requires complete evidence bound to exact sender, credential, environment, route and origin',async()=>{
    const e=fixture();await expect(requirePlatformSender(e)).rejects.toMatchObject({code:'platform_email_not_ready'});
    const config=await evidence(e);expect(await requirePlatformSender(e)).toEqual(config);expect(JSON.stringify(config)).not.toContain(e.AGENT_PLATFORM_RESEND_API_KEY!);
    for(const change of [{AGENT_PLATFORM_EMAIL_FROM:'other@example.test'},{AGENT_PLATFORM_RESEND_API_KEY:'re_rotated'},{ENVIRONMENT:'production' as const},{AGENT_PLATFORM_EMAIL_ROUTE:'other'},{APP_ORIGIN:'https://other.mehyar.us'}])await expect(requirePlatformSender({...e,...change})).rejects.toMatchObject({code:'platform_email_not_ready'});
  });
  it('rejects revoked, empty, expired, future-dated or overly long evidence and unsafe origins',async()=>{
    for(const change of ["status='revoked'","evidence_ref=' '","verified_by=' '","valid_until='2000-01-01T00:00:00Z'","verified_at='2999-01-01T00:00:00Z'","valid_until='2999-01-01T00:00:00Z'"]){const e=fixture(),config=await evidence(e);await e.AGENT_DB.prepare(`UPDATE agent_platform_email_readiness SET ${change} WHERE route_ref=? AND gate=?`).bind(config.routeRef,PLATFORM_EMAIL_GATES[0]).run();await expect(requirePlatformSender(e)).rejects.toMatchObject({code:'platform_email_not_ready'});}
    for(const APP_ORIGIN of ['http://app.mehyar.us','https://app.mehyar.us/path','https://user:pass@app.mehyar.us','https://app.mehyar.us/?next=other'])await expect(platformSenderConfiguration({...fixture(),APP_ORIGIN})).rejects.toMatchObject({code:'platform_email_origin_unverified'});
  });
});
