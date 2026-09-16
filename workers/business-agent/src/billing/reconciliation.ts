import {HttpError} from '../http';
import {configuredClient,requireVerifiedGates,allowedPriceIds} from './service';
import {AGENT_BILLING_DOMAIN,assertNoLegacyMetadata,objectId,type BillingEnv,type StripeClient,type StripeObject} from './stripe';

/** Read-only supplier comparison. Findings are not entitlement or payment evidence. */
export async function auditSubscription(env:BillingEnv,tenantId:string,client:StripeClient):Promise<string[]>{
  const local=await env.AGENT_DB.prepare('SELECT * FROM agent_billing_subscriptions WHERE tenant_id=?').bind(tenantId).first<StripeObject>();
  if(!local||!/^sub_[A-Za-z0-9_]+$/.test(local.stripe_subscription_id))throw new HttpError(409,'subscription_mapping_missing','Subscription mapping needs review.');
  const customer=await env.AGENT_DB.prepare('SELECT stripe_customer_id FROM agent_billing_customers WHERE tenant_id=?').bind(tenantId).first<{stripe_customer_id:string}>();
  const order=await env.AGENT_DB.prepare("SELECT * FROM agent_billing_orders WHERE id=? AND tenant_id=? AND stage='activation'").bind(local.activation_order_id,tenantId).first<StripeObject>();
  if(!customer||customer.stripe_customer_id!==local.stripe_customer_id||!order||!['checkout_created','completed'].includes(order.status)||order.price_id!==local.price_id||!allowedPriceIds(env).includes(local.price_id))throw new HttpError(409,'billing_mapping_mismatch','Billing mapping needs review.');
  const sub=await client.request(`/v1/subscriptions/${local.stripe_subscription_id}`);
  assertNoLegacyMetadata(sub.metadata);
  if(sub.id!==local.stripe_subscription_id||objectId(sub.customer)!==customer.stripe_customer_id||sub.livemode!==(env.ENVIRONMENT==='production')||sub.metadata?.mehyar_billing_domain!==AGENT_BILLING_DOMAIN||sub.metadata?.mehyar_agent_tenant_id!==tenantId||sub.metadata?.mehyar_agent_order_id!==order.id)throw new HttpError(409,'subscription_contract_mismatch','Subscription identity needs review.');
  const findings:string[]=[],items=sub.items?.data;
  if(!Array.isArray(items)||sub.items.has_more!==false||items.length!==1||objectId(items[0]?.price)!==local.price_id||items[0]?.quantity!==1)findings.push('subscription_items_mismatch');
  if(typeof sub.status!=='string'||typeof sub.cancel_at_period_end!=='boolean')throw new HttpError(502,'invalid_subscription_snapshot','Subscription snapshot is incomplete.');
  if(sub.status!==local.status)findings.push('subscription_status_mismatch');
  if(sub.cancel_at_period_end!==Boolean(local.cancel_at_period_end))findings.push('cancellation_mismatch');
  const invoiceId=objectId(sub.latest_invoice);
  if(!invoiceId||!/^in_[A-Za-z0-9_]+$/.test(invoiceId))findings.push('latest_invoice_unavailable');
  else{
    const invoice=await client.request(`/v1/invoices/${invoiceId}`);
    assertNoLegacyMetadata(invoice.metadata);
    if(invoice.id!==invoiceId||objectId(invoice.customer)!==customer.stripe_customer_id||objectId(invoice.parent?.subscription_details?.subscription??invoice.subscription)!==sub.id||invoice.livemode!==(env.ENVIRONMENT==='production'))throw new HttpError(409,'invoice_contract_mismatch','Invoice identity needs review.');
    const recorded=await env.AGENT_DB.prepare('SELECT status,amount_paid_cents,currency FROM agent_billing_invoices WHERE stripe_invoice_id=? AND tenant_id=? AND stripe_subscription_id=?').bind(invoiceId,tenantId,sub.id).first<StripeObject>();
    if(!recorded)findings.push('latest_invoice_not_recorded');
    else if(invoice.status!==recorded.status||invoice.amount_paid!==recorded.amount_paid_cents||invoice.currency!==recorded.currency)findings.push('invoice_snapshot_mismatch');
    if(local.last_invoice_id!==invoiceId)findings.push('latest_invoice_mapping_mismatch');
  }
  // Concurrent webhooks can change local accounting while supplier reads are in flight.
  const after=await env.AGENT_DB.prepare('SELECT * FROM agent_billing_subscriptions WHERE tenant_id=?').bind(tenantId).first<StripeObject>();
  if(JSON.stringify(after)!==JSON.stringify(local))throw new HttpError(409,'billing_snapshot_changed','Billing changed during comparison. Retry the audit.');
  return findings;
}

/** Bounded scheduled audit of new-platform mappings only. No Stripe writes. */
export async function runBillingReconciliation(env:BillingEnv,injectedClient?:StripeClient){
  if(env.AGENT_BILLING_RECONCILIATION_ENABLED!=='true')return {checked:0,disabled:true};
  await requireVerifiedGates(env,`billing:reconciliation:${env.AGENT_STRIPE_ACCOUNT_ID}`,['stripe_account_verified','billing_reconciliation_tests']);
  const client=configuredClient(env,injectedClient),account=await client.request('/v1/account');
  if(account.id!==env.AGENT_STRIPE_ACCOUNT_ID)throw new HttpError(409,'stripe_account_mismatch','Billing account needs review.');
  const now=new Date().toISOString();
  const due=await env.AGENT_DB.prepare(`SELECT s.tenant_id FROM agent_billing_subscriptions s JOIN agent_tenants t ON t.id=s.tenant_id
    LEFT JOIN agent_billing_reconciliation r ON r.tenant_id=s.tenant_id WHERE t.status!='deleted'
    AND (r.next_check_at IS NULL OR r.next_check_at<=?) AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=?)
    ORDER BY COALESCE(r.next_check_at,''),s.tenant_id LIMIT 5`).bind(now,now).all<{tenant_id:string}>();
  let checked=0;
  for(const {tenant_id:tenantId} of due.results){
    const token=crypto.randomUUID(),started=new Date().toISOString(),expires=new Date(Date.now()+120000).toISOString();
    const claim=await env.AGENT_DB.prepare(`INSERT INTO agent_billing_reconciliation(tenant_id,status,next_check_at,lease_token,lease_expires_at) VALUES (?,'checking',?,?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET status='checking',lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
      WHERE agent_billing_reconciliation.next_check_at<=? AND (agent_billing_reconciliation.lease_expires_at IS NULL OR agent_billing_reconciliation.lease_expires_at<=?)`).bind(tenantId,started,token,expires,started,started).run();
    if(!claim.meta.changes)continue;
    try{
      await requireVerifiedGates(env,`billing:reconciliation:${env.AGENT_STRIPE_ACCOUNT_ID}`,['stripe_account_verified','billing_reconciliation_tests']);
      const findings=await auditSubscription(env,tenantId,client);
      const saved=await env.AGENT_DB.prepare(`UPDATE agent_billing_reconciliation SET status=?,findings_json=?,checked_at=?,next_check_at=?,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL WHERE tenant_id=? AND lease_token=? AND lease_expires_at>?`)
        .bind(findings.length?'needs_review':'checked',JSON.stringify(findings),new Date().toISOString(),new Date(Date.now()+86400000).toISOString(),tenantId,token,new Date().toISOString()).run();
      checked+=saved.meta.changes;
    }catch(error){await env.AGENT_DB.prepare("UPDATE agent_billing_reconciliation SET status='failed',next_check_at=?,lease_token=NULL,lease_expires_at=NULL,last_error_code=? WHERE tenant_id=? AND lease_token=?")
      .bind(new Date(Date.now()+3600000).toISOString(),error instanceof HttpError?error.code:'reconciliation_failed',tenantId,token).run();}
  }
  return {checked,disabled:false};
}
