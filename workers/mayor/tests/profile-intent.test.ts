import {it,expect} from 'vitest';
import {isExplicitProfileUpdate,profileUpdateFields} from '../src/profile-intent';
it.each(['Our services are Logo design and Brand identity. We serve customers Online.','Our business time zone is New York. I work alone.','Please update our services to Design and Consulting.','Our business time zone is New York. I work alone. Prepare these details.','Change my business name to Example.'])('routes explicit profile edits: %s',text=>expect(isExplicitProfileUpdate(text)).toBe(true));
it.each(['Update our services and growth plan.','What business name do you remember?','What is my business name? Do not change anything.','Save our appointment scheduling hours.','Prepare calendar changes for my business hours.','Read our website and update our services.','Prepare email notifications.'])('keeps other workflows available: %s',text=>expect(isExplicitProfileUpdate(text)).toBe(false));

it('scopes a services/location edit without exposing website or time zone fields',()=>{
 expect(profileUpdateFields('Our services are Logo design and Brand identity. We serve customers Online. Prepare only those services and locations.')).toEqual(['services','locations']);
});
it('keeps an explicitly unknown hours field available for clarification without inferring a value',()=>{
 expect(profileUpdateFields('Our business time zone is New York. I work alone with no staff. Our hours are unknown.')).toEqual(['hours','timeZone','staff']);
});
