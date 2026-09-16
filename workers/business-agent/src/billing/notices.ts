import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {BILLING_ROLES,requireMembership,requireTenant} from '../permissions';

const labels:Record<string,{title:string;message:string}>={
  setup_paid:{title:'Setup payment received',message:'Your setup payment was recorded. Subscription activation is a separate step.'},
  setup_payment_failed:{title:'Setup payment failed',message:'The setup payment did not complete. Review billing before trying again.'},
  cancellation_scheduled:{title:'Cancellation scheduled',message:'Cancellation at the end of the paid period was recorded. Check your current subscription for the latest access dates.'},
  annual_renewal_upcoming:{title:'Annual renewal approaching',message:'An upcoming annual renewal was reported. Review your subscription and payment method.'},
  renewal_upcoming:{title:'Renewal approaching',message:'An upcoming renewal was reported. Review your subscription and payment method.'},
  subscription_paid:{title:'Subscription payment recorded',message:'An invoice payment was recorded. Your current subscription shows the latest access status.'},
  payment_action_required:{title:'Payment needs attention',message:'A subscription payment required additional action. Open billing management to review the payment.'},
  payment_failed:{title:'Subscription payment failed',message:'A subscription payment failed. Review your payment method and current access status; unresolved payments can pause your agent.'},
  refund_review:{title:'Refund update recorded',message:'A refund update was recorded for review. This notice does not confirm a completed refund or a change to access.'},
  dispute_review:{title:'Payment dispute update',message:'A payment dispute update was recorded. Review billing or contact support about its current status.'},
  credit_note_review:{title:'Credit update recorded',message:'A credit update was recorded for review. Check billing management for the current amount and status.'},
};
type Row={public_key:string;created_at:string;kind:string};
export async function billingNotices(env:Env,actor:Actor,cursor?:string|null){
  await requireTenant(env,actor);await requireMembership(env,actor,BILLING_ROLES);
  let before:Row|null=null;
  if(cursor){
    if(!/^[a-f0-9]{32}$/.test(cursor))throw new HttpError(400,'invalid_notice_cursor','Refresh billing activity to continue.');
    before=await env.AGENT_DB.prepare('SELECT public_key,created_at,kind FROM agent_billing_notices WHERE tenant_id=? AND public_key=?').bind(actor.tenantId,cursor).first<Row>();
    if(!before)throw new HttpError(400,'invalid_notice_cursor','Refresh billing activity to continue.');
  }
  const rows=await env.AGENT_DB.prepare(`SELECT public_key,created_at,kind FROM agent_billing_notices WHERE tenant_id=? AND public_key IS NOT NULL
    ${before?'AND (created_at<? OR (created_at=? AND public_key<?))':''} ORDER BY created_at DESC,public_key DESC LIMIT 26`)
    .bind(actor.tenantId,...(before?[before.created_at,before.created_at,before.public_key]:[])).all<Row>();
  await requireMembership(env,actor,BILLING_ROLES);
  const page=rows.results.slice(0,25);
  return {notices:page.map(row=>({id:row.public_key,recordedAt:row.created_at,...(Object.hasOwn(labels,row.kind)?labels[row.kind]:{title:'Billing update recorded',message:'A billing update was recorded. Review your current subscription or contact support for details.'})})),nextCursor:rows.results.length>25?page.at(-1)!.public_key:null};
}
