import {expect,it} from 'vitest';
import {catalogResponse} from '../src/billing/index';
import {PLANS,CREDIT_PACKS} from '../src/billing/plans';
function req(path:string,method='GET',origin?:string){const headers:Record<string,string>={};if(origin)headers['origin']=origin;return new Request(`https://mayor.mehyar.us${path}`,{method,headers});}
it('serves the pricing catalog publicly from plans.ts (single source of truth)',async()=>{
 const res=catalogResponse(req('/api/billing/catalog','GET','https://mehyar.us'))!;
 expect(res.status).toBe(200);
 const body=await res.json() as any;
 expect(body.currency).toBe('USD');
 expect(body.plans.map((p:any)=>p.id)).toEqual(PLANS.map(p=>p.id));
 expect(body.creditPacks.map((p:any)=>p.id)).toEqual(CREDIT_PACKS.map(p=>p.id));
 const pro=body.plans.find((p:any)=>p.id==='pro');
 expect(pro.priceCents).toBe(PLANS.find(p=>p.id==='pro')!.priceCents);
 expect(pro.replyLimit).toBe(1000);expect(pro.voiceMinuteLimit).toBe(120);
 const small=body.creditPacks.find((p:any)=>p.id==='small');
 expect(small.priceCents).toBe(CREDIT_PACKS.find(p=>p.id==='small')!.priceCents);
 expect(res.headers.get('access-control-allow-origin')).toBe('https://mehyar.us');
});
it('does not leak CORS to unlisted origins and rejects non-GET',()=>{
 const res=catalogResponse(req('/api/billing/catalog','GET','https://evil.example'))!;
 expect(res.headers.get('access-control-allow-origin')).toBeNull();
 expect(catalogResponse(req('/api/other'))).toBeNull();
 expect(()=>catalogResponse(req('/api/billing/catalog','POST'))).toThrowError(/Use GET for the billing catalog/);
});
it('exposes no internal fields (no Stripe ids, no secrets)',async()=>{
 const res=catalogResponse(req('/api/billing/catalog'))!;
 const raw=await res.text();
 expect(raw).not.toMatch(/price_|sk_|whsec_|secret/i);
});
