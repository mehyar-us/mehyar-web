/** Crew 4 — Google Places onboarding UI.
 *
 * Cards interleaved in the chat view: search entry → candidate list →
 * "Is this you?" confirmation card → confirm → calendar connect, business
 * phone, and TEST-ONLY missed-call test steps. Thin progress bar comes from
 * the existing onboarding-progress element in main.ts; this module mounts into
 * it. All Places I/O goes through the worker routes; the module never calls
 * Google directly. One-thumb completable: big buttons, short copy.
 *
 * React migration S4: rendering lives in ./places-onboarding-panels
 * (loaded lazily); this module keeps the wizard state machine, the API
 * calls, and the mount contract — including the persistent root node
 * whose in-progress state survives main.ts's container wipes.
 */
import './places-onboarding.css';
import {VERTICAL_PROFILES} from '../src/verticals';
import {loadPlacesPanels} from './places-onboarding-panels-loader';
import type {ConfirmCardData, PlaceCandidate, PlacesActions, PlacesViewState} from './places-onboarding-panels';

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

interface ConfirmResult{
 profile:Record<string,unknown>;revision:number;
 vertical:string|null;followUpQuestion:string|null;
 /** Crew 6b — honest adjacent-vertical suggestion. Present only when the
  * trade didn't match a real vertical; the owner must explicitly accept it —
  * nothing is auto-saved. */
 verticalSuggestion:{trade:string;vertical:string;reason:string;modeLabel:string;framing:string;followUpQuestion:string}|null;
 placePhone:string;placeAddress:string;
 progress:{missing:string[];basicsComplete:boolean};
 /** Crew 6e - honest fit check. Present only on a clear 'poor' fit. */
 fitCheck:{message:string;reasons:string[]}|null;
}

const STEP_DEFS:{label:string;testOnly:boolean}[]=[
 {label:'Connect your calendar',testOnly:false},
 {label:'Set up your business phone',testOnly:false},
 {label:'Run a test missed call',testOnly:true},
];

export function createPlacesOnboarding(deps:PlacesOnboardingDeps){
 // Persistent root: renderOnboardingProgress() in main.ts replaceChildren()s
 // the container on every update, so mount() re-appends this same node —
 // in-progress state survives the wipe.
 const root=document.createElement('div');
 root.className='places-onboarding';
 let active=false;
 let candidates:PlaceCandidate[]=[];
 let confirmData:ConfirmCardData|null=null;
 let confirmResult:ConfirmResult|null=null;
 let businessName='';

 const freshSteps=()=>STEP_DEFS.map(step=>({...step,done:false,busy:false}));
 let view:PlacesViewState={
  screen:'idle',status:null,searchBusy:false,candidates:[],confirm:null,confirmBusy:false,
  fitMessage:'',businessName:'',vertical:null,followUpQuestion:null,steps:freshSteps(),
 };
 function push(){loadPlacesPanels(root,{view,actions});}
 function say(message:string){view={...view,status:message};push();}

 function finish(){
  active=false;candidates=[];view={...view,screen:'idle',status:null};push();
 }

 function showSearch(){
  view={...view,screen:'search',status:null,searchBusy:false};
  push();
 }

 function showNextSteps(result:ConfirmResult,name:string){
  businessName=name;
  const suggestion=result.verticalSuggestion;
  view={
   ...view,
   screen:'nextsteps',status:null,businessName:name,
   vertical:suggestion?{
    framing:suggestion.framing,modeLabel:suggestion.modeLabel,phase:'choice',busy:false,
    doneText:'',followUp:suggestion.followUpQuestion,
    options:Object.entries(VERTICAL_PROFILES).filter(([key])=>key!=='other').map(([key,vertical])=>({key,label:vertical.label})),
   }:null,
   followUpQuestion:suggestion?null:result.followUpQuestion,
   steps:freshSteps(),
  };
  push();
 }

 const stepTaps:(()=>Promise<void>|void)[]=[
  ()=>deps.openCalendarConnect(),
  ()=>deps.openPhoneCard(),
  ()=>deps.runMissedCallTest(),
 ];

 const actions:PlacesActions={
  search:async(query)=>{
   view={...view,searchBusy:true};say('Looking up your business…');
   try{
    const result=await deps.api('/api/places/search',{query});
    if(!result.placesEnabled){
     view={...view,searchBusy:false};say('Business lookup isn’t available right now — answer the questions in chat instead and we’ll keep going.');
     return;
    }
    if(!result.places?.length){
     view={...view,searchBusy:false};say('No matches — try adding your city, or answer the questions instead.');
     return;
    }
    candidates=result.places as PlaceCandidate[];
    view={...view,screen:'candidates',status:null,candidates};
    push();
   }catch(error){
    view={...view,searchBusy:false};say(error instanceof Error?error.message:'The lookup failed. Try again or answer the questions instead.');
   }
  },
  skipSearch:()=>finish(),
  pickCandidate:async(placeId)=>{
   say('Pulling up the listing…');
   try{
    const result=await deps.api('/api/places/details',{placeId});
    confirmData=result.card as ConfirmCardData;
    view={...view,screen:'confirm',status:null,confirm:confirmData,confirmBusy:false};
    push();
   }catch(error){
    say(error instanceof Error?error.message:'Could not load that listing. Pick another.');
   }
  },
  searchAgain:()=>showSearch(),
  confirmYes:async()=>{
   if(!confirmData)return;
   view={...view,confirmBusy:true};say('Saving your details…');
   try{
    const result=await deps.api('/api/onboarding/confirm-place',{placeId:confirmData.placeId,businessId:deps.tenant()}) as ConfirmResult;
    confirmResult=result;businessName=confirmData.name;
    deps.onProgress(result.progress);
    // Crew 6e - honest fit check. A clear poor fit gets the plain-spoken
    // message first, with a genuinely frictionless [Continue anyway] (one
    // tap, no guilt copy) and a clean [Not now]. Shown at most once: the
    // assessment is stored server-side.
    if(result.fitCheck){
     view={...view,screen:'fitcheck',status:null,fitMessage:result.fitCheck.message,confirmBusy:false};
     push();return;
    }
    view={...view,confirmBusy:false};
    showNextSteps(result,confirmData.name);
   }catch(error){
    view={...view,confirmBusy:false};say(error instanceof Error?error.message:'Could not save. Try again.');
   }
  },
  confirmNotUs:()=>{
   view={...view,screen:'candidates',status:null,confirmBusy:false};
   push();
  },
  fitContinue:()=>{if(confirmResult)showNextSteps(confirmResult,businessName);},
  fitNotNow:()=>{finish();if(confirmResult)deps.onProgress(confirmResult.progress);},
  verticalUse:async()=>{
   const result=confirmResult,suggestion=result?.verticalSuggestion,vertical=view.vertical;
   if(!result||!suggestion||!vertical)return;
   view={...view,vertical:{...vertical,busy:true}};push();
   say('Saving your business type…');
   try{
    const updated=await deps.api(`/api/businesses/${deps.tenant()}/profile`,
     {vertical:suggestion.vertical,verticalMappedFrom:suggestion.trade,revision:result.revision});
    result.revision=updated.revision;
    view={...view,vertical:{...vertical,busy:false,phase:'use-done',doneText:`Using ${suggestion.modeLabel} mode for your ${suggestion.trade} business.`}};
    push();
   }catch(error){
    view={...view,vertical:{...vertical,busy:false}};push();
    say(error instanceof Error?error.message:'Could not save. Try again.');
   }
  },
  verticalDifferent:()=>{
   if(view.vertical)view={...view,vertical:{...view.vertical,phase:'picker'}};
   push();
  },
  verticalPick:async(key)=>{
   const result=confirmResult,vertical=view.vertical;
   if(!result||!vertical)return;
   view={...view,vertical:{...vertical,busy:true}};push();
   say('Saving your business type…');
   try{
    const updated=await deps.api(`/api/businesses/${deps.tenant()}/profile`,
     {vertical:key,clearVerticalMapping:true,revision:result.revision});
    result.revision=updated.revision;
    const label=VERTICAL_PROFILES[key as keyof typeof VERTICAL_PROFILES].label;
    view={...view,vertical:{...vertical,busy:false,phase:'picked-done',doneText:`Saved — using ${label}.`}};
    push();
   }catch(error){
    view={...view,vertical:{...vertical,busy:false}};push();
    say(error instanceof Error?error.message:'Could not save. Try again.');
   }
  },
  verticalSkip:()=>{
   if(view.vertical)view={...view,vertical:{...view.vertical,phase:'skipped'}};
   push();
  },
  runStep:async(index)=>{
   const steps=view.steps.map((step,i)=>i===index?{...step,busy:true}:step);
   view={...view,steps};push();
   try{
    await stepTaps[index]();
    view={...view,steps:view.steps.map((step,i)=>i===index?{...step,busy:false,done:true}:step)};push();
   }catch(error){
    view={...view,steps:view.steps.map((step,i)=>i===index?{...step,busy:false}:step)};push();
    say(error instanceof Error?error.message:'That step failed. Try again.');
   }
  },
  doneForNow:()=>{finish();if(confirmResult)deps.onProgress(confirmResult.progress);},
 };

 return {
  /** Mount the search entry into the onboarding-progress container.
   * No-op while a flow is in progress (state survives re-mounts); renders a
   * fresh entry when idle. Owners/managers only. */
  mount(container:HTMLElement){
   if(!deps.canManage())return;
   if(!container.contains(root))container.append(root);
   if(active)return;
   active=true;
   showSearch();
  },
  reset(){finish();},
 };
}
