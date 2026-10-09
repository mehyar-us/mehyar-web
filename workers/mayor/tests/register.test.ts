import {describe,it,expect} from 'vitest';
import {
 VERTICAL_PROFILES,verticalProfile,
 toneSchema,isProfessionalTone,
 PROFESSIONAL_TEXTBACK_TEMPLATE,PROFESSIONAL_TEXTBACK_CONFIRM_TEMPLATE,PROFESSIONAL_REMINDER_TEMPLATE,
 textbackTemplateFor,textbackConfirmTemplateFor,reminderTemplateFor,
 professionalWinbackTemplate,PROFESSIONAL_LEAD_REPLY_TEMPLATE,professionalFillGapTemplate,
} from '../src/verticals';
import {verticalIdentityBlock,assistantPersonaPrompt,growthMetricsInstruction,PROFESSIONAL_REGISTER_BLOCK} from '../src/assistant-persona';
import {profileSchema} from '../src/memory';

describe('tone schema',()=>{
 it('accepts friendly and professional, omits cleanly',()=>{
  expect(toneSchema.parse('friendly')).toBe('friendly');
  expect(toneSchema.parse('professional')).toBe('professional');
  expect(()=>toneSchema.parse('casual')).toThrow();
 });
 it('isProfessionalTone only fires on the explicit value',()=>{
  expect(isProfessionalTone('professional')).toBe(true);
  expect(isProfessionalTone('friendly')).toBe(false);
  expect(isProfessionalTone(undefined)).toBe(false);
  expect(isProfessionalTone('Professional')).toBe(false);
 });
});

describe('profileSchema tone field',()=>{
 it('accepts professional tone',()=>{
  const p=profileSchema.parse({name:'Acme',tone:'professional'});
  expect(p.tone).toBe('professional');
 });
 it('omits tone cleanly — existing profiles default to friendly',()=>{
  const p=profileSchema.parse({name:'Acme'});
  expect('tone' in p).toBe(false);
 });
 it('rejects unknown tones',()=>{
  expect(()=>profileSchema.parse({name:'Acme',tone:'casual'})).toThrow();
 });
});

describe('professional register block',()=>{
 const salonPro={vertical:'salon',tone:'professional'};
 const salonFriendly={vertical:'salon'};
 it('is present for professional tone',()=>{
  expect(verticalIdentityBlock(salonPro)).toContain(PROFESSIONAL_REGISTER_BLOCK);
  expect(verticalIdentityBlock(salonPro)).toContain('professional');
 });
 it('overrides the vertical suggestion-voice chirpiness',()=>{
  expect(verticalIdentityBlock(salonPro)).not.toContain('like the best receptionist');
 });
 it('friendly default is unchanged',()=>{
  const block=verticalIdentityBlock(salonFriendly);
  expect(block).toContain('like the best receptionist');
  expect(block).not.toContain(PROFESSIONAL_REGISTER_BLOCK);
 });
 it('flows into the full persona prompt',()=>{
  const prompt=assistantPersonaPrompt(salonPro);
  expect(prompt).toContain('Register: professional');
  expect(prompt).not.toContain('like the best receptionist');
  expect(assistantPersonaPrompt(salonFriendly)).toContain('like the best receptionist');
 });
});

describe('professional templates',()=>{
 const salon=verticalProfile('salon');
 it('contain no "Reply YES" and no "!"',()=>{
  for(const t of [PROFESSIONAL_TEXTBACK_TEMPLATE,PROFESSIONAL_TEXTBACK_CONFIRM_TEMPLATE,PROFESSIONAL_REMINDER_TEMPLATE]){
   expect(t).not.toContain('Reply YES');
   expect(t).not.toContain('!');
  }
 });
 it('keep the legal opt-out line, phrased plainly',()=>{
  expect(PROFESSIONAL_TEXTBACK_TEMPLATE).toContain('Reply STOP to opt out.');
  expect(PROFESSIONAL_TEXTBACK_TEMPLATE).toContain('{business}');
  expect(PROFESSIONAL_REMINDER_TEMPLATE).toContain('{when}');
 });
 it('selectors fall back to friendly templates by default',()=>{
  expect(textbackTemplateFor(salon,undefined)).toContain('Reply YES');
  expect(textbackTemplateFor(salon,'friendly')).toContain('Reply YES');
  expect(reminderTemplateFor(salon,undefined)).toBe(salon.reminderTemplate);
  expect(reminderTemplateFor(salon,undefined)).toContain('Reply CANCEL');
  expect(textbackConfirmTemplateFor(salon,undefined)).toContain('Thanks!');
 });
 it('selectors return the professional variants for professional tone',()=>{
  expect(textbackTemplateFor(salon,'professional')).toBe(PROFESSIONAL_TEXTBACK_TEMPLATE);
  expect(textbackConfirmTemplateFor(salon,'professional')).toBe(PROFESSIONAL_TEXTBACK_CONFIRM_TEMPLATE);
  expect(reminderTemplateFor(salon,'professional')).toBe(PROFESSIONAL_REMINDER_TEMPLATE.replace('{booking}','appointment'));
 });
 it('professional drafts have no upsell language',()=>{
  for(const t of [professionalWinbackTemplate('appointment'),PROFESSIONAL_LEAD_REPLY_TEMPLATE,professionalFillGapTemplate('reservation')]){
   expect(t).not.toContain('Reply YES');
   expect(t).not.toContain('!');
   expect(t).toContain('Reply STOP to opt out.');
  }
 });
 it('every profile renders a professional text-back without chirpiness',()=>{
  for(const profile of Object.values(VERTICAL_PROFILES)){
   const t=textbackTemplateFor(profile,'professional');
   expect(t).not.toContain('!');
   expect(t).not.toContain('Reply YES');
   expect(t).toContain('Reply STOP to opt out.');
  }
 });
});

describe('growthMetricsInstruction under professional tone',()=>{
 const transcript='how do we grow this year';
 it('professional variant is formal with no exclamation',()=>{
  const inst=growthMetricsInstruction({vertical:'salon',tone:'professional'},transcript);
  expect(inst).not.toBeNull();
  expect(inst).not.toContain('!');
  expect(inst).toContain('Rebooking rate');
 });
 it('friendly variant is unchanged',()=>{
  const inst=growthMetricsInstruction({vertical:'salon'},transcript);
  expect(inst).not.toBeNull();
  expect(inst).toContain('frame it in this business');
 });
 it('still names the vertical vocabulary',()=>{
  const inst=growthMetricsInstruction({vertical:'dental',tone:'professional'},'what metrics should we track');
  expect(inst).toContain('patient');
  expect(inst).toContain('Recare rate');
 });
});
