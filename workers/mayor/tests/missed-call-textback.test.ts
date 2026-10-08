import {describe,it,expect,vi} from 'vitest';
import {missedCallInputSchema} from '../src/missed-call-textback';
import {verticalProfile} from '../src/verticals';

describe('missed-call input validation',()=>{
 it('accepts a valid E.164 caller number',()=>{
  const parsed=missedCallInputSchema.parse({callerNumber:'+17189217300',businessNumber:'+17477772687',source:'test'});
  expect(parsed.callerNumber).toBe('+17189217300');
 });
 it('rejects non-E.164 numbers',()=>{
  expect(()=>missedCallInputSchema.parse({callerNumber:'718-921-7300',source:'test'})).toThrow();
  expect(()=>missedCallInputSchema.parse({callerNumber:'abc',source:'test'})).toThrow();
 });
 it('defaults source to webhook',()=>{
  const parsed=missedCallInputSchema.parse({callerNumber:'+17189217300'});
  expect(parsed.source).toBe('webhook');
 });
 it('rejects unknown fields (strict)',()=>{
  expect(()=>missedCallInputSchema.parse({callerNumber:'+17189217300',hacker:'x'})).toThrow();
 });
});

describe('text-back template rendering',()=>{
 it('replaces {business} with the business name',()=>{
  const profile=verticalProfile('salon');
  const text=profile.textbackTemplate.replace('{business}','Salon Briana');
  expect(text).toContain('Salon Briana');
  expect(text).not.toContain('{business}');
 });
 it('all templates stay under SMS segment limits with a long name',()=>{
  const longName='A Very Long Business Name That Keeps Going LLC';
  for(const v of ['salon','restaurant','plumbing_hvac','dental','auto_repair','other'] as const){
   const text=verticalProfile(v).textbackTemplate.replace('{business}',longName);
   expect(text.length).toBeLessThan(306);
  }
 });
});
