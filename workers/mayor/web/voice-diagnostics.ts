const timingFields=['turnTotalMs','speechStartToFirstInterimMs','speechStartToFinalMs','afterTranscribeMs','modelToFirstTextMs','exposedReasoningMs','modelStreamConsumptionMs','finalInputToFirstAudioMs','ttsToFirstAudioMs','ttsWallMs','ttsWorkMs'] as const;
type Timing=typeof timingFields[number];
const outcomes=['completed','no_output','output_limit','content_filtered','model_error','tts_error','aborted','skipped','error'] as const;
type Outcome=typeof outcomes[number];
type Source='speech'|'text';
type Sample={source:Source;outcome:Outcome}&Partial<Record<Timing,number>>;
const duration=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=900000;
function distribution(values:number[]){
 values.sort((a,b)=>a-b);
 const percentile=(fraction:number)=>values.length?values[Math.max(0,Math.ceil(values.length*fraction)-1)]:null;
 return {samples:values.length,p50Ms:percentile(.5),p95Ms:percentile(.95)};
}
/** Explicitly enabled, bounded, content-free page memory; no storage or network. */
export function createVoiceDiagnostics(){
 let active=false,segment=0,dropped=0,rejected=0;
 const samples:Sample[]=[],keys:string[]=[],seen=new Set<string>();
 return {
  start(){active=true;segment=0;dropped=0;rejected=0;samples.length=0;keys.length=0;seen.clear();},
  stop(){active=false;},
  clear(){active=false;dropped=0;rejected=0;samples.length=0;keys.length=0;seen.clear();},
  newConnection(){segment++;},
  get active(){return active;},
  get count(){return samples.length;},
  record(raw:unknown){
   if(!active)return;
   if(!raw||typeof raw!=='object'){rejected++;return;}
   const value=raw as Record<string,unknown>;
   if(typeof value.turnId!=='string'||!value.turnId||value.turnId.length>128||!['speech','text'].includes(String(value.source))||!outcomes.includes(value.outcome as Outcome)||!duration(value.turnTotalMs)){rejected++;return;}
   const key=`${segment}:${value.turnId}`;if(seen.has(key))return;
   const sample:Sample={source:value.source as Source,outcome:value.outcome as Outcome};
   for(const field of timingFields)if(duration(value[field]))sample[field]=Math.round(value[field] as number);
   if(samples.length===200){samples.shift();seen.delete(keys.shift()!);dropped++;}
   samples.push(sample);keys.push(key);seen.add(key);
  },
  report(){
   const groups=Object.fromEntries((['speech','text'] as const).map(source=>{
    const rows=samples.filter(sample=>sample.source===source),completed=rows.filter(sample=>sample.outcome==='completed');
    return [source,{turns:rows.length,outcomes:Object.fromEntries(outcomes.map(outcome=>[outcome,rows.filter(row=>row.outcome===outcome).length])),completedTurnTimings:Object.fromEntries(timingFields.map(field=>[field,distribution(completed.flatMap(row=>row[field]===undefined?[]:[row[field]!]))]))}];
   }));
   return {schemaVersion:1,measurement:'server_voice_pipeline',limitations:['Not acoustic end-of-speech to audible playback latency.','Excludes browser playback and network delivery; clocks are not combined.','Timings overlap and must not be added together.','Percentiles cover completed retained turns only; other outcomes are counted separately.','Device and network conditions must be recorded separately by the tester.'],active,retainedTurns:samples.length,droppedTurns:dropped,rejectedRecords:rejected,groups,samples:samples.map(sample=>({...sample}))};
  },
 };
}
