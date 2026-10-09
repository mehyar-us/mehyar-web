import {detectedTimeZone} from './time-zone';
import {verticalProfile} from '../src/verticals';
const labels:Record<string,string>={name:'Business',assistantName:'Your assistant',industry:'Industry',website:'Website',description:'About your business',services:'Services',locations:'Locations',hours:'Hours',timeZone:'Time zone',staff:'Team',businessGoals:'Growth goals',bottlenecks:'What slows you down',currentTools:'Current tools',growthPlan:'Agreed growth plan'};
export interface ProfileRefreshPreview{vertical:string;label:string;revision:number;changes:{field:'description'|'industry';from:string|null;to:string}[];description:string;industry:string}
export interface BusinessWorkspaceHooks{onRefreshProfile?:()=>void}
export function createBusinessWorkspace(ask:(text:string)=>void,account:()=>void,hooks:BusinessWorkspaceHooks={}){
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
 // Crew 4b — one-tap refresh of the business profile from the saved vertical.
 // Shown only when a real vertical is set; saving always needs the owner's tap.
 const refresh=document.createElement('button');refresh.type='button';refresh.className='secondary';refresh.textContent='Refresh business profile';refresh.hidden=true;
 refresh.setAttribute('aria-label','Refresh business profile from business type');
 refresh.onclick=()=>hooks.onRefreshProfile?.();actions.append(refresh);
 const refreshCard=document.createElement('div');refreshCard.className='refresh-confirm';refreshCard.hidden=true;
 const expertise=document.createElement('section');expertise.id='mehyar-expertise';expertise.hidden=true;
 memory.append(summary,note,facts,actions,refreshCard,expertise);panel.append(memory);
 return {element:panel,
  ready(ready:boolean){for(const button of actions.querySelectorAll('button'))button.disabled=!ready;},
  clear(){facts.replaceChildren();expertise.replaceChildren();refreshCard.replaceChildren();refreshCard.hidden=true;panel.hidden=true;},
  profile(profile:Record<string,unknown>){
   facts.replaceChildren();panel.hidden=false;
   for(const [key,label] of Object.entries(labels)){
    const value=profile[key];if(typeof value!=='string'&&!Array.isArray(value))continue;
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=Array.isArray(value)?value.filter(v=>typeof v==='string').join(' · '):value;facts.append(dt,dd);
   }
   if(!facts.children.length){const empty=document.createElement('p');empty.textContent='Tell me what your business does. We’ll build this together.';facts.append(empty);}
   const vp=verticalProfile(typeof profile.vertical==='string'?profile.vertical:undefined);
   refresh.hidden=vp.vertical==='other'||!hooks.onRefreshProfile;
   if(refresh.hidden){refreshCard.replaceChildren();refreshCard.hidden=true;}
  },
  /** Owner confirmation card for the vertical refresh preview. Nothing is
   * saved until the owner taps Save; Cancel discards the preview. */
  showRefreshConfirm(preview:ProfileRefreshPreview,onSave:()=>Promise<void>){
   refreshCard.replaceChildren();refreshCard.hidden=false;
   const heading=document.createElement('h3');heading.textContent='Refresh business profile';
   const explanation=document.createElement('p');
   explanation.textContent=`Rewrites “About your business” and “Industry” from your business type (${preview.label}) and your saved answers. Nothing else changes, and nothing is deleted.`;
   refreshCard.append(heading,explanation);
   for(const change of preview.changes){
    const item=document.createElement('div');item.className='refresh-change';
    const field=document.createElement('b');field.textContent=change.field==='description'?'About your business':'Industry';
    const from=document.createElement('p');from.className='refresh-from';from.textContent=change.from?`Now: ${change.from}`:'Now: (empty)';
    const to=document.createElement('p');to.className='refresh-to';to.textContent=`New: ${change.to}`;
    item.append(field,from,to);refreshCard.append(item);
   }
   const row=document.createElement('div');row.className='card-actions';
   const save=document.createElement('button');save.type='button';save.className='primary';save.textContent='Save';
   const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Cancel';
   cancel.onclick=()=>{refreshCard.replaceChildren();refreshCard.hidden=true;};
   save.onclick=()=>{save.disabled=true;cancel.disabled=true;void onSave();};
   row.append(save,cancel);refreshCard.append(row);
   refreshCard.scrollIntoView({block:'nearest'});
  },
  hideRefreshConfirm(){refreshCard.replaceChildren();refreshCard.hidden=true;},
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
