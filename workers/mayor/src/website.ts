import type {Actor,Env} from './env';
import {OPERATORS,requireMembership,requireTenant} from './permissions';
import {HttpError,digest} from './http';
import type {Profile} from './memory';

/** A read-only website answer must not attribute saved owner facts to the page. */
export function websiteEvidenceReadback(source:{url:string;excerpt:string},profile:Profile){
 const excerpt=source.excerpt.replace(/\s+/g,' ').trim();
 const boundary=excerpt.length>700?excerpt.lastIndexOf(' ',700):excerpt.length;
 const quote=excerpt.slice(0,boundary>500?boundary:Math.min(excerpt.length,700));
 const missing=([['services','services'],['locations','location'],['hours','business hours'],['timeZone','time zone'],['staff','staff'],['appointmentTypes','appointment types']] as const)
  .filter(([field])=>{const value=profile[field];return !value||(Array.isArray(value)&&!value.length);}).map(([,label])=>label);
 return `I read one public page on ${new URL(source.url).hostname}. The captured excerpt says: “${quote}${quote.length<excerpt.length?'…':''}” This may include page metadata; it is not a complete website review. Nothing was changed in your saved profile.${missing.length?` Your saved profile still needs ${missing.join(', ')}; those details remain unconfirmed.`:''}`;
}

const error=(message:string)=>new HttpError(400,'website_unavailable',message);
export function websiteWasSupplied(url:URL,transcript:string,confirmedWebsite?:string){
 try{if(confirmedWebsite&&new URL(confirmedWebsite).href===url.href)return true;}catch{}
 const spoken=transcript.toLowerCase().replace(/\s+dot\s+/g,'.');
 if(url.pathname!=='/')return spoken.includes(url.href.toLowerCase());
 // Permit explicitly spelled domain labels; never fuzzy-match a different name.
 const escaped=url.hostname.split('.').map(label=>label.split('').map(char=>char==='-'?'\\-':char).join('[\\s]*')).join('\\s*\\.\\s*');
 const matches=spoken.matchAll(new RegExp(`(?:^|[\\s/])(${escaped})(?=$|[\\s/,!?]|\\.(?![a-z0-9-]))`,'gi'));
 for(const match of matches){
  if(/\s/.test(match[1])){
   const start=match.index!+match[0].length-match[1].length;
   // Do not accept a suffix/prefix of a longer letter-by-letter domain.
   if(/(?:^|\s)[a-z]\s+$/.test(spoken.slice(0,start))||/^\s+[a-z](?=\s|$)/.test(spoken.slice(match.index!+match[0].length)))continue;
  }
  return true;
 }
 return false;
}
export function publicWebsiteUrl(input:string,appOrigin:string){
 let url:URL;try{url=new URL(input);}catch{throw error('Please provide the full HTTPS website address.');}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||input.length>2048||
  !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||
  /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)||host===new URL(appOrigin).hostname)
  throw error('Use a public HTTPS business webpage without login details, query parameters, or a fragment.');
 url.hostname=host;return url;
}

async function boundedText(response:Response){
 const reader=response.body?.getReader();if(!reader)throw error('That page has no readable content.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>512000)throw error('That page is too large. Try a shorter About or Services page.');chunks.push(value);
 }}finally{await reader.cancel();}
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder().decode(data);
}

export async function extractWebsiteText(html:string){
 // Two passes ensure text in removed elements never reaches the text collector.
 const clean=new HTMLRewriter().on('script,style,noscript,template,svg,iframe,form,nav,footer,[hidden],[aria-hidden="true"]',{element(element){element.remove();}})
  .transform(new Response(html, {headers:{'content-type':'text/html'}}));
 let title='',text='';const descriptions:string[]=[];
 const parsed=new HTMLRewriter().on('title',{text(chunk){if(title.length<300)title+=chunk.text;}})
  .on('meta[name="description"],meta[property="og:description"]',{element(element){const value=element.getAttribute('content');if(value&&descriptions.length<2)descriptions.push(value.slice(0,2000));}})
  .on('body',{text(chunk){if(text.length<16000)text+=chunk.text;}})
  .on('p,div,br,li,h1,h2,h3,h4,section,article',{element(element){text+=' ';if(element.tagName!=='br')element.onEndTag(()=>{text+=' ';});}}).transform(clean);
 await parsed.arrayBuffer();
 const cleanTitle=title.replace(/\s+/g,' ').trim().slice(0,300);
 const excerpt=[cleanTitle?`Page title: ${cleanTitle}`:'',...descriptions.map(value=>`Page description: ${value}`),text].join('\n').replace(/\s+/g,' ').trim().slice(0,12000);
 return {title:cleanTitle,excerpt};
}

/** Uses only Cloudflare global fetch (public Internet); never a private service/VPC binding.
 * No caller headers, cookies, tokens or tenant data are sent to the site.
 */
export async function fetchWebsite(input:string,appOrigin:string,transport:typeof fetch=fetch){
 let url=publicWebsiteUrl(input,appOrigin);const visited=new Set<string>(),signal=AbortSignal.timeout(12000);
 for(let redirects=0;redirects<=3;redirects++){
  if(visited.has(url.href))throw error('That website redirects in a loop.');visited.add(url.href);
  const response=await transport(url.href,{method:'GET',redirect:'manual',signal,headers:{accept:'text/html,text/plain;q=0.8','user-agent':'TheMayor/1.0 (+https://mayor.mehyar.us)'}});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();
   if(!location)throw error('That website returned an incomplete redirect.');
   url=publicWebsiteUrl(new URL(location,url).href,appOrigin);continue;
  }
  if(!response.ok){await response.body?.cancel();throw error('I could not read that public page. Try another page or describe your business.');}
  const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!['text/html','text/plain'].includes(type??'')){await response.body?.cancel();throw error('Use a public text or HTML page.');}
  const raw=await boundedText(response),content=type==='text/html'?await extractWebsiteText(raw):{title:'',excerpt:raw.replace(/\s+/g,' ').trim().slice(0,12000)};
  if(content.excerpt.length<40)throw error('That page has too little readable text. Describe your business or provide another page.');
  return {url:url.href,...content};
 }
 throw error('That website has too many redirects.');
}

export async function researchWebsite(env:Env,actor:Actor,url:string,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 if((await requireTenant(env,actor)).status!=='active')throw error('This workspace is not active.');
 const requested=publicWebsiteUrl(url,env.APP_ORIGIN).href;
 const bucket=Math.floor(Date.now()/60000);
 const rate=await env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)
  ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(`website:${actor.tenantId}`,bucket).first<{count:number}>();
 if(!rate||rate.count>3)throw new HttpError(429,'website_rate_limit','Please wait a minute before researching another page.');
 const page=await fetchWebsite(requested,env.APP_ORIGIN,transport);
 await requireMembership(env,actor,OPERATORS);
 const id=crypto.randomUUID(),fetchedAt=new Date().toISOString();
 await env.AGENT_DB.prepare('INSERT INTO mayor_website_sources(id,tenant_id,requested_url,source_url,title,excerpt,content_hash,fetched_by,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(id,actor.tenantId,requested,page.url,page.title,page.excerpt,await digest(page.excerpt),actor.userId,fetchedAt).run();
 return {sourceId:id,...page,fetchedAt,untrusted:true,confirmed:false,coverage:'One static public page excerpt, including page metadata. JavaScript is not executed; not a complete website crawl. Missing information remains unknown.'};
}
