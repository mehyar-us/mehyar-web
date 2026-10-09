import {describe,it,expect} from 'vitest';
import {guideForService,genericConnectorGuide,resolveConnectorService,topServicesForVertical} from '../src/connector-guides';

describe('connector guides',()=>{
  it('resolves the five vertical services plus OAuth providers',()=>{
    expect(resolveConnectorService('connect my booksy please')).toBe('booksy');
    expect(resolveConnectorService('can you hook up vagaro?')).toBe('vagaro');
    expect(resolveConnectorService('link fresha')).toBe('fresha');
    expect(resolveConnectorService('set up square payments')).toBe('square');
    expect(resolveConnectorService('connect stripe')).toBe('stripe');
    expect(resolveConnectorService('my google business profile')).toBe('google_business');
    expect(resolveConnectorService('google my business')).toBe('google_business');
    expect(resolveConnectorService('connect my outlook')).toBe('microsoft');
    expect(resolveConnectorService('connect zoho')).toBe('zoho');
    expect(resolveConnectorService('connect zoom')).toBe(null);
    expect(resolveConnectorService('connect my bank')).toBe(null);
  });
  it('every guided service has numbered plain-language steps',()=>{
    for(const service of ['vagaro','booksy','fresha','square','stripe','google_business','google','microsoft','zoho']){
      const guide=guideForService(service)!;
      expect(guide,`guide ${service}`).toBeTruthy();
      expect(guide.steps.length).toBeGreaterThanOrEqual(4);
      for(const step of guide.steps){
        expect(step.length).toBeGreaterThan(10);
        expect(step.length).toBeLessThan(400);
      }
      if(guide.docUrl)expect(guide.docUrl.startsWith('https://')).toBe(true);
    }
  });
  it('is honest about gated access models (no invented dashboard paths)',()=>{
    const vagaro=guideForService('vagaro')!;
    expect(vagaro.note).toMatch(/approve|review/i);
    expect(vagaro.authKind).toBe('request_access');
    const booksy=guideForService('booksy')!;
    expect(booksy.note).toMatch(/no self-serve|will not pretend|no API/i);
    expect(booksy.steps.join(' ')).not.toMatch(/dashboard.*api key|settings.*api key/i);
    const fresha=guideForService('fresha')!;
    expect(fresha.authKind).toBe('request_access');
  });
  it('falls back to a generic guide for unknown services',()=>{
    const guide=genericConnectorGuide('Acme Widgets');
    expect(guide.service).toBe('unknown');
    expect(guide.name).toBe('Acme Widgets');
    expect(guide.steps.length).toBeGreaterThanOrEqual(4);
    expect(guide.steps.join(' ')).toMatch(/Developer/i);
    expect(genericConnectorGuide('  ').name).toBe('that service');
  });
  it('orders salon vertical services per the brief',()=>{
    const services=topServicesForVertical('salon').map(g=>g.service);
    expect(services[0]).toBe('google_business');
    expect(services.slice(1,4)).toEqual(['vagaro','booksy','fresha']);
    expect(services).toContain('square');
    expect(services).toContain('stripe');
  });
});
