/**
 * leadproof/packs.ts — LeadProof pack requests (integration spec
 * §4.3 step 1 + §5.2): the confirmed request consumes exactly ONE
 * pack credit and creates the pack `queued`, where the Phase 6
 * pipeline picks it up. Consumption is lease-guarded (the billing
 * locking.ts pattern) and double-fenced: the credit row's
 * consumed_by_pack_id is claimed by a guarded UPDATE, and the pack
 * INSERT runs only WHERE changes()=1 — a racing second request can
 * never spend the same credit twice.
 *
 * A credit is spendable only while its checkout is still 'paid':
 * a refund/dispute that lands before the spend makes the credit
 * unspendable (leadproofSessionEffects mirrors the checkout state;
 * no refund is ever initiated by this product).
 *
 * Businesses only (decision D7, spec §4.1): the request states its
 * scope and anything else is refused in the open — consumer leads
 * have no honest source today and are never quietly converted into
 * business leads.
 */
import type {Actor} from '../env';
import {HttpError} from '../http';
import {BILLING_ROLES,requireMembership} from '../permissions';
import {acquireLease,commitLease,releaseLease} from '../billing/locking';
import {mode,type BillingEnv} from '../billing/stripe';

export interface LeadProofIcpParams {
 category: string;
 geography: string;
 qualifiers: string[];
 scope: 'businesses';
}

export interface LeadProofPack {
 id: string; tenantId: string; creditId: string; icpText: string;
 icpParams: LeadProofIcpParams; status: string; harveyJobRef: string | null;
 leadCount: number | null; shortfallReason: string | null;
 createdAt: string; updatedAt: string; readyAt: string | null; exportedAt: string | null;
}

type PackRow = Record<string, unknown>;
const rowToPack = (r: PackRow): LeadProofPack => ({
 id: r.id as string, tenantId: r.tenant_id as string, creditId: r.credit_id as string,
 icpText: r.icp_text as string, icpParams: JSON.parse(r.icp_params_json as string) as LeadProofIcpParams,
 status: r.status as string, harveyJobRef: (r.harvey_job_ref as string) ?? null,
 leadCount: (r.lead_count as number) ?? null, shortfallReason: (r.shortfall_reason as string) ?? null,
 createdAt: r.created_at as string, updatedAt: r.updated_at as string,
 readyAt: (r.ready_at as string) ?? null, exportedAt: (r.exported_at as string) ?? null,
});

export function validateIcpParams(raw: unknown): LeadProofIcpParams {
 const p = (raw ?? {}) as Record<string, unknown>;
 const category = typeof p.category === 'string' ? p.category.trim() : '';
 const geography = typeof p.geography === 'string' ? p.geography.trim() : '';
 if (!category || category.length > 120) throw new HttpError(400, 'leadproof_icp_invalid', 'Name the kind of business you want — for example, "property managers".');
 if (!geography || geography.length > 120) throw new HttpError(400, 'leadproof_icp_invalid', 'Name the place to search — for example, "Brooklyn, NY".');
 if (p.scope !== undefined && p.scope !== 'businesses') throw new HttpError(400, 'leadproof_businesses_only', 'LeadProof finds businesses you can sell to. Household and consumer leads are not something we can source honestly today, so they are not offered.');
 const qualifiers = Array.isArray(p.qualifiers) ? p.qualifiers.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map(q => q.trim().slice(0, 120)).slice(0, 8) : [];
 return { category, geography, qualifiers, scope: 'businesses' };
}

export async function getLeadProofPack(db: D1Database, tenantId: string, packId: string): Promise<LeadProofPack | null> {
 const row = await db.prepare('SELECT * FROM mayor_leadproof_packs WHERE tenant_id=? AND id=?').bind(tenantId, packId).first<PackRow>();
 return row ? rowToPack(row) : null;
}

export async function listLeadProofPacks(db: D1Database, tenantId: string, limit = 10): Promise<LeadProofPack[]> {
 const rows = await db.prepare('SELECT * FROM mayor_leadproof_packs WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?').bind(tenantId, limit).all<PackRow>();
 return rows.results.map(rowToPack);
}

/** Spend one credit on a confirmed pack request. The read-back the
 * owner confirmed (§4.1) happens in the caller — by the time this
 * runs, the owner has seen "25 leads: <category> near <geography>.
 * Go?" and said yes; exactly one credit moves, exactly one pack is
 * created, and the pack enters the pipeline as `queued`. */
export async function requestLeadProofPack(env: BillingEnv, actor: Actor, input: { icpText: string; icpParams: unknown }): Promise<LeadProofPack> {
 await requireMembership(env, actor, BILLING_ROLES);
 const icpText = (input.icpText ?? '').trim();
 if (!icpText || icpText.length > 500) throw new HttpError(400, 'leadproof_icp_invalid', 'Describe the leads in your own words — a sentence or two is plenty.');
 const icpParams = validateIcpParams(input.icpParams);
 const selected = mode(env);
 if (!selected) throw new HttpError(503, 'leadproof_not_ready', 'LeadProof is being prepared.');
 const lease = await acquireLease(env, actor.tenantId, selected);
 try {
  const credit = await env.AGENT_DB.prepare(`SELECT cr.id FROM mayor_leadproof_pack_credits cr JOIN mayor_leadproof_checkouts co ON co.id=cr.checkout_id
   WHERE cr.tenant_id=? AND co.mode=? AND co.status='paid' AND cr.consumed_by_pack_id IS NULL ORDER BY cr.created_at ASC LIMIT 1`)
   .bind(actor.tenantId, selected).first<{ id: string }>();
  if (!credit) throw new HttpError(409, 'leadproof_credit_required', 'No LeadProof pack credit is available. Buy a pack first — the credit lands the moment Stripe verifies payment.');
  const packId = crypto.randomUUID(), now = new Date().toISOString();
  const claim = env.AGENT_DB.prepare('UPDATE mayor_leadproof_pack_credits SET consumed_by_pack_id=?,updated_at=? WHERE id=? AND tenant_id=? AND consumed_by_pack_id IS NULL')
   .bind(packId, now, credit.id, actor.tenantId);
  const insert = env.AGENT_DB.prepare(`INSERT INTO mayor_leadproof_packs(id,tenant_id,credit_id,icp_text,icp_params_json,status,created_at,updated_at)
   SELECT ?,?,?,?,?, 'queued',?,? WHERE changes()=1`)
   .bind(packId, actor.tenantId, credit.id, icpText, JSON.stringify(icpParams), now, now);
  await commitLease(env, actor.tenantId, selected, lease, [claim, insert]);
  const pack = await getLeadProofPack(env.AGENT_DB, actor.tenantId, packId);
  if (!pack) throw new HttpError(409, 'leadproof_credit_spent', 'That pack credit was just spent on another request. Refresh and try again.');
  return pack;
 } finally {
  await releaseLease(env, actor.tenantId, selected, lease).catch(() => undefined);
 }
}
