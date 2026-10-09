import {it,expect} from 'vitest';
import {phoneAssistantPersonaPrompt,DEFAULT_PHONE_ASSISTANT_NAME} from '../src/phone-assistant-persona';

it('injects vertical vocabulary into the phone voice persona',()=>{
 const restaurant=phoneAssistantPersonaPrompt('The Mayor',{vertical:'restaurant'});
 expect(restaurant).toContain('restaurant');
 expect(restaurant).toContain('“guest”');expect(restaurant).toContain('“reservation”');
 expect(restaurant).toContain('“server”');
 expect(restaurant).not.toContain('chair');
 const salon=phoneAssistantPersonaPrompt('The Mayor',{vertical:'salon'});
 expect(salon).toContain('“client”');expect(salon).toContain('“appointment”');
 expect(salon).toContain('“stylist”');
});
it('falls back to the neutral block without a profile',()=>{
 const prompt=phoneAssistantPersonaPrompt('The Mayor');
 expect(prompt).toContain('Vertical identity');
 expect(prompt).toContain('neutral words');
 expect(prompt).not.toContain('“guest”');expect(prompt).not.toContain('“client”');
});
it('still guards the assistant name as display data',()=>{
 expect(phoneAssistantPersonaPrompt('<script>')).toContain(JSON.stringify(DEFAULT_PHONE_ASSISTANT_NAME));
});
