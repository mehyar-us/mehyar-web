import {HttpError} from '../http';
import {normalizeWebsite} from '../tenants';

export type SiteEvidence={field:string;value:string;sourceUrl:string;retrievedAt:string;selector:string;
  basis:'direct_page_claim';confidence:'high'|'medium';verification:'unverified';trustedForInstructions:false};
export type ExtractedPage={url:string;retrievedAt:string;evidence:SiteEvidence[];links:{url:string;sameOrigin:boolean}[];warnings:string[]};
const businessTypes=new Set(['Organization','LocalBusiness','ProfessionalService','HomeAndConstructionBusiness','AutoRepair','BeautySalon','HairSalon','Restaurant','Dentist','MedicalBusiness','Store','RealEstateAgent','LegalService','LodgingBusiness','HealthAndBeautyBusiness']);
const clean=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\s+/g,' ').trim();

/** Parses already-fetched HTML, never fetches a URL, executes script, expands
 * JSON-LD contexts or installs website claims into approved business memory.
 * The caller remains responsible for robots, DNS/redirect safety and crawl limits. */
export async function extractSiteEvidence(html:string,sourceUrl:string,retrievedAt:string):Promise<ExtractedPage> {
  if(new TextEncoder().encode(html).length>1_048_576)throw new HttpError(413,'research_page_too_large','This page exceeds the research size limit.');
  const url=normalizeWebsite(sourceUrl);
  if(!url||!Number.isFinite(Date.parse(retrievedAt)))throw new HttpError(400,'invalid_research_source','Research needs a source URL and retrieval timestamp.');
  const stamp=new Date(retrievedAt).toISOString(),evidence:SiteEvidence[]=[],warnings=new Set<string>(),links=new Map<string,{url:string;sameOrigin:boolean}>();
  const add=(field:string,value:unknown,selector:string,confidence:'high'|'medium'='high')=>{
    if(typeof value!=='string'&&typeof value!=='number')return;
    const text=clean(String(value));if(!text)return;
    if(evidence.length>=100){warnings.add('evidence_limit');return;}
    if(text.length>2000){warnings.add('oversized_claim_omitted');return;}
    if(evidence.some(item=>item.field===field&&item.value===text))return;
    evidence.push({field,value:text,sourceUrl:url,retrievedAt:stamp,selector,basis:'direct_page_claim',confidence,verification:'unverified',trustedForInstructions:false});
  };
  const scripts:{value:string;selector:string}[]=[];
  const textHandler=(selector:string,field:string)=>{
    let chunks='';
    return {element(element:Element){chunks='';element.onEndTag(()=>{add(field,chunks,selector,'medium');chunks='';});},text(text:Text){if(chunks.length<4000)chunks+=text.text;}};
  };
  let currentScript:{value:string;selector:string}|null=null;
  const parser=new HTMLRewriter()
    .on('title',textHandler('title','page_title'))
    .on('h1',textHandler('h1','headline'))
    .on('meta',{element(element){
      const key=(element.getAttribute('name')??element.getAttribute('property')??'').toLowerCase(),value=element.getAttribute('content');
      if(['description','og:description'].includes(key))add('description',value,`meta[${key}]`,'medium');
      if(key==='og:site_name')add('business_name',value,'meta[og:site_name]','medium');
      if(key==='robots'&&value&&/noindex|nofollow|none/i.test(value))warnings.add('page_robots_restriction');
    }})
    .on('a[href]',{element(element){
      if(links.size>=100){warnings.add('link_limit');return;}
      const href=element.getAttribute('href')??'';
      if(href.startsWith('mailto:')){add('contact_email',href.slice(7).split('?')[0],'a[href=mailto]');return;}
      if(href.startsWith('tel:')){add('contact_phone',href.slice(4),'a[href=tel]');return;}
      try {const target=normalizeWebsite(new URL(href,url).href);links.set(target,{url:target,sameOrigin:new URL(target).origin===new URL(url).origin});}catch{/* Unsafe URL candidates are not crawl instructions. */}
    }})
    .on('script[type="application/ld+json"]',{element(element){
      if(scripts.length>=20){warnings.add('structured_data_limit');currentScript=null;return;}
      currentScript={value:'',selector:`script[type=application/ld+json]:${scripts.length+1}`};scripts.push(currentScript);
      element.onEndTag(()=>{currentScript=null;});
    },text(text){if(currentScript){if(currentScript.value.length+text.text.length>65_536){warnings.add('structured_data_size_limit');currentScript.value='';currentScript=null;}else currentScript.value+=text.text;}}});
  await parser.transform(new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})).arrayBuffer();
  let nodes=0;
  const walk=(value:unknown,selector:string,depth=0)=>{
    if(depth>8||++nodes>200){warnings.add('structured_data_traversal_limit');return;}
    if(Array.isArray(value)){for(const item of value)walk(item,selector,depth+1);return;}
    if(!value||typeof value!=='object')return;
    const node=value as Record<string,unknown>;
    if(node['@graph'])walk(node['@graph'],selector,depth+1);
    const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
    if(!types.some(type=>typeof type==='string'&&businessTypes.has(type)))return;
    add('business_name',node.name,selector+'.name');add('description',node.description,selector+'.description');
    for(const type of types)if(typeof type==='string'&&businessTypes.has(type))add('category',type,selector+'.@type');
    for(const [key,field] of [['telephone','contact_phone'],['email','contact_email'],['priceRange','price_range'],['currenciesAccepted','currency']] as const)add(field,node[key],selector+'.'+key);
    for(const key of ['openingHours','areaServed'] as const)for(const item of Array.isArray(node[key])?node[key]:[node[key]])add(key==='openingHours'?'hours':'service_area',item,selector+'.'+key);
    const offerKey=node.makesOffer!==undefined?'makesOffer':'offers';
    const offers=Array.isArray(node[offerKey])?node[offerKey]:[node[offerKey]];
    for(const [index,offer] of offers.slice(0,30).entries())if(offer&&typeof offer==='object') {
      const data=offer as Record<string,unknown>,path=selector+`.${offerKey}[${index}]`;
      add('offer_name',data.name,path+'.name');add('offer_price',data.price,path+'.price');add('offer_currency',data.priceCurrency,path+'.priceCurrency');
      if(data.itemOffered&&typeof data.itemOffered==='object')add('service',(data.itemOffered as Record<string,unknown>).name,path+'.itemOffered.name');
    }
    const addresses=Array.isArray(node.address)?node.address:[node.address];
    for(const address of addresses) {
      if(typeof address==='string'){add('location',address,selector+'.address');continue;}
      if(address&&typeof address==='object')for(const key of ['streetAddress','addressLocality','addressRegion','postalCode','addressCountry'])
        add('address_'+key,(address as Record<string,unknown>)[key],selector+'.address.'+key);
    }
  };
  for(const script of scripts){try{walk(JSON.parse(script.value),script.selector);}catch{warnings.add('invalid_structured_data');}}
  if(!evidence.length)warnings.add('no_extractable_evidence');
  return {url,retrievedAt:stamp,evidence,links:[...links.values()],warnings:[...warnings]};
}
