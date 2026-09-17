// GET /api/admin/center/revenue — revenue per brand, 30d series, recent purchases.
import { guard, onOptions, qAllSoft, etDateMinus, etMonthPrefix, REGISTRY, json } from "./_lib.js";

export async function onRequestOptions({ request, env }) {
  return onOptions(request, env);
}

export async function onRequestGet({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  if (!env?.INTEL_DB) return json({ ok: false, error: "intel_db_not_bound", missing: { intel: true } }, 200, request, env);

  const month = etMonthPrefix();
  const d30 = etDateMinus(30);
  const perBrand = [];
  for (const b of REGISTRY) {
    const intelId = b.sources?.intel;
    if (!intelId) continue;
    const mtd = await qAllSoft(env.INTEL_DB,
      `SELECT COALESCE(SUM(p.amount_cents),0) AS n FROM purchases p JOIN offers o ON o.id = p.offer_id
        WHERE o.brand_id = ? AND substr(p.purchased_at,1,7) = ?`, [intelId, month]);
    const t30 = await qAllSoft(env.INTEL_DB,
      `SELECT COALESCE(SUM(p.amount_cents),0) AS n FROM purchases p JOIN offers o ON o.id = p.offer_id
        WHERE o.brand_id = ? AND substr(p.purchased_at,1,10) >= ?`, [intelId, d30]);
    const mtdN = Number(mtd[0]?.n || 0), t30N = Number(t30[0]?.n || 0);
    if (mtdN > 0 || t30N > 0) {
      perBrand.push({ brandId: b.id, brandName: b.name, mtd: Math.round(mtdN) / 100, d30: Math.round(t30N) / 100 });
    }
  }
  perBrand.sort((a, b) => b.mtd - a.mtd);

  const intelIds = perBrand.length
    ? REGISTRY.filter((b) => b.sources?.intel).map((b) => b.sources.intel)
    : [];
  let series = [];
  let purchases = [];
  if (intelIds.length) {
    const inQ = intelIds.map(() => "?").join(",");
    series = (await qAllSoft(env.INTEL_DB,
      `SELECT substr(p.purchased_at,1,10) AS date, SUM(p.amount_cents) AS cents
         FROM purchases p JOIN offers o ON o.id = p.offer_id
        WHERE o.brand_id IN (${inQ}) AND substr(p.purchased_at,1,10) >= ?
        GROUP BY date ORDER BY date`, [...intelIds, d30]))
      .map((r) => ({ date: r.date, total: Math.round(Number(r.cents || 0)) / 100 }));
    const regByIntel = Object.fromEntries(REGISTRY.map((b) => [b.sources?.intel, b]));
    purchases = (await qAllSoft(env.INTEL_DB,
      `SELECT p.purchased_at, p.amount_cents, p.offer_id, p.source, o.brand_id
         FROM purchases p JOIN offers o ON o.id = p.offer_id
        WHERE o.brand_id IN (${inQ}) ORDER BY p.purchased_at DESC LIMIT 50`, intelIds))
      .map((r) => ({
        purchasedAt: r.purchased_at, amountCents: Number(r.amount_cents || 0),
        offerId: r.offer_id, brandId: regByIntel[r.brand_id]?.id || r.brand_id,
        brandName: regByIntel[r.brand_id]?.name || r.brand_id, source: r.source || null,
      }));
  }
  return json({ ok: true, perBrand, series, purchases }, 200, request, env);
}
