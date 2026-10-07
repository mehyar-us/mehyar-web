import {detectedTimeZone} from './time-zone';
const labels:Record<string,string>={name:'Business',assistantName:'Your assistant',industry:'Industry',website:'Website',description:'About your business',services:'Services',locations:'Locations',hours:'Hours',timeZone:'Time zone',staff:'Team',businessGoals:'Growth goals',bottlenecks:'What slows you down',currentTools:'Current tools',growthPlan:'Agreed growth plan'};
export function createBusinessWorkspace(ask:(text:string)=>void,account:()=>void){
 const panel=document.createElement('aside');panel.id='business-context';panel.hidden=true;panel.setAttribute('aria-label','Your business workspace');
 const title=document.createElement('h2');title.textContent='Business memory';
 const memory=document.createElement('details');memory.className='business-memory';
 const summary=document.createElement('summary');summary.append(title);
 const phone=matchMedia('(max-width:760px)');memory.open=!phone.matches;
 phone.addEventListener('change',event=>{memory.open=!event.matches;});
 const note=document.createElement('p');note.textContent='Details you have confirmed with Mayor.';
 const facts=document.createElement('dl');facts.id='business-facts';
 const actions=document.createElement('div');actions.className='conversation-actions';
 for(const [label,prompt] of [['Continue onboarding','Resume onboarding from my confirmed details. Ask one missing question.'],['Explore growth ideas','How could Mehyar US and AI help my specific business grow? Use what you know, distinguish ideas from active capabilities, and ask about the biggest missing goal.']] as const){
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;button.onclick=()=>{const zone=detectedTimeZone();ask(label==='Continue onboarding'&&zone?`${prompt} My device detects ${zone}; suggest this time zone if my business has none saved, and let me correct it.`:prompt);};actions.append(button);
 }
 const connect=document.createElement('button');connect.type='button';connect.className='secondary';connect.textContent='Connections';connect.onclick=account;actions.append(connect);
 const expertise=document.createElement('section');expertise.id='mehyar-expertise';expertise.hidden=true;
 memory.append(summary,note,facts,actions,expertise);panel.append(memory);
 return {element:panel,
  ready(ready:boolean){for(const button of actions.querySelectorAll('button'))button.disabled=!ready;},
  clear(){facts.replaceChildren();expertise.replaceChildren();panel.hidden=true;},
  profile(profile:Record<string,unknown>){
   facts.replaceChildren();panel.hidden=false;
   for(const [key,label] of Object.entries(labels)){
    const value=profile[key];if(typeof value!=='string'&&!Array.isArray(value))continue;
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=Array.isArray(value)?value.filter(v=>typeof v==='string').join(' · '):value;facts.append(dt,dd);
   }
   if(!facts.children.length){const empty=document.createElement('p');empty.textContent='Tell me what your business does. We’ll build this together.';facts.append(empty);}
  },
  expertise(services:Array<{name:string;scope:string}>){
   expertise.replaceChildren();expertise.hidden=false;
   const heading=document.createElement('h3');heading.textContent='Ways Mehyar can help';
   const explanation=document.createElement('p');explanation.textContent='Services to explore together. These are not completed audits or enabled automations.';expertise.append(heading,explanation);
   for(const service of services.slice(0,7)){const item=document.createElement('details'),name=document.createElement('summary'),text=document.createElement('p');name.textContent=service.name;text.textContent=service.scope;item.append(name,text);expertise.append(item);}
   const link=document.createElement('a');link.href='https://mehyar.us/';link.textContent='Explore Mehyar US';link.target='_blank';link.rel='noopener noreferrer';expertise.append(link);
  },
 };
}

/** Local tone: no model call, microphone permission or external audio request. */
export async function playSoundCheck(){
 const context=new AudioContext();
 try{
  await context.resume();
  const oscillator=context.createOscillator(),gain=context.createGain();
  oscillator.frequency.value=440;gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(.08,context.currentTime+.04);gain.gain.linearRampToValueAtTime(0,context.currentTime+.5);
  oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.55);
  await new Promise<void>(resolve=>{oscillator.onended=()=>resolve();});
 }finally{await context.close();}
}
