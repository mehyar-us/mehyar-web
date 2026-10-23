/**
 * cashtext/talk.ts — the CashText talk surface (integration spec §3.1).
 *
 * Deterministic-first, Stage 3 discipline: the specced command forms
 * parse here with NO model call —
 *   "invoice Maria $400"
 *   "invoice Maria 400 for the water heater"
 *   "chase Maria"
 *   "who owes me?"
 *   "cash summary"
 * into a CashTextIntent with facts {personName, amountCents}. Anything
 * this parser cannot settle returns null and the turn keeps the
 * engine's normal path (Stage 5 decide with the mayor_intent profile
 * for free-form variants — see loop.ts). Ambiguity is NEVER resolved
 * here: no name match, two matches, and a missing amount are surfaced
 * by the loop as asks, and a resolved customer without an email stops
 * the draft — no email is ever guessed.
 *
 * Person resolution runs against mayor_customers (the tenant's book,
 * src/customers.ts' table), tenant-bound on every query.
 */
import type {CashTextIntent} from '../engine/types';

const cleanName = (s: string): string => s.replace(/\s+/g, ' ').trim().replace(/[.?!,]+$/, '');

/** Dollars text → cents, or null when the token is not a clean amount.
 * Accepts "400", "400.5", "400.50", "1,250". Rejects 0 and negatives. */
export function amountToCents(token: string): number | null {
 const m = token.replace(/,/g, '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
 if (!m) return null;
 const cents = parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0);
 return cents > 0 ? cents : null;
}

interface InvoiceParts { personName: string; amountCents?: number; description?: string }

/** Parse the tail after an invoice verb: "<Name> [$]<amount> [for <desc>]"
 * in any of the specced orders. The name is everything before the
 * amount token; without an amount token the WHOLE tail is the name
 * (the loop then asks for the amount — it never guesses one). */
function parseInvoiceTail(tail: string): InvoiceParts | null {
 const t = tail.trim().replace(/[.!]+$/, '');
 if (!t) return null;
 // "<Name> for <desc> [$amount]" and "<Name> [$amount] for <desc>".
 const amountMatch = t.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/) ?? t.match(/(?:^|\s)([\d,]+(?:\.\d{1,2})?)(?=\s|$)/);
 if (!amountMatch) {
  const forSplit = t.split(/\s+for\s+/i);
  const personName = cleanName(forSplit[0]);
  return personName ? { personName } : null;
 }
 const cents = amountToCents(amountMatch[1]);
 const idx = amountMatch.index ?? 0;
 const before = t.slice(0, idx).replace(/\b(?:for|please)\s*$/i, '').trim();
 let after = t.slice(idx + amountMatch[0].length).trim();
 let description: string | undefined;
 const forInAfter = after.match(/^for\s+(.+)$/i);
 if (forInAfter) { description = forInAfter[1].trim(); after = ''; }
 else if (after && !/^please$/i.test(after)) description = after.replace(/^for\s+/i, '').trim();
 // "Name for desc $400": the for-phrase sat before the amount.
 let personName = cleanName(before);
 const forInBefore = personName.match(/^(.+?)\s+for\s+(.+)$/i);
 if (forInBefore && !description) { personName = cleanName(forInBefore[1]); description = forInBefore[2].trim(); }
 if (!personName) return null;
 return { personName, ...(cents !== null ? { amountCents: cents } : {}), ...(description ? { description } : {}) };
}

/** The deterministic CashText parser. Returns null when the turn is
 * not CashText-shaped at all (the engine's other parsers own it). */
export function parseCashText(rawText: string): CashTextIntent | null {
 const text = rawText.trim();
 const t = text.toLowerCase().replace(/[.!?\s]+$/, '');

 if (/^(who owes me|who owes|what'?s outstanding|what is outstanding|outstanding invoices|who hasn'?t paid( me)?)$/i.test(t)) return { kind: 'who_owes' };
 if (/^(cash summary|money summary|how'?s cash|how is cash|how are we doing on cash)$/i.test(t)) return { kind: 'cash_summary' };

 const chase = text.match(/^chase\s+(.+?)(?:\s+please)?[.!?]*$/i) ?? text.match(/^remind\s+(.+?)\s+about\s+(?:her|his|their|the)\s+(?:invoice|payment|bill)(?:\s+please)?[.!?]*$/i);
 if (chase) {
  const personName = cleanName(chase[1]);
  if (personName && !/^(me|us|it|them)$/i.test(personName)) return { kind: 'chase', personName };
  return null;
 }

 const invoice = text.match(/^invoice\s+(.+)$/i)
  ?? text.match(/^send\s+(?:an?\s+)?invoice\s+to\s+(.+)$/i)
  ?? text.match(/^bill\s+(.+)$/i);
 if (invoice) {
  const parts = parseInvoiceTail(invoice[1]);
  return parts ? { kind: 'invoice', ...parts } : null;
 }
 return null;
}

/** Loose extraction for the Stage-5 fallthrough (loop.ts): decide()
 * has classified a free-form turn as invoice talk; this pulls what
 * structure it can — a capitalized name beside the invoice/bill
 * word, a $ amount anywhere, and a trailing "for …" description.
 * Missing pieces stay missing (the loop asks). */
export function extractLooseInvoiceFacts(text: string): InvoiceParts | null {
 const nameMatch = text.match(/\b(?:invoice|bill)\s+(?:to\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/)
  ?? text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:an?\s+)?(?:bill|invoice)\b/)
  ?? text.match(/\bsend\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+an?\s+(?:bill|invoice)\b/);
 if (!nameMatch) return null;
 const personName = cleanName(nameMatch[1]);
 if (!personName) return null;
 const amount = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
 const amountCents = amount ? amountToCents(amount[1]) : null;
 const forIdx = text.toLowerCase().lastIndexOf(' for ');
 const description = forIdx > 0 ? text.slice(forIdx + 5).trim().replace(/[.!?]+$/, '') : undefined;
 return { personName, ...(amountCents !== null ? { amountCents } : {}), ...(description ? { description } : {}) };
}

/* ---------------- customer resolution (mayor_customers) ---------------- */

export interface CashTextCustomer { id: string; name: string; email: string | null; phone: string | null }

const nameKey = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Resolve a spoken name against the tenant's customer book.
 * Exact name_key match wins; otherwise customers whose name_key
 * starts with the spoken key, or whose FIRST name equals it. The
 * caller treats 0 as "not in the book" and >1 as ambiguity — both
 * ask, neither acts. Tenant-bound, always. */
export async function resolveCustomers(db: D1Database, tenantId: string, personName: string): Promise<CashTextCustomer[]> {
 const key = nameKey(personName);
 if (!key) return [];
 const rows = await db.prepare('SELECT id,name,email,phone FROM mayor_customers WHERE tenant_id=? ORDER BY name_key,id').bind(tenantId).all<CashTextCustomer>();
 const all = rows.results;
 const exact = all.filter(c => nameKey(c.name) === key);
 if (exact.length) return exact;
 const first = key.split(' ')[0];
 return all.filter(c => {
  const ck = nameKey(c.name);
  return ck.startsWith(key) || ck.split(' ')[0] === first && key.split(' ').length === 1;
 });
}

export async function getCustomerById(db: D1Database, tenantId: string, customerId: string): Promise<CashTextCustomer | null> {
 return db.prepare('SELECT id,name,email,phone FROM mayor_customers WHERE tenant_id=? AND id=?').bind(tenantId, customerId).first<CashTextCustomer>();
}

export const money = (cents: number): string => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
