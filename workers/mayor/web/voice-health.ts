import type {createVoiceDiagnostics} from './voice-diagnostics';

type Diagnostics=ReturnType<typeof createVoiceDiagnostics>;

/** Help controls for the existing content-free, page-local collector. */
export function createVoiceHealth(diagnostics:Diagnostics){
 const section=document.createElement('section'),heading=document.createElement('h3'),description=document.createElement('p');
 const status=document.createElement('p'),actions=document.createElement('div');
 section.className='account-card voice-health';section.setAttribute('aria-labelledby','voice-health-heading');
 heading.id='voice-health-heading';heading.textContent='Voice troubleshooting';
 description.id='voice-health-description';description.textContent='Collect timing and error counts while trying voice. They stay in this page until you download a report. No audio, messages or business details are included.';
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 actions.className='voice-health-actions';
 const button=(label:string)=>{const control=document.createElement('button');control.type='button';control.className='secondary';control.textContent=label;control.setAttribute('aria-describedby',description.id);actions.append(control);return control;};
 const start=button('Start local diagnostics'),stop=button('Stop collection'),download=button('Download voice report'),clear=button('Clear report');
 const limits=document.createElement('p');limits.className='privacy-note';limits.textContent='This report measures the server voice pipeline. It cannot tell whether your microphone works, whether you heard a reply, or how quickly playback stopped when you interrupted.';
 const refresh=()=>{
  start.disabled=diagnostics.active;stop.disabled=!diagnostics.active;
  download.disabled=diagnostics.count===0;clear.disabled=!diagnostics.active&&diagnostics.count===0;
  status.textContent=diagnostics.active?`Collecting locally · ${diagnostics.count} voice and text turns retained.`
   :diagnostics.count?`Collection stopped · ${diagnostics.count} turns available to download.`:'Diagnostics are off. Start collection, try voice, then download a report for support.';
 };
 start.onclick=()=>{diagnostics.start();refresh();};
 stop.onclick=()=>{diagnostics.stop();refresh();};
 clear.onclick=()=>{diagnostics.clear();refresh();};
 download.onclick=()=>{
  if(!diagnostics.count)return;
  let url:string|undefined;
  try{
   const report=JSON.stringify(diagnostics.report(),null,2);
   url=URL.createObjectURL(new Blob([report],{type:'application/json'}));
   const link=document.createElement('a');link.href=url;link.download='mayor-voice-diagnostics.json';link.hidden=true;
   section.append(link);link.click();link.remove();
   status.textContent='Your voice report was downloaded locally. It contains timing and outcomes, not audio or conversation content.';
  }catch{status.textContent='The report could not be downloaded here. Your local collection is still available; try again in your browser.';}
  finally{if(url){const resource=url;setTimeout(()=>URL.revokeObjectURL(resource),1000);}}
 };
 section.append(heading,description,status,actions,limits);refresh();
 return {element:section,refresh,clear(){diagnostics.clear();refresh();}};
}
