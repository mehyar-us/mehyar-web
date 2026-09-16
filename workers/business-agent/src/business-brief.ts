import {z} from 'zod';
import {HttpError} from './http';
import {getIndustryPack} from './automations';
import {briefRecommendations} from './brief-recommendations';
import type {BriefSource} from './brief-sources';
import {industryQuestions} from './industry-questions';

const text=z.string().trim().max(2000).default('');
export const briefFields=z.object({businessName:text,category:text,industryPack:z.string().trim().max(80).default('').refine(value=>!value||!!getIndustryPack(value)),services:text,prices:text,currency:text,hours:text,locations:text,serviceArea:text,contactRoutes:text,bookingSystem:text,publicPolicies:text,brandLanguage:text,existingTools:text,requestOwner:text,serviceDuration:text,staffResources:text,cancellationRules:text,escalationDestination:text,tone:text,permittedAutonomy:text}).strict();
const input=z.object({expectedRevision:z.number().int().min(0),reviewed:z.literal(true),fields:briefFields,industryAnswers:z.record(z.string().max(80),z.string().trim().max(2000)).default({}).refine(value=>Object.keys(value).length<=5),sourceIds:z.record(z.string().max(40),z.string().max(128)).default({}).refine(value=>Object.keys(value).length<=20)}).strict();
type Fields=z.infer<typeof briefFields>;
type Saved={revision:number;fields:Fields;industryAnswers:Record<string,string>;sources:Record<string,BriefSource>;confirmedBy:string|null;confirmedAt:string|null};
const questions=[['requestOwner','Who should own incoming requests?'],['serviceDuration','How long do your services take?'],['staffResources','Which staff and resources can be scheduled?'],['cancellationRules','What cancellation and rescheduling rules apply?'],['escalationDestination','Where should the agent send questions it cannot resolve?'],['tone','What tone should your agent use?'],['permittedAutonomy','Which actions should require your review?']] as const;

/** Private per-business owner-reviewed brief. It is factual context, never an
 * action policy, domain-ownership proof or permission grant. */
export class BusinessBrief {
  constructor(private storage:DurableObjectStorage){}
  initialize(){
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS business_brief (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)');
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS business_brief_receipts (request_key TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload TEXT NOT NULL,value TEXT NOT NULL)');
  }
  read():Saved{
    const row=this.storage.sql.exec<{value:string}>('SELECT value FROM business_brief WHERE id=1').toArray()[0];
    return row?{industryAnswers:{},sources:{},...JSON.parse(row.value),fields:briefFields.parse(JSON.parse(row.value).fields)}:{revision:0,fields:briefFields.parse({}),industryAnswers:{},sources:{},confirmedBy:null,confirmedAt:null};
  }
  replay(userId:string,key:string,value:unknown):Saved|null{
    const parsed=input.safeParse(value);
    if(!parsed.success||!/^[a-zA-Z0-9_-]{16,128}$/.test(key))throw new HttpError(400,'invalid_business_brief','Review your business details and provide the current revision.');
    const prior=this.storage.sql.exec<{user_id:string;payload:string;value:string}>('SELECT * FROM business_brief_receipts WHERE request_key=?',key).toArray()[0];
    if(!prior)return null;
    if(prior.user_id!==userId||JSON.stringify(input.parse(JSON.parse(prior.payload)))!==JSON.stringify(parsed.data))throw new HttpError(409,'brief_request_reused','This request belongs to a different brief update.');
    return {industryAnswers:{},sources:{},...JSON.parse(prior.value),fields:briefFields.parse(JSON.parse(prior.value).fields)};
  }
  save(userId:string,key:string,value:unknown,availableSources:BriefSource[]=[]):Saved{
    const parsed=input.safeParse(value);
    if(!parsed.success||!/^[a-zA-Z0-9_-]{16,128}$/.test(key))throw new HttpError(400,'invalid_business_brief','Review your business details and provide the current revision.');
    const payload=JSON.stringify(parsed.data);
    return this.storage.transactionSync(()=>{
      const replay=this.replay(userId,key,value);if(replay)return replay;
      const current=this.read();
      if(current.revision!==parsed.data.expectedRevision)throw new HttpError(409,'brief_revision_conflict','The business brief changed. Refresh it before saving your edits.');
      const allowed=getIndustryPack(parsed.data.fields.industryPack)?.requiredFacts??[];
      if(Object.keys(parsed.data.industryAnswers).some(key=>!allowed.includes(key)))throw new HttpError(400,'invalid_industry_answers','Only questions for the selected industry can be answered.');
      const sources:Record<string,BriefSource>={};
      for(const [field,id] of Object.entries(parsed.data.sourceIds)){
        const source=availableSources.find(item=>item.id===id&&item.field===field);
        if(!source||!Object.hasOwn(parsed.data.fields,field)||parsed.data.fields[field as keyof Fields]!==source.value)throw new HttpError(409,'brief_source_changed','A selected research fact is unavailable or differs from the brief. Reload sources or save that field as your own edit.');
        sources[field]=source;
      }
      const saved:Saved={revision:current.revision+1,fields:parsed.data.fields,industryAnswers:parsed.data.industryAnswers,sources,confirmedBy:userId,confirmedAt:new Date().toISOString()},json=JSON.stringify(saved);
      this.storage.sql.exec('INSERT INTO business_brief(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',json);
      this.storage.sql.exec('INSERT INTO business_brief_receipts(request_key,user_id,payload,value) VALUES(?,?,?,?)',key,userId,payload,json);
      return saved;
    });
  }
  present(){
    const brief=this.read();
    return {brief,identityVerified:false,authorizesActions:false,
      industryQuestions:industryQuestions(brief.fields,brief.industryAnswers),unresolvedQuestions:questions.filter(([field])=>!brief.fields[field]&&(brief.fields.industryPack!=='clinics-dentists'||!['serviceDuration','staffResources','cancellationRules'].includes(field))).map(([field,question])=>({field,question})),
      ...briefRecommendations(brief.fields)};
  }
}
