import {z} from 'zod';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const label=z.string().trim().min(1).max(160);
const sample=z.object({
 id:label,kind:z.enum(['response','interruption']),outcome:z.enum(['success','failure']),
 recordingSha256:z.string().regex(/^[a-f0-9]{64}$/),
 startMs:z.number().finite().nonnegative(),endMs:z.number().finite().nonnegative().optional(),
}).strict().superRefine((s,ctx)=>{
 if(s.outcome==='success'&&(s.endMs===undefined||s.endMs<s.startMs))ctx.addIssue({code:'custom',message:'Successful samples need an end timestamp at or after start.'});
 if(s.outcome==='failure'&&s.endMs!==undefined)ctx.addIssue({code:'custom',message:'Failed samples must not contain successful end timestamps.'});
});
const schema=z.object({
 schemaVersion:z.literal(1),measurement:z.literal('annotated_acoustic_recording'),
 sessions:z.array(z.object({
  id:label,deviceClass:z.enum(['desktop','mobile']),device:label,region:label,
  network:z.enum(['baseline','impaired']),addedRttMs:z.number().finite().nonnegative(),
  downlinkKbps:z.number().finite().positive(),uplinkKbps:z.number().finite().positive(),
  measuredAt:z.iso.datetime(),samples:z.array(sample).max(2000),
 }).strict()).min(1).max(100),
}).strict();
export function assessAcousticLatency(raw){
 const input=schema.parse(raw),sessionIds=new Set(),evidenceKeys=new Set();
 const results=input.sessions.map(session=>{
  if(sessionIds.has(session.id))throw new Error('Duplicate session ID.');sessionIds.add(session.id);
  const sampleIds=new Set();
  for(const s of session.samples){
   const key=`${s.recordingSha256}:${s.kind}:${s.startMs}`;
   if(sampleIds.has(s.id)||evidenceKeys.has(key))throw new Error('Duplicate sample or recording annotation.');
   sampleIds.add(s.id);evidenceKeys.add(key);
  }
  const metrics=Object.fromEntries(['response','interruption'].map(kind=>{
   const rows=session.samples.filter(s=>s.kind===kind),values=rows.filter(s=>s.outcome==='success').map(s=>s.endMs-s.startMs).sort((a,b)=>a-b);
   const percentile=p=>values.length?values[Math.ceil(values.length*p)-1]:null;
   const p50Ms=percentile(.5),p95Ms=percentile(.95),failures=rows.length-values.length;
   const exceeds=kind==='response'?(p50Ms>1200||p95Ms>2500):p95Ms>250;
   return [kind,{attempts:rows.length,successful:values.length,failures,p50Ms,p95Ms,status:failures||exceeds?'failed':values.length<30?'incomplete':'passed'}];
  }));
  const networkValid=session.network==='baseline'||(session.addedRttMs>=150&&session.downlinkKbps<=1000&&session.uplinkKbps<=256);
  return {id:session.id,deviceClass:session.deviceClass,device:session.device,region:session.region,network:session.network,addedRttMs:session.addedRttMs,downlinkKbps:session.downlinkKbps,uplinkKbps:session.uplinkKbps,measuredAt:session.measuredAt,networkValid,metrics};
 });
 const missingConditions=['desktop','mobile'].flatMap(device=>['baseline','impaired'].filter(network=>!results.some(s=>s.deviceClass===device&&s.network===network)).map(network=>`${device}/${network}`));
 const failed=results.some(s=>!s.networkValid||Object.values(s.metrics).some(m=>m.status==='failed'));
 const incomplete=missingConditions.length>0||results.some(s=>Object.values(s.metrics).some(m=>m.status==='incomplete'));
 return {measurement:input.measurement,status:failed?'failed':incomplete?'incomplete':'passed',missingConditions,results,
  limitations:['Annotations and recording hashes must be independently checked against actual recordings.','Numerical passage alone does not verify microphone hardware, annotation accuracy or network shaping.','Successful-sample percentiles are shown separately; any failed attempt prevents passage.','Calendar tool timing is outside this acoustic assessment.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [source,output]=process.argv.slice(2);if(!source||!output)throw new Error('Usage: node scripts/assess-acoustic-latency.mjs annotations.json new-report.json');
  const report=assessAcousticLatency(JSON.parse(readFileSync(source,'utf8')));
  writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(`Acoustic assessment: ${report.status}. Recording review is still required.`);
  if(report.status!=='passed')process.exitCode=2;
 }catch(error){console.error(error instanceof z.ZodError?'Invalid acoustic annotation schema.':error.message);process.exitCode=1;}
}
