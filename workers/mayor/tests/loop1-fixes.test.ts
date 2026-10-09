import {describe,it,expect} from 'vitest';
import {VERTICAL_PROFILES,detectVerticalFromCategory,isProfessionalTone} from '../src/verticals';
import {ADJACENT_VERTICAL_MAP,suggestVertical,verticalSuggestionFraming} from '../src/vertical-mapping';
import {esFormatWhen,ES_PROFESSIONAL_SMS,smsTemplates,renderTextback,renderReminder} from '../src/i18n';
import {verticalIdentityBlock,assistantGreeting,businessFirstTurnPrompt,growthMetricsInstruction} from '../src/assistant-persona';
import {asksCurrentCapabilities} from '../src/current-capabilities';
import {detectConnectorNeed} from '../src/connector-cards';

describe('loop-1: honest adjacent mapping can never be bypassed by direct hints',()=>{
 it('no placesHints entry overlaps an ADJACENT_VERTICAL_MAP key',()=>{
  const mappedKeys=new Set(Object.keys(ADJACENT_VERTICAL_MAP).map(k=>k.toLowerCase()));
  for(const [vkey,profile] of Object.entries(VERTICAL_PROFILES)){
   for(const hint of profile.placesHints){
    expect(mappedKeys.has(hint.toLowerCase()),`${vkey} placesHints contains mapped trade "${hint}"`).toBe(false);
   }
  }
 });
 it('electrician routes through the honest suggestion, not direct detection',()=>{
  expect(detectVerticalFromCategory('electrician')).toBeNull();
  const s=suggestVertical('electrician');
  expect(s).not.toBeNull();
  expect(s!.vertical).toBe('plumbing_hvac');
 });
 it('barber shop and nail salon route through the honest suggestion',()=>{
  expect(detectVerticalFromCategory('barber shop')).toBeNull();
  expect(detectVerticalFromCategory('nail salon')).toBeNull();
  expect(suggestVertical('barber shop')!.vertical).toBe('salon');
  expect(suggestVertical('nail salon')!.vertical).toBe('salon');
 });
 it('framing never doubles the "don\'t have" line',()=>{
  const s=suggestVertical('electrician')!;
  const framing=verticalSuggestionFraming(s);
  const count=(framing.match(/don't have/gi)??[]).length;
  expect(count).toBe(1);
 });
});

describe('loop-1: Spanish time phrases',()=>{
 it('esFormatWhen speaks Spanish, never English',()=>{
  // 2026-10-10 15:00 America/New_York
  const ms=Date.parse('2026-10-10T19:00:00Z'),now=Date.parse('2026-10-10T12:00:00Z');
  const out=esFormatWhen(ms,'America/New_York',now);
  expect(out).toContain('hoy');
  expect(out).not.toMatch(/today|tomorrow at/i);
 });
 it('esFormatWhen says mañana for tomorrow',()=>{
  const ms=Date.parse('2026-10-11T19:00:00Z'),now=Date.parse('2026-10-10T12:00:00Z');
  expect(esFormatWhen(ms,'America/New_York',now)).toContain('mañana');
 });
});

describe('loop-1: professional Spanish register',()=>{
 it('professional Spanish pack is formal: no exclamation marks, no chirpy CTA',()=>{
  for(const t of [ES_PROFESSIONAL_SMS.textback,ES_PROFESSIONAL_SMS.textbackConfirm,ES_PROFESSIONAL_SMS.reminder]){
   expect(t).not.toContain('!');
   expect(t).not.toMatch(/Responda SÍ/i);
  }
  expect(ES_PROFESSIONAL_SMS.textback).toContain('{business}');
 });
 it('smsTemplates returns professional Spanish for es+professional',()=>{
  const t=smsTemplates('salon','es','professional');
  expect(t.textback).toBe(ES_PROFESSIONAL_SMS.textback);
 });
 it('smsTemplates still returns friendly Spanish for es+friendly',()=>{
  const t=smsTemplates('salon','es','friendly');
  expect(t.textback).toContain('¡Perdón');
 });
 it('renderTextback threads tone through',()=>{
  expect(renderTextback('salon','es','Acme','professional')).toContain('Le escribe Acme');
  expect(renderReminder('salon','es','Acme','mañana','professional')).toContain('Acme');
 });
});

describe('loop-1: professional register without a vertical',()=>{
 it('verticalIdentityBlock applies the professional block for vertical=other',()=>{
  const block=verticalIdentityBlock({vertical:'other',tone:'professional'});
  expect(block).toContain('professional');
  expect(block).toContain('Register: professional');
 });
 it('still applies for a set vertical',()=>{
  expect(verticalIdentityBlock({vertical:'salon',tone:'professional'})).toContain('Register: professional');
 });
 it('friendly default does not include the professional block',()=>{
  expect(verticalIdentityBlock({vertical:'other'})).not.toContain('Register: professional');
 });
});

describe('loop-1: tone- and language-aware greeting',()=>{
 it('professional greeting is formal',()=>{
  const g=assistantGreeting({tone:'professional',name:'Acme Law'});
  expect(g).toContain('Good day');
  expect(g).not.toContain('Hey —');
 });
 it('Spanish greeting is Spanish',()=>{
  const g=assistantGreeting({language:'es',name:'Taquería Rosa'});
  expect(g).toContain('Hola');
  expect(g).not.toContain('Hey —');
 });
 it('first-turn prompt is formal for professional tone',()=>{
  expect(businessFirstTurnPrompt({tone:'professional'})).toContain('Good day');
 });
 it('first-turn prompt is Spanish for es language',()=>{
  expect(businessFirstTurnPrompt({language:'es'})).toContain('Hola');
 });
});

describe('loop-1: growth question misfires',()=>{
 it('does not fire on non-business contexts',()=>{
  expect(growthMetricsInstruction({vertical:'restaurant'},'improve my soup recipe')).toBeNull();
  expect(growthMetricsInstruction({vertical:'restaurant'},'track my package')).toBeNull();
 });
 it('still fires on real growth questions',()=>{
  const out=growthMetricsInstruction({vertical:'salon'},'how do I grow revenue?');
  expect(out).not.toBeNull();
  expect(out).toContain('Rebooking rate');
 });
});

describe('loop-1: Instagram DM capability guard',()=>{
 it('catches "Can you answer my Instagram DMs?"',()=>{
  expect(asksCurrentCapabilities('Can you answer my Instagram DMs?')).toBe(true);
 });
 it('catches "answer my IG dms"',()=>{
  expect(asksCurrentCapabilities('answer my dms on instagram')).toBe(true);
 });
 it('does not fire on unrelated questions',()=>{
  expect(asksCurrentCapabilities('what time is it?')).toBe(false);
 });
});

describe('loop-1: connector need negation scoping',()=>{
 it('"I no longer use Booksy, connect Fresha" still detects Fresha',()=>{
  const r=detectConnectorNeed('I no longer use Booksy, connect Fresha');
  expect(r).not.toBeNull();
  expect(r!.service).toBe('fresha');
 });
 it('"do not connect Booksy" is still a negation',()=>{
  expect(detectConnectorNeed('do not connect Booksy')).toBeNull();
 });
});

describe('loop-1: dead detector metadata is gone',()=>{
 it('no profile carries a detectors list',()=>{
  for(const profile of Object.values(VERTICAL_PROFILES)){
   expect((profile as Record<string,unknown>).detectors).toBeUndefined();
  }
 });
 it('detectorParams (consumed) still exist',()=>{
  expect(VERTICAL_PROFILES.salon.detectorParams.lapsedRegularDays).toBe(56);
 });
});
