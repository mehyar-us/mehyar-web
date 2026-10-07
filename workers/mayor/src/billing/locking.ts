import {HttpError} from '../http';
import type {BillingEnv} from './stripe';
import type {BillingMode} from './plans';
export async function acquireLease(env:Pick<BillingEnv,'AGENT_DB'>,tenantId:string,selected:BillingMode){
 const token=crypto.randomUUID(),now=Date.now();
 const result=await env.AGENT_DB.prepare(`INSERT INTO mayor_billing_leases(tenant_id,mode,token,expires_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,mode) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE expires_at<=?`).bind(tenantId,selected,token,now+120000,now).run();
 if(!result.meta.changes)throw new HttpError(503,'billing_busy','Billing is being updated. Try again shortly.');return token;
}
export async function commitLease(env:Pick<BillingEnv,'AGENT_DB'>,tenantId:string,selected:BillingMode,token:string,effects:D1PreparedStatement[]){
 // A NOT NULL fence rolls back the entire batch if another worker acquired the expired lease.
 const fence=env.AGENT_DB.prepare(`INSERT INTO mayor_billing_fences(token,verified_token) VALUES(?,(SELECT token FROM mayor_billing_leases WHERE tenant_id=? AND mode=? AND token=? AND expires_at>?))`).bind(token,tenantId,selected,token,Date.now());
 await env.AGENT_DB.batch([fence,...effects,env.AGENT_DB.prepare('DELETE FROM mayor_billing_fences WHERE token=?').bind(token),env.AGENT_DB.prepare('DELETE FROM mayor_billing_leases WHERE tenant_id=? AND mode=? AND token=?').bind(tenantId,selected,token)]);
}
export async function releaseLease(env:Pick<BillingEnv,'AGENT_DB'>,tenantId:string,selected:BillingMode,token:string){await env.AGENT_DB.prepare('DELETE FROM mayor_billing_leases WHERE tenant_id=? AND mode=? AND token=?').bind(tenantId,selected,token).run();}
