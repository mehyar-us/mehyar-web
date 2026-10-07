/** Pure roadmap reference helpers. Callers retain responsibility for action quality and text bounds. */
export type AuditRoadmapDeliverable =
 | {kind:'mapped';findingIds:string[];text:string}
 | {kind:'legacy';text:string}
 | {kind:'invalid';error:'invalid_value'|'empty_text'|'malformed_prefix'|'duplicate_reference'};

export type MappedAuditRoadmapDeliverable = Extract<AuditRoadmapDeliverable,{kind:'mapped'}>;
export type LegacyAuditRoadmapDeliverable = Extract<AuditRoadmapDeliverable,{kind:'legacy'}>;
export interface MappedAuditRoadmapPhase {findingIds:string[];deliverables:MappedAuditRoadmapDeliverable[];}
export interface LegacyAuditRoadmapPhase {findingIds:string[];deliverables:LegacyAuditRoadmapDeliverable[];}
export type AuditRoadmapReferenceError =
 | 'invalid_known_findings'|'invalid_phases'|'invalid_phase'|'invalid_phase_reference'
 | 'duplicate_phase_reference'|'unknown_reference'|'invalid_deliverable'
 | 'missing_reference'|'mixed_references'|'reference_union_mismatch';
export type AuditRoadmapReferenceValidation =
 | {valid:true;mode:'mapped';phases:MappedAuditRoadmapPhase[]}
 | {valid:true;mode:'legacy';phases:LegacyAuditRoadmapPhase[]}
 | {valid:false;error:AuditRoadmapReferenceError;phaseIndex?:number;deliverableIndex?:number;
    findingId?:string;reason?:Extract<AuditRoadmapDeliverable,{kind:'invalid'}>['error'];
    missingFindingIds?:string[];extraFindingIds?:string[]};

const findingIdPattern=/^F(?:0[1-9]|1[0-2])$/;
const mappedPattern=/^\[(F(?:0[1-9]|1[0-2])(?:,F(?:0[1-9]|1[0-2]))*)\](?: ([\s\S]*))?$/;

/** Detect only a leading attempted reference, never infer references from action prose. */
function attemptedReferencePrefix(text:string):boolean{
 // Markdown/quotation wrappers cannot turn a malformed mapped prefix into legacy.
 const unwrapped=text.replace(/^(?:(?:[-*+]\s+|\d+[.)]\s+|[`\"'“”‘’*]+)\s*)+/,'');
 if(unwrapped!==text)return attemptedReferencePrefix(unwrapped);
 if(/^[Ff]\s*\p{N}/u.test(text))return true;
 if(!/^[\[({<]/.test(text))return false;
 const prefix=text.replace(/^(?:[\[({<]\s*)+/,'');
 return !prefix || /^[\])}>]/.test(prefix)
  || /^[A-Za-zＦｆ]\s*\p{N}/u.test(prefix)
  || /^[FfＦｆ]/.test(prefix);
}

/**
 * Canonical mapping is `[F01,F06] Action text`: exact IDs, no spaces inside the
 * prefix, and one space before the body. Plain historical strings stay legacy.
 */
export function parseAuditRoadmapDeliverable(value:unknown):AuditRoadmapDeliverable{
 if(typeof value!=='string')return {kind:'invalid',error:'invalid_value'};
 const input=value.trim();
 if(!input)return {kind:'invalid',error:'empty_text'};
 const match=mappedPattern.exec(input);
 if(match){
  const findingIds=match[1].split(',');
  if(new Set(findingIds).size!==findingIds.length)return {kind:'invalid',error:'duplicate_reference'};
  const body=match[2];
  if(!body || !body.trim())return {kind:'invalid',error:'empty_text'};
  if(body!==body.trimStart() || attemptedReferencePrefix(body))return {kind:'invalid',error:'malformed_prefix'};
  return {kind:'mapped',findingIds,text:body};
 }
 if(attemptedReferencePrefix(input))return {kind:'invalid',error:'malformed_prefix'};
 return {kind:'legacy',text:input};
}

/**
 * Validate structural traceability without guessing whether an action is relevant
 * to a finding. Legacy repair input is accepted only when explicitly allowed and
 * every deliverable in every phase is plain legacy text. Malformed/mixed mappings
 * can never use that escape hatch. No input is mutated and no schema is imported.
 */
export function validateAuditRoadmapReferences(
 phases:unknown,
 knownFindingIds:readonly string[]|ReadonlySet<string>,
 options:{allowUnmappedLegacy?:boolean}={},
):AuditRoadmapReferenceValidation{
 const knownValues=Array.isArray(knownFindingIds)?knownFindingIds:
  knownFindingIds instanceof Set?[...knownFindingIds]:null;
 if(!knownValues || !knownValues.length || knownValues.some(id=>typeof id!=='string'||!findingIdPattern.test(id))
  || new Set(knownValues).size!==knownValues.length)return {valid:false,error:'invalid_known_findings'};
 const known=new Set<string>(knownValues);
 if(!Array.isArray(phases) || !phases.length)return {valid:false,error:'invalid_phases'};
 const parsedPhases:{findingIds:string[];deliverables:(MappedAuditRoadmapDeliverable|LegacyAuditRoadmapDeliverable)[]}[]=[];
 let mapped=0,legacy=0;
 let firstLegacy:{phaseIndex:number;deliverableIndex:number}|undefined;
 for(let phaseIndex=0;phaseIndex<phases.length;phaseIndex++){
  const phase=phases[phaseIndex];
  if(!phase || typeof phase!=='object' || Array.isArray(phase)
   || !Array.isArray(phase.findingIds) || !phase.findingIds.length
   || !Array.isArray(phase.deliverables) || !phase.deliverables.length)return {valid:false,error:'invalid_phase',phaseIndex};
  const findingIds:string[]=[],seen=new Set<string>();
  for(const id of phase.findingIds){
   if(typeof id!=='string'||!findingIdPattern.test(id))return {valid:false,error:'invalid_phase_reference',phaseIndex};
   if(seen.has(id))return {valid:false,error:'duplicate_phase_reference',phaseIndex,findingId:id};
   if(!known.has(id))return {valid:false,error:'unknown_reference',phaseIndex,findingId:id};
   seen.add(id);findingIds.push(id);
  }
  const deliverables:(MappedAuditRoadmapDeliverable|LegacyAuditRoadmapDeliverable)[]=[];
  for(let deliverableIndex=0;deliverableIndex<phase.deliverables.length;deliverableIndex++){
   const parsed=parseAuditRoadmapDeliverable(phase.deliverables[deliverableIndex]);
   if(parsed.kind==='invalid')return {valid:false,error:'invalid_deliverable',phaseIndex,deliverableIndex,reason:parsed.error};
   if(parsed.kind==='mapped'){
    mapped++;
    for(const id of parsed.findingIds)if(!known.has(id))return {valid:false,error:'unknown_reference',phaseIndex,deliverableIndex,findingId:id};
   }else{
    legacy++;
    firstLegacy??={phaseIndex,deliverableIndex};
   }
   deliverables.push(parsed);
  }
  parsedPhases.push({findingIds,deliverables});
 }
 if(mapped && legacy)return {valid:false,error:'mixed_references',...firstLegacy};
 if(legacy){
  if(options.allowUnmappedLegacy!==true)return {valid:false,error:'missing_reference',...firstLegacy};
  return {valid:true,mode:'legacy',phases:parsedPhases as LegacyAuditRoadmapPhase[]};
 }
 for(let phaseIndex=0;phaseIndex<parsedPhases.length;phaseIndex++){
  const phase=parsedPhases[phaseIndex] as MappedAuditRoadmapPhase;
  const union=new Set(phase.deliverables.flatMap(deliverable=>deliverable.findingIds));
  const declared=new Set(phase.findingIds);
  const missingFindingIds=[...union].filter(id=>!declared.has(id)).sort();
  const extraFindingIds=[...declared].filter(id=>!union.has(id)).sort();
  if(missingFindingIds.length || extraFindingIds.length)return {valid:false,error:'reference_union_mismatch',phaseIndex,missingFindingIds,extraFindingIds};
 }
 return {valid:true,mode:'mapped',phases:parsedPhases as MappedAuditRoadmapPhase[]};
}
