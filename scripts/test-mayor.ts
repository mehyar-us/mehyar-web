import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mayorConcepts } from '../client/src/data/mayor-concepts';
for(const concept of Object.values(mayorConcepts))assert(readFileSync(`client/public${concept.image}`).length>0,'Every curated illustration must exist');
import { createMayorVoice, MayorSpeechPlatform } from "../client/src/lib/mayor-voice";
import { contextForMayor, mayorHistorySchema, mayorVisitSchema, mayorSummary } from "../client/src/lib/mayor-conversations";
const response=JSON.parse(readFileSync("docs/site-review-2026-10-03/rethink/live-provider-safety-final.json","utf8"))[0].response;
const turn={id:"one",question:"Explain a controlled knowledge pilot",response};
const conversation={id:"chat-one",title:"Knowledge pilot",updatedAt:Date.now(),turns:[turn]};
assert(mayorHistorySchema.safeParse([conversation]).success);
assert(mayorVisitSchema.safeParse({conversation,draft:"Unsent question",brief:"Approved brief",open:true}).success);
assert(!mayorHistorySchema.safeParse([{...conversation,turns:[{...turn,response:{...response,sources:["/api/admin/mayor"]}}]}]).success);
assert(!mayorHistorySchema.safeParse(Array(11).fill(conversation)).success);
assert(!mayorHistorySchema.safeParse([{...conversation,turns:Array(51).fill(turn)}]).success);
assert(!mayorVisitSchema.safeParse({conversation,draft:"x".repeat(1601),brief:"",open:true}).success);
const turns=Array.from({length:20},(_,i)=>({...turn,id:`turn-${i}`,question:`Question ${i}`}));
const context=contextForMayor(turns,"Apply this to pharma document review");
assert.equal(context.length,7);assert.equal(context[0].content,"Question 17");assert.equal(context.at(-1)?.content,"Apply this to pharma document review");assert(context.every(m=>m.content.length<=1600));assert(context[1].content.includes("Visual context:"));
assert(mayorSummary([turn]).includes("No business action was taken."));

let current:any,utterance:any,starts=0,stops=0,aborts=0,speaks=0,cancels=0;
const states:string[]=[],transcripts:{text:string;final:boolean}[]=[],errors:string[]=[];
class Recognition {
  lang="";continuous=true;interimResults=false;onstart:any;onend:any;onerror:any;onresult:any;
  constructor(){current=this;}
  start(){starts++;}stop(){stops++;}abort(){aborts++;}
}
class Utterance {lang="";voice:any;onstart:any;onend:any;onerror:any;constructor(public text:string){utterance=this;}}
const platform={SpeechRecognition:Recognition,SpeechSynthesisUtterance:Utterance,speechSynthesis:{speak(){speaks++;},cancel(){cancels++;},getVoices(){return[{lang:"en-US"}];}}} as unknown as MayorSpeechPlatform;
const voice=createMayorVoice(platform,{state:s=>states.push(s),transcript:(text,final)=>transcripts.push({text,final}),error:e=>errors.push(e)});
assert(voice.supportsInput&&voice.supportsOutput);assert.equal(starts,0);assert.equal(speaks,0,"Voice must be user initiated");
voice.listen();assert.equal(starts,1);assert.equal(states.at(-1),"starting");current.onstart();assert.equal(states.at(-1),"listening");assert.equal(current.continuous,false);
current.onresult({results:[{isFinal:false,0:{transcript:"Show a salon"}}]});assert.deepEqual(transcripts.at(-1),{text:"Show a salon",final:false});
voice.finishListening();assert.equal(stops,1);current.onresult({results:[{isFinal:true,0:{transcript:"Show a salon workflow"}}]});assert.equal(transcripts.at(-1)?.final,true);current.onend();assert.equal(states.at(-1),"idle");
voice.listen();const stale=current;voice.stop();const transcriptCount=transcripts.length;stale.onresult({results:[{isFinal:true,0:{transcript:"Stale private audio must be ignored"}}]});assert.equal(transcripts.length,transcriptCount);
voice.listen();current.onerror({error:"not-allowed"});assert(errors.at(-1)?.includes("Microphone access was not allowed"));assert.equal(states.at(-1),"idle");
voice.speak("A proposed workflow with human review.");assert.equal(speaks,1);assert.notEqual(states.at(-1),"speaking","Animation must wait for actual audio-start event");utterance.onstart();assert.equal(states.at(-1),"speaking");const oldUtterance=utterance;voice.listen();current.onstart();oldUtterance.onend();assert.equal(states.at(-1),"listening","Stale speech events must not overwrite new microphone state");voice.stop();
voice.speak("Second answer");utterance.onerror();assert.equal(states.at(-1),"idle");assert(errors.at(-1)?.includes("Read aloud could not finish"));voice.stop();assert(aborts>0&&cancels>0);
const unavailable=createMayorVoice({}, {state:s=>states.push(s),transcript:()=>{},error:e=>errors.push(e)});unavailable.listen();assert(errors.at(-1)?.includes("Type your question"));unavailable.speak("Text fallback");assert(errors.at(-1)?.includes("complete answer is here as text"));unavailable.stop();
console.log("Passed Mayor history/visit boundaries, visual context retention, no automatic voice start, transcript review, permission failures, speech activity state and stale audio-event cancellation. Speech hardware/provider behavior is a separate browser/device check.");
