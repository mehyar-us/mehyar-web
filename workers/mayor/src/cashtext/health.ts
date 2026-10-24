/* CashText §10 instrumentation (integration spec §10): the pilot kill
 * bar — "draft-error rate > 5% at n ≥ 20 approved sends stops the
 * module" — is only a bar if it is computable from live data at any
 * moment. The draft_error flag itself is written by the Phase 3 edit
 * path (an owner correcting a drafting field — customer, amount,
 * description — on a prepared draft marks the draft as an error the
 * talk layer made). This read is the other half: per tenant, how many
 * invoices were approved/sent, how many carried the flag, the rate,
 * and whether the bar is evaluable yet (n ≥ 20) or already tripped. */
export interface CashTextDraftHealth {
 approvedSends: number;
 draftErrors: number;
 errorRate: number | null;
 evaluable: boolean;
 tripped: boolean;
}
export async function cashtextDraftHealth(db: D1Database, tenantId: string): Promise<CashTextDraftHealth> {
 const row = await db.prepare(`SELECT
   SUM(CASE WHEN status IN ('approved','sent','paid','overdue') THEN 1 ELSE 0 END) AS approved_sends,
   SUM(CASE WHEN status IN ('approved','sent','paid','overdue') AND draft_error=1 THEN 1 ELSE 0 END) AS draft_errors
   FROM mayor_cashtext_invoices WHERE tenant_id=?`).bind(tenantId).first<{ approved_sends: number | null; draft_errors: number | null }>();
 const approvedSends = row?.approved_sends ?? 0, draftErrors = row?.draft_errors ?? 0;
 const errorRate = approvedSends > 0 ? draftErrors / approvedSends : null;
 return {
  approvedSends, draftErrors, errorRate,
  evaluable: approvedSends >= 20,
  tripped: approvedSends >= 20 && errorRate !== null && errorRate > 0.05,
 };
}
