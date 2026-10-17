/**
 * provider-example.test.ts — the Telnyx worked example (2026-10-17).
 *
 * Pins: (1) the arithmetic — the total is COMPUTED from the rate
 * constants, so a rate edit moves the total or fails loudly here;
 * (2) the copy contract — labeled, sourced, dated, "never marked
 * up by us"; (3) serve-time placement — injectSalesPlans and
 * injectPricingCards put the example exactly once, immediately
 * after the provider note, in the REAL static pages (which stay
 * dollar-free themselves: the routes-manifest invariant holds).
 */
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {providerExampleSsrHtml,providerExampleTotalCents,TELNYX_INBOUND_PER_MIN_CENTS,TELNYX_OUTBOUND_PER_MIN_CENTS} from '../src/provider-example';
import {injectPricingCards,injectSalesPlans} from '../src/offer-block-ssr';

const webDir=join(dirname(fileURLToPath(import.meta.url)),'..','web');
const readWeb=(f:string)=>readFileSync(join(webDir,f),'utf8');

describe('provider worked example',()=>{
  it('computes its total from the sourced rate constants',()=>{
    // 110 number+SMS + 300*0.52 inbound + 80*0.7 outbound + 150*0.85 texts
    expect(providerExampleTotalCents()).toBeCloseTo(449.5,5);
    expect(TELNYX_INBOUND_PER_MIN_CENTS).toBeCloseTo(0.52,10); // $0.002 API + $0.0032 trunk
    expect(TELNYX_OUTBOUND_PER_MIN_CENTS).toBeCloseTo(0.7,10); // $0.002 API + $0.005 trunk
  });
  it('renders the labeled, sourced disclosure',()=>{
    const html=providerExampleSsrHtml();
    expect(html).toContain('Worked example');
    expect(html).toContain("Telnyx's published US pay-as-you-go rates");
    expect(html).toContain('telnyx.com/pricing');
    expect(html).toContain('checked October 2026');
    expect(html).toContain('$1.10/mo');
    expect(html).toContain('$0.0052/min');
    expect(html).toContain('$0.007/min');
    expect(html).toContain('about $4.50');
    expect(html).toContain('never marked up by us');
  });
  it('injects exactly once after the provider note on /sales and /pricing',()=>{
    for(const [file,inject] of [['sales.html',injectSalesPlans],['pricing.html',injectPricingCards]] as const){
      const served=inject(readWeb(file),false,null);
      expect(served.split('Worked example').length-1).toBe(1);
      const noteAt=served.indexOf('automatic text-backs are sent through Telnyx.</p>');
      const exAt=served.indexOf('Worked example');
      expect(noteAt).toBeGreaterThan(-1);
      expect(exAt).toBeGreaterThan(noteAt);
      expect(exAt-noteAt).toBeLessThan(200);
    }
  });
  it('fails quiet when the anchor is absent',()=>{
    expect(injectSalesPlans('<html><body>no note</body></html>',false,null)).not.toContain('Worked example');
  });
});
