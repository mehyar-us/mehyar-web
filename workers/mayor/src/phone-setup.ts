import {z} from 'zod';
import type {Actor,Env} from './env';
import {requireMembership,OPERATORS} from './permissions';

export const phoneSetupSchema=z.object({
  mode:z.enum(['new','existing']),
  provider:z.enum(['twilio','telnyx']).optional(),
}).strict();
export type PhoneSetupInput=z.infer<typeof phoneSetupSchema>;

// Product guidance, not customer data or a claim that a connection exists.
// Reviewed against official provider documentation on 2026-09-22.
export const phoneProviders={
  twilio:{name:'Twilio',signupUrl:'https://www.twilio.com/try-twilio',consoleUrl:'https://console.twilio.com/',
    guideUrl:'https://www.twilio.com/docs/usage/trials/try-out-voice',
    pricingUrl:'https://www.twilio.com/en-us/voice/pricing',
    note:'Trial calls have verified-number and feature restrictions. Check the provider’s current terms and pricing before upgrading.'},
  telnyx:{name:'Telnyx',signupUrl:'https://telnyx.com/sign-up',consoleUrl:'https://portal.telnyx.com/',
    guideUrl:'https://telnyx.com/developers',pricingUrl:'https://telnyx.com/pricing',
    note:'Complete the provider’s account verification and review number and call charges before adding funds or ordering a number.'},
} as const;

export function phoneSetupGuide(input:PhoneSetupInput){
  const selected=input.provider?phoneProviders[input.provider]:null;
  return {
    mode:input.mode,provider:input.provider??null,status:'awaiting_provider_setup',
    question:input.mode==='new'?'Which country should your business number be in?':selected?'Do you want to keep your current business number?':'Which provider holds your business number?',
    steps:input.mode==='new'?[
      'Choose a provider and open its signup page. The account will belong to your business.',
      'Complete email, phone, and any required business verification with the provider.',
      'Review current number and usage charges before ordering a number or upgrading.',
      'Acknowledge your call-recording consent duties: review the recording-consent notice in phone setup and confirm before calls can be handled.',
      'Return to The Mayor to connect the account, choose a number, and verify a test call before routing customers.',
    ]:[
      'Sign in to the provider that already holds your business number.',
      'Authorize a supported connection or use the secure credential setup when available. Never speak or paste secrets into chat.',
      'Choose the number you own. Review any routing change before applying it.',
      'Acknowledge your call-recording consent duties: review the recording-consent notice in phone setup and confirm before calls can be handled.',
      'Verify a test call before routing customer calls to The Mayor.',
    ],
    providers:selected?[{id:input.provider,...selected}]:Object.entries(phoneProviders).map(([id,provider])=>({id,...provider})),
    connectionVerified:false,purchaseAuthorized:false,
  };
}
export async function savePhoneSetup(env:Env,actor:Actor,input:PhoneSetupInput){
  await requireMembership(env,actor,OPERATORS);
  const parsed=phoneSetupSchema.parse(input);
  await env.AGENT_DB.prepare(`INSERT INTO mayor_phone_setup(tenant_id,mode,provider,updated_by,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode,provider=excluded.provider,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(actor.tenantId,parsed.mode,parsed.provider??null,actor.userId,new Date().toISOString()).run();
  return phoneSetupGuide(parsed);
}
export async function getPhoneSetup(env:Env,actor:Actor){
  await requireMembership(env,actor,OPERATORS);
  const row=await env.AGENT_DB.prepare('SELECT mode,provider FROM mayor_phone_setup WHERE tenant_id=?').bind(actor.tenantId).first<{mode:'new'|'existing';provider:'twilio'|'telnyx'|null}>();
  return row?phoneSetupGuide({mode:row.mode,...(row.provider?{provider:row.provider}:{})}):null;
}
