import {digest} from './http';
import {extractWebsiteText,publicWebsiteUrl} from './website';
import {AuditFailure,type AuditContext,type AuditEvidence,type AuditSource} from './business-audit-schema';

const MAX_PAGE_BYTES=256000,MAX_TOTAL_BYTES=1500000,MAX_SOURCES=8;
const STATIC_LIMITS=['Only returned public HTML and text were inspected. JavaScript, screenshots, responsive layouts, accessibility conformance, page speed, and working form or booking submissions were not tested.','No search ranking, review volume, traffic, revenue, conversion rate, customer retention, internal staffing, or private tool configuration was measured. Their current baselines remain unknown.','Impact, effort, and priority are planning judgments, not measured business performance or guaranteed outcomes.','Recommendations cover business operations and customer experience, not legal, medical, investment, accounting, or regulatory advice.'];
export function isPublicAuditAddress(value:string):boolean {
 if(value.trim()!==value)return false;
 if(/^\d+\.\d+\.\d+\.\d+$/.test(value)){
  const p=value.split('.').map(Number);if(p.some(v=>v<0||v>255))return false;const [a,b,c]=p;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0&&(c===0||c===2)||a===192&&b===88&&c===99||a===198&&(b===18||b===19)||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
 }
 if(!/^[a-f0-9:]+$/i.test(value)||value.includes(':::'))return false;
 const halves=value.toLowerCase().split('::');if(halves.length>2)return false;
 const left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
 if([...left,...right].some(piece=>!/^[a-f0-9]{1,4}$/.test(piece))||halves.length===1&&left.length!==8||halves.length===2&&left.length+right.length>=8)return false;
 const words=[...left,...Array(8-left.length-right.length).fill('0'),...right].map(piece=>parseInt(piece,16));
 // Only global unicast; also exclude documentation, transition, benchmark, and ORCHID ranges.
 return words[0]>=0x2000&&words[0]<=0x3fff&&words[0]!==0x2002&&!(words[0]===0x2001&&(words[1]===0||words[1]===2||words[1]===0xdb8||(words[1]&0xfff0)===0x10||(words[1]&0xfff0)===0x20))&&!(words[0]===0x3fff&&(words[1]&0xf000)===0);
}
async function boundedBody(response:Response,maxBytes:number,budget?:{remaining:number}){
 const reader=response.body?.getReader();if(!reader)throw new AuditFailure('source_unavailable');const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes||budget&&(budget.remaining-=value.byteLength)<0)throw new AuditFailure('source_too_large');chunks.push(value);}}finally{try{await reader.cancel();}catch{/* Cleanup must not replace a successful bounded read or its original failure. */}}
 const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(body);}catch{throw new AuditFailure('source_unavailable');}
}
export function auditSourceUrl(input:string,appOrigin:string){
 try{const url=new URL(input);if(url.protocol==='http:'&&!url.port)url.protocol='https:';url.hash='';return publicWebsiteUrl(url.href,appOrigin);}catch{throw new AuditFailure('unsafe_source',true);}
}
async function assertPublicDns(host:string,transport:typeof fetch,signal:AbortSignal){
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
  let response:Response;try{response=await transport(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,{method:'GET',redirect:'manual',headers:{accept:'application/dns-json','accept-encoding':'identity'},signal});}catch{throw new AuditFailure('source_dns_unavailable');}
  if(!response.ok){await response.body?.cancel();throw new AuditFailure('source_dns_unavailable');}
  let json:unknown;try{json=JSON.parse(await boundedBody(response,16384));}catch(error){if(error instanceof AuditFailure)throw error;throw new AuditFailure('source_dns_unavailable');}
  const data=json as {Status?:number;Answer?:{type?:number;data?:string}[]};if(!data||typeof data!=='object'||data.Status!==0||data.Answer&&!Array.isArray(data.Answer)||(data.Answer??[]).some(answer=>!answer||typeof answer!=='object'||typeof answer.type!=='number'||typeof answer.data!=='string'))throw new AuditFailure('source_dns_unavailable');
  return (data.Answer??[]).filter(answer=>answer.type===1||answer.type===28).map(answer=>answer.data??'');
 }));
 const addresses=answers.flat();if(!addresses.length)throw new AuditFailure('source_dns_unavailable');if(addresses.some(address=>!isPublicAuditAddress(address)))throw new AuditFailure('unsafe_source',true);
}
function domainFamily(host:string){return host.replace(/^www\./,'');}
async function inspectHtml(raw:string){
 const observations:AuditSource['observations']={titlePresent:false,descriptionPresent:false,viewportPresent:false,h1Count:0,imageCount:0,imagesMissingAlt:0,formCount:0,bookingLinkCount:0,contactLinkCount:0};
 const links:{href:string;text:string}[]=[];
 const response=new HTMLRewriter().on('title',{element(){observations.titlePresent=true;}})
 .on('meta[name="description"]',{element(element){observations.descriptionPresent=Boolean(element.getAttribute('content')?.trim());}})
 .on('meta[name="viewport"]',{element(element){observations.viewportPresent=Boolean(element.getAttribute('content')?.trim());}})
 .on('h1',{element(){observations.h1Count++;}}).on('img',{element(element){observations.imageCount++;if(element.getAttribute('alt')===null)observations.imagesMissingAlt++;}})
 .on('form',{element(){observations.formCount++;}}).on('a[href]',{element(element){const href=element.getAttribute('href')??'';if(/book|appointment|schedule|reserve/i.test(href))observations.bookingLinkCount++;if(/contact|^mailto:|^tel:/i.test(href))observations.contactLinkCount++;if(links.length<120)links.push({href,text:''});}}).transform(new Response(raw,{headers:{'content-type':'text/html'}}));
 await response.arrayBuffer();return {observations,links};
}
async function readPage(input:string,appOrigin:string,transport:typeof fetch,signal:AbortSignal,budget:{remaining:number},family:string){
 let url=auditSourceUrl(input,appOrigin);const visited=new Set<string>();
 for(let redirects=0;redirects<=3;redirects++){
  if(domainFamily(url.hostname)!==family||visited.has(url.href))throw new AuditFailure('unsafe_source',true);visited.add(url.href);await assertPublicDns(url.hostname,transport,signal);
  let response:Response;try{response=await transport(url.href,{method:'GET',redirect:'manual',signal,headers:{accept:'text/html,text/plain;q=0.8','accept-encoding':'identity','user-agent':'MayorBusinessAudit/1.0 (+https://mayor.mehyar.us)'}});}catch{throw new AuditFailure('source_unavailable');}
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new AuditFailure('source_unavailable');url=auditSourceUrl(new URL(location,url).href,appOrigin);continue;}
  if(!response.ok){await response.body?.cancel();throw new AuditFailure('source_unavailable');}
  const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();if(type!=='text/html'&&type!=='text/plain'){await response.body?.cancel();throw new AuditFailure('source_type_unsupported');}
  const raw=await boundedBody(response,MAX_PAGE_BYTES,budget),content=type==='text/html'?await extractWebsiteText(raw):{title:'',excerpt:raw.replace(/\s+/g,' ').trim()};
  const inspected=type==='text/html'?await inspectHtml(raw):{observations:{titlePresent:false,descriptionPresent:false,viewportPresent:false,h1Count:0,imageCount:0,imagesMissingAlt:0,formCount:0,bookingLinkCount:0,contactLinkCount:0},links:[]};
  if(content.excerpt.length<80)throw new AuditFailure('insufficient_evidence');return {url:url.href,title:content.title,excerpt:content.excerpt.slice(0,6000),...inspected};
 }
 throw new AuditFailure('source_redirect_limit');
}
/** Fixed public DNS service plus Cloudflare global public fetch; never private bindings or owner headers.
 * DNS is checked before every request/redirect. Cloudflare does not expose IP pinning here: these
 * checks are defense in depth, not a claim to defeat every possible DNS rebinding race.
 */
export async function collectAuditEvidence(context:AuditContext,appOrigin:string,transport:typeof fetch=fetch,now=Date.now()):Promise<AuditEvidence>{
 const root=auditSourceUrl(context.website,appOrigin),signal=AbortSignal.timeout(120000),budget={remaining:MAX_TOTAL_BYTES};
 const sources:AuditSource[]=[],limitations=[...STATIC_LIMITS],seen=new Set<string>();
 async function add(input:string,providedBy:AuditSource['providedBy']){
  const url=auditSourceUrl(input,appOrigin);if(seen.has(url.href)||sources.length>=MAX_SOURCES)return null;seen.add(url.href);
  const page=await readPage(url.href,appOrigin,transport,signal,budget,domainFamily(url.hostname));if(sources.some(source=>source.url===page.url))return null;
  sources.push({id:`S${sources.length+1}`,url:page.url,title:page.title,checkedAt:new Date(now).toISOString(),contentHash:await digest(page.excerpt),excerpt:page.excerpt,observations:page.observations,providedBy});return page;
 }
 const home=await add(root.href,'website');if(!home)throw new AuditFailure('insufficient_evidence');
 const candidates=home.links.map(link=>{try{const url=auditSourceUrl(new URL(link.href,home.url).href,appOrigin);return domainFamily(url.hostname)===domainFamily(root.hostname)&&url.pathname!=='/'&&/about|service|contact|pricing|book|appointment|schedule|team|faq|location/i.test(url.pathname)?url:null;}catch{return null;}}).filter((url):url is URL=>url!==null);
 for(const url of [...new Map(candidates.map(url=>[url.href,url])).values()].slice(0,4)){
  try{await add(url.href,'website');}catch(error){limitations.push(`An additional linked business page could not be safely checked (${error instanceof AuditFailure?error.code:'source_unavailable'}). Its content remains unknown.`);}
 }
 for(const link of (context.links??[]).slice(0,3)){
  try{await add(link,'owner_link');}catch(error){limitations.push(`An owner-supplied public link could not be safely checked (${error instanceof AuditFailure?error.code:'source_unavailable'}). Listing status and metrics on that link remain unverified.`);}
 }
 if((context.links?.length??0)>3)limitations.push('The collection limit includes the first three owner-supplied links; additional links were not inspected.');
 if(sources.reduce((sum,source)=>sum+source.excerpt.length,0)<300)throw new AuditFailure('insufficient_evidence',true);
 return {sources,limitations:[...new Set(limitations)],collectedAt:new Date(now).toISOString()};
}
