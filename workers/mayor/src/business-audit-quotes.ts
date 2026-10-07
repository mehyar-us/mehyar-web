import {z} from 'zod';
import {AuditFailure,auditDraftSchema,auditReviewSchema,normalizeAuditQuote,validateAuditDraft,validateAuditInternalDraft,validateAuditReview,type AuditDraft,type AuditEvidence} from './business-audit-schema';

const modelCitation=z.object({sourceId:z.string().regex(/^S[1-8]$/),quoteId:z.string().regex(/^Q(?:0[1-9]|[1-5][0-9]|6[0-4])$/)}).strict();
const concise=(minimum:number,maximum:number)=>z.string().trim().min(minimum).max(maximum);
const conciseAction=concise(8,240).describe('One executable action with a verb and a specific object. No field labels or placeholders.');
const modelFinding=auditDraftSchema.shape.findings.element.extend({
 title:concise(8,160),observation:concise(20,700),whyItMatters:concise(20,500),recommendation:concise(20,700),
 nextSteps:z.array(conciseAction).min(2).max(4),citations:z.array(modelCitation).min(1).max(3),
 measurement:auditDraftSchema.shape.findings.element.shape.measurement.extend({metric:concise(8,160),howToCollect:concise(20,500),successSignal:concise(8,300).describe('A verifiable outcome or owner-agreed target after baseline collection. Never invent numerical performance thresholds.')}),
 copyExample:concise(8,700).describe('Publishable only after owner confirmation. Unknown requirements, policies, prices and service promises need bracketed placeholders.').nullable(),
}).strict();
/** The model gets a concise contract; public report bounds stay compatible with stored reports. */
export const auditModelDraftSchema=auditDraftSchema.extend({
 summary:z.object({headline:concise(8,160),overview:concise(20,700),biggestOpportunity:concise(20,600),startingPoint:concise(20,500)}).strict(),
 business:auditDraftSchema.shape.business.extend({offer:concise(20,500).describe('Actual products/services, not audit scope.'),audience:concise(8,160).describe('The business end customers, not the audit reader.'),serviceArea:concise(2,350).nullable()}),
 findings:z.array(modelFinding).min(6).max(8),
 roadmap:z.array(auditDraftSchema.shape.roadmap.element.extend({objective:concise(20,500),ownerRole:concise(2,80).describe('Required actual role text, such as Workshop owner. This property is not an action placeholder and must never be deleted; individual staff names are not required.'),deliverables:z.array(concise(8,240).describe('Canonical finding-reference prefix then an executable action, for example [F01,F06] Workshop owner verifies the existing baseline. Every phase findingIds must be the exact union of its deliverable prefixes.')).min(2).max(5)}).strict()).length(3),
 unknowns:z.array(concise(8,240)).min(3).max(10),questionsToResolve:z.array(concise(8,240)).min(3).max(8),
}).strict();
export const auditModelReviewSchema=auditReviewSchema.extend({summary:concise(20,900),issues:z.array(auditReviewSchema.shape.issues.element.extend({message:concise(20,700),suggestedFix:concise(20,700)}).strict()).max(12),strengths:z.array(concise(8,300)).min(1).max(6)}).strict();
export function resolveAuditModelReview(value:unknown,draft:AuditDraft){const parsed=auditModelReviewSchema.safeParse(value);if(!parsed.success)throw new AuditFailure('model_output_invalid');return validateAuditReview(parsed.data,draft);}
/** Literal captured spans only. IDs prevent model punctuation, rearrangement or paraphrase from becoming quotes. */
export function auditQuoteCatalog(evidence:AuditEvidence){
 return evidence.sources.map(source=>{
  const text=normalizeAuditQuote(source.excerpt),titlePrefix=`Page title: ${normalizeAuditQuote(source.title)}`;
  const prose=text.startsWith(titlePrefix)?text.slice(titlePrefix.length).trim():text;
  const spans:string[]=[];
  for(const sentence of prose.split(/(?<=[.!?])\s+/)){
   let remaining=sentence;
   while(remaining.length>400){const end=remaining.lastIndexOf(' ',400);if(end<12)break;spans.push(remaining.slice(0,end));remaining=remaining.slice(end+1);}
   if(remaining.length>=12&&remaining.length<=400)spans.push(remaining);
  }
  return {sourceId:source.id,quotes:[...new Set(spans)].slice(0,64).map((quote,index)=>({quoteId:`Q${String(index+1).padStart(2,'0')}`,quote}))};
 });
}
const internalResolvedDraftSchema=auditModelDraftSchema.extend({findings:z.array(modelFinding.extend({citations:auditDraftSchema.shape.findings.element.shape.citations}).strict()).min(6).max(8)}).strict();
/** Recheck stored new private output against the same concise shape, using
 * resolved literal citations rather than model quote IDs. */
export function validateAuditStoredInternalDraft(value:unknown,evidence:AuditEvidence):AuditDraft{
 const parsed=internalResolvedDraftSchema.safeParse(value);if(!parsed.success)throw new AuditFailure('model_output_invalid');return validateAuditInternalDraft(parsed.data,evidence);
}
function resolveModelDraft(value:unknown,evidence:AuditEvidence,internal:boolean):AuditDraft{
 const parsed=auditModelDraftSchema.safeParse(value);if(!parsed.success)throw new AuditFailure('model_output_invalid');
 const catalog=auditQuoteCatalog(evidence);
 const draft={...parsed.data,findings:parsed.data.findings.map(finding=>({...finding,citations:finding.citations.map(citation=>{
  const quote=catalog.find(source=>source.sourceId===citation.sourceId)?.quotes.find(quote=>quote.quoteId===citation.quoteId)?.quote;
  if(!quote)throw new AuditFailure('unsupported_citation');return {sourceId:citation.sourceId,quote};
 })}))};
 return internal?validateAuditInternalDraft(draft,evidence):validateAuditDraft(draft,evidence);
}
/** Existing callers retain strict quality admission. */
export function resolveAuditModelDraft(value:unknown,evidence:AuditEvidence):AuditDraft{return resolveModelDraft(value,evidence,false);}
/** Only the private analyze/revise pipeline may defer quality to the critic. */
export function resolveAuditInternalModelDraft(value:unknown,evidence:AuditEvidence):AuditDraft{return resolveModelDraft(value,evidence,true);}
