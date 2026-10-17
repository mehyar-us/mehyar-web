/**
 * billing-intent.test.ts — purchase intent consumption (NEW-1, 2026-10-17).
 *
 * The allowlist is the contract: exactly the values /sales and
 * /pricing emit. plan=pro-founding must parse to null — founding is
 * seat-gated in the dialog and the server; a URL must never be able
 * to preselect a seat. The stash exists so the intent survives the
 * sign-in round trip; take() consumes it exactly once.
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
    expect(parseBillingIntent('?pack=small')).toEqual({kind:'pack',id:'small'});
    expect(parseBillingIntent('?pack=medium')).toEqual({kind:'pack',id:'medium'});
    expect(parseBillingIntent('?pack=large')).toEqual({kind:'pack',id:'large'});
    expect(parseBillingIntent('plan=pro')).toEqual({kind:'plan',id:'pro'}); // no leading ?
  });
  it('rejects everything else — founding can never be smuggled in',()=>{
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
    // The founding checkout path is not reachable from the intent:
    expect(workday).not.toContain("intent.id==='pro-founding'");
  });
});
