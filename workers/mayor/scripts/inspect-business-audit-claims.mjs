import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const evidenceName=process.argv[2];
if(!evidenceName||!/^[a-z0-9-]+$/.test(evidenceName))throw new Error('Provide the lowercase synthetic evidence name.');
const workspace=fileURLToPath(new URL('../',import.meta.url));
const sourcePath=resolve(workspace,`../../docs/mayor/evidence/${evidenceName}-completed-content.json`);
const evidence=JSON.parse(await readFile(resolve(workspace,`../../docs/mayor/evidence/${evidenceName}.json`),'utf8'));
if(evidence.synthetic!==true)throw new Error('Only preserved synthetic evidence is eligible.');
const completed=JSON.parse(await readFile(sourcePath,'utf8'));
const bundled=await build({stdin:{contents:"export {validateAuditDraft} from './src/business-audit-schema';export {auditModelDraftSchema,resolveAuditModelDraft} from './src/business-audit-quotes';export {auditFixtureDraft,auditFixtureEvidence} from './tests/fixtures/business-audit';",resolveDir:workspace},bundle:true,platform:'node',format:'esm',write:false});
const {validateAuditDraft,auditModelDraftSchema,resolveAuditModelDraft,auditFixtureDraft,auditFixtureEvidence}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const parsed=auditModelDraftSchema.safeParse(completed);
const schemaIssues=parsed.success?[]:parsed.error.issues.map(issue=>({path:issue.path,code:issue.code,message:issue.message}));
let actualAdmission;try{resolveAuditModelDraft(completed,evidence.phases[0].evidence);actualAdmission={accepted:true};}catch(error){actualAdmission={accepted:false,code:error.code};}
const candidates=Object.entries(completed.summary).map(([key,value])=>({path:`summary.${key}`,value}));
for(const finding of completed.findings){
 for(const key of ['title','observation','whyItMatters','recommendation','copyExample'])if(finding[key])candidates.push({path:`findings.${finding.id}.${key}`,value:finding[key]});
 finding.nextSteps.forEach((value,index)=>candidates.push({path:`findings.${finding.id}.nextSteps.${index}`,value}));
 for(const key of ['howToCollect','successSignal'])candidates.push({path:`findings.${finding.id}.measurement.${key}`,value:finding.measurement[key]});
}
completed.roadmap.forEach((phase,index)=>{candidates.push({path:`roadmap.${index}.objective`,value:phase.objective});phase.deliverables.forEach((value,item)=>candidates.push({path:`roadmap.${index}.deliverables.${item}`,value}));});
const rejections=[];
for(const candidate of candidates){
 const isolated=auditFixtureDraft();
 if(candidate.value.length>=20)isolated.summary.overview=candidate.value;else isolated.summary.headline=candidate.value;
 try{validateAuditDraft(isolated,auditFixtureEvidence());}catch(error){if(error.code==='unsupported_scope_claim')rejections.push({...candidate,code:error.code});}
}
const proof={synthetic:true,newInference:false,visibleContentSource:sourcePath,actualAdmission,schemaIssues,structuralFacts:{findingIds:completed.findings.map(finding=>finding.id),categories:completed.findings.map(finding=>finding.category),roadmapWindows:completed.roadmap.map(phase=>phase.window),roadmapReferences:completed.roadmap.flatMap(phase=>phase.findingIds)},method:'Complete output is passed to the actual private schema and production admission function with preserved evidence. Each exact narrative is then isolated in an otherwise accepted fixture to diagnose conservative scope gating, not full-draft semantic approval.',rejections};
await writeFile(resolve(workspace,`../../docs/mayor/evidence/${evidenceName}-scope-proof.json`),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));
