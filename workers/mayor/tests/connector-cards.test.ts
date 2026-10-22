import {describe,it,expect} from 'vitest';
import {
  detectConnectorNeed,connectorOfferEvent,connectorOfferForName,guideCardEvent,credentialCardEvent,
  reconnectCardEvent,isConnectorAuthFailureCode,isConnectorAuthFailure,assertNoSecretLeak,maskSecretTail,
  type ConnectorCardEvent,
} from '../src/connector-cards';
import {guideForService,genericConnectorGuide} from '../src/connector-guides';
import {customConnectionErrorMessage} from '../src/custom-connectors';

const booksy=()=>guideForService('booksy')!;
const google=()=>guideForService('google')!;
const stripe=()=>guideForService('stripe')!;

describe('connector-need detection (deterministic)',()=>{
  it('fires on explicit connect requests',()=>{
    expect(detectConnectorNeed('connect my Booksy please')).toMatchObject({service:'booksy',name:'Booksy'});
    expect(detectConnectorNeed('can you hook up vagaro?')).toMatchObject({service:'vagaro'});
    expect(detectConnectorNeed('Link my Stripe account')).toMatchObject({service:'stripe'});
    expect(detectConnectorNeed('set up square payments')).toMatchObject({service:'square'});
    expect(detectConnectorNeed('sync my fresha bookings')).toMatchObject({service:'fresha'});
  });
  it('fires on key-mention requests',()=>{
    expect(detectConnectorNeed("i don't have an api key for fresha — show me how")).toMatchObject({service:'fresha'});
  });
  it('does not fire on negations, disconnects, or chit-chat',()=>{
    expect(detectConnectorNeed('do not connect stripe')).toBe(null);
    expect(detectConnectorNeed("don't hook up vagaro")).toBe(null);
    expect(detectConnectorNeed('disconnect my square')).toBe(null);
    expect(detectConnectorNeed('remove my booksy connection')).toBe(null);
    expect(detectConnectorNeed('what time is it')).toBe(null);
    expect(detectConnectorNeed('my booksy is slow today')).toBe(null);
  });
  it('leaves calendar mentions to the connectCalendar flow',()=>{
    expect(detectConnectorNeed('connect my google calendar')).toBe(null);
    expect(detectConnectorNeed('link my outlook calendar')).toBe(null);
    expect(detectConnectorNeed('connect google')).toMatchObject({service:'google'});
  });
});

describe('card events',()=>{
  it('builds an offer card with the teaching path and secure capture actions',()=>{
    const event=connectorOfferEvent(booksy());
    expect(event.type).toBe('connector_card');
    expect(event.card.kind).toBe('offer');
    expect(event.card.title).toContain('Booksy');
    expect(event.card.body).toBeTruthy();
    const actions=event.card.actions.map(a=>a.id);
    expect(actions).toContain('show_guide');
    expect(actions).toContain('enter_key');
    expect(actions).toContain('dismiss');
    expect(event.card.guide!.steps.length).toBeGreaterThanOrEqual(4);
  });
  it('builds an OAuth card for OAuth services',()=>{
    const event=connectorOfferEvent(google());
    expect(event.card.kind).toBe('oauth');
    const action=event.card.actions.find(a=>a.id==='connect_oauth')!;
    expect(action.provider).toBe('google');
    expect(action.label).toContain('Google');
  });
  it('builds guide, credential, and reconnect cards',()=>{
    const guide=guideCardEvent(booksy());
    expect(guide.card.kind).toBe('guide');
    expect(guide.card.guide!.steps.length).toBeGreaterThanOrEqual(4);
    const credential=credentialCardEvent(stripe());
    expect(credential.card.kind).toBe('credential');
    expect(credential.card.endpoint).toBe('https://api.stripe.com/v1');
    const reconnect=reconnectCardEvent(stripe());
    expect(reconnect.card.kind).toBe('reconnect');
    expect(reconnect.card.title).toContain('reconnecting');
    expect(reconnect.card.body).toMatch(/expired|permission/i);
    const reconnectOAuth=reconnectCardEvent(google());
    expect(reconnectOAuth.card.actions.find(a=>a.id==='connect_oauth')?.provider).toBe('google');
  });
  it('falls back to the generic guide for unknown services',()=>{
    const event=connectorOfferForName('Acme Widgets');
    expect(event.card.name).toBe('Acme Widgets');
    expect(event.card.guide!.steps.length).toBeGreaterThanOrEqual(4);
  });
  it('every card id is unique',()=>{
    const ids=new Set([connectorOfferEvent(booksy()),connectorOfferEvent(booksy())].map(e=>e.card.id));
    expect(ids.size).toBe(2);
  });
});

describe('dead-credential detection',()=>{
  it('classifies auth failure codes',()=>{
    for(const code of ['authentication_required','invalid_credential','connection_unavailable','insufficient_scope','connection_provider_rejected','connection_custody_unavailable','token_custody_unavailable'])
      expect(isConnectorAuthFailureCode(code)).toBe(true);
    for(const code of ['tool_not_found','invalid_tool_input','connection_rate_limited','bogus'])
      expect(isConnectorAuthFailureCode(code)).toBe(false);
  });
  it('classifies auth failure errors and messages',()=>{
    expect(isConnectorAuthFailure({code:'invalid_credential'})).toBe(true);
    expect(isConnectorAuthFailure({code:'tool_not_found'})).toBe(false);
    expect(isConnectorAuthFailure(new Error('Token expired, please reconnect'))).toBe(true);
    expect(isConnectorAuthFailure(new Error('Request timed out'))).toBe(false);
    expect(isConnectorAuthFailure(null)).toBe(false);
  });
});

describe('secret boundary — secrets never touch chat text, the model, or logs',()=>{
  const CANARY='sk-live-CANARY-9f8d7c6b5a';
  const allEvents=():ConnectorCardEvent[]=>[
    connectorOfferEvent(booksy()),connectorOfferEvent(google()),connectorOfferEvent(stripe()),
    connectorOfferForName('Acme'),guideCardEvent(booksy()),credentialCardEvent(stripe()),
    reconnectCardEvent(booksy()),reconnectCardEvent(google()),
  ];
  it('no card payload carries a secret-shaped value or field',()=>{
    for(const event of allEvents()){
      assertNoSecretLeak(event);
      const serialized=JSON.stringify(event);
      expect(serialized).not.toMatch(/"secret"\s*:/);
      expect(serialized).not.toMatch(/"apiKey"\s*:/);
      expect(serialized).not.toContain(CANARY);
    }
  });
  it('assertNoSecretLeak throws on secret-shaped payloads',()=>{
    expect(()=>assertNoSecretLeak({card:{kind:'offer'},secret:CANARY})).toThrow(/secret/);
    expect(()=>assertNoSecretLeak({nested:{apiKey:CANARY}})).toThrow();
    expect(()=>assertNoSecretLeak({nested:{client_secret:CANARY}})).toThrow();
    // Prose that merely mentions "API key" is fine — only values are forbidden.
    expect(()=>assertNoSecretLeak(genericConnectorGuide('Acme'))).not.toThrow();
  });
  it('auth-failure error copy never includes a secret value',()=>{
    for(const code of ['invalid_credential','connection_unavailable','connection_provider_rejected','connection_custody_unavailable']){
      expect(customConnectionErrorMessage(code)).not.toContain(CANARY);
      expect(customConnectionErrorMessage(code)).not.toMatch(/sk-live/);
    }
  });
  it('masked display shows only the last four',()=>{
    expect(maskSecretTail('sk_live_abcdef1234')).toBe('••••1234');
    expect(maskSecretTail('')).toBe('••••');
  });
});
