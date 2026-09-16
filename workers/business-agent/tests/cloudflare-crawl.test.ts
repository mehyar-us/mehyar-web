import {describe,it,expect} from 'vitest';
import {CloudflareCrawl} from '../src/research/cloudflare-crawl';
const account='a'.repeat(32),id='11111111-1111-4111-8111-111111111111',source='https://salon.example.com/';
const envelope=(result:unknown)=>Response.json({success:true,result});
describe('bounded Cloudflare crawl adapter',()=>{
  it('submits only a bounded public static crawl without training or external-domain discovery',async()=>{
    let calls=0;
    const client=new CloudflareCrawl(account,'fixture-token',async(input,init)=>{
      calls++;expect(String(input)).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/crawl`);
      expect(init?.redirect).toBe('error');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-token');
      expect(JSON.parse(String(init?.body))).toEqual({url:source,limit:20,depth:2,source:'all',formats:['html'],render:false,maxAge:0,crawlPurposes:['ai-input'],contentUse:'reference',options:{includeExternalLinks:false,includeSubdomains:false}});
      return envelope(id);
    });
    expect(await client.start({url:source,limit:20,depth:2})).toEqual({id});expect(calls).toBe(1);
  });
  it.each(['http://127.0.0.1','http://169.254.169.254/latest','https://localhost','https://user:secret@example.com'])('rejects unsafe initial URL %s before dispatch',async url=>{
    let calls=0;const client=new CloudflareCrawl(account,'fixture',async()=>{calls++;return envelope(id);});
    await expect(client.start({url,limit:20,depth:2})).rejects.toMatchObject({code:'invalid_website'});expect(calls).toBe(0);
  });
  it('enforces page/depth limits before dispatch',async()=>{
    const client=new CloudflareCrawl(account,'fixture',async()=>{throw new Error('must not dispatch');});
    await expect(client.start({url:source,limit:1001,depth:2})).rejects.toMatchObject({code:'invalid_crawl_limits'});
    await expect(client.start({url:source,limit:20,depth:6})).rejects.toMatchObject({code:'invalid_crawl_limits'});
  });
  it('marks a lost submission as uncertain and never automatically submits twice',async()=>{
    let calls=0;const client=new CloudflareCrawl(account,'fixture-secret',async()=>{calls++;throw new Error('fixture-secret raw failure');});
    const failure=await client.start({url:source,limit:20,depth:2}).catch(error=>error);
    expect(failure.code).toBe('crawl_start_uncertain');expect(failure.message).not.toContain('fixture-secret');expect(calls).toBe(1);
  });
  it('reads one bounded result and a numeric continuation cursor',async()=>{
    const client=new CloudflareCrawl(account,'fixture',async(input,init)=>{
      expect(String(input)).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/crawl/${id}?limit=1&cursor=2`);
      expect(init?.method).toBe('GET');return envelope({id,status:'completed',browserSecondsUsed:0,records:[{url:source,status:'completed',html:'<title>Salon</title>',metadata:{status:200,url:source}}],cursor:3});
    });
    expect(await client.results(id,source,2)).toMatchObject({id,status:'completed',cursor:3,records:[{url:source,status:'completed',html:'<title>Salon</title>',httpStatus:200}]});
  });
  it.each(['record','redirect'])('rejects cross-origin %s content after retrieval',async kind=>{
    const client=new CloudflareCrawl(account,'fixture',async()=>envelope({id,status:'completed',records:[{url:kind==='record'?'https://other.example.com/':source,status:'completed',html:'private',metadata:{status:200,url:kind==='redirect'?'https://other.example.com/':source}}]}));
    await expect(client.results(id,source)).rejects.toMatchObject({code:'crawl_origin_changed'});
  });
  it('preserves robots-disallowed outcomes without importing the response HTML as business evidence',async()=>{
    const client=new CloudflareCrawl(account,'fixture',async()=>envelope({id,status:'completed',records:[{url:source,status:'disallowed',html:'Do not import this error page',metadata:{status:403}}]}));
    expect((await client.results(id,source)).records[0]).toEqual({url:source,status:'disallowed',httpStatus:403,finalUrl:source});
  });
  it('rejects oversized results and unknown provider schemas',async()=>{
    const large=new CloudflareCrawl(account,'fixture',async()=>new Response('x'.repeat(2_097_153)));
    await expect(large.results(id,source)).rejects.toMatchObject({code:'crawl_read_failed'});
    const unknown=new CloudflareCrawl(account,'fixture',async()=>envelope({id,status:'made-up',records:[]}));
    await expect(unknown.results(id,source)).rejects.toMatchObject({code:'invalid_crawl_result'});
  });
  it('validates provider identifiers and cursors without allowing endpoint injection',async()=>{
    const client=new CloudflareCrawl(account,'fixture',async()=>{throw new Error('must not dispatch');});
    await expect(client.results('../another-account',source)).rejects.toMatchObject({code:'invalid_crawl_job'});
    await expect(client.results(id,source,'https://evil.example.com' as unknown as number)).rejects.toMatchObject({code:'invalid_crawl_cursor'});
    expect(()=>new CloudflareCrawl('../account','fixture')).toThrow();
  });
  it('requests cancellation without claiming completion',async()=>{
    const client=new CloudflareCrawl(account,'fixture',async(input,init)=>{expect(String(input)).toContain('/crawl/'+id);expect(init?.method).toBe('DELETE');return envelope(null);});
    expect(await client.cancel(id)).toEqual({requested:true});
  });
  it.each(['', 'http://127.0.0.1', 'https://user:secret@example.com'])('sanitizes malformed provider page URLs: %s',async url=>{
    const client=new CloudflareCrawl(account,'fixture',async()=>envelope({id,status:'completed',records:[{url,status:'completed',html:'page',metadata:{status:200}}]}));
    await expect(client.results(id,source)).rejects.toMatchObject({code:'invalid_crawl_record',status:502});
  });
  it('rejects fractional HTTP success statuses',async()=>{
    const client=new CloudflareCrawl(account,'fixture',async()=>envelope({id,status:'completed',records:[{url:source,status:'completed',html:'page',metadata:{status:200.5}}]}));
    await expect(client.results(id,source)).rejects.toMatchObject({code:'invalid_crawl_record'});
  });
});
