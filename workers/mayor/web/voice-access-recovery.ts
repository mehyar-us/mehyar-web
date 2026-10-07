import type {VoiceClient} from '@cloudflare/voice/client';

/** Policy closures need user recovery; network failures keep normal reconnect. */
export function bindVoiceAccessRecovery(client:VoiceClient,ended:()=>void){
 let terminal=false;
 client.addEventListener('connectiondiagnostic',event=>{
  if(terminal||event.type!=='close'||event.code!==1008)return;
  terminal=true;
  ended();
  client.disconnect();
 });
}

export function createAccessRecoveryView(reload:()=>void){
 const section=document.createElement('section'),heading=document.createElement('h2'),text=document.createElement('p'),button=document.createElement('button');
 section.className='account-card';section.hidden=true;section.setAttribute('aria-labelledby','access-recovery-heading');
 heading.id='access-recovery-heading';heading.textContent='Let’s reconnect your account';
 text.textContent='Your workspace access has ended. Reload to check your sign-in and business permissions. If access was removed, contact your workspace owner.';
 button.type='button';button.className='primary';button.textContent='Reload account';button.onclick=reload;
 section.append(heading,text,button);
 return {element:section,show(){section.hidden=false;button.focus();}};
}
