import {it,expect} from 'vitest';
import {prioritizeDetectionsDecide,triageSummary,triageScoreOf} from '../src/proactive';
import type {DetectionRow} from '../src/proactive-detectors';

const NOW=Date.parse('2026-10-09T14:00:00Z');
const ctx:any={nowMs:NOW,timeZone:'America/New_York',businessName:'Test Salon',vertical:'salon'};

const detection=(id:string,detector:DetectionRow['detector'],payload:Record<string,any>,detectedAt=NOW-30*60000):DetectionRow=>({
 id,tenant_id:'t1',detector,detected_at:new Date(detectedAt).toISOString(),
 payload_json:JSON.stringify(payload),state:'open',dedupe_key:`k:${id}`,
});
const item=(id:string,detector:DetectionRow['detector'],payload:Record<string,any>)=>({
 detection:detection(id,detector,payload),card:{id:`card-${id}`,title:`Title ${id}`,body:`Body ${id}`},
});

// Mock transport answering each score question with a chosen level index (0-4 of 5 levels).
const mockScores=(levels:number[])=>async(_env:any,body:any)=>{
 const answers:Record<string,any>={};
 const qids=Object.keys(body.questions);
 qids.forEach((qid,i)=>{
  const legend:{[k:string]:string}={};
  for(let l=0;l<5;l++)legend[String(l)]=`L${l}`;
  answers[qid]={type:'score',score:levels[i]??2,legend,probabilities:{[String(levels[i]??2)]:0.9}};
 });
 return {raw:{model:'clef-flash',answers,usage:{input_tokens:40,output_tokens:0}},latencyMs:5,via:'mock'};
};

const fakeEnv=(writes:any[])=>({
 AGENT_DB:{
  prepare:(sql:string)=>({
   bind:(...args:any[])=>({
    run:async()=>{writes.push({sql,args});return {};},
    first:async()=>null,
    all:async()=>({results:[]}),
   }),
  }),
 },
} as any);

it('ranks detections by triage score and persists the scores',async()=>{
 const writes:any[]=[];
 const items=[
  item('a','slow_day',{maxGapMinutes:60}),
  item('b','unanswered_lead',{fromNumber:'+15551234567',body:'do you have openings',receivedAt:new Date(NOW-130*60000).toISOString()}),
  item('c','no_show_risk',{customerName:'Jane',customerPhone:'+15557654321',startsAt:new Date(NOW+86400000).toISOString()}),
 ];
 const ordered=await prioritizeDetectionsDecide(fakeEnv(writes),ctx,items,{decideTransport:mockScores([1,4,2])});
 // scores: a=25, b=100, c=50 -> order b, c, a
 expect(ordered.map(o=>o.detection.id)).toEqual(['b','c','a']);
 const updates=writes.filter(w=>w.sql.includes('triage_score'));
 expect(updates).toHaveLength(3);
 expect(updates.map(w=>w.args[0]).sort((x:number,y:number)=>x-y)).toEqual([25,50,100]);
});

it('keeps the original order and writes nothing when decide() fails',async()=>{
 const writes:any[]=[];
 const items=[item('a','slow_day',{maxGapMinutes:60}),item('b','lapsed_regular',{customers:[],count:3,cutoffDays:56})];
 const down=async()=>{throw new Error('net down');};
 const ordered=await prioritizeDetectionsDecide(fakeEnv(writes),ctx,items,{decideTransport:down});
 expect(ordered.map(o=>o.detection.id)).toEqual(['a','b']);
 expect(writes).toHaveLength(0);
});

it('skips the model call entirely for fewer than two items',async()=>{
 let called=false;
 const t=async()=>{called=true;throw new Error('should not be called');};
 const writes:any[]=[];
 const ordered=await prioritizeDetectionsDecide(fakeEnv(writes),ctx,[item('a','slow_day',{maxGapMinutes:60})],{decideTransport:t});
 expect(called).toBe(false);
 expect(ordered).toHaveLength(1);
 expect(writes).toHaveLength(0);
});

it('sinks unscored items without disturbing the scored order',async()=>{
 const writes:any[]=[];
 const items=[item('a','slow_day',{maxGapMinutes:60}),item('b','unanswered_lead',{}),item('c','lapsed_regular',{count:2,cutoffDays:56})];
 // Second answer missing -> not ok -> sinks to the end, original relative order kept.
 const partial=async(_env:any,body:any)=>{
  const answers:Record<string,any>={};
  const qids=Object.keys(body.questions);
  const legend:{[k:string]:string}={};for(let l=0;l<5;l++)legend[String(l)]=`L${l}`;
  answers[qids[0]]={type:'score',score:4,legend,probabilities:{'4':0.9}};
  answers[qids[2]]={type:'score',score:1,legend,probabilities:{'1':0.9}};
  return {raw:{model:'clef-flash',answers,usage:{input_tokens:40,output_tokens:0}},latencyMs:5,via:'mock'};
 };
 const ordered=await prioritizeDetectionsDecide(fakeEnv(writes),ctx,items,{decideTransport:partial});
 expect(ordered.map(o=>o.detection.id)).toEqual(['a','c','b']);
 expect(writes.filter(w=>w.sql.includes('triage_score'))).toHaveLength(2);
});

it('scrubs PII from the decision state',async()=>{
 const seen:string[]=[];
 const spy=async(_env:any,body:any)=>{
  for(const q of Object.values(body.questions) as any[])seen.push(q.instructions);
  const answers:Record<string,any>={};
  const legend:{[k:string]:string}={};for(let l=0;l<5;l++)legend[String(l)]=`L${l}`;
  for(const qid of Object.keys(body.questions))answers[qid]={type:'score',score:2,legend,probabilities:{'2':0.9}};
  return {raw:{model:'clef-flash',answers,usage:{input_tokens:40,output_tokens:0}},latencyMs:5,via:'mock'};
 };
 const writes:any[]=[];
 const items=[
  item('a','unanswered_lead',{fromNumber:'+15551234567',body:'hey do you take my insurance',receivedAt:new Date(NOW-60000).toISOString()}),
  item('b','no_show_risk',{customerName:'Jane Doe',customerPhone:'+15557654321',startsAt:new Date(NOW+86400000).toISOString()}),
  item('c','missed_call_followup',{missedCallId:'x',callerNumber:'+15559876543',occurredAt:new Date(NOW-60000).toISOString()}),
 ];
 await prioritizeDetectionsDecide(fakeEnv(writes),ctx,items,{decideTransport:spy});
 const joined=seen.join(' ');
 for(const secret of ['+15551234567','+15557654321','+15559876543','Jane Doe','take my insurance'])expect(joined).not.toContain(secret);
});

it('triageSummary covers every detector kind without PII',()=>{
 const kinds:DetectionRow['detector'][]=['slow_day','lapsed_regular','missed_call_followup','unanswered_lead','no_show_risk'];
 for(const k of kinds){
  const s=triageSummary(detection('x',k,{customerName:'Jane',customerPhone:'+1555',body:'secret body',fromNumber:'+1555'}),NOW);
  expect(s.length).toBeGreaterThan(10);
  expect(s).not.toContain('Jane');expect(s).not.toContain('+1555');expect(s).not.toContain('secret body');
 }
});

it('triageScoreOf reads persisted scores safely',()=>{
 expect(triageScoreOf(JSON.stringify({triage_score:73}))).toBe(73);
 expect(triageScoreOf(JSON.stringify({}))).toBeNull();
 expect(triageScoreOf('not json')).toBeNull();
 expect(triageScoreOf(JSON.stringify({triage_score:'high'}))).toBeNull();
 expect(triageScoreOf(JSON.stringify({triage_score:999}))).toBe(100);
});
