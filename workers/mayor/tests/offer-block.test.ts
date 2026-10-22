import {expect,it} from 'vitest';
import {offerBlockHtml} from '../web/offer-block';
const catalog=()=>({currency:'USD',plans:[
 {id:'free',name:'Free',priceCents:0,interval:'calendar_month',replyLimit:100,voiceMinuteLimit:10},
 {id:'pro',name:'Pro',priceCents:1400,interval:'month',replyLimit:1000,voiceMinuteLimit:120},
]});
it('renders catalog prices and plan terms (no hardcoded amounts)',()=>{
 const html=offerBlockHtml(catalog())!;
 expect(html).toContain('$14');
 expect(html).toContain('/ month');
 expect(html).toContain('1,000 assistant replies');
 expect(html).toContain('120 microphone minutes');
 expect(html).toContain('100 assistant replies');
 expect(html).toContain('10 microphone minutes');
 expect(html).toContain('Purchases are final');
});
it('follows the catalog when prices change (never a stale or invented amount)',()=>{
 const changed=catalog();changed.plans[1].priceCents=3900;
 const html=offerBlockHtml(changed)!;
 expect(html).toContain('$39');
 expect(html).not.toContain('$14');
});
it('degrades to null when the catalog is missing or malformed (fallback stays)',()=>{
 expect(offerBlockHtml(null)).toBeNull();
 expect(offerBlockHtml(undefined)).toBeNull();
 expect(offerBlockHtml({})).toBeNull();
 expect(offerBlockHtml({currency:'USD',plans:[{id:'free'}]})).toBeNull();
 expect(offerBlockHtml({currency:'USD',plans:[{id:'free',name:'Free',priceCents:0,interval:'calendar_month',replyLimit:100,voiceMinuteLimit:10}]})).toBeNull();
});
it('escapes hostile plan names',()=>{
 const c=catalog();(c.plans[0] as {name:string}).name='<img src=x onerror=alert(1)>';
 const html=offerBlockHtml(c)!;
 expect(html).not.toContain('<img src=x');
 expect(html).toContain('&lt;img');
});
