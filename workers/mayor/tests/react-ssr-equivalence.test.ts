import {expect,it} from 'vitest';
import {offerBlockHtml} from '../web/offer-block';
import {offerBlockSsrHtml} from '../src/offer-block-ssr';

/* React migration guard (S0): the client offer block is a React component;
 * its rendered markup must stay byte-identical to the worker's SSR string
 * renderer for the same catalog, so the funnel can never drift between
 * server-rendered and client-rendered output. */
it('React client offer markup is byte-identical to the SSR renderer',()=>{
 const catalog={currency:'USD',plans:[
  {id:'free',name:'Free',priceCents:0,interval:'calendar_month',replyLimit:100,voiceMinuteLimit:10},
  {id:'pro',name:'Pro',priceCents:1400,interval:'month',replyLimit:1000,voiceMinuteLimit:120}]};
 expect(offerBlockHtml(catalog)).toBe(offerBlockSsrHtml());
});
