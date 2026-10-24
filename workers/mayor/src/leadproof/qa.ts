/* LeadProof §10 instrumentation (integration spec §10): the first
 * five packs are sampled at delivery into mayor_leadproof_qa — one
 * verdict row per sampled lead ('fit' | 'wrong_fit' | 'fabricated',
 * recorded by the human reviewer who read the lead against the
 * buyer's ICP; §10's sampling procedure). A wrong-fit-or-fabricated
 * rate above 15% across the first five sampled packs stops the module
 * before pack six is sold. recordLeadProofQa is the ledger's write;
 * leadproofQaState is the tripwire read: evaluable once five of the
 * tenant's packs carry verdicts, tripped when the combined bad rate
 * exceeds 15%. */
export type LeadProofVerdict = 'fit' | 'wrong_fit' | 'fabricated';
export async function recordLeadProofQa(db: D1Database, input: { packId: string; leadId: string; verdict: LeadProofVerdict; reviewer: string }): Promise<void> {
 await db.prepare('INSERT INTO mayor_leadproof_qa(id,pack_id,lead_id,verdict,reviewer,created_at) VALUES(?,?,?,?,?,?)')
  .bind(crypto.randomUUID(), input.packId, input.leadId, input.verdict, input.reviewer, new Date().toISOString()).run();
}
export interface LeadProofQaState {
 packsReviewed: number;
 leadsSampled: number;
 wrongFitRate: number | null;
 fabricatedRate: number | null;
 combinedBadRate: number | null;
 evaluable: boolean;
 tripped: boolean;
}
export async function leadproofQaState(db: D1Database, tenantId: string): Promise<LeadProofQaState> {
 const row = await db.prepare(`SELECT COUNT(DISTINCT qa.pack_id) AS packs, COUNT(qa.id) AS sampled,
   SUM(CASE WHEN qa.verdict='wrong_fit' THEN 1 ELSE 0 END) AS wrong_fit,
   SUM(CASE WHEN qa.verdict='fabricated' THEN 1 ELSE 0 END) AS fabricated
   FROM mayor_leadproof_qa qa JOIN mayor_leadproof_packs p ON p.id=qa.pack_id WHERE p.tenant_id=?`)
  .bind(tenantId).first<{ packs: number; sampled: number; wrong_fit: number | null; fabricated: number | null }>();
 const packsReviewed = row?.packs ?? 0, leadsSampled = row?.sampled ?? 0;
 const wrongFit = row?.wrong_fit ?? 0, fabricated = row?.fabricated ?? 0;
 const wrongFitRate = leadsSampled > 0 ? wrongFit / leadsSampled : null;
 const fabricatedRate = leadsSampled > 0 ? fabricated / leadsSampled : null;
 const combinedBadRate = leadsSampled > 0 ? (wrongFit + fabricated) / leadsSampled : null;
 return {
  packsReviewed, leadsSampled, wrongFitRate, fabricatedRate, combinedBadRate,
  evaluable: packsReviewed >= 5,
  tripped: packsReviewed >= 5 && combinedBadRate !== null && combinedBadRate > 0.15,
 };
}
