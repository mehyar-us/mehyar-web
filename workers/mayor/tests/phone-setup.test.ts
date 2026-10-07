import {describe,it,expect} from 'vitest';
import {phoneSetupSchema,phoneSetupGuide} from '../src/phone-setup';
describe('new and existing phone setup',()=>{
  it('guides new owners without claiming a purchased number or connected account',()=>{
    const guide=phoneSetupGuide({mode:'new'});
    expect(guide.providers).toHaveLength(2);
    expect(guide.steps.join(' ')).toContain('charges');
    expect(guide.connectionVerified).toBe(false);
    expect(guide.purchaseAuthorized).toBe(false);
  });
  it('preserves the existing-number path and does not request secrets in chat',()=>{
    const guide=phoneSetupGuide({mode:'existing',provider:'twilio'});
    expect(guide.providers).toHaveLength(1);
    expect(guide.steps.join(' ')).toContain('Never speak or paste secrets');
    expect(guide.steps.join(' ')).toContain('Review any routing change');
  });
  it('rejects purchase/connection state injection and arbitrary URLs',()=>{
    expect(phoneSetupSchema.safeParse({mode:'new',purchaseAuthorized:true}).success).toBe(false);
    expect(phoneSetupSchema.safeParse({mode:'existing',provider:'https://evil.test'}).success).toBe(false);
    expect(phoneSetupSchema.safeParse({mode:'ready'}).success).toBe(false);
  });
});
