import {expect,it,describe} from 'vitest';
import {
 adGenerateRequestSchema,adPackageSchema,buildAdBrief,exportForAdsManager,
 generateAdPackage,pickCtaForGoal,validateAdCopy,META_CTAS,SPEND_NOTICE,
 type AdGenerateRequest,type AdModelFn,type AdPackage,
} from '../src/adgen';

const baseInput:AdGenerateRequest={
 businessName:'Glow Studio',vertical:'salon',offer:'20% off first balayage',
 goal:'bookings',language:'en',services:['balayage','cuts'],location:'Brooklyn, NY',
 verifiedUrgency:false,verifiedTestimonials:false,creativeRefs:[],
};
const cleanPackage:AdPackage={
 hooks:['Fresh color, zero damage.','Brooklyn balayage specialists.','Your hair, but better.'],
 primaryTexts:[
  'Glow Studio in Brooklyn does lived-in balayage that grows out soft — no harsh lines, no monthly panic appointments.',
  'First visit? Take 20% off balayage this month. Evening appointments available.',
 ],
 headlines:['Brooklyn Balayage','20% Off First Visit','Book Your Chair'],
 description:'Lived-in color by Brooklyn specialists. Book your appointment today.',
 cta:'Book Now',
};

describe('pickCtaForGoal',()=>{
 it('maps goals to sensible Meta CTAs',()=>{
  expect(pickCtaForGoal('bookings')).toBe('Book Now');
  expect(pickCtaForGoal('sales')).toBe('Shop Now');
  expect(pickCtaForGoal('leads')).toBe('Get Quote');
  expect(pickCtaForGoal('awareness')).toBe('Learn More');
 });
 it('every mapped CTA is on the allowed Meta list',()=>{
  for(const goal of ['bookings','sales','leads','awareness'] as const)
   expect(META_CTAS).toContain(pickCtaForGoal(goal));
 });
});

describe('buildAdBrief',()=>{
 it('injects the vertical voice deterministically',()=>{
  const salon=buildAdBrief({...baseInput,vertical:'salon'});
  expect(salon).toContain('“client”');
  expect(salon).toContain('“appointment”');
  expect(salon).not.toContain('“covers”');
  const restaurant=buildAdBrief({...baseInput,vertical:'restaurant'});
  expect(restaurant).toContain('“guest”');
  expect(restaurant).toContain('reservation');
 });
 it('unknown verticals fall back to neutral voice without crashing',()=>{
  const brief=buildAdBrief({...baseInput,vertical:'spaceship-repair'});
  expect(brief).toContain('other local business');
  expect(brief).toContain('Glow Studio');
 });
 it('embeds the compliance guardrails in the brief',()=>{
  const brief=buildAdBrief(baseInput);
  expect(brief).toMatch(/guaranteed results/i);
  expect(brief).toMatch(/fake urgency/i);
  expect(brief).toMatch(/personal.attributes/i);
  expect(brief).toMatch(/protected attributes/i);
 });
 it('threads the language param through',()=>{
  expect(buildAdBrief({...baseInput,language:'es'})).toContain('es');
  expect(buildAdBrief(baseInput)).toContain('Write all copy in English.');
 });
 it('includes offer, goal, location, and CTA in the brief',()=>{
  const brief=buildAdBrief(baseInput);
  expect(brief).toContain('20% off first balayage');
  expect(brief).toContain('drive bookings');
  expect(brief).toContain('Brooklyn, NY');
  expect(brief).toContain('Book Now');
 });
});

describe('validateAdCopy',()=>{
 const flagged=(pkg:Partial<AdPackage>)=>validateAdCopy({...cleanPackage,...pkg});
 it('passes clean copy with no flags',()=>{
  const {flags,blocked}=validateAdCopy(cleanPackage);
  expect(flags).toEqual([]);
  expect(blocked).toBe(false);
 });
 it('flags guaranteed-results as an error',()=>{
  const {flags,blocked}=flagged({hooks:['We guarantee more customers in 30 days.','Fresh color, zero damage.','Your hair, but better.']});
  expect(blocked).toBe(true);
  expect(flags.some(f=>f.rule==='guaranteed-results'&&f.severity==='error'&&f.field==='hooks')).toBe(true);
 });
 it('flags 100% satisfaction style guarantees',()=>{
  const {flags}=flagged({headlines:['100% satisfaction guaranteed','Brooklyn Balayage','Book Your Chair']});
  expect(flags.some(f=>f.rule==='guaranteed-results')).toBe(true);
 });
 it('flags fake urgency as a warning',()=>{
  const {flags,blocked}=flagged({description:'Only 2 left — book your appointment today.'});
  expect(blocked).toBe(false);
  expect(flags.some(f=>f.rule==='fake-urgency'&&f.severity==='warn')).toBe(true);
 });
 it('skips fake-urgency when the owner verified it',()=>{
  const {flags}=validateAdCopy({...cleanPackage,description:'Only 2 left — book your appointment today.'},{verifiedUrgency:true});
  expect(flags.some(f=>f.rule==='fake-urgency')).toBe(false);
 });
 it('flags unverified testimonials and ratings',()=>{
  const {flags}=flagged({primaryTexts:['Rated 5 stars by everyone! "Best salon ever" — Jessica','First visit? Take 20% off balayage this month.']});
  expect(flags.some(f=>f.rule==='unverified-testimonial')).toBe(true);
 });
 it('skips testimonial rule when the owner verified real quotes',()=>{
  const {flags}=validateAdCopy({...cleanPackage,primaryTexts:['"Best salon ever" — Jessica R., real Google review.','Second variant.']},{verifiedTestimonials:true});
  expect(flags.some(f=>f.rule==='unverified-testimonial')).toBe(false);
 });
 it('flags before/after claims',()=>{
  const {flags}=flagged({hooks:['See the before and after magic.','Fresh color, zero damage.','Your hair, but better.']});
  expect(flags.some(f=>f.rule==='before-after')).toBe(true);
 });
 it('flags protected-attribute targeting language as an error',()=>{
  const {flags,blocked}=flagged({primaryTexts:['Special pricing for Christians this Sunday — all are welcome to book.','Second variant.']});
  expect(blocked).toBe(true);
  expect(flags.some(f=>f.rule==='protected-attribute'&&f.severity==='error')).toBe(true);
 });
 it('flags personal-attribute copy as an error',()=>{
  for(const line of ['Are you a busy mom with no time for yourself?','Tired of being overlooked at work?','Do you suffer from thinning hair?']){
   const {flags,blocked}=flagged({hooks:[line,'Fresh color, zero damage.','Your hair, but better.']});
   expect(blocked).toBe(true);
   expect(flags.some(f=>f.rule==='personal-attribute')).toBe(true);
  }
 });
 it('flags unsubstantiated superlatives as a warning',()=>{
  const {flags,blocked}=flagged({headlines:['#1 salon in Brooklyn','Brooklyn Balayage','Book Your Chair']});
  expect(blocked).toBe(false);
  expect(flags.some(f=>f.rule==='unsubstantiated-superlative'&&f.severity==='warn')).toBe(true);
 });
 it('records field, index, and match on each flag',()=>{
  const {flags}=flagged({headlines:['Brooklyn Balayage','Best salon in town — results guaranteed!','Book Your Chair']});
  const flag=flags.find(f=>f.rule==='guaranteed-results');
  expect(flag?.field).toBe('headlines');
  expect(flag?.index).toBe(1);
  expect(flag?.match.length).toBeGreaterThan(0);
  expect(flag?.fix.length).toBeGreaterThan(0);
 });
 it('rejects packages outside the shape contract',()=>{
  expect(()=>validateAdCopy({...cleanPackage,hooks:['only one']} as unknown as AdPackage)).toThrow();
 });
});

describe('generateAdPackage',()=>{
 const modelJson:AdModelFn=async()=>JSON.stringify({
  hooks:['Hook one.','Hook two.','Hook three.','Hook four.'],
  primaryTexts:['Primary one. Two sentences here.','Primary two. Two sentences here.'],
  headlines:['Head one','Head two','Head three','Head four'],
  description:'A short description line.',
 });
 it('generates a package through the injected model (no real calls)',async()=>{
  const {pkg,flags,blocked,brief}=await generateAdPackage(baseInput,modelJson);
  expect(pkg.hooks).toHaveLength(4);
  expect(pkg.primaryTexts).toHaveLength(2);
  expect(pkg.headlines).toHaveLength(4);
  expect(pkg.description).toBe('A short description line.');
  expect(pkg.cta).toBe('Book Now');
  expect(flags).toEqual([]);
  expect(blocked).toBe(false);
  expect(brief).toContain('Glow Studio');
 });
 it('clamps overlong model output into the contract',async()=>{
  const greedy:AdModelFn=async()=>JSON.stringify({
   hooks:['a','b','c','d','e','f','g'],
   primaryTexts:['p1','p2','p3','p4'],
   headlines:['h1','h2','h3','h4','h5','h6'],
   description:'d',
  });
  const {pkg}=await generateAdPackage(baseInput,greedy);
  expect(pkg.hooks).toHaveLength(5);
  expect(pkg.primaryTexts).toHaveLength(3);
  expect(pkg.headlines).toHaveLength(5);
 });
 it('honors an explicit CTA override from the allowed list',async()=>{
  const {pkg}=await generateAdPackage({...baseInput,cta:'Call Now'},modelJson);
  expect(pkg.cta).toBe('Call Now');
 });
 it('attaches validation flags from generated copy',async()=>{
  const shady:AdModelFn=async()=>JSON.stringify({
   hooks:['We guarantee more customers fast.','Hook two.','Hook three.'],
   primaryTexts:['Primary one.','Primary two.'],
   headlines:['Head one','Head two','Head three'],
   description:'d',
  });
  const {flags,blocked}=await generateAdPackage(baseInput,shady);
  expect(blocked).toBe(true);
  expect(flags.some(f=>f.rule==='guaranteed-results')).toBe(true);
 });
 it('tolerates fenced JSON from the model',async()=>{
  const fenced:AdModelFn=async()=>'Here is your copy:\n```json\n'+JSON.stringify({
   hooks:['a','b','c'],primaryTexts:['p1','p2'],headlines:['h1','h2','h3'],description:'d',
  })+'\n```';
  const {pkg}=await generateAdPackage(baseInput,fenced);
  expect(pkg.hooks).toHaveLength(3);
 });
 it('throws a 502 when the model is unavailable',async()=>{
  const dead:AdModelFn=async()=>{throw new Error('boom');};
  await expect(generateAdPackage(baseInput,dead)).rejects.toMatchObject({status:502});
 });
 it('rejects bad input before touching the model',async()=>{
  let called=false;
  const spy:AdModelFn=async()=>{called=true;return '{}';};
  await expect(generateAdPackage({...baseInput,offer:''},spy)).rejects.toThrow();
  expect(called).toBe(false);
 });
});

describe('adGenerateRequestSchema',()=>{
 it('defaults language to en and refs to empty',()=>{
  const parsed=adGenerateRequestSchema.parse({businessName:'X',offer:'Y',goal:'leads'});
  expect(parsed.language).toBe('en');
  expect(parsed.creativeRefs).toEqual([]);
 });
 it('rejects unknown goals and CTAs',()=>{
  expect(()=>adGenerateRequestSchema.parse({businessName:'X',offer:'Y',goal:'viral'})).toThrow();
  expect(()=>adGenerateRequestSchema.parse({businessName:'X',offer:'Y',goal:'leads',cta:'Buy Now!!'})).toThrow();
 });
 it('accepts creative refs by id without reading media',()=>{
  const parsed=adGenerateRequestSchema.parse({...baseInput,creativeRefs:[{kind:'image',id:'img_123',label:'Hero'},{kind:'video',id:'vid_9'}]});
  expect(parsed.creativeRefs).toHaveLength(2);
 });
});

describe('exportForAdsManager',()=>{
 it('produces copy-paste-ready text with the spend notice',()=>{
  const text=exportForAdsManager(cleanPackage);
  expect(text).toContain('HOOKS');
  expect(text).toContain('PRIMARY TEXT');
  expect(text).toContain('HEADLINES');
  expect(text).toContain('CALL TO ACTION');
  expect(text).toContain('Book Now');
  expect(text).toContain(SPEND_NOTICE);
 });
 it('the spend notice is explicit that nothing is launched',()=>{
  expect(SPEND_NOTICE).toMatch(/nothing.*spends money/i);
  expect(SPEND_NOTICE).toMatch(/Ads Manager/i);
 });
});
