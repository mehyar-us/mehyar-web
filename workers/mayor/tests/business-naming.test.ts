import {describe,expect,it} from 'vitest';
import {namingGreeting,validateBusinessName} from '../web/business-naming';

describe('business naming (crew 5 UX — no nameless auto-create)',()=>{
  it('accepts a real business name',()=>{
    expect(validateBusinessName('Salon Briana')).toBeNull();
    expect(validateBusinessName('  Fix-It Plumbing Co.  ')).toBeNull();
  });
  it('accepts the longest allowed name',()=>{
    expect(validateBusinessName('x'.repeat(160))).toBeNull();
  });
  it('rejects empty input with an actionable message',()=>{
    for(const text of ['','   '])expect(validateBusinessName(text)).toMatch(/business name/);
  });
  it('rejects overlong names',()=>{
    expect(validateBusinessName('x'.repeat(161))).toMatch(/160/);
  });
  it('rejects the old auto-create placeholder forever',()=>{
    for(const text of ['My business','my business','MY BUSINESS','  my business  '])
      expect(validateBusinessName(text)).toMatch(/placeholder/);
  });
  it('greets with the naming question',()=>{
    expect(namingGreeting()).toMatch(/What’s your business called\?/);
  });
});
