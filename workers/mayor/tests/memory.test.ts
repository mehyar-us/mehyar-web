import {describe,it,expect} from 'vitest';
import {isSpokenConfirmation,profileSchema} from '../src/memory';
describe('spoken profile confirmation',()=>{
  it('accepts clear short confirmations',()=>{
    for(const value of ['Yes.','Yes please','Save it!','That is correct.','Yes, that is correct.','Yes, that’s correct.','Yes, please.','Yes. That is correct.','Yes! That’s correct.'])expect(isSpokenConfirmation(value)).toBe(true);
  });
  it('does not treat qualified or quoted yeses as consent',()=>{
    for(const value of ['yes but change the hours','do not save it','The website says yes','not correct','yesterday','yes cancel that','guests','Yes, but change the name.','Yes?','Yes, that is not correct.','"yes"'])expect(isSpokenConfirmation(value)).toBe(false);
  });
  it('rejects unknown fields and invalid time zones',()=>{
    expect(profileSchema.safeParse({admin:true}).success).toBe(false);
    expect(profileSchema.safeParse({timeZone:'Moon/Base'}).success).toBe(false);
    expect(profileSchema.safeParse({}).success).toBe(false);
    expect(profileSchema.safeParse({timeZone:'America/New_York',name:'Example'}).success).toBe(true);
  });
  it('accepts ASR it-is variants without accepting negation or qualifications',()=>{
    for(const text of ['Yes, it is correct.',"Yes, it's correct."])expect(isSpokenConfirmation(text)).toBe(true);
    for(const text of ['Yes, it is not correct.','Yes, it is correct, but change the hours.','Yes, it is correct?'])expect(isSpokenConfirmation(text)).toBe(false);
  });
});
