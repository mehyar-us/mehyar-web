import {HttpError} from '../http';
import {normalizeWebsite} from '../tenants';

const statuses=['running','completed','cancelled_due_to_timeout','cancelled_due_to_limits','cancelled_by_user','errored'] as const;
type JobStatus=typeof statuses[number];
type RecordStatus='queued'|'completed'|'disallowed'|'skipped'|'errored'|'cancelled';
export type CrawlRecord={url:string;status:RecordStatus;html?:string;httpStatus?:number;finalUrl?:string};
export type CrawlResults={id:string;status:JobStatus;records:CrawlRecord[];cursor?:number;browserSecondsUsed?:number};
const fail=(code:string,message:string,status=502)=>new HttpError(status,code,message);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const jobId=(id:string)=>{if(!/^[a-zA-Z0-9_-]{16,128}$/.test(id))throw fail('invalid_crawl_job','Invalid crawl job identifier.',400);return id;};
const providerUrl=(value:string)=>{
  try {const url=normalizeWebsite(value);if(url)return url;}catch{/* Untrusted provider fields get a stable, sanitized error. */}
  throw fail('invalid_crawl_record','A crawl record contained an invalid public URL.');
};

/** Internal provider adapter only: the durable caller must authorize the tenant,
 * reserve quota, verify network-safety release evidence and persist dispatch
 * before start(). No retries are made here, especially after ambiguous starts. */
export class CloudflareCrawl {
  private readonly base:string;
  constructor(accountId:string,private token:string,private transport:typeof fetch=fetch) {
    if(!/^[a-f0-9]{32}$/.test(accountId)||!token)throw fail('crawl_not_configured','Website research is not configured.',503);
    this.base=`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/crawl`;
  }
  private async request(path:string,method:'GET'|'POST'|'DELETE',body?:unknown):Promise<unknown> {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
    try {
      const response=await this.transport(this.base+path,{method,redirect:'error',signal:controller.signal,
        headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok) {
        await response.body?.cancel();
        throw fail(method==='POST'&&response.status>=500?'crawl_start_uncertain':'crawl_provider_rejected','The crawl provider could not complete this request.',response.status===429?429:502);
      }
      const reader=response.body?.getReader();if(!reader)throw new Error('empty response');
      const chunks:Uint8Array[]=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_097_152){await reader.cancel();throw new Error('response limit');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const data:unknown=JSON.parse(new TextDecoder().decode(bytes));
      if(!object(data)||data.success!==true||!('result' in data))throw new Error('invalid envelope');
      return data.result;
    }catch(error){if(error instanceof HttpError)throw error;throw fail(method==='POST'?'crawl_start_uncertain':'crawl_read_failed',method==='POST'?'Crawl submission outcome is uncertain. Reconcile it before submitting again.':'Crawl results could not be read.');}
    finally{clearTimeout(timer);}
  }
  async start(input:{url:string;limit:number;depth:number}) {
    const url=normalizeWebsite(input.url);
    if(!url||!Number.isInteger(input.limit)||input.limit<1||input.limit>1000||!Number.isInteger(input.depth)||input.depth<0||input.depth>5)
      throw fail('invalid_crawl_limits','Choose bounded crawl limits.',400);
    const result=await this.request('','POST',{url,limit:input.limit,depth:input.depth,source:'all',formats:['html'],render:false,maxAge:0,
      crawlPurposes:['ai-input'],contentUse:'reference',options:{includeExternalLinks:false,includeSubdomains:false}});
    if(typeof result!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(result))throw fail('crawl_start_uncertain','The provider did not return a valid job identifier. Reconcile before resubmitting.');
    return {id:result};
  }
  async results(id:string,sourceUrl:string,cursor?:number):Promise<CrawlResults> {
    jobId(id);const source=normalizeWebsite(sourceUrl);if(!source)throw fail('invalid_crawl_source','A source website is required.',400);
    if(cursor!==undefined&&(!Number.isSafeInteger(cursor)||cursor<0))throw fail('invalid_crawl_cursor','Invalid crawl cursor.',400);
    const raw=await this.request(`/${id}?limit=1${cursor===undefined?'':`&cursor=${cursor}`}`,'GET');
    if(!object(raw)||raw.id!==id||!statuses.includes(raw.status as JobStatus)||!Array.isArray(raw.records)||raw.records.length>1)
      throw fail('invalid_crawl_result','The provider returned an unexpected crawl result.');
    const records:CrawlRecord[]=[];
    for(const record of raw.records) {
      if(!object(record)||typeof record.url!=='string'||!['queued','completed','disallowed','skipped','errored','cancelled'].includes(String(record.status)))throw fail('invalid_crawl_record','A crawl record could not be verified.');
      let recordUrl:string;
      try{recordUrl=providerUrl(record.url);}catch(error){if(record.status!=='skipped')throw error;continue;}
      // The provider reports individually evaluated excluded URLs as skipped.
      // They are not fetched evidence and may be outside the approved origin.
      if(record.status==='skipped'){
        if(new URL(recordUrl).origin===new URL(source).origin){
          const metadata=object(record.metadata)?record.metadata:{};
          records.push({url:recordUrl,status:record.status as RecordStatus,
            httpStatus:typeof metadata.status==='number'&&Number.isInteger(metadata.status)?metadata.status:undefined,finalUrl:recordUrl});
        }
        continue;
      }
      if(new URL(recordUrl).origin!==new URL(source).origin)throw fail('crawl_origin_changed','The crawl returned a page outside the approved website.');
      const metadata=object(record.metadata)?record.metadata:{};
      const finalUrl=typeof metadata.url==='string'?providerUrl(metadata.url):recordUrl;
      if(new URL(finalUrl).origin!==new URL(source).origin)throw fail('crawl_origin_changed','A crawled page redirected outside the approved website.');
      const httpStatus=typeof metadata.status==='number'&&Number.isInteger(metadata.status)?metadata.status:undefined;
      if(record.status==='completed'&&(httpStatus===undefined||httpStatus<200||httpStatus>=300||typeof record.html!=='string'||new TextEncoder().encode(record.html).length>1_048_576))
        throw fail('invalid_crawl_record','A completed page did not contain bounded successful HTML.');
      records.push({url:recordUrl,status:record.status as RecordStatus,...(record.status==='completed'?{html:record.html as string}:{}),httpStatus,finalUrl});
    }
    if(raw.cursor!==undefined&&(!Number.isSafeInteger(raw.cursor)||Number(raw.cursor)<0))throw fail('invalid_crawl_cursor','The provider returned an invalid cursor.');
    return {id,status:raw.status as JobStatus,records,...(raw.cursor===undefined?{}:{cursor:raw.cursor as number}),
      ...(typeof raw.browserSecondsUsed==='number'&&Number.isFinite(raw.browserSecondsUsed)&&raw.browserSecondsUsed>=0?{browserSecondsUsed:raw.browserSecondsUsed}:{})};
  }
  async cancel(id:string) {await this.request('/'+jobId(id),'DELETE');return {requested:true};}
}
