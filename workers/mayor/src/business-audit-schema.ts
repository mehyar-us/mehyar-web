import {z} from 'zod';
import {validateAuditRoadmapReferences} from './business-audit-roadmap';
import {hasUnsupportedAuditPrivateAbsence,hasUnsupportedAuditTrustAbsence,validateAuditCustomerOutreach,validateAuditCustomerPilot,hasAnchoredAuditCommercialPlaceholder} from './business-audit-content-safety';

export const AUDIT_ANALYSIS_MODEL='@cf/moonshotai/kimi-k2.6';
export const AUDIT_REVIEW_MODEL='@cf/moonshotai/kimi-k2.6';
export const AUDIT_DEEPSEEK_MODEL='@cf/deepseek-ai/deepseek-v4-pro-0813';
export const AUDIT_CONFIGURED_MODELS=[AUDIT_ANALYSIS_MODEL,AUDIT_DEEPSEEK_MODEL] as const;
export type AuditModel=typeof AUDIT_CONFIGURED_MODELS[number];
const short=z.string().trim().min(8).max(500);
const paragraph=z.string().trim().min(20).max(1800);
const item=z.string().trim().min(8).max(600);
const action=item.describe('A concrete executable action or deliverable, never a schema field name, TODO, or placeholder.');
const level=z.enum(['low','medium','high']);
const findingId=z.string().regex(/^F(?:0[1-9]|1[0-2])$/);
export const auditDraftSchema=z.object({
 summary:z.object({headline:short,overview:paragraph,biggestOpportunity:paragraph,startingPoint:paragraph}).strict(),
 business:z.object({offer:paragraph.describe('The business products and services offered to its customers, not this audit methodology or scope.'),audience:short.describe('The business end customers, not the business owner or the reader of this audit.'),serviceArea:z.string().trim().min(2).max(500).nullable()}).strict(),
 findings:z.array(z.object({id:findingId,category:z.enum(['offer','journey','trust','conversion','operations','measurement']),priority:z.enum(['P1','P2','P3']),title:short,observation:paragraph,whyItMatters:paragraph,recommendation:paragraph,nextSteps:z.array(action).min(2).max(5),effort:level,impact:level,confidence:z.enum(['high','medium','low']),citations:z.array(z.object({sourceId:z.string().regex(/^S[1-8]$/),quote:z.string().trim().min(12).max(400)}).strict()).min(1).max(3),measurement:z.object({metric:short,howToCollect:paragraph,currentBaseline:z.null(),successSignal:short}).strict(),copyExample:z.string().trim().min(8).max(1200).nullable()}).strict()).min(6).max(12),
 roadmap:z.array(z.object({window:z.enum(['30_days','60_days','90_days']),objective:paragraph,findingIds:z.array(findingId).min(1).max(12),ownerRole:z.string().trim().min(2).max(120),deliverables:z.array(action).min(2).max(6)}).strict()).length(3),
 unknowns:z.array(item).min(3).max(12),questionsToResolve:z.array(item).min(3).max(10),
}).strict();
export const auditReviewSchema=z.object({approved:z.boolean(),summary:paragraph,issues:z.array(z.object({findingId:findingId.nullable(),severity:z.enum(['critical','major','minor']),message:paragraph,suggestedFix:paragraph}).strict()).max(18),strengths:z.array(item).min(1).max(8),verification:z.object({citationGrounding:z.boolean(),scopeHonesty:z.boolean(),actionability:z.boolean(),noFabricatedMetrics:z.boolean()}).strict()}).strict();
export type AuditDraft=z.infer<typeof auditDraftSchema>;
export type AuditReview=z.infer<typeof auditReviewSchema>&{model:string;reviewedAt:string};
export interface AuditSource {
 id:string;url:string;title:string;checkedAt:string;contentHash:string;excerpt:string;providedBy:'website'|'owner_link';
 observations:{titlePresent:boolean;descriptionPresent:boolean;viewportPresent:boolean;h1Count:number;imageCount:number;imagesMissingAlt:number;formCount:number;bookingLinkCount:number;contactLinkCount:number};
}
export interface AuditEvidence {sources:AuditSource[];limitations:string[];collectedAt:string;}
export interface AuditContext {businessName:string;website:string;goals:string;notes?:string;links?:string[];}
export interface BusinessAuditReport extends AuditDraft {
 schemaVersion:1;orderId:string;businessName:string;website:string;generatedAt:string;analysisModel:string;reviewModel:string;
 scope:{method:string;limitations:string[];pagesChecked:number};sources:AuditSource[];
}
export function normalizeAuditQuote(value:string){return value.replace(/\s+/g,' ').trim();}
export class AuditFailure extends Error {constructor(public readonly code:string,public readonly terminal=false){super(code);}}
const actionStubs=new Set(['ownerrole','findingids','nextsteps','deliverables','objective','window','successsignal','howtocollect','currentbaseline','copyexample','recommendation','measurement','priority','effort','impact','placeholder','todo','tbd']);
const zeroOutcome=/\b(?:zero|0)\s+(?:\w+\s+){0,2}(?:conversion|appointments|bookings|revenue)\b|\b(?:conversion|appointments|bookings|revenue)\s+(?:\w+\s+){0,4}(?:zero|0)\b/i;
export type AuditQualityCode='action_placeholder'|'unsupported_scope_claim'|'unsupported_trust_absence'|'customer_permission_unverified'|'customer_pilot_unverified'|'unsupported_measurement_target'|'existing_tools_unverified'|'unsupported_copy_promise';
/** Server-enumerated codes and schema-derived locations, never model/error prose. */
export interface AuditQualityDiagnostic {code:AuditQualityCode;path:string;}
const qualityRepairHints:Readonly<Record<AuditQualityCode,string>>={
 action_placeholder:'Repair the action at its exact location with a concrete executable instruction. A required role property is valid; a literal schema-field label used as the action is not.',
 unsupported_scope_claim:'Repair the proposition at this exact field, not its category. Excerpt omissions cannot establish public-page coverage or private nonexistence. Check all sources for contrary positive facts. Retain a relevant cited positive fact and state the narrow verification unknown; narrowing an unsupported negative to a different process is not evidence. Remove unmeasured fastest, highest-return or zero-outcome claims.',
 unsupported_trust_absence:'Use relevant positive attributed trust facts or explicit collection unknowns. Captured prose cannot establish missing independent reviews, testimonials or trust signals. Another unknown clause, category change or narrower absence label cannot cure this claim.',
 customer_permission_unverified:'Before external contact, verify recorded customer permission for the intended channel and purpose and explicitly exclude declined, withdrawn and unverified contacts. Preferences and a generic verified group are not permission evidence. Later verification cannot authorize an earlier send.',
 customer_pilot_unverified:'Before any send, executable actions must verify channel/purpose permission; factual copy values against owner records; owner timing/capacity; an owner-authorized reply-route test and destination receipt; owner-approved final copy; replacement of all placeholders with confirmed facts or omission; and internal testing. Block contact if any gate remains unknown. Readiness is not an actual pilot outcome.',
 unsupported_measurement_target:'Keep the baseline null. Define an observable outcome for the same counting unit, population, status and observation window as collection; rates need numerator and denominator. Agree performance targets only after owner verification of a baseline and capacity.',
 existing_tools_unverified:'First verify current tools, records, responsibility and reporting adequacy with the owner. Reuse adequate reporting and collect only verified gaps. Carry that condition into the summary and roadmap; do not prescribe new logs or software unconditionally.',
 unsupported_copy_promise:'Keep unsupported commercial or factual copy as an unsent draft, omit it or use neutral placeholders. Before publication/contact, the owner must confirm the actual facts and final wording and every placeholder must be replaced or omitted. Placeholder replacement is not fact verification.',
};
const qualityPath=/^(?:summary\.(?:headline|overview|biggestOpportunity|startingPoint)|findings\.F(?:0[1-9]|1[0-2])\.(?:title|observation|whyItMatters|recommendation|copyExample|nextSteps\.[0-4]|measurement\.(?:howToCollect|successSignal))|roadmap\.(?:30_days|60_days|90_days)\.(?:objective|deliverables\.[0-5])|roadmap\.customerOutreach\.(?:[0-9]|1[0-7]))$/;
/** Explanations are fixed server constants, never raw exception/source/model
 * strings. Invalid codes/locations/extra properties cannot select guidance.
 * The runtime supplies only recomputed diagnostics from the exact current draft. */
export function auditQualityRepairGuidance(value:unknown):{code:AuditQualityCode;explanation:string}[]{
 if(!Array.isArray(value))return [];
 const selected=new Set<AuditQualityCode>();
 for(const item of value.slice(0,32)){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==2)continue;
  const {code,path}=item as {code?:unknown;path?:unknown};
  if(typeof code!=='string'||!Object.prototype.hasOwnProperty.call(qualityRepairHints,code)||typeof path!=='string'||path!==path.trim()||!qualityPath.test(path))continue;
  selected.add(code as AuditQualityCode);
 }
 return [...selected].map(code=>({code,explanation:qualityRepairHints[code]}));
}
function qualityDiagnostics(draft:AuditDraft,evidence:AuditEvidence,roadmapBodies:string[][]):AuditQualityDiagnostic[]{
 const diagnostics:AuditQualityDiagnostic[]=[],seen=new Set<string>();const add=(code:AuditQualityCode,path:string)=>{const key=code+':'+path;if(!seen.has(key)){seen.add(key);diagnostics.push({code,path});}};
 const summary=Object.entries(draft.summary).map(([key,text])=>({path:'summary.'+key,text}));
 const findingTexts=draft.findings.flatMap(finding=>[...(['title','observation','whyItMatters','recommendation'] as const).map(key=>({path:'findings.'+finding.id+'.'+key,text:finding[key]})),...finding.nextSteps.map((text,index)=>({path:'findings.'+finding.id+'.nextSteps.'+index,text})),{path:'findings.'+finding.id+'.measurement.howToCollect',text:finding.measurement.howToCollect},{path:'findings.'+finding.id+'.measurement.successSignal',text:finding.measurement.successSignal},...(finding.copyExample?[{path:'findings.'+finding.id+'.copyExample',text:finding.copyExample}]:[])]);
 const roadmapTexts=draft.roadmap.flatMap((phase,index)=>[{path:'roadmap.'+phase.window+'.objective',text:phase.objective},...roadmapBodies[index].map((text,actionIndex)=>({path:'roadmap.'+phase.window+'.deliverables.'+actionIndex,text}))]);
 for(const finding of draft.findings)for(const [index,text] of finding.nextSteps.entries())if(actionStubs.has(text.replace(/[^a-z0-9]/gi,'').toLowerCase()))add('action_placeholder','findings.'+finding.id+'.nextSteps.'+index);
 for(const item of roadmapTexts)if(actionStubs.has(item.text.replace(/[^a-z0-9]/gi,'').toLowerCase()))add('action_placeholder',item.path);
 for(const {text,path} of [...summary,...findingTexts,...roadmapTexts])for(const sentence of text.split(/(?<=[.!?;])\s+/))if(/\b(?:fastest|highest[- ]return)\b/i.test(sentence)||zeroOutcome.test(sentence)||hasUnsupportedAuditPrivateAbsence(sentence))add('unsupported_scope_claim',path);
 const allCitations=draft.findings.flatMap(finding=>finding.citations);
 for(const {text,path} of [...summary,...roadmapTexts])if(hasUnsupportedAuditTrustAbsence(text,evidence.sources,allCitations))add('unsupported_trust_absence',path);
 for(const finding of draft.findings){
  for(const {text,path} of findingTexts.filter(item=>item.path.startsWith('findings.'+finding.id+'.')))if(hasUnsupportedAuditTrustAbsence(text,evidence.sources,finding.citations))add('unsupported_trust_absence',path);
  const outreach=validateAuditCustomerOutreach(finding.nextSteps);if(!outreach.valid)add('customer_permission_unverified','findings.'+finding.id+'.nextSteps.'+outreach.actionIndex);
  else {const pilot=validateAuditCustomerPilot(finding.nextSteps);if(!pilot.valid)add('customer_pilot_unverified','findings.'+finding.id+'.nextSteps.'+pilot.actionIndex);}
 }
 const orderedRoadmap=draft.roadmap.map((phase,index)=>({window:phase.window,actions:roadmapBodies[index]})).sort((a,b)=>a.window.localeCompare(b.window));
 const orderedActions=orderedRoadmap.flatMap(phase=>phase.actions),roadmapOutreach=validateAuditCustomerOutreach(orderedActions);if(!roadmapOutreach.valid)add('customer_permission_unverified','roadmap.customerOutreach.'+roadmapOutreach.actionIndex);
 else {const pilot=validateAuditCustomerPilot(orderedActions);if(!pilot.valid)add('customer_pilot_unverified','roadmap.customerOutreach.'+pilot.actionIndex);}
 const toolInstallation=/\b(?:install|implement|replace|launch|introduce|start|create|set up|add|deploy)\b[^.!?;]{0,100}\b(?:analytics|tracking|crm|software|automation|(?:reminder|follow[- ]up)\s+(?:list|system|process)|(?:scheduling|booking)\s+(?:tool|system|software))\b/i;
 for(const finding of draft.findings){
  if(/(?:\b\d+(?:[.,]\d+)?\s*%|\b(?:one|two|three|five|ten|twenty|fifty|ninety|hundred)\s+percent\b|(?:[<>]=?|\b(?:at least|under|below|over|within|fewer than|less than|more than)\s+)\s*\d+|\b\d+\s*(?:hours?|hrs?|minutes?|mins?|days?)\b)/i.test(finding.measurement.successSignal))add('unsupported_measurement_target','findings.'+finding.id+'.measurement.successSignal');
  if(toolInstallation.test([finding.title,finding.recommendation,...finding.nextSteps].join('. '))){
   const first=finding.nextSteps[0],inventory=/\b(?:verify|confirm|check|inventory|determine|review|inspect)\b/i.test(first)||/\bask\s+(?:the\s+)?owner\s+to\s+(?:list|describe|identify)\b/i.test(first);if(!inventory||!/\b(?:existing|current|already|in use|internal)\b/i.test(first)||!/\b(?:analytics|tracking|crm|software|tools?|systems?|reminders?|follow[- ]up)\b/i.test(first))add('existing_tools_unverified','findings.'+finding.id+'.nextSteps.0');
  }
  const copy=finding.copyExample;if(copy&&(hasAnchoredAuditCommercialPlaceholder(copy)||/(?:[$£€]\s*\d|\d[\d.,–-]*\s*(?:%|(?:hours?|hrs?|h|minutes?|mins?|days?|weeks?|months?|dollars?|USD)\b)|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|sixty|ninety)\s*(?:hours?|minutes?|days?|weeks?|months?)\b)/i.test(copy))&&!evidence.sources.some(source=>normalizeAuditQuote(source.excerpt).includes(normalizeAuditQuote(copy))))add('unsupported_copy_promise','findings.'+finding.id+'.copyExample');
 }
 return diagnostics.slice(0,32);
}
function structuralDraft(value:unknown,evidence:AuditEvidence,allowLegacy=false){
 const parsed=auditDraftSchema.safeParse(value);if(!parsed.success)throw new AuditFailure('model_output_invalid');const draft=parsed.data;
 const ids=new Set(draft.findings.map(finding=>finding.id));
 if(ids.size!==draft.findings.length||new Set(draft.findings.map(finding=>finding.category)).size!==6)throw new AuditFailure('model_output_invalid');
 const windows=new Set(draft.roadmap.map(step=>step.window));if(windows.size!==3||draft.roadmap.some(step=>step.findingIds.some(id=>!ids.has(id))))throw new AuditFailure('model_output_invalid');
 const roadmap=validateAuditRoadmapReferences(draft.roadmap,ids,{allowUnmappedLegacy:allowLegacy});if(!roadmap.valid)throw new AuditFailure('roadmap_references_invalid');
 for(const finding of draft.findings)for(const citation of finding.citations){const source=evidence.sources.find(source=>source.id===citation.sourceId);if(!source||!normalizeAuditQuote(source.excerpt).includes(normalizeAuditQuote(citation.quote)))throw new AuditFailure('unsupported_citation');}
 return {draft,roadmapBodies:roadmap.phases.map(phase=>phase.deliverables.map(deliverable=>deliverable.text))};
}
/** Private drafts may have quality defects, but never corrupt shape, invented
 * baselines/quotes, incomplete categories, or broken canonical action mappings. */
export function validateAuditInternalDraft(value:unknown,evidence:AuditEvidence):AuditDraft{return structuralDraft(value,evidence).draft;}
export function auditDraftQualityDiagnostics(value:unknown,evidence:AuditEvidence,options:{/** Diagnostic inspection of an explicitly untrusted legacy repair input only. */repairInput?:boolean}={}):AuditQualityDiagnostic[]{const {draft,roadmapBodies}=structuralDraft(value,evidence,options.repairInput===true);return qualityDiagnostics(draft,evidence,roadmapBodies);}
export function validateAuditDraft(value:unknown,evidence:AuditEvidence,options:{/** Untrusted legacy repair only. Never new internal storage, review, or final delivery. */repairInput?:boolean}={}):AuditDraft {
 const {draft,roadmapBodies}=structuralDraft(value,evidence,options.repairInput===true);
 if(!options.repairInput){const first=qualityDiagnostics(draft,evidence,roadmapBodies)[0];if(first)throw new AuditFailure(first.code);}
 return draft;
}

export function approvedAuditReview(review:z.infer<typeof auditReviewSchema>){return review.approved&&Object.values(review.verification).every(Boolean)&&!review.issues.some(issue=>issue.severity==='critical'||issue.severity==='major');}
export function validateAuditReview(value:unknown,draft:AuditDraft):z.infer<typeof auditReviewSchema> {
 const parsed=auditReviewSchema.safeParse(value);if(!parsed.success)throw new AuditFailure('model_output_invalid');
 if(parsed.data.issues.some(issue=>issue.findingId&&!draft.findings.some(finding=>finding.id===issue.findingId)))throw new AuditFailure('model_output_invalid');return parsed.data;
}
export function assembleAuditReport(orderId:string,context:AuditContext,evidence:AuditEvidence,draft:AuditDraft,generatedAt:string,models:{analysisModel:AuditModel;reviewModel:AuditModel}={analysisModel:AUDIT_ANALYSIS_MODEL,reviewModel:AUDIT_REVIEW_MODEL}):BusinessAuditReport {
 return {...validateAuditDraft(draft,evidence),schemaVersion:1,orderId,businessName:context.businessName,website:context.website,generatedAt,analysisModel:models.analysisModel,reviewModel:models.reviewModel,scope:{method:'Public static website evidence, owner-supplied business goals, structured model analysis, and an independent automated review. No private accounts, transactions, customer records, live calls, or rendered-browser measurements were accessed.',limitations:evidence.limitations,pagesChecked:evidence.sources.length},sources:evidence.sources};
}
