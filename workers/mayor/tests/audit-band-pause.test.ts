/**
 * audit-band-pause.test.ts — the homepage audit band's paused
 * annotation (2026-10-23, Product Chief order).
 *
 * The hub Audit checkouts are paused under the claim-posture ruling;
 * the band must say so before the click and name what the click
 * delivers today (the free scan + the notify path). The annotation
 * is SELF-CLEARING: the serve path reads the hub's availability flag
 * (GET https://mehyar.us/api/pay/availability → {audit_paused}) at
 * serve time and the note renders unless that flag affirmatively
 * reads false — so the hub's unpause commit retires the note with
 * no edit here. These pins cover BOTH states of the reader and the
 * band, plus the fail-safe semantics: an unreadable flag (network
 * failure, non-200, malformed body, missing field) reads as PAUSED,
 * because a stale note is a smaller harm than an unannounced dead
 * checkout. No real network: the reader takes an injected fetch.
 *
 * ADDENDUM (2026-10-23 re-rule, Product Chief): the pins above cover
 * the annotation on the LIVE band (the hub's pause, the worker's
 * offer available). The fold then paused the WORKER's own offer
 * (MAYOR_AUDIT_GENERATION_PAUSED), which made the offer unavailable
 * and the band dark. The re-rule: the band renders in PAUSED FORM
 * while the worker's generation pause is set — one slot, two
 * truthful states, never dark while either state is describable.
 * The second describe block below pins the full state matrix:
 * (worker offer available / generation-paused / unavailable-other)
 * × (hub flag true / false / unreadable). In the generation-paused
 * cells the worker's pause governs regardless of the hub flag —
 * this band sells the worker's door. Unavailability WITHOUT the
 * generation pause (e.g. missing Stripe configuration) stays dark:
 * the pause copy would be a false claim for a config outage.
 */
import {expect,it,describe,beforeEach} from 'vitest';
import {auditPaused,resetAuditPausedCache,AUDIT_AVAILABILITY_URL} from '../src/billing/audit-availability';
import {homeAuditBandSsrHtml,homeAuditBandPausedSsrHtml,injectHomeAuditSlot} from '../src/offer-block-ssr';

const NOTE='Audit checkout is paused while report generation is restored. The free scan is open, and the audit page can notify you when checkout returns.';
const okJson=(body:unknown):Response=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const fetchReturning=(body:unknown)=>async()=>okJson(body);

beforeEach(()=>{resetAuditPausedCache();});

describe('auditPaused — the hub availability read',()=>{
  it('reads the hub availability endpoint',async()=>{
    let seen='';
    const fetchImpl=async(url:string)=>{seen=String(url);return okJson({ok:true,checkout_open:true,audit_paused:true});};
    await auditPaused(1_000,fetchImpl as typeof fetch);
    expect(seen).toBe(AUDIT_AVAILABILITY_URL);
    expect(seen).toBe('https://mehyar.us/api/pay/availability');
  });
  it('flag true → paused (annotation state)',async()=>{
    expect(await auditPaused(1_000,fetchReturning({ok:true,audit_paused:true}))).toBe(true);
  });
  it('flag false → NOT paused (the self-clearing state)',async()=>{
    expect(await auditPaused(1_000,fetchReturning({ok:true,audit_paused:false}))).toBe(false);
  });
  it('flag missing → paused (only an affirmative false clears)',async()=>{
    expect(await auditPaused(1_000,fetchReturning({ok:true,checkout_open:true}))).toBe(true);
  });
  it('non-200 → paused (fail-safe)',async()=>{
    const fetchImpl=async()=>new Response('nope',{status:500});
    expect(await auditPaused(1_000,fetchImpl as unknown as typeof fetch)).toBe(true);
  });
  it('malformed JSON → paused (fail-safe)',async()=>{
    const fetchImpl=async()=>new Response('not json',{status:200});
    expect(await auditPaused(1_000,fetchImpl as unknown as typeof fetch)).toBe(true);
  });
  it('network failure / timeout → paused (fail-safe)',async()=>{
    const fetchImpl=async()=>{throw new Error('network down');};
    expect(await auditPaused(1_000,fetchImpl as unknown as typeof fetch)).toBe(true);
  });
  it('caches a successful read for the TTL, then re-reads',async()=>{
    let calls=0,flag=true;
    const fetchImpl=async()=>{calls++;return okJson({audit_paused:flag});};
    expect(await auditPaused(1_000,fetchImpl as unknown as typeof fetch)).toBe(true);
    flag=false; // the hub unpauses inside the TTL…
    expect(await auditPaused(31_000,fetchImpl as unknown as typeof fetch)).toBe(true); // …still cached
    expect(calls).toBe(1);
    expect(await auditPaused(61_001,fetchImpl as unknown as typeof fetch)).toBe(false); // TTL over → fresh read clears
    expect(calls).toBe(2);
  });
  it('caches a failure only briefly, then retries',async()=>{
    let calls=0;
    const fetchImpl=async()=>{calls++;if(calls===1)throw new Error('blip');return okJson({audit_paused:false});};
    expect(await auditPaused(1_000,fetchImpl as unknown as typeof fetch)).toBe(true);
    expect(await auditPaused(11_000,fetchImpl as unknown as typeof fetch)).toBe(true); // failure still cached
    expect(calls).toBe(1);
    expect(await auditPaused(31_001,fetchImpl as unknown as typeof fetch)).toBe(false); // retried → clears
    expect(calls).toBe(2);
  });
});

describe('the band in both pause states',()=>{
  it('paused: the annotation renders inside the band, before the CTA',()=>{
    const band=homeAuditBandSsrHtml(true);
    expect(band).toContain('home-audit-note');
    expect(band).toContain(NOTE);
    expect(band.indexOf('home-audit-note')).toBeLessThan(band.indexOf('home-audit-cta'));
    // The offer itself is untouched: same name, price, destination.
    expect(band).toContain('Extensive business audit');
    expect(band).toContain('$330');
    expect(band).toContain('href="/business-audit"');
  });
  it('unpaused: the band is byte-identical to its pre-annotation form',()=>{
    expect(homeAuditBandSsrHtml(false)).toBe('<aside class="home-audit-band"><div class="home-audit-head"><strong>Extensive business audit</strong><span class="home-audit-price">$330 one-time</span></div><p>A reviewed report on how people find your business, become customers, and come back — plus a practical plan for a better workday.</p><a class="home-audit-cta" href="/business-audit">See the business audit</a></aside>');
    expect(homeAuditBandSsrHtml(false)).not.toContain('home-audit-note');
  });
  it('slot: paused state carries the note; unpaused does not; unavailable stays empty either way',()=>{
    const page='<div id="chat-sign-in"><div id="home-audit-slot"></div><div id="offer-block" class="offer-block" aria-label="Plans"><p class="offer-fallback">x</p></div></div>';
    expect(injectHomeAuditSlot(page,true,true)).toContain(NOTE);
    expect(injectHomeAuditSlot(page,true,false)).not.toContain('home-audit-note');
    expect(injectHomeAuditSlot(page,true,false)).toContain('home-audit-band');
    // 2026-10-23 re-rule: these two calls pass no generation-pause
    // argument (it defaults false), so they pin the narrowed claim —
    // unavailable AND NOT generation-paused stays empty in either
    // hub state. The generation-paused cells are pinned below.
    expect(injectHomeAuditSlot(page,false,true)).toBe(page);
    expect(injectHomeAuditSlot(page,false,false)).toBe(page);
  });
});

describe('the band in paused form — the worker generation pause (2026-10-23 re-rule)',()=>{
  const page='<div id="chat-sign-in"><div id="home-audit-slot"></div><div id="offer-block" class="offer-block" aria-label="Plans"><p class="offer-fallback">x</p></div></div>';
  it('paused form: the offer presented as paused — band shell, note, non-purchase CTA, no purchase path',()=>{
    const band=homeAuditBandPausedSsrHtml();
    expect(band).toContain('home-audit-band');
    expect(band).toContain('Extensive business audit');
    expect(band).toContain('$330');
    expect(band).toContain(NOTE);
    expect(band.indexOf('home-audit-note')).toBeLessThan(band.indexOf('home-audit-cta'));
    expect(band).toContain('<a class="home-audit-cta" href="/business-audit">See the business audit</a>');
    expect(band).not.toContain('Start your audit');
  });
  it('paused form is the live band in its annotated state — one paused dialect, byte-identical',()=>{
    expect(homeAuditBandPausedSsrHtml()).toBe(homeAuditBandSsrHtml(true));
  });
  it('matrix: generation-paused renders the paused form when the hub flag reads true',()=>{
    const out=injectHomeAuditSlot(page,false,true,true);
    expect(out).toContain('home-audit-band');
    expect(out).toContain(NOTE);
    expect(out).toContain('data-ssr="catalog"');
  });
  it('matrix: generation-paused renders the paused form when the hub flag reads false — the worker pause governs',()=>{
    const out=injectHomeAuditSlot(page,false,false,true);
    expect(out).toContain('home-audit-band');
    expect(out).toContain(NOTE);
  });
  it('matrix: generation-paused renders the paused form when the hub flag is unreadable',()=>{
    // The serve path passes auditPausedState=true for an unreadable
    // flag (the reader's fail-safe) whenever it reads the flag at
    // all; the paused form does not depend on the value either way.
    const out=injectHomeAuditSlot(page,false,true,true);
    expect(out).toBe(injectHomeAuditSlot(page,false,false,true));
    expect(out).toContain(NOTE);
  });
  it('matrix: unavailable WITHOUT the generation pause stays dark in either hub state (no false pause claim)',()=>{
    expect(injectHomeAuditSlot(page,false,true,false)).toBe(page);
    expect(injectHomeAuditSlot(page,false,false,false)).toBe(page);
  });
  it('matrix: available renders the live form even if the pause argument is passed (unreachable from the serve path; live wins by gate order)',()=>{
    const out=injectHomeAuditSlot(page,true,false,true);
    expect(out).toContain('home-audit-band');
    expect(out).not.toContain('home-audit-note');
  });
  it('paused form respects the slot guards: missing, already-rendered, or non-empty slot stays untouched',()=>{
    expect(injectHomeAuditSlot('<div id="chat-sign-in"></div>',false,true,true)).toBe('<div id="chat-sign-in"></div>');
    const stamped='<div id="home-audit-slot" data-ssr="catalog">x</div>';
    expect(injectHomeAuditSlot(stamped,false,true,true)).toBe(stamped);
    const filled='<div id="home-audit-slot">content</div>';
    expect(injectHomeAuditSlot(filled,false,true,true)).toBe(filled);
  });
});
