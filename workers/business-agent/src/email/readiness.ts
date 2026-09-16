import {z} from 'zod';
import type {Env} from '../env';
import {CATALOG_VERSION} from '../catalog';
import {digest,HttpError} from '../http';
export const PLATFORM_EMAIL_GATES=['sender_domain_verified','credential_scope_verified','delivery_recovery_tested','suppression_tested','supplier_cost_limits_verified'] as const;
const settings=z.object({from:z.email().max(254),routeRef:z.string().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/),secret:z.string().regex(/^re_[A-Za-z0-9_-]+$/),environment:z.enum(['local','staging','production']),origin:z.url()});

/** Fingerprint for operator evidence; never exposes a provider credential. This
 * alone does not authorize sending or satisfy per-message quota/suppression checks. */
export async function platformSenderConfiguration(env:Env){
  const parsed=settings.safeParse({from:env.AGENT_PLATFORM_EMAIL_FROM,routeRef:env.AGENT_PLATFORM_EMAIL_ROUTE,secret:env.AGENT_PLATFORM_RESEND_API_KEY,environment:env.ENVIRONMENT,origin:env.APP_ORIGIN});
  if(!parsed.success)throw new HttpError(503,'platform_email_unconfigured','Platform email is not configured.');
  const data=parsed.data,origin=new URL(data.origin);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw new HttpError(503,'platform_email_origin_unverified','Platform email requires a verified app origin.');
  const configurationHash=await digest(JSON.stringify(['platform-email-v1',CATALOG_VERSION,data.environment,origin.origin,data.from,data.routeRef,await digest(data.secret)]));
  return {from:data.from,routeRef:data.routeRef,configurationHash};
}
/** Read-only release gate. Disabled before any database/credential work; purpose
 * is invitation email only until additional transactional flows are implemented. */
export async function requirePlatformSender(env:Env,now=new Date()){
  if(env.AGENT_PLATFORM_EMAIL_ENABLED!=='true')throw new HttpError(503,'platform_email_disabled','Invitation email delivery is not enabled.');
  const configuration=await platformSenderConfiguration(env),time=now.getTime();
  if(!Number.isFinite(time))throw new HttpError(503,'platform_email_not_ready','Invitation email verification is unavailable.');
  const rows=await env.AGENT_DB.prepare("SELECT gate,evidence_ref,verified_by,verified_at,valid_until FROM agent_platform_email_readiness WHERE route_ref=? AND configuration_hash=? AND status='verified'")
    .bind(configuration.routeRef,configuration.configurationHash).all<{gate:string;evidence_ref:string;verified_by:string;verified_at:string;valid_until:string}>();
  const verified=new Set(rows.results.filter(row=>{
    const start=Date.parse(row.verified_at),end=Date.parse(row.valid_until);
    return !!row.evidence_ref.trim()&&!!row.verified_by.trim()&&Number.isFinite(start)&&Number.isFinite(end)&&start<=time&&end>time&&end>start&&end-start<=30*86400000;
  }).map(row=>row.gate));
  if(PLATFORM_EMAIL_GATES.some(gate=>!verified.has(gate)))throw new HttpError(409,'platform_email_not_ready','Invitation email release checks are incomplete or expired.');
  return configuration;
}
