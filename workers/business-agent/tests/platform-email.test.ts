import {describe,it,expect} from 'vitest';
import {PlatformResendClient,type PlatformEmail} from '../src/email/resend';
import {invitationEmail} from '../src/email/invitation-template';
const now=Date.parse('2026-09-16T16:00:00Z'),first=new Date(now).toISOString(),id='4ef9a417-02e9-4d39-ad75-9611e0fcc33c',key=`mayor-ai:email:${'a'.repeat(64)}`;
const message:PlatformEmail={from:'notices@example.test',to:['owner@example.test'],subject:'Workspace invitation',text:'Review your invitation.'};
describe('new platform transactional email transport',()=>{
  it('sends an exact single-recipient payload to a fixed origin and records acceptance only',async()=>{
    const calls:{url:string;init:RequestInit}[]=[];const client=new PlatformResendClient('re_fixture',async(url,init)=>{calls.push({url,init});return Response.json({id});},()=>now);
    expect(await client.send(message,key,first)).toEqual({state:'accepted',providerId:id});expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');expect(calls[0].init.redirect).toBe('error');expect(calls[0].init.body).toBe(JSON.stringify(message));expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe(key);
  });
  it('refuses expired/future retry windows and invalid payloads without external requests',async()=>{
    let calls=0;const client=new PlatformResendClient('re_fixture',async()=>{calls++;return Response.json({id});},()=>now);
    for(const stamp of [new Date(now-23*3600000).toISOString(),new Date(now+1).toISOString(),'invalid'])expect(await client.send(message,key,stamp)).toEqual({state:'review_required',code:'email_retry_window_closed'});
    await expect(client.send({...message,subject:'Hello\r\nBcc: another@example.test'},key,first)).rejects.toBeDefined();
    await expect(client.send(message,'legacy-key',first)).rejects.toThrow('invalid_platform_email_request_key');expect(calls).toBe(0);
  });
  it('never retries ambiguous network/provider responses automatically or exposes provider error text',async()=>{
    for(const response of [new Response('private failure',{status:500}),Response.json({message:'private error'},{status:503}),Response.json({id:'invalid'}),new Response('x'.repeat(65537))]){
      let calls=0;const client=new PlatformResendClient('re_fixture',async()=>{calls++;return response;},()=>now);const result=await client.send(message,key,first);expect(result.state).toBe('uncertain');expect(JSON.stringify(result)).not.toContain('private');expect(calls).toBe(1);
    }
    const client=new PlatformResendClient('re_fixture',async()=>{throw new Error('private token');},()=>now);expect(await client.send(message,key,first)).toEqual({state:'uncertain',code:'email_transport_uncertain'});
  });
  it('distinguishes concurrent requests, conflicting payloads, rate limits and rejected attempts',async()=>{
    for(const [status,name,state] of [[409,'concurrent_idempotent_requests','deferred'],[409,'invalid_idempotent_request','conflict'],[429,'rate_limit_exceeded','deferred'],[403,'validation_error','rejected']] as const){
      const client=new PlatformResendClient('re_fixture',async()=>Response.json({name},{status}),()=>now);expect((await client.send(message,key,first)).state).toBe(state);
    }
  });
  it('retrieves only an exact owned payload and does not turn an arbitrary event into delivery',async()=>{
    const receipt={id,from:message.from,to:message.to,subject:message.subject,text:message.text,cc:[],bcc:[],last_event:'delivered'};
    const client=new PlatformResendClient('re_fixture',async()=>Response.json(receipt));expect(await client.receipt(id,message)).toEqual({providerId:id,lastEvent:'delivered'});
    for(const changed of [{to:['foreign@example.test']},{bcc:['hidden@example.test']},{subject:'Other message'},{text:'Other body'},{id:'other'}]){
      const wrong=new PlatformResendClient('re_fixture',async()=>Response.json({...receipt,...changed}));await expect(wrong.receipt(id,message)).rejects.toThrow('platform_email_receipt_mismatch');
    }
  });
  it('renders a fixed invitation purpose without granting access or accepting arbitrary links',()=>{
    const input={from:'notices@example.test',recipient:'owner@example.test',businessName:'Oak & Ivy',role:'staff' as const,expiresAt:'2026-09-23T00:00:00Z',appOrigin:'https://app.mehyar.us'};
    const email=invitationEmail(input);expect(email.to).toEqual([input.recipient]);expect(email.text).toContain('does not connect your email');expect(email.text).toContain('https://app.mehyar.us/');expect(email).not.toHaveProperty('html');
    for(const appOrigin of ['http://app.mehyar.us','https://evil.test/path','https://user:secret@app.mehyar.us','https://app.mehyar.us/?next=https://evil.test'])expect(()=>invitationEmail({...input,appOrigin})).toThrow();
    expect(()=>invitationEmail({...input,businessName:'Name\nFake authority'})).toThrow();
  });
});
