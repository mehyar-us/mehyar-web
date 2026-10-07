import type {Actor,Env} from './env';
import {HttpError} from './http';
import {requireMembership,OPERATORS} from './permissions';

/** Version of the recording-consent acknowledgement text. Bump when the text changes. */
export const RECORDING_CONSENT_VERSION=1;

export const RECORDING_CONSENT_TEXT=
 'I understand that phone calls handled by The Mayor may be recorded or transcribed. '+
 'I am responsible for complying with the call-recording consent laws that apply to my business, '+
 'including providing any required notices to callers and obtaining consent where the law requires it. '+
 'I will not enable call recording or transcription where it would violate applicable law.';

export interface RecordingConsentStatus{
 acknowledged:boolean;
 consentVersion:number;
 acknowledgedAt:string|null;
 acknowledgedBy:string|null;
}

/** Public status for the phone-setup checklist. Owner/manager only. */
export async function getRecordingConsent(env:Pick<Env,'AGENT_DB'>,actor:Actor):Promise<RecordingConsentStatus>{
 await requireMembership(env,actor,OPERATORS);
 const row=await env.AGENT_DB.prepare('SELECT consent_version,acknowledged_at,acknowledged_by FROM mayor_phone_recording_consent WHERE tenant_id=?')
  .bind(actor.tenantId).first<{consent_version:number;acknowledged_at:string;acknowledged_by:string}>();
 if(!row||row.consent_version!==RECORDING_CONSENT_VERSION)
  return {acknowledged:false,consentVersion:RECORDING_CONSENT_VERSION,acknowledgedAt:null,acknowledgedBy:null};
 return {acknowledged:true,consentVersion:row.consent_version,acknowledgedAt:row.acknowledged_at,acknowledgedBy:row.acknowledged_by};
}

/** Owner/manager acknowledges recording-consent duty. Blocks nothing by itself;
 * call admission refuses unacknowledged tenants via requireRecordingConsent. */
export async function acknowledgeRecordingConsent(env:Pick<Env,'AGENT_DB'>,actor:Actor):Promise<RecordingConsentStatus>{
 await requireMembership(env,actor,OPERATORS);
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_phone_recording_consent(tenant_id,consent_version,acknowledged_at,acknowledged_by)
  VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET consent_version=excluded.consent_version,
  acknowledged_at=excluded.acknowledged_at,acknowledged_by=excluded.acknowledged_by`)
  .bind(actor.tenantId,RECORDING_CONSENT_VERSION,now,actor.userId).run();
 return {acknowledged:true,consentVersion:RECORDING_CONSENT_VERSION,acknowledgedAt:now,acknowledgedBy:actor.userId};
}

/** Call-admission gate: no acknowledged consent, no admitted calls. */
export async function requireRecordingConsent(env:Pick<Env,'AGENT_DB'>,tenantId:string){
 const row=await env.AGENT_DB.prepare('SELECT consent_version FROM mayor_phone_recording_consent WHERE tenant_id=?')
  .bind(tenantId).first<{consent_version:number}>();
 if(!row||row.consent_version!==RECORDING_CONSENT_VERSION)
  throw new HttpError(403,'recording_consent_required','The business must acknowledge call-recording consent duties in phone setup before calls can be handled.');
}
