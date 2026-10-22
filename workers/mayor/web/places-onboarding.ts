/** Crew 4 — Google Places onboarding UI.
 *
 * Cards interleaved in the chat view: search entry → candidate list →
 * "Is this you?" confirmation card → confirm → calendar connect, business
 * phone, and TEST-ONLY missed-call test steps. Thin progress bar comes from
 * the existing onboarding-progress element in main.ts; this module mounts into
 * it. All Places I/O goes through the worker routes; the module never calls
 * Google directly. One-thumb completable: big buttons, short copy.
 */
import './places-onboarding.css';

export interface PlacesOnboardingDeps{
 api:(path:string,body?:unknown)=>Promise<any>;
 tenant:()=>string;
 canManage:()=>boolean;
 /** One-tap entry into the existing calendar connect flow. */
 openCalendarConnect:()=>void;
 /** Link to the existing Business phone card. */
 openPhoneCard:()=>void;
 /** Triggers the existing TEST-ONLY missed-call simulator (no real SMS). */
 runMissedCallTest:()=>Promise<void>;
 onProgress:(progress:{missing:string[];basicsComplete:boolean})=>void;
}

interface PlaceCandidate{
 placeId:string;name:string;address:string;phone:string;
 hours:string[];photoUrl:string;category:string;
}
interface ConfirmCardData{
 title:string;placeId:string;name:string;photoUrl:string;
 address:string;hoursSummary:string;phone:string;
}
interface ConfirmResult{
 profile:Record<string,unknown>;revision:number;
 vertical:string|null;followUpQuestion:string|null;
 placePhone:string;placeAddress:string;
 progress:{missing:string[];basicsComplete:boolean};
}

function el<K extends keyof HTMLElementTagNameMap>(tag:K,className=''):HTMLElementTagNameMap[K]{
 const node=document.createElement(tag);
 if(className)node.className=className;
 return node;
}

export function createPlacesOnboarding(deps:PlacesOnboardingDeps){
 // Persistent root: renderOnboardingProgress() in main.ts replaceChildren()s
 // the container on every update, so mount() re-appends this same node —
 // in-progress state survives the wipe.
 const root=el('div','places-onboarding');
 let active=false;
 let candidates:PlaceCandidate[]=[];

 function say(host:HTMLElement,message:string){
  let status=host.querySelector<HTMLElement>('.places-status');
  if(!status){status=el('p','places-status');status.setAttribute('role','status');host.append(status);}
  status.hidden=false;status.textContent=message;
 }

 function finish(){
  active=false;candidates=[];root.replaceChildren();
 }

 function renderSearchEntry(){
  root.replaceChildren();
  const card=el('div','places-card');
  const heading=el('h3');heading.textContent='Find your business on Google';
  const intro=el('p');
  intro.textContent='Skip the typing — I’ll pull your name, address, hours, and phone from your Google listing.';
  const form=el('form');form.className='places-search';
  const input=el('input');input.type='search';input.required=true;input.maxLength=200;
  input.placeholder='Business name + city';input.setAttribute('aria-label','Search for your business on Google');
  const go=el('button','primary');go.type='submit';go.textContent='Look it up';
  const skip=el('button','quiet');skip.type='button';skip.textContent='I’ll answer the questions instead';
  skip.onclick=()=>finish();
  form.append(input,go);card.append(heading,intro,form,skip);root.append(card);
  form.onsubmit=async event=>{
   event.preventDefault();
   const query=input.value.trim();
   if(!query)return;
   go.disabled=true;say(card,'Looking up your business…');
   try{
    const result=await deps.api('/api/places/search',{query});
    if(!result.placesEnabled){
     say(card,'Business lookup isn’t available right now — answer the questions in chat instead and we’ll keep going.');
     go.disabled=false;return;
    }
    if(!result.places?.length){
     say(card,'No matches — try adding your city, or answer the questions instead.');
     go.disabled=false;return;
    }
    renderCandidates(result.places as PlaceCandidate[]);
   }catch(error){
    say(card,error instanceof Error?error.message:'The lookup failed. Try again or answer the questions instead.');
    go.disabled=false;
   }
  };
 }

 function renderCandidates(list:PlaceCandidate[]){
  candidates=list;
  root.replaceChildren();
  const card=el('div','places-card');
  const heading=el('h3');heading.textContent='Which one is yours?';
  const listEl=el('div','places-candidates');
  for(const candidate of list){
   const button=el('button','secondary places-candidate');button.type='button';
   const name=el('strong');name.textContent=candidate.name;
   const address=el('span');address.textContent=candidate.address||'Address not listed';
   button.append(name,address);
   button.onclick=()=>void loadDetails(candidate.placeId);
   listEl.append(button);
  }
  const back=el('button','quiet');back.type='button';back.textContent='← Search again';
  back.onclick=()=>renderSearchEntry();
  card.append(heading,listEl,back);root.append(card);
 }

 async function loadDetails(placeId:string){
  const card=root.querySelector<HTMLElement>('.places-card');
  if(card)say(card,'Pulling up the listing…');
  try{
   const result=await deps.api('/api/places/details',{placeId});
   renderConfirmCard(result.card as ConfirmCardData);
  }catch(error){
   if(card)say(card,error instanceof Error?error.message:'Could not load that listing. Pick another.');
  }
 }

 function renderConfirmCard(cardData:ConfirmCardData){
  root.replaceChildren();
  const card=el('div','places-card places-confirm');
  const heading=el('h3');heading.textContent=cardData.title||'Is this you?';
  card.append(heading);
  if(cardData.photoUrl){
   const photo=el('img','places-photo') as HTMLImageElement;
   photo.src=cardData.photoUrl;photo.alt=cardData.name;photo.loading='lazy';
   card.append(photo);
  }
  const name=el('p','places-name');name.textContent=cardData.name;card.append(name);
  if(cardData.address){const address=el('p');address.textContent=cardData.address;card.append(address);}
  if(cardData.hoursSummary){const hours=el('p','places-hours');hours.textContent=cardData.hoursSummary;card.append(hours);}
  if(cardData.phone){const phone=el('p');phone.textContent=cardData.phone;card.append(phone);}
  const actions=el('div','places-actions');
  const yes=el('button','primary');yes.type='button';yes.textContent='Yes, that’s us';
  const notUs=el('button','secondary');notUs.type='button';notUs.textContent='Not us';
  notUs.onclick=()=>renderCandidates(candidates);
  yes.onclick=async()=>{
   yes.disabled=true;notUs.disabled=true;say(card,'Saving your details…');
   try{
    const result=await deps.api('/api/onboarding/confirm-place',{placeId:cardData.placeId,businessId:deps.tenant()}) as ConfirmResult;
    deps.onProgress(result.progress);
    renderNextSteps(result,cardData.name);
   }catch(error){
    say(card,error instanceof Error?error.message:'Could not save. Try again.');
    yes.disabled=false;notUs.disabled=false;
   }
  };
  actions.append(yes,notUs);card.append(actions);root.append(card);
 }

 function renderNextSteps(result:ConfirmResult,businessName:string){
  root.replaceChildren();
  const card=el('div','places-card');
  const heading=el('h3');heading.textContent=`Got it — ${businessName} is saved.`;
  card.append(heading);
  if(result.followUpQuestion){
   const question=el('p','places-question');question.textContent=result.followUpQuestion;
   const hint=el('p','places-hint');hint.textContent='Reply in chat — I’ll remember your answer.';
   card.append(question,hint);
  }
  const steps=el('div','places-steps');
  const stepButton=(label:string,testOnly:boolean,onTap:()=>Promise<void>|void)=>{
   const button=el('button','secondary places-step');button.type='button';
   const text=el('span');text.textContent=label;
   button.append(text);
   if(testOnly){const badge=el('span','places-test-badge');badge.textContent='TEST ONLY';button.append(badge);}
   button.onclick=async()=>{
    button.disabled=true;
    try{await onTap();text.textContent=`✓ ${label}`;}
    catch(error){text.textContent=label;say(card,error instanceof Error?error.message:'That step failed. Try again.');button.disabled=false;}
   };
   steps.append(button);
   return button;
  };
  stepButton('Connect your calendar',false,()=>deps.openCalendarConnect());
  stepButton('Set up your business phone',false,()=>deps.openPhoneCard());
  stepButton('Run a test missed call',true,()=>deps.runMissedCallTest());
  const done=el('button','quiet');done.type='button';done.textContent='Done for now';
  done.onclick=()=>{finish();deps.onProgress(result.progress);};
  card.append(steps,done);root.append(card);
 }

 return {
  /** Mount the search entry into the onboarding-progress container.
   * No-op while a flow is in progress (state survives re-mounts); renders a
   * fresh entry when idle. Owners/managers only. */
  mount(container:HTMLElement){
   if(!deps.canManage())return;
   if(!container.contains(root))container.append(root);
   if(active)return;
   active=true;
   renderSearchEntry();
  },
  reset(){finish();},
 };
}
