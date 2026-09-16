import {describe,it,expect} from 'vitest';
import {calibratedTextReservation,verifyCalibratedTextReceipt} from '../src/billing/text-calibration';
const now=Date.parse('2026-09-17T00:00:00Z'),gateway='mehyar-business-agent-dev';
const request={messages:[{role:'system',content:'Synthetic token calibration. Reply only OK.'},{role:'user',content:' a'.repeat(11950)}],max_tokens:64};
describe('scoped development token calibration',()=>{
  it('corrects the independently observed credit-boundary request',()=>{
    expect(calibratedTextReservation(request,gateway,now)).toMatchObject({inputTokens:12025,credits:2,outputTokenLimit:64});
  });
  it('requires the observed input count and bounded output before settlement',()=>{
    expect(verifyCalibratedTextReceipt(request,gateway,{usage:{prompt_tokens:12025,completion_tokens:64,total_tokens:12089}},now).credits).toBe(2);
    for(const response of [{},{usage:{prompt_tokens:11968,completion_tokens:64,total_tokens:12032}},
      {usage:{prompt_tokens:12025,completion_tokens:65,total_tokens:12090}}])
      expect(()=>verifyCalibratedTextReceipt(request,gateway,response,now)).toThrow('did not match');
  });
  it('rejects expired, premature and other-gateway calibration',()=>{
    for(const time of [NaN,Date.parse('2026-09-16T20:00:00Z'),Date.parse('2026-10-16T21:37:47Z')])
      expect(()=>calibratedTextReservation(request,gateway,time)).toThrow();
    expect(()=>calibratedTextReservation(request,'production',now)).toThrow();
  });
  it('does not apply the observed constant to other message shapes or sizes',()=>{
    for(const input of [{...request,max_tokens:2001},{...request,messages:request.messages.slice(1)},
      {...request,messages:[...request.messages,{role:'assistant',content:'Hi'}]},
      {...request,messages:[request.messages[0],{role:'user',content:'x'.repeat(64000)}]}])
      expect(()=>calibratedTextReservation(input,gateway,now)).toThrow();
  });
});
