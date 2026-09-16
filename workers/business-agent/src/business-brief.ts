import {z} from 'zod';
import {HttpError} from './http';
import {AUTOMATIONS} from './automations';
import {getPlan} from './catalog';

const text=z.string().trim().max(2000).default('');
export const briefFields=z.object({businessName:text,category:text,services:text,prices:text,currency:text,hours:text,locations:text,serviceArea:text,contactRoutes:text,bookingSystem:text,publicPolicies:text,brandLanguage:text,existingTools:text,requestOwner:text,serviceDuration:text,staffResources:text,cancellationRules:text,escalationDestination:text,tone:text,permittedAutonomy:text}).strict();
const input=z.object({expectedRevision:z.number().int().min(0),reviewed:z.literal(true),fields:briefFields}).strict();
type Fields=z.infer<typeof briefFields>;
type Saved={revision:number;fields:Fields;confirmedBy:string|null;confirmedAt:string|null};
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
    return row?JSON.parse(row.value):{revision:0,fields:briefFields.parse({}),confirmedBy:null,confirmedAt:null};
  }
  save(userId:string,key:string,value:unknown):Saved{
    const parsed=input.safeParse(value);
    if(!parsed.success||!/^[a-zA-Z0-9_-]{16,128}$/.test(key))throw new HttpError(400,'invalid_business_brief','Review your business details and provide the current revision.');
    const payload=JSON.stringify(parsed.data);
    return this.storage.transactionSync(()=>{
      const prior=this.storage.sql.exec<{user_id:string;payload:string;value:string}>('SELECT * FROM business_brief_receipts WHERE request_key=?',key).toArray()[0];
      if(prior){if(prior.user_id!==userId||prior.payload!==payload)throw new HttpError(409,'brief_request_reused','This request belongs to a different brief update.');return JSON.parse(prior.value);}
      const current=this.read();
      if(current.revision!==parsed.data.expectedRevision)throw new HttpError(409,'brief_revision_conflict','The business brief changed. Refresh it before saving your edits.');
      const saved:Saved={revision:current.revision+1,fields:parsed.data.fields,confirmedBy:userId,confirmedAt:new Date().toISOString()},json=JSON.stringify(saved);
      this.storage.sql.exec('INSERT INTO business_brief(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',json);
      this.storage.sql.exec('INSERT INTO business_brief_receipts(request_key,user_id,payload,value) VALUES(?,?,?,?)',key,userId,payload,json);
      return saved;
    });
  }
  present(){
    const brief=this.read();
    const ids=['email.draft',brief.fields.bookingSystem||brief.fields.serviceDuration?'appointments.availability':'email.summary','email.unanswered-followup'];
    return {brief,identityVerified:false,authorizesActions:false,
      unresolvedQuestions:questions.filter(([field])=>!brief.fields[field]).map(([field,question])=>({field,question})),
      recommendations:ids.map((id,index)=>{
        const definition=AUTOMATIONS.find(item=>item.id===id)!;
        const plan=getPlan(definition.eligibility.plans[0])!;
        return {id,priority:index+1,name:definition.name,basis:'owner_brief_rule' as const,
          proposed:true,executionEnabled:false,permissions:definition.permissions,prerequisites:definition.eligibility.prerequisites,
          plan:{id:plan.id,name:plan.name,monthlyCents:plan.monthlyCents,setupCents:plan.setupCents},
          addon:definition.eligibility.businessAddon??null,
          example:id==='email.draft'?'Prepare a reply to a customer question for your review.':id==='appointments.availability'?'Suggest open times from an approved calendar without making a booking.':id==='email.summary'?'Show the key points and open questions in an authorized email thread.':'Prepare an allowed follow-up after checking that the inquiry is still unanswered.',
          expectedImprovement:id==='email.draft'?'Reduce repeated reply writing.':id==='appointments.availability'?'Reduce back-and-forth over available times.':id==='email.summary'?'Make long customer threads easier to review.':'Reduce missed follow-up on unresolved inquiries.'};
      })};
  }
}
