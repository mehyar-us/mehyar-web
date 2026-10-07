/** Conservative admission checks for claims and proposed customer outreach.
 * These checks do not certify a business process or replace semantic review.
 * Keep this module import-free so evidence previews can use native TypeScript.
 */
export interface AuditSafetySource {id:string;excerpt:string;}
export interface AuditSafetyCitation {sourceId:string;quote:string;}
const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
const trustTopic=/\b(?:(?:independent|public|external|customer|online)\s+)?(?:trust\s+(?:signals?|evidence)|testimonials?|reviews|review\s+(?:counts?|volume|data)|star\s+ratings?|social\s+proof)\b/gi;
const unknownAfter=/^\s*(?:[—–:-]\s*)?(?:(?:are|is|were|was|remain|remains)\s+)?(?:unknown|unverified|not\s+(?:known|verified|confirmed|provided|supplied|measured|inspected)|(?:cannot|can't|could\s+not)\s+(?:be\s+)?(?:verified|confirmed|determined|measured))/i;
const dataUnavailableBefore=/\b(?:do(?:es)?\s+not\s+(?:provide|supply|include)|not\s+(?:provided|supplied)|unknown|unverified)\s+(?:(?:the|any|current|public|independent|customer|actual|external)\s+)*$/i;
const absenceBefore=/\b(?:no|without|lacks?|missing|absence\s+of)\b/i;
const absenceAfter=/\b(?:absent|missing|unavailable|(?:not|never)\s+(?:present|published|available|visible|detected|found|shown)|none\s+(?:were|are)\s+(?:found|detected))\b/i;
const privateAbsence=/\b(?:no|without|lacks?|missing|absence\s+of)\s+(?:[\w/-]+\s+){0,6}(?:analytics|(?:conversion|submission|event)\s+tracking|crm|(?:internal\s+)?software|(?:intake|inquiry|enquiry)\s+handoffs?|(?:automated|automatic)\s+reminders?|(?:follow[- ]up|retention)\s+(?:system|mechanism|process)|(?:measurement\s+|performance\s+|tracking\s+)?baselines?)\b|\b(?:analytics|tracking|crm|software|(?:internal|intake|inquiry)\s+(?:handoffs?|processes?)|(?:measurement\s+|performance\s+|tracking\s+)?baselines?)\b.{0,100}\b(?:absent|missing|not\s+(?:present|installed|used|in\s+use|available)|does\s+not\s+exist)\b/gi;

/** A caution about implying an absence is not itself that absence claim.
 * Limit this exception to the local nominal claim and its governing caution;
 * an adjacent independent negative must still be inspected. */
function metaLevelAbsenceCaution(before:string,after:string){
 if(/\b(?:implying|claiming|asserting|assuming)\s+(?:that\s+)?[^,;.!?]{0,80}$/i.test(before)&&/^\s+(?:could|may|might|would)\s+(?:mislead|be\s+misleading|create\s+confusion)\b/i.test(after))return true;
 return /\b(?:rather\s+than|instead\s+of)\s+(?:assumed|unsupported|unverified|unproven|invented|guessed)\s+[^,;.!?]{0,60}$/i.test(before)&&/^\s*(?:[.!?]|$)/.test(after);
}

/** Classify the governing predicate of each negative topic, not a sentence-wide
 * keyword. A supplied-data list, proposed purchase, or measurement dependency
 * is different from a claim that the business has no tool or private baseline.
 * Unclassified nominal negatives remain conservative; semantic review is still
 * required, including for historical public analytics-inspection statements. */
export function hasUnsupportedAuditPrivateAbsence(text:string){
 let remaining=normalize(text);
 // One passive governs every coordinated subject. Annotate before comma
 // splitting, but never cross a finite existence claim or contrast clause.
 remaining=remaining.replace(/\bno\s+([^;.!?]{1,180}?)\s+(?:(?:were|was|are|is|have\s+been|has\s+been)\s+)?(?:provided|supplied)\b/gi,(span,subject:string)=>{
  if(/\b(?:exists?|missing|installed|absent|but|however|because|while|whereas|is|are|was|were)\b/i.test(subject))return span;
  return 'unsupplied audit data';
 });
 // Keep the connector: "without a purchase or analytics" must still inspect
 // the joined analytics absence after masking only the event phrase.
 remaining=remaining.replace(/\bwithout\s+(?:adding|buying|purchasing|installing|replacing|deploying)\s+(?:(?!or\b|and\b|no\b|without\b)[\w-]+\s+){0,3}(?:software|crm|analytics|tracking\s+(?:tools?|systems?))\b/gi,'without extra spending')
  .replace(/\bwithout\s+(?:(?!or\b|and\b|no\b|without\b)[\w-]+\s+){0,3}software\s+(?:investment|spending|purchases?)\b/gi,'without extra spending')
  .replace(/\b(?:requires?|required|needs?|needed)\s+no\s+(?:[\w-]+\s+){0,3}software\b/gi,'requires no extra spending')
  .replace(/\bno\s+(?:[\w-]+\s+){0,3}software\s+(?:investment|spending|purchases?)\s+is\s+(?:needed|required)\b/gi,'no extra spending is required');
 // Preposed dependency conditions do not assert actual baseline existence.
 // Mask this condition only, never a later independent negative assertion.
 remaining=remaining.replace(/(^|[.!?;]\s*)without\s+(?:[\w-]+\s+){0,3}baseline(s)?\s*,(?=[^.!?;]{0,200}\b(?:cannot|could|would|may|can)\b[^.!?;]{0,100}\b(?:measur\w*|compar\w*|evaluat\w*|assess\w*)\b)/gi,'$1without verified measurement input,');
 for(const clause of remaining.split(/[,;]|\b(?:but|however|whereas|while|and)\b/i))for(const match of clause.matchAll(privateAbsence)){
  const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
  if(metaLevelAbsenceCaution(before+match[0],after))continue;
  // "No unsupported baselines" constrains report claims, not actual baseline
  // existence. Never excuse ordinary "no baseline" or a separate negative.
  if(/^no\s+(?:unsupported|fabricated|invented|guessed)\s+(?:(?:measurement|performance|tracking)\s+)?baselines?$/i.test(match[0]))continue;
  if(/^\s*(?:(?:data|information|details|records|facts)\s+)?(?:(?:were|was|are|is|have\s+been|has\s+been)\s+)?(?:provided|supplied)\b/i.test(after))continue;
  if(/\bbaselines?\s+(?:data|information|details|records)\s+(?:are|is)\s+not\s+available$/i.test(match[0])&&/^\s+to\s+(?:this|the)\s+audit\b/i.test(after))continue;
  if(/\b(?:unknown|unverified|not\s+(?:known|verified|confirmed)|cannot\s+(?:verify|confirm|determine))\s+(?:whether|if)\s*$/i.test(before))continue;
  if(/^absence\s+of\b/i.test(match[0])&&/^\s*(?:(?:is|remains)\s+)?(?:unknown|unverified|not\s+(?:verified|confirmed))\b/i.test(after))continue;
  if(/^\s*if\b/i.test(clause))continue;
  // Preserve the existing narrow public analytics inspection compatibility;
  // captured prose never excuses private CRM, software, handoff or baseline absence.
  if(/\b(?:analytics|tracking)\b/i.test(match[0])&&!/\b(?:crm|software|baselines?|handoffs?|process|system)\b/i.test(match[0])&&/\b(?:captured|inspected|public|excerpt|source records?|html)\b/i.test(clause))continue;
  return true;
 }
 return false;
}

function literalSourceAttribution(sentence:string,index:number,length:number,sources:readonly AuditSafetySource[],citations:readonly AuditSafetyCitation[]){
 if(!/\b(?:page|source|website|excerpt)\b.{0,80}\b(?:says|states|reports|declares|notes|claims)\b/i.test(sentence))return false;
 return citations.some(citation=>{
  const quote=normalize(citation.quote),source=sources.find(item=>item.id===citation.sourceId);
  if(quote.length<12||!source||!normalize(source.excerpt).includes(quote))return false;
  let position=sentence.indexOf(quote);
  while(position>=0){if(index>=position&&index+length<=position+quote.length)return true;position=sentence.indexOf(quote,position+1);}
  return false;
 });
}

/** Captured prose cannot establish the absence of external trust evidence.
 * Explicit topic-local unknowns and actual attributed literal source claims
 * remain admissible; unrelated unknowns never excuse a negative trust claim.
 */
export function hasUnsupportedAuditTrustAbsence(text:string,sources:readonly AuditSafetySource[],citations:readonly AuditSafetyCitation[]=[]){
 for(const sentence of normalize(text).match(/[^.!?]+(?:[.!?]|$)/g)??[]){
  for(const topic of sentence.matchAll(trustTopic)){
   const index=topic.index,before=sentence.slice(0,index),after=sentence.slice(index+topic[0].length);
   // "Owner reviews the baseline" uses a verb, not customer review evidence.
   if(/^reviews$/i.test(topic[0])&&/^\s+(?:the|a|an|each|baseline|data|inquiries|requests)\b/i.test(after))continue;
   const localBefore=before.split(/[,;]|\b(?:but|however|whereas|while)\b/i).at(-1)??before;
   const localAfter=after.split(/[,;]|\b(?:but|however|whereas|while)\b/i)[0];
   if(metaLevelAbsenceCaution(localBefore+topic[0],localAfter))continue;
   // Unavailable supplied counts describe metric coverage, not the existence
   // of customer reviews. A later separate trust topic is still inspected.
   if(/\breview\s+(?:counts?|volume|data)\b/i.test(topic[0])&&/^\s*(?:(?:are|is|were|was|remain|remains)\s+)?(?:unavailable|not\s+(?:available|provided|supplied|measured))\b/i.test(localAfter))continue;
   const physicalAbsence=absenceAfter.test(localAfter)||/\b(?:does?|did)\s+not\s+(?:contain|display|show|include)\b/i.test(localBefore);
   // Collection coverage is not absence of external trust evidence. The
   // governing collection predicate must be local and cannot mask a later
   // explicit absent/missing/does-not-contain claim about the same topic.
   if(!physicalAbsence&&/\bno\s+(?:evidence|data|information)\s+(?:(?:was|were|has\s+been)\s+)?(?:collected|supplied|provided|captured)\s+(?:of|about|on|regarding)\b[^;]*$/i.test(localBefore))continue;
   if(!physicalAbsence&&(unknownAfter.test(localAfter)||dataUnavailableBefore.test(localBefore)||/\bno\b/i.test(localBefore)&&/^\s*(?:(?:were|was|are|is|have\s+been)\s+)?(?:provided|supplied)\b/i.test(localAfter)))continue;
   if(!physicalAbsence&&(/\b(?:do\s+not|never)\s+(?:assume|infer|assert|claim)\b/i.test(localBefore)||/\bwithout\s+(?:changing|replacing|removing|altering)\b/i.test(localBefore)))continue;
   if(!absenceBefore.test(localBefore)&&!physicalAbsence)continue;
   if(literalSourceAttribution(sentence,index,topic[0].length,sources,citations))continue;
   return true;
  }
 }
 return false;
}

const customers=/\b(?:customers?|clients?|recipients?|riders?|contacts?|pilot\s+group)\b/i;
const directContact=/\b(?:sends?|delivers?|reach(?:es)?\s+out)\b|\b(?:calls?|contacts?|emails?|texts?|messages?|invites?)\s+(?:(?:only|the|these|any|eligible|verified(?:-permission)?|recent|existing|three|selected)\s+){0,6}(?:customers?|clients?|recipients?|riders?|contacts?|pilot\s+group)\b|\b(?:emails?|texts?)\s+(?:(?:a|the|this|seasonal|maintenance)\s+){0,4}(?:reminder|message|survey)\b.{0,80}\bto\s+(?:(?:the|these|recent|existing|selected)\s+){0,3}(?:customers?|clients?|riders?)\b/i;
const trial=/\b(?:tests?|pilot|trial|try|roll\s+out|launch)\b/i;
const communication=/\b(?:reminders?|follow[- ]?ups?|messages?|surveys?|invitations?|maintenance)\b/i;
const customerRecipient=/\b(?:to|with|and)\s+(?:(?:the|these|our|their|any|eligible|verified|recent|existing|three|selected|real)\s+){0,5}(?:customers?|clients?|recipients?|riders?|contacts?)\b/i;
function externalCustomerContact(action:string,communicationContext:boolean){
 if(!customers.test(action))return false;
 if(/^\s*(?:(?:workshop\s+)?owner\s+(?:must|should)\s+)?(?:do\s+not|don't|never|not)\s+(?:send|deliver|call|contact|email|text|message|invite)\b/i.test(action))return false;
 if(/\b(?:to|into)\s+(?:(?:a|an|the|our)\s+)?(?:staff[- ]only|internal|sandbox|staging|dummy|synthetic)\b/i.test(action)&&!customerRecipient.test(action))return false;
 if(directContact.test(action))return true;
 if(!trial.test(action)||!communicationContext)return false;
 return customerRecipient.test(action)||!/\b(?:internally|internal[- ]only|staff[- ]only|sandbox|staging|dummy|synthetic)\b/i.test(action);
}
function recordedPermission(action:string){
 const topic=/\b(?:permission|consent|opt[- ]?in|opted[- ]in|authorization)\b/i;
 return customers.test(action)&&topic.test(action)&&/\b(?:recorded|existing|actual|records?|log(?:ged)?)\b/i.test(action)&&/\b(?:verify|verified|confirm|confirmed|check|review|record|recorded)\b/i.test(action);
}
function exclusions(action:string){
 return /\b(?:excludes?|excluding|skip|remove|do\s+not\s+(?:contact|include|send|message))\b/i.test(action)&&/\bdeclined\b/i.test(action)&&/\b(?:withdrawn|opted[- ]out)\b/i.test(action)&&/\b(?:unverified|without\s+(?:verified\s+)?(?:consent|permission|opt[- ]?in))\b/i.test(action);
}
export type AuditOutreachSafety={valid:true}|{valid:false;actionIndex:number;error:'permission_before_outreach_required'};
/** Evaluate ordered executable actions, never assume customer preferences are
 * permission. Drafting, internal tests and in-person permission requests do
 * not count as outbound reminder contact. */
export function validateAuditCustomerOutreach(actions:readonly string[]):AuditOutreachSafety {
 let permission=false,excluded=false;
 for(let actionIndex=0;actionIndex<actions.length;actionIndex++){
  const action=actions[actionIndex];
  for(const clause of action.split(/[;.]\s*|\s*,?\s+(?:then|and\s+then|but)\s+/i)){
   const external=externalCustomerContact(clause,communication.test(action));
   const gated=external&&/\b(?:only|once|after)\b/i.test(clause)&&recordedPermission(clause)&&exclusions(clause)&&!/\b(?:afterward|afterwards)\s+(?:verify|confirm|check|record)\b/i.test(clause);
   if(external&&!gated&&!(permission&&excluded))return {valid:false,actionIndex,error:'permission_before_outreach_required'};
   if(!external){permission ||= recordedPermission(clause);excluded ||= exclusions(clause);}
  }
 }
 return {valid:true};
}

export type AuditPilotPrerequisite='channel_and_purpose'|'factual_copy'|'timing_and_capacity'|'tested_reply_receipt'|'approved_copy'|'placeholder_replacement'|'internal_test';
export type AuditPilotSafety={valid:true}|{valid:false;actionIndex:number;missing:AuditPilotPrerequisite[]};
function positivePilotAction(clause:string,verb:RegExp){
 for(const match of clause.matchAll(new RegExp(verb.source,'gi'))){
  const prefix=clause.slice(0,match.index);
  if(/\b(?:do\s+not|does\s+not|don't|never|cannot|can't|not|without|no\s+need\s+to)\s*(?:(?:[\w-]+ly|yet|first|now|ever)\s+){0,3}(?:(?:need|have|bother|required|expected|supposed)\s+to\s+(?:(?:[\w-]+ly|yet|first|now|ever)\s+){0,3})?$/i.test(prefix))continue;
  // "No internal test is needed" contains a test noun, not an instruction.
  if(/\b(?:no|without)\s+(?:(?!and\b|but\b|or\b)[\w/-]+\s+){0,6}$/i.test(prefix))continue;
  // A test subject can also be waived by its following predicate. Inspect
  // only that local test phrase; later positive gates stay independent.
  if(/^test(?:s|ed)?$/i.test(match[0])&&/^\s+(?:(?!and\b|but\b|or\b|then\b|is\b|are\b|was\b|were\b)[\w/-]+\s+){0,6}(?:is|are|was|were)\s+not\s+(?:required|needed|necessary)\b/i.test(clause.slice(match.index+match[0].length)))continue;
  return true;
 }
 return false;
}
function deferredUntilCustomerContact(clause:string){
 for(const condition of clause.matchAll(/\b(?:after|following)\s+([^;.!?]{1,180})/gi)){
  const event=condition[1];
  if(externalCustomerContact(event,true)||/\b(?:sending|delivering)\b[^;.!?]{0,120}\bto\s+(?:(?:the|these|any|eligible|verified|recent|existing|selected|real)\s+){0,4}(?:customers?|clients?|recipients?|riders?|contacts?|pilot\s+group)\b/i.test(event)||/\b(?:external|real\s+customer|customer|pilot)\s+(?:contact|sending|delivery|outreach)\b/i.test(event))return true;
 }
 return false;
}
const confirmAction=/\b(?:verif(?:y|ies|ied)|confirm(?:s|ed)?|check(?:s|ed)?|approv(?:e|es|ed)|agree(?:s|d)?|test(?:s|ed)?)\b/;
const pilotKeys:readonly AuditPilotPrerequisite[]=['channel_and_purpose','factual_copy','timing_and_capacity','tested_reply_receipt','approved_copy','placeholder_replacement','internal_test'];
/** A permission list is readiness, not a complete contact plan. Inspect only
 * executable actions in order; unknowns and later success signals cannot clear
 * these prerequisites. This is a conservative language check, not verification
 * of real customer records, legal compliance or a working business workflow. */
export function validateAuditCustomerPilot(actions:readonly string[]):AuditPilotSafety {
 const ready=new Set<AuditPilotPrerequisite>();let testedRoute=false,confirmedReceipt=false;
 const collectPart=(clause:string)=>{
  // A prerequisite explicitly conditional on REAL contact is not pre-send
  // readiness. Receipt after an authorized internal/dummy test stays allowed.
  if(deferredUntilCustomerContact(clause))return;
  if(!positivePilotAction(clause,confirmAction)&&!positivePilotAction(clause,/\b(?:replace|replaced|resolve|resolved|remove|removed|omit|omitted)\b/))return;
  if(recordedPermission(clause)&&/\b(?:channel|email|sms|phone|text|communication\s+method)\b/i.test(clause)&&/\b(?:purpose|seasonal|maintenance|reminder|follow[- ]up|survey)\b/i.test(clause))ready.add('channel_and_purpose');
  if(positivePilotAction(clause,/\b(?:verif(?:y|ies|ied)|confirm(?:s|ed)?|check(?:s|ed)?)\b/)&&/\b(?:copy|message|wording|script)\b/i.test(clause)&&/\b(?:factual|facts|details|values|service|dates?|contact\s+(?:details|values))\b/i.test(clause)&&/\b(?:owner|records?|verified)\b/i.test(clause))ready.add('factual_copy');
  if(positivePilotAction(clause,confirmAction)&&/\b(?:timing|schedule|when)\b/i.test(clause)&&/\bcapacity\b/i.test(clause)&&/\bowner\b/i.test(clause))ready.add('timing_and_capacity');
  if(positivePilotAction(clause,/\b(?:test|tested|verif(?:y|ies|ied)|confirm(?:s|ed)?)\b/)&&/\b(?:reply|response|booking|contact)\b/i.test(clause)&&/\b(?:route|path|channel|destination)\b/i.test(clause)&&/\b(?:owner[- ]authorized|owner\s+(?:authorizes|authorized|approves|approved))\b/i.test(clause))testedRoute=true;
  if(positivePilotAction(clause,/\b(?:verif(?:y|ies|ied)|confirm(?:s|ed)?|check(?:s|ed)?)\b/)&&/\b(?:destination|reply|response|test)\b/i.test(clause)&&/\b(?:receipt|received|receives)\b/i.test(clause)&&/\b(?:ownership|owner|responsible)\b/i.test(clause))confirmedReceipt=true;
  if(testedRoute&&confirmedReceipt)ready.add('tested_reply_receipt');
  if(/\bowner\b/i.test(clause)&&positivePilotAction(clause,/\b(?:approves?|approved|confirms?|confirmed)\b/)&&/\b(?:final|customer[- ]facing)\b/i.test(clause)&&/\b(?:copy|message|wording|script)\b/i.test(clause))ready.add('approved_copy');
  if(positivePilotAction(clause,/\b(?:replace|replaced|resolve|resolved|remove|removed|omit|omitted)\b/)&&/\b(?:all|every)\b/i.test(clause)&&/\bplaceholders?\b/i.test(clause)&&/\b(?:confirmed|verified|owner[- ]approved|unknown|unverified)\b/i.test(clause))ready.add('placeholder_replacement');
  if(positivePilotAction(clause,/\b(?:test|tested)\b/)&&/\b(?:internally|internal|staff|dummy|sandbox)\b/i.test(clause))ready.add('internal_test');
 };
 const collect=(clause:string)=>{
  // A later positive verb for timing cannot validate a negated copy check.
  // Split coordinated ACTION predicates, preserving noun lists and the shared
  // owner subject. Each gate is associated with its own local predicate.
  const parts=clause.split(/\s+and\s+(?=(?:(?:(?:workshop|business)\s+)?owner\s+)?(?:(?:does\s+not|do\s+not|don't|cannot|can't|not|never|no\s+need\s+to)\s+)?(?:(?:[\w-]+ly|yet|also|first|now|ever)\s+){0,3}(?:verif(?:y|ies|ied)|confirm(?:s|ed)?|check(?:s|ed)?|approv(?:e|es|ed)|agree(?:s|d)?|test(?:s|ed)?|replace|omit)\b)/i);
  for(const [index,part] of parts.entries())collectPart(index&&/\bowner\b/i.test(parts[0])?'Owner '+part:part);
 };
 for(let actionIndex=0;actionIndex<actions.length;actionIndex++){
  const action=actions[actionIndex];
  for(const clause of action.split(/[;.]\s*|\s*,?\s+(?:then|and\s+then|but)\s+/i)){
   if(!externalCustomerContact(clause,communication.test(action))){collect(clause);continue;}
   // Only an explicit BEFORE-contact condition may supply gates in the same
   // clause. Ordinary send-now wording cannot borrow later verification.
   if(/\b(?:only\s+after|only\s+once|only\s+when)\b/i.test(clause)&&!/\b(?:afterward|afterwards|later)\b/i.test(clause))collect(clause);
   const missing=pilotKeys.filter(key=>!ready.has(key));
   if(missing.length)return {valid:false,actionIndex,missing};
  }
 }
 return {valid:true};
}

/** A placeholder must not quietly introduce an unverified commercial value. */
export function hasAnchoredAuditCommercialPlaceholder(copy:string){
 return /\[[^\]]*\b(?:same[- ]day|next[- ]day|overnight|guaranteed|unlimited|lifetime)\b[^\]]*\]/i.test(copy);
}
