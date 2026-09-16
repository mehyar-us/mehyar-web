import type {BusinessBrief} from './business-brief';

const encoder=new TextEncoder();
function clip(value:string,limit:number){
  let result='',bytes=0;
  for(const point of value){const size=encoder.encode(point).length;if(bytes+size>limit)break;result+=point;bytes+=size;}
  return result;
}

/** Complete JSON within a UTF-8 budget. Context is descriptive, never authority. */
export function conversationContext(goal:string,facts:{key:string;value:string}[],brief?:ReturnType<BusinessBrief['present']>,byteLimit=3000){
  const data:{goal:string;briefRevision:number|null;details:Record<string,string>;industryAnswers:Record<string,string>;questions:string[];facts:{key:string;value:string}[];truncated:boolean}={goal:clip(goal,200),briefRevision:brief?.brief.revision??null,details:{},industryAnswers:{},questions:[],facts:[],truncated:false};
  const fits=()=>encoder.encode(JSON.stringify(data)).length<=byteLimit;
  const add=(target:Record<string,string>,key:string,value:string)=>{
    if(!value)return;
    target[key]=clip(value,240);
    if(target[key]!==value)data.truncated=true;
    if(!fits()){delete target[key];data.truncated=true;}
  };
  if(brief){
    for(const q of [...brief.industryQuestions.filter(q=>!q.answered),...brief.unresolvedQuestions].slice(0,3))data.questions.push(clip(q.question,200));
    for(const key of ['businessName','industryPack','services','tone','requestOwner','escalationDestination','hours'])add(data.details,key,brief.brief.fields[key as keyof typeof brief.brief.fields]);
    for(const [key,value] of Object.entries(brief.brief.industryAnswers))add(data.industryAnswers,key,value);
    for(const [key,value] of Object.entries(brief.brief.fields))if(!(key in data.details))add(data.details,key,value);
  }
  for(const fact of facts){
    const item={key:clip(fact.key,80),value:clip(fact.value,240)};
    data.facts.push(item);
    if(item.key!==fact.key||item.value!==fact.value)data.truncated=true;
    if(!fits()){data.facts.pop();data.truncated=true;}
  }
  return JSON.stringify(data);
}
