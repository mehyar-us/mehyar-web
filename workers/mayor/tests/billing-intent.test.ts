/**
 * billing-intent.test.ts — purchase intent consumption (NEW-1, 2026-10-17).
 *
 * The allowlist is the contract: exactly the values /sales and
 * /pricing emit. plan=pro-founding must parse to null — it is the
 * internal Stripe-facing planId, never an emitted URL value.
 * plan=founding IS accepted (rot523, 2026-10-21 — this replaces the
 * original founding pin in the open): the founding intent is a DOOR,
 * not a seat. It opens the standard upgrade dialog, whose live
 * founding block renders only while the server reports seats
 * remaining, and foundingGateOpen is re-read at checkout creation —
 * a URL still cannot buy, reserve, or preselect a seat. The stash
 * exists so the intent survives the sign-in round trip; take()
 * consumes it exactly once.
 */
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {captureBillingIntent,hasBillingIntent,parseBillingIntent,takeBillingIntent,type IntentStore} from '../web/billing-intent';

function fakeStore():IntentStore & {map:Map<string,string>}{
  const map=new Map<string,string>();
  return {map,
    getItem:(k)=>map.get(k)??null,
    setItem:(k,v)=>{map.set(k,v);},
    removeItem:(k)=>{map.delete(k);}};
}

describe('parseBillingIntent allowlist',()=>{
  it('accepts exactly the emitted values',()=>{
    expect(parseBillingIntent('?plan=pro')).toEqual({kind:'plan',id:'pro'});
    expect(parseBillingIntent('?plan=founding')).toEqual({kind:'plan',id:'founding'});
    expect(parseBillingIntent('?pack=small')).toEqual({kind:'pack',id:'small'});
    expect(parseBillingIntent('?pack=medium')).toEqual({kind:'pack',id:'medium'});
    expect(parseBillingIntent('?pack=large')).toEqual({kind:'pack',id:'large'});
    expect(parseBillingIntent('plan=pro')).toEqual({kind:'plan',id:'pro'}); // no leading ?
  });
  it('rejects everything else — the internal planId can never be smuggled in',()=>{
    expect(parseBillingIntent('?plan=pro-founding')).toBeNull();
    expect(parseBillingIntent('?plan=free')).toBeNull();
    expect(parseBillingIntent('?plan=PRO')).toBeNull();
    expect(parseBillingIntent('?pack=huge')).toBeNull();
    expect(parseBillingIntent('?pack=')).toBeNull();
    expect(parseBillingIntent('?start=1')).toBeNull();
    expect(parseBillingIntent('')).toBeNull();
  });
  it('plan beats pack when both appear (the emitters never send both)',()=>{
    expect(parseBillingIntent('?pack=small&plan=pro')).toEqual({kind:'plan',id:'pro'});
  });
});

describe('stash: intent survives sign-in',()=>{
  it('capture stores a valid intent; take consumes it exactly once',()=>{
    const store=fakeStore();
    expect(captureBillingIntent('?pack=medium',store)).toEqual({kind:'pack',id:'medium'});
    expect(hasBillingIntent('',store)).toBe(true);
    // The post-sign-in boot lands on / (no params): the stash carries it.
    expect(takeBillingIntent('',store)).toEqual({kind:'pack',id:'medium'});
    expect(takeBillingIntent('',store)).toBeNull(); // consumed
    expect(hasBillingIntent('',store)).toBe(false);
  });
  it('capture ignores invalid params and stores nothing',()=>{
    const store=fakeStore();
    expect(captureBillingIntent('?plan=pro-founding',store)).toBeNull();
    expect(store.map.size).toBe(0);
  });
  it('the founding door survives the sign-in round trip on the stash',()=>{
    const store=fakeStore();
    expect(captureBillingIntent('?plan=founding',store)).toEqual({kind:'plan',id:'founding'});
    expect(store.map.get('mayor_billing_intent')).toMatch(/^plan:founding@\d+$/);
    expect(hasBillingIntent('',store)).toBe(true);
    expect(takeBillingIntent('',store)).toEqual({kind:'plan',id:'founding'});
    expect(takeBillingIntent('',store)).toBeNull(); // consumed exactly once
  });
  it('a URL intent wins over the stash, and clears it',()=>{
    const store=fakeStore();
    captureBillingIntent('?pack=small',store);
    expect(takeBillingIntent('?plan=pro',store)).toEqual({kind:'plan',id:'pro'});
    expect(takeBillingIntent('',store)).toBeNull();
  });
  it('a corrupt stash value is re-validated to null',()=>{
    const store=fakeStore();
    store.setItem('mayor_billing_intent','plan:pro-founding');
    expect(takeBillingIntent('',store)).toBeNull();
  });
  it('storage failure degrades to URL-only, never throws',()=>{
    const broken:IntentStore={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');},removeItem:()=>{throw new Error('denied');}};
    expect(captureBillingIntent('?plan=pro',broken)).toEqual({kind:'plan',id:'pro'});
    expect(hasBillingIntent('?plan=pro',broken)).toBe(true);
    expect(takeBillingIntent('?plan=pro',broken)).toEqual({kind:'plan',id:'pro'});
    expect(takeBillingIntent('',broken)).toBeNull();
  });
});

describe('wiring pins',()=>{
  const web=(f:string)=>readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','web',f),'utf8');
  it('main.ts captures at boot and hands the taken intent to workday',()=>{
    const main=web('main.ts');
    expect(main).toContain('captureBillingIntent();');
    expect(main).toContain('workday.billingIntent(purchaseIntent)');
    expect(main).toContain('hasBillingIntent()');
  });
  it('workday consumes the pending intent inside loadBilling via the button paths',()=>{
    const workday=web('workday.ts');
    expect(workday).toContain('pendingBillingIntent');
    expect(workday).toContain("if(intent.kind==='plan'){if(data.plan.id!=='pro')void checkout();}");
    expect(workday).toContain('creditCheckout(pack)');
    // Rot523 supersedes the old pin ("the founding checkout path is
    // not reachable from the intent"): a founding intent now opens
    // the same upgrade dialog, and the cohort is still decided by
    // the dialog's live founding block + the server seat gate.
    expect(workday).toContain('the intent is a door, never a seat');
  });
});

describe('durable carrier (rot333 hardening)',()=>{
  const T0=1_800_000_000_000;
  // Two facades over ONE map = two tabs/windows of one browser profile
  // on a shared localStorage. Two maps = two storage partitions.
  function facade(map:Map<string,string>):IntentStore{
    return {getItem:(k)=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:(k)=>{map.delete(k);}};
  }
  it('survives a new tab: stashed in tab A, taken in tab B (shared profile storage)',()=>{
    const shared=new Map<string,string>();
    expect(captureBillingIntent('?plan=pro',facade(shared),T0)).toEqual({kind:'plan',id:'pro'});
    expect(takeBillingIntent('',facade(shared),T0+5*60*1000)).toEqual({kind:'plan',id:'pro'});
  });
  it('still dies across a storage PARTITION (webview -> system browser) — the documented boundary',()=>{
    const tabA=new Map<string,string>(); const browserB=new Map<string,string>();
    captureBillingIntent('?plan=pro',facade(tabA),T0);
    expect(takeBillingIntent('',facade(browserB),T0+60*1000)).toBeNull();
    // The URL param is the carrier there: the same link opened in the browser parses directly.
    expect(takeBillingIntent('?plan=pro',facade(browserB),T0+60*1000)).toEqual({kind:'plan',id:'pro'});
  });
  it('expiry: inside 60 minutes it fires; past it, it is gone and cleaned',()=>{
    const store=fakeStore();
    captureBillingIntent('?pack=large',store,T0);
    expect(takeBillingIntent('',store,T0+59*60*1000)).toEqual({kind:'pack',id:'large'});
    captureBillingIntent('?pack=large',store,T0);
    expect(hasBillingIntent('',store,T0+61*60*1000)).toBe(false);
    expect(takeBillingIntent('',store,T0+61*60*1000)).toBeNull();
    expect(store.map.size).toBe(0);
  });
  it('rejects corrupt, pre-hardening, and future-beyond-skew stamps',()=>{
    const store=fakeStore();
    store.setItem('mayor_billing_intent','plan:pro'); // old format, no stamp
    expect(takeBillingIntent('',store,T0)).toBeNull();
    store.setItem('mayor_billing_intent','plan:pro@abc');
    expect(takeBillingIntent('',store,T0)).toBeNull();
    store.setItem('mayor_billing_intent',`plan:pro@${T0+60*60*1000}`); // 1h in the future
    expect(takeBillingIntent('',store,T0)).toBeNull();
    store.setItem('mayor_billing_intent',`plan:pro@${T0+4*60*1000}`); // within skew
    expect(takeBillingIntent('',store,T0)).toEqual({kind:'plan',id:'pro'});
  });
});
