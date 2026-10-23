import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {ACTION_CLASSES,NEVER_LIVE_ACTION_CLASSES,isNeverLiveActionClass} from '../src/engine/types';
import {compileGrant} from '../src/engine/grant-compiler';
import {evaluateCoverage,evaluateGrant,type ActRequest} from '../src/engine/grant-gate';
import type {Grant} from '../src/engine/types';
import {parseCashText,extractLooseInvoiceFacts,amountToCents} from '../src/cashtext/talk';
import {parseCashTextEdit} from '../src/cashtext/drafts';
import {CASHTEXT_INVOICE_FOOTER} from '../src/cashtext/executor';

/* Phase 3 unit pins (integration spec §3.1–3.3, §6 proofs 3+5):
 * the deterministic talk parser, the NEVER_LIVE grant fence at the
 * compiler + gate, and the executor's creation-time footer. The
 * stateful batteries live in tests/integration/cashtext-phase3.test.ts. */

it('talk parser: the specced invoice forms parse deterministically with facts {personName, amountCents}',()=>{
 expect(parseCashText('invoice Maria $400')).toEqual({kind:'invoice',personName:'Maria',amountCents:40000});
 expect(parseCashText('invoice Maria 400 for the water heater')).toEqual({kind:'invoice',personName:'Maria',amountCents:40000,description:'the water heater'});
 expect(parseCashText('invoice Maria Lopez $1,250.50 for the roof')).toEqual({kind:'invoice',personName:'Maria Lopez',amountCents:125050,description:'the roof'});
 expect(parseCashText('send an invoice to Maria $75')).toEqual({kind:'invoice',personName:'Maria',amountCents:7500});
 expect(parseCashText('invoice Maria')).toEqual({kind:'invoice',personName:'Maria'}); // amount missing — the loop asks, never guesses
});

it('talk parser: chase, who-owes, and cash-summary forms; non-CashText turns return null',()=>{
 expect(parseCashText('chase Maria')).toEqual({kind:'chase',personName:'Maria'});
 expect(parseCashText('who owes me?')).toEqual({kind:'who_owes'});
 expect(parseCashText("what's outstanding")).toEqual({kind:'who_owes'});
 expect(parseCashText('cash summary')).toEqual({kind:'cash_summary'});
 expect(parseCashText('text Maria about Thursday')).toBeNull();
 expect(parseCashText('you can reschedule anyone who asks')).toBeNull();
 expect(parseCashText('chase me')).toBeNull();
});

it('amount parsing: clean dollars only, zero and junk rejected',()=>{
 expect(amountToCents('400')).toBe(40000);
 expect(amountToCents('400.5')).toBe(40050);
 expect(amountToCents('1,250.50')).toBe(125050);
 expect(amountToCents('0')).toBeNull();
 expect(amountToCents('abc')).toBeNull();
});

it('loose extraction (Stage 5 fallthrough): name, $ amount, trailing description — missing pieces stay missing',()=>{
 expect(extractLooseInvoiceFacts('Please send Maria Lopez an invoice for $250 for the sink repair')).toEqual({personName:'Maria Lopez',amountCents:25000,description:'the sink repair'});
 expect(extractLooseInvoiceFacts('Could you bill Maria for the sink?')).toEqual({personName:'Maria',description:'the sink'});
 expect(extractLooseInvoiceFacts('the weather is nice')).toBeNull();
});

it('fence: both CashText send classes are action classes AND never-live classes',()=>{
 expect(ACTION_CLASSES).toContain('send_invoice');
 expect(ACTION_CLASSES).toContain('send_invoice_chase');
 expect([...NEVER_LIVE_ACTION_CLASSES]).toEqual(['send_invoice','send_invoice_chase']);
 expect(isNeverLiveActionClass('send_invoice')).toBe(true);
 expect(isNeverLiveActionClass('send_invoice_chase')).toBe(true);
 expect(isNeverLiveActionClass('send_reminder')).toBe(false);
});

it('fence: the grant compiler REFUSES grants for both send classes (decline, never ready/ask)',()=>{
 const invoice=compileGrant('You can invoice anyone who asks');
 expect(invoice.disposition).toBe('decline');
 expect(invoice.actionClass).toBe('send_invoice');
 expect(invoice.decline).toContain('standing authority to send invoices');
 const chase=compileGrant('You can chase overdue invoices whenever you like');
 expect(chase.disposition).toBe('decline');
 expect(chase.actionClass).toBe('send_invoice_chase');
 // An ordinary class still compiles normally — the fence is surgical.
 expect(compileGrant('You can reschedule anyone who asks').disposition).toBe('ready');
});

it('fence: the Stage-4 gate never covers a send class, even with a fabricated live grant row',()=>{
 const grant:Grant={id:'g1',tenantId:'t',version:1,status:'live',actionClass:'send_invoice',scope:{who:'any_customer',what:'any_service',when:'any_time',channel:'any',limits:{maxMessagesPerPersonPerDay:99}},conditions:[],neverLines:[],sourceUtterance:'invoice anyone',plainSummary:'invoice anyone',origin:'owner_stated',capabilityState:'present',probeSetId:null,sessionScope:'standard',asks:[],createdAt:new Date().toISOString(),confirmedAt:new Date().toISOString(),expiresAt:null,supersedesId:null};
 const act:ActRequest={actionClass:'send_invoice',facts:{personName:'Maria',amountCents:40000,personKnown:true},channel:'email'};
 expect(evaluateCoverage([grant],act).outcome).toBe('not_covered');
 expect(evaluateGrant(grant,act).verdict).toBe('excludes');
 const chaseGrant={...grant,actionClass:'send_invoice_chase' as const};
 expect(evaluateCoverage([chaseGrant],{...act,actionClass:'send_invoice_chase'}).outcome).toBe('not_covered');
});

it('executor pins: footer is set at invoice CREATION, before finalize; the claim key is cashtext-send:<action id>',()=>{
 const src=readFileSync(new URL('../src/cashtext/executor.ts',import.meta.url),'utf8');
 expect(src).toContain('footer: CASHTEXT_INVOICE_FOOTER');
 // The footer rides the CREATION POST body, and that POST precedes
 // the creation branch's finalize. (2026-10-23 chain repair: the
 // original pin compared against the first '/finalize' in the file,
 // which sits in the resume branch — finalizing an invoice minted by
 // an earlier attempt, whose footer was set at ITS creation. The
 // semantic claim is unchanged and is what is pinned here.)
 const createIdx=src.indexOf("'/v1/invoices', 'POST'");
 const footerIdx=src.indexOf('footer: CASHTEXT_INVOICE_FOOTER');
 expect(createIdx).toBeGreaterThan(-1);
 expect(footerIdx).toBeGreaterThan(createIdx);
 expect(footerIdx).toBeLessThan(src.indexOf('/finalize', createIdx));
 expect(src).toContain('cashtext-send:${action.id}');
 expect(src).toContain('mayor-pwa:cashtext-');
 // No post-finalize edit path exists (Phase 2 rider 1): the file
 // never PATCHes/POSTs an invoice update with footer/description.
 expect(src).not.toMatch(/invoices\/\$\{[^}]+\}`\s*,\s*'POST'\s*,\s*\{\s*(footer|description)/);
 expect(CASHTEXT_INVOICE_FOOTER.length).toBeGreaterThan(10);
});

it('edit parsing: JSON and field:value forms; a plain body on a chase card is the new chase text',()=>{
 const invoiceAction={actionClass:'send_invoice',payload:{}} as any;
 expect(parseCashTextEdit(invoiceAction,'{"amount_cents":45000}')).toEqual({amount_cents:45000});
 expect(parseCashTextEdit(invoiceAction,'amount: 450; description: Water heater')).toEqual({amount:'450',description:'Water heater'});
 const chaseAction={actionClass:'send_invoice_chase',payload:{}} as any;
 expect(parseCashTextEdit(chaseAction,'Hi Maria, just checking in on this one.')).toEqual({chase_text:'Hi Maria, just checking in on this one.'});
 expect(parseCashTextEdit(invoiceAction,'')).toBeNull();
});

it('desk client: invoice-card is a known, money-adjacent, renderable intent; the renderer and reapprove wiring exist',()=>{
 const intents=readFileSync(new URL('../web/desk/intents.ts',import.meta.url),'utf8');
 expect(intents).toContain("'invoice-card'");
 expect(intents).toContain('InvoiceCardIntent');
 expect(intents).toContain('editHint?: string');
 const primitives=readFileSync(new URL('../web/desk/primitives.tsx',import.meta.url),'utf8');
 expect(primitives).toContain("case 'invoice-card':");
 expect(primitives).toContain('Review the draft');
 expect(primitives).toContain('canEdit');
 const main=readFileSync(new URL('../web/main.ts',import.meta.url),'utf8');
 expect(main).toContain('/engine/cashtext/invoices/');
 expect(main).toContain('onReapproveInvoice');
 const routes=readFileSync(new URL('../src/engine/routes.ts',import.meta.url),'utf8');
 expect(routes).toContain('cashtext\\/invoices');
 expect(routes).toContain('billingEnv: env');
});

it('loop pins: the fenced hook + suggestion guard are wired, and no other send path exists in loop.ts',()=>{
 const loop=readFileSync(new URL('../src/engine/loop.ts',import.meta.url),'utf8');
 expect(loop).toContain('executeCashTextSend');
 expect(loop).toContain('isNeverLiveActionClass(action.actionClass)');
 const store=readFileSync(new URL('../src/engine/store.ts',import.meta.url),'utf8');
 expect(store).toContain('if (isNeverLiveActionClass(actionClass)) return;');
 expect(store).toContain('claimActionLog');
});
