import {createElement,X} from 'lucide';
import {createTimeZoneSuggestion} from './time-zone';
import {createTextChat} from './text-chat';
import {createCalendarChat} from './calendar-chat';
import {createPullRefresh} from './pull-refresh';
import {bindChatKeyboardViewport,chatComposerHeightLimit} from './chat-keyboard-viewport';
import {MayorMicrophone} from './microphone-input';
import {VoiceClient} from '@cloudflare/voice/client';
import './style.css';
import './workspace.css';
import './workday.css';
import {createWorkday,type WorkdayView} from './workday';
import {createConnections} from './connections';
import {createVoiceDiagnostics} from './voice-diagnostics';
import {createVoiceHealth} from './voice-health';
import {createVoiceCall} from './voice-call';
import {bindVoiceAccessRecovery,createAccessRecoveryView} from './voice-access-recovery';
import {createBusinessWorkspace,playSoundCheck} from './business-workspace';
import {createWorkspaceAccessGuard,workspaceAccessWasRejected,selectWorkspaceBusiness} from './workspace-access';
import {assistantName,assistantGreeting} from '../src/assistant-persona';
import './mobile-compact.css';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
function resizeComposer(){const input=$<HTMLTextAreaElement>('message');input.style.height='auto';const keyboardHeight=document.body.dataset.chatKeyboard==='open'?parseFloat(document.body.style.getPropertyValue('--chat-viewport-height')):undefined;const limit=chatComposerHeightLimit(matchMedia('(max-width:760px)').matches,keyboardHeight,document.body.dataset.view==='chat'?window.innerHeight:undefined);input.style.height=`${Math.min(limit,Math.max(36,input.scrollHeight))}px`;input.style.overflowY=input.scrollHeight>limit?'auto':'hidden';}
$('message').addEventListener('input',resizeComposer);window.addEventListener('resize',resizeComposer);
const chatKeyboard=bindChatKeyboardViewport($<HTMLTextAreaElement>('message'),resizeComposer);
$<HTMLDetailsElement>('conversation').open=true;
// Alerts must stay visible when the Account tab is open too.
let voice:VoiceClient|undefined, tenantId='', loggedIn=false, membershipRole='',sessionUserId='';
let voiceCall:ReturnType<typeof createVoiceCall>|undefined;
let accessEnded=false;
const workspaceAccess=createWorkspaceAccessGuard();
const accessRecovery=createAccessRecoveryView(()=>location.reload());
document.querySelector('header')!.after(accessRecovery.element);
const workspace=createBusinessWorkspace(text=>{if(historyReady&&!accessEnded){void sendTextMessage(text);$('conversation').setAttribute('open','');}},()=>show('connections'));
const calendarChat=createCalendarChat({api,tenant:()=>tenantId,signIn,followup:text=>void sendTextMessage(text)});
$('conversation').after(calendarChat.element);
const calendarLauncher=document.createElement('button');calendarLauncher.type='button';calendarLauncher.className='quiet calendar-launcher';calendarLauncher.textContent='Calendar settings';calendarLauncher.hidden=true;
calendarLauncher.onclick=()=>{show('chat');$('conversation').setAttribute('open','');void calendarChat.open();};calendarChat.element.after(calendarLauncher);
$('account-view').append(workspace.element);
const usageStatus=document.createElement('p');usageStatus.id='usage-status';usageStatus.className='privacy-note';usageStatus.textContent='Check Plan & usage for your shared business allowance.';
$('text-form').after(usageStatus);
const soundCheck=document.createElement('button');soundCheck.type='button';soundCheck.className='sound-check';soundCheck.textContent='Check speaker sound';
soundCheck.onclick=async()=>{soundCheck.disabled=true;try{await playSoundCheck();notice('Did you hear the tone? If not, check your speaker volume and whether this tab is muted. Then choose Talk to The Mayor.');}catch{notice('Audio could not start here. Open mayor.mehyar.us in your regular browser and try the sound check again.');}finally{soundCheck.disabled=false;}};
const voiceHelp=document.createElement('details');voiceHelp.className='voice-help';
const voiceHelpSummary=document.createElement('summary');voiceHelpSummary.setAttribute('aria-label','Voice help');voiceHelpSummary.setAttribute('aria-controls','voice-help-panel');voiceHelpSummary.title='Voice help';
const helpIcon=document.createElement('i');helpIcon.dataset.lucide='circle-help';helpIcon.setAttribute('aria-hidden','true');voiceHelpSummary.append(helpIcon);
const voiceHelpContent=document.createElement('div');voiceHelpContent.id='voice-help-panel';voiceHelpContent.className='voice-help-content';voiceHelpContent.append($('voice-hint'),soundCheck);
voiceHelp.append(voiceHelpSummary,voiceHelpContent);document.querySelector('.header-actions')!.append(voiceHelp);
voiceHelp.addEventListener('keydown',event=>{if(event.key==='Escape'&&voiceHelp.open){event.preventDefault();voiceHelp.open=false;voiceHelpSummary.focus();}});
const micLevel=document.createElement('meter');micLevel.id='mic-level';micLevel.min=0;micLevel.max=1;micLevel.value=0;micLevel.hidden=true;micLevel.setAttribute('aria-label','Microphone input level');soundCheck.after(micLevel);
const canManage=()=>!accessEnded&&['owner','manager'].includes(membershipRole);
const canChat=()=>!accessEnded&&['owner','manager','staff'].includes(membershipRole);
const connectionHub=createConnections({api,tenant:()=>tenantId,actor:()=>sessionUserId,canManage,onConnect:(provider,capabilities)=>signIn(provider,capabilities),onCalendar:provider=>{show('chat');void calendarChat.open(undefined,provider);},onAccount:()=>show('account'),ask:text=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value=text;resizeComposer();input.focus();},pendingProviders:[{id:'facebook',label:'Facebook & Instagram',status:'App review pending'}]});
$('connections-content').append(connectionHub.element);
$('open-connections').onclick=()=>show('connections');
const workday=createWorkday({api,tenant:()=>tenantId,actor:()=>sessionUserId,canManage,canChat,onNavigate:show,ask:text=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value=text;resizeComposer();input.focus();},onNotice:message=>notice(message),onChanged:()=>void refreshInbox(),onSignIn:()=>void signIn()});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-prompt]'))button.onclick=()=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value=button.dataset.prompt??'';resizeComposer();input.focus();};
$('today-sign-in').onclick=()=>signIn();
$('today-microsoft-sign-in').onclick=()=>signIn('microsoft');
$('calendar-status').onclick=()=>{show('connections');$('connections-heading').focus();};
$('dock-voice-label').onclick=()=>{show('chat');$('talk').click();};
const inbox=document.createElement('details'),inboxSummary=document.createElement('summary'),inboxItems=document.createElement('div'),inboxRefresh=document.createElement('button'),inboxStatus=document.createElement('p');
inbox.className='account-card notification-inbox';inbox.hidden=true;
inboxSummary.textContent='Notifications';inboxRefresh.textContent='Check account';inboxRefresh.type='button';inboxRefresh.className='secondary';
inboxStatus.setAttribute('role','status');
inbox.append(inboxSummary,inboxStatus,inboxItems,inboxRefresh);$('notice').after(inbox);
let inboxLoading=false;
async function refreshInbox(){
 if(!tenantId||!canManage())return;
 if(inboxLoading)return;
 inboxLoading=true;inboxRefresh.disabled=true;inboxStatus.textContent='Checking your business profile and saved calendar connection…';
 try{
  // api() already bounds requests at 15s: a hanging provider check can never
  // leave the button permanently disabled. The finally below always re-enables.
  const result=await api(`/api/businesses/${tenantId}/notifications/refresh`,{});
  inboxItems.replaceChildren();
  const unread=result.notifications.filter((item:any)=>!item.read).length;
  inboxSummary.textContent=`Notifications${unread?` (${unread} unread)`:''}`;
  inboxStatus.textContent=result.notifications.length?'Account items needing attention. Manage recurring checks and email alerts in Account.':'No account alerts are open. Manage recurring checks and email alerts in Account.';
  for(const item of result.notifications){
   const card=document.createElement('article'),title=document.createElement('h3'),message=document.createElement('p'),action=document.createElement('button');
   const destination=item.action==='today'?'today':item.action==='tasks'?'tasks':item.action==='chat'?'chat':'account';
   title.textContent=item.title;message.textContent=item.message;action.type='button';action.className='secondary';action.textContent=destination==='today'?'Open agent report':destination==='tasks'?'Open business playbook':destination==='account'?'Review account':'Talk to '+assistantName(confirmedProfile);
   action.onclick=()=>{show(destination);inbox.open=false;(destination==='today'?$('today-heading'):destination==='tasks'?$('tasks-heading'):destination==='account'?$('account-heading'):$('talk')).focus();};
   card.append(title,message,action);
   if(!item.read){
    const read=document.createElement('button');read.type='button';read.className='secondary';read.textContent='Mark read';
    read.onclick=async()=>{read.disabled=true;try{await api(`/api/businesses/${tenantId}/notifications/${item.id}/read`,{});await refreshInbox();}catch(error){inboxStatus.textContent=error instanceof Error?error.message:'Could not mark this notification read.';read.disabled=false;}};
    card.append(read);
   }
   inboxItems.append(card);
  }
  if(result.hasMore){const more=document.createElement('p');more.textContent='Showing the latest 50 items.';inboxItems.append(more);}
 }catch(error){inboxItems.replaceChildren();inboxSummary.textContent='Notifications';
  const message=error instanceof Error?error.message:'Notifications could not be checked. Try again.';
  inboxStatus.textContent=message;
  // Never a dead end: on calendar/connection failures offer the reconnect path.
  if(/calendar|connection|verify|reconnect/i.test(message)){
   const reconnect=document.createElement('button');reconnect.type='button';reconnect.className='secondary';
   reconnect.textContent='Reconnect calendar';reconnect.onclick=()=>{show('connections');$('connections-heading').focus();};
   inboxItems.append(reconnect);
  }
 }finally{inboxLoading=false;inboxRefresh.disabled=false;}
}
inboxRefresh.onclick=()=>void refreshInbox();
$('notifications-button').onclick=()=>{inbox.hidden=!inbox.hidden;inbox.open=!inbox.hidden;};
inbox.addEventListener('toggle',()=>{if(inbox.open)void refreshInbox();});
const routineCard=document.createElement('div'),routineHeading=document.createElement('h2'),routineDescription=document.createElement('p'),routineState=document.createElement('p'),routinePause=document.createElement('button'),routineTalk=document.createElement('button');
routineCard.className='account-card';routineCard.hidden=true;routineHeading.textContent='Recurring account check';
routineDescription.textContent='Ask The Mayor to check your business profile and live calendar connection every day or on weekdays. Choose a time by talking. Issues appear in Notifications and follow your email alert preferences. This check does not monitor your email inbox or reviews.';
routineState.setAttribute('role','status');routinePause.type='button';routinePause.className='secondary';routinePause.textContent='Pause check';routinePause.hidden=true;
routineTalk.type='button';routineTalk.className='secondary';routineTalk.textContent='Set up or change in chat';routineTalk.onclick=()=>{show('chat');$('talk').focus();};
routineCard.append(routineHeading,routineDescription,routineState,routineTalk,routinePause);$('logout').before(routineCard);
async function refreshRoutine(){
 if(!canManage())return;routineCard.hidden=false;routineState.textContent='Loading your check…';routinePause.hidden=true;
 try{
  const check=await api(`/api/businesses/${tenantId}/recurring-check`);
  const schedule=check.schedule;
  const parts=[check.enabled?'Enabled':check.revision?'Paused':'Not set up'];
  if(schedule)parts.push(`${schedule.frequency==='daily'?'Daily':'Weekdays'} at ${String(schedule.hour).padStart(2,'0')}:${String(schedule.minute).padStart(2,'0')} · ${schedule.timeZone}`);
  if(check.running)parts.push('A check is in progress');
  else if(check.nextRunAt)parts.push(`Next check after: ${new Date(check.nextRunAt).toLocaleString(undefined,{timeZone:schedule.timeZone})} (${schedule.timeZone})`);
  if(check.lastRunAt)parts.push(`Last attempt: ${new Date(check.lastRunAt).toLocaleString()} · ${check.lastStatus==='ok'?'Completed':'Could not finish; review Notifications'}`);
  else parts.push('No completed attempts yet.');
  routineState.textContent=parts.join('. ');routinePause.hidden=!check.enabled;
 }catch(error){routineState.textContent=error instanceof Error?error.message:'Could not load your recurring check.';}
}
routinePause.onclick=async()=>{routinePause.disabled=true;try{await api(`/api/businesses/${tenantId}/recurring-check/pause`,{});await refreshRoutine();}catch(error){routineState.textContent=error instanceof Error?error.message:'Could not pause the check.';}finally{routinePause.disabled=false;}};
const emailCard=document.createElement('div'),emailHeading=document.createElement('h2'),emailDescription=document.createElement('p'),emailStatus=document.createElement('p'),emailToggle=document.createElement('button');
emailCard.className='account-card';emailCard.hidden=true;emailHeading.textContent='Email notifications';
emailDescription.textContent='Get a link to The Mayor when unread issues need your attention. You can also ask The Mayor to turn these emails on or off. Email delivery is currently a pilot for approved recipient addresses. At most one email every 24 hours per business. Your business details stay in the app. Turning this off cancels queued messages; mail already being sent cannot be recalled.';
emailStatus.setAttribute('role','status');emailToggle.className='secondary';emailToggle.type='button';emailToggle.hidden=true;let emailsEnabled=false;
emailCard.append(emailHeading,emailDescription,emailStatus,emailToggle);routineCard.after(emailCard);
async function refreshEmailPreference(){
 if(!canManage())return;emailCard.hidden=false;emailToggle.disabled=true;emailToggle.hidden=true;emailStatus.textContent='Loading email preferences…';
 try{
  const preference=await api(`/api/businesses/${tenantId}/email-preferences`);emailsEnabled=preference.enabled;
  const states:Record<string,string>={pending:'A notification email is queued.',sending:'An email is being submitted.',accepted:'The email provider accepted the latest message; inbox delivery is not confirmed.',uncertain:'The send outcome is unknown. It will not be automatically resent.',failed:'The latest email could not be sent.',cancelled:'The queued email was cancelled.'};
  emailStatus.textContent=preference.available?`${emailsEnabled?'Enabled':'Off'}${preference.email?` · ${preference.email}`:' · A verified sign-in email is required'}. ${preference.lastDelivery?states[preference.lastDelivery.state]??'':''}`:'Email sending is not configured yet.';
  emailToggle.textContent=emailsEnabled?'Turn off email alerts':'Enable email alerts';emailToggle.disabled=!emailsEnabled&&(!preference.available||!preference.email);emailToggle.hidden=false;
 }catch(error){emailStatus.textContent=error instanceof Error?error.message:'Could not load email preferences.';}
}
emailToggle.onclick=async()=>{emailToggle.disabled=true;try{await api(`/api/businesses/${tenantId}/email-preferences`,{enabled:!emailsEnabled});await refreshEmailPreference();}catch(error){emailStatus.textContent=error instanceof Error?error.message:'Could not save email preferences.';emailToggle.disabled=false;}};
const permissionDetail=document.createElement('p');permissionDetail.id='permission-detail';
$('user-detail').after(permissionDetail);
const timezoneSuggestion=createTimeZoneSuggestion(text=>{show('chat');void sendTextMessage(text);});
$('logout').before(timezoneSuggestion.element);
const diagnostics=createVoiceDiagnostics();
const voiceHealth=createVoiceHealth(diagnostics);
$('help-view').append(voiceHealth.element);
const notice=(message:string)=>{
 if(accessEnded)return;
 const banner=$('notice');
 if(!message){banner.textContent=message;banner.hidden=true;return;}
 const content=document.createElement('div'),dismiss=document.createElement('button');
 content.className='notice-message';content.textContent=message;content.tabIndex=0;
 content.setAttribute('role','region');content.setAttribute('aria-label','Message details');
 dismiss.type='button';dismiss.className='icon-button notice-dismiss';dismiss.setAttribute('aria-label','Dismiss message');
 const mark=createElement(X);mark.setAttribute('aria-hidden','true');mark.setAttribute('focusable','false');dismiss.append(mark);
 dismiss.onclick=()=>{
  if(accessEnded)return;
  banner.hidden=true;
  const view=document.body.dataset.view,panel=view?document.getElementById(view+'-view'):null;
  const heading=panel&&!panel.hidden?panel.querySelector<HTMLElement>('h1'):null;
  if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  else $('main-content').focus({preventScroll:true});
 };
 banner.replaceChildren(content,dismiss);banner.hidden=false;
};
const networkStatus=document.createElement('p');networkStatus.id='network-status';networkStatus.setAttribute('role','status');networkStatus.hidden=true;
$('notice').before(networkStatus);
let voiceConnected=false;
let microphoneProblem='';
let historyReady=false;
let savedTranscript:Array<{role:string;text:string}>=[];
let confirmedProfile:Record<string,unknown>={};
let councilMode=false;
function composerPlaceholder(){const name=assistantName(confirmedProfile);return councilMode?'Ask the council…':`Ask ${name.length<=14?name:'Mayor'}…`;}
const ONBOARDING_STEP_LABELS:Record<string,string>={name:'Business name',industry:'Industry',services:'Services',locations:'Locations',hours:'Hours',timeZone:'Time zone',staff:'Team'};
function renderOnboardingProgress(progress?:{missing:string[];basicsComplete:boolean}){
 const el=$('onboarding-progress');el.replaceChildren();
 if(!progress||progress.basicsComplete){el.hidden=true;return;}
 const done=7-progress.missing.length;
 const bar=document.createElement('div');bar.className='op-bar';bar.setAttribute('role','progressbar');
 bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','7');bar.setAttribute('aria-valuenow',String(done));
 bar.setAttribute('aria-label',`Business profile ${done} of 7 complete`);
 const fill=document.createElement('div');fill.className='op-fill';fill.style.width=`${Math.round(done/7*100)}%`;bar.append(fill);
 const text=document.createElement('p');
 text.textContent=`Business profile: ${done} of 7 complete. Still to go: ${progress.missing.map(field=>ONBOARDING_STEP_LABELS[field]??field).join(', ')}.`;
 const again=document.createElement('button');again.type='button';again.className='secondary';again.textContent='Continue setup';
 again.onclick=()=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value='Resume onboarding from my confirmed details. Ask one missing question.';resizeComposer();input.focus();};
 el.append(bar,text,again);el.hidden=false;
}
function useBusinessProfile(profile:Record<string,unknown>,progress?:{missing:string[];basicsComplete:boolean}){
 confirmedProfile=profile;workspace.profile(profile);renderOnboardingProgress(progress);
 const name=assistantName(profile);$<HTMLTextAreaElement>('message').placeholder=composerPlaceholder();resizeComposer();
 $('chat-view').querySelector('.page-heading > p')!.textContent=`Tell ${name} what you need. Review details before changing your calendar or saving a customer.`;
 $('chat-view').querySelector<HTMLImageElement>('.portrait img')!.alt=name;
 if(!savedTranscript.length&&canChat())savedTranscript.push({role:'assistant',text:assistantGreeting(profile,canManage())});
 if(historyReady)transcripts();
}
const composerStatus=document.createElement('p');composerStatus.id='composer-status';composerStatus.setAttribute('role','status');
const stopWaiting=document.createElement('button');stopWaiting.type='button';stopWaiting.className='secondary';stopWaiting.textContent='Stop waiting';stopWaiting.hidden=true;
const chatActions=document.createElement('div');chatActions.className='chat-actions';chatActions.append(stopWaiting);$('text-form').after(composerStatus,chatActions);
const modeToggle=document.createElement('div');modeToggle.className='mode-toggle';modeToggle.setAttribute('role','group');modeToggle.setAttribute('aria-label','Chat mode');
const assistantModeBtn=document.createElement('button');assistantModeBtn.type='button';assistantModeBtn.textContent='Assistant';assistantModeBtn.setAttribute('aria-pressed','true');
const councilModeBtn=document.createElement('button');councilModeBtn.type='button';councilModeBtn.textContent='Council';councilModeBtn.setAttribute('aria-pressed','false');
const modeNote=document.createElement('p');modeNote.className='mode-note';modeNote.hidden=true;modeNote.textContent='The council answers — the seats speak, the King rules. AI coaching, not professional advice. Council replies show here but are not saved to your conversation history.';
function setChatMode(council:boolean){councilMode=council;assistantModeBtn.setAttribute('aria-pressed',String(!council));councilModeBtn.setAttribute('aria-pressed',String(council));modeNote.hidden=!council;$<HTMLTextAreaElement>('message').placeholder=composerPlaceholder();resizeComposer();}
assistantModeBtn.onclick=()=>setChatMode(false);councilModeBtn.onclick=()=>setChatMode(true);
modeToggle.append(assistantModeBtn,councilModeBtn);$('text-form').before(modeToggle,modeNote);
const textChat=createTextChat(async(text,requestId,signal)=>{
 const captured=workspaceAccess.capture();const endpoint=`/api/businesses/${tenantId}/${councilMode?'council':'conversation'}`;
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,requestId}),signal});
 const result=await response.json();workspaceAccess.assert(captured);if(!response.ok){if(workspaceAccessWasRejected(endpoint,tenantId,loggedIn,result.error))endWorkspaceAccess();throw new Error(result.message??'Could not send. Your draft is still here.');}return result;
},(busy,message)=>{if(accessEnded)return;composerStatus.textContent=message;stopWaiting.hidden=!busy;updateNetwork();renderVoiceState();});
stopWaiting.onclick=()=>textChat.cancel();
async function loadConversation(){
 const result=await api(`/api/businesses/${tenantId}/conversation`);
 savedTranscript=result.messages.map((m:any)=>({role:m.role,text:m.content}));if(!savedTranscript.length&&canChat())savedTranscript.push({role:'assistant',text:assistantGreeting(confirmedProfile,canManage())});voiceRows.clear();voiceSeen=voice?.transcript.length??0;historyReady=true;transcripts();updateNetwork();
}
const pullStatus=document.createElement('div');pullStatus.className='pull-refresh-status';pullStatus.hidden=true;pullStatus.setAttribute('role','status');document.body.append(pullStatus);
const pullGesture=createPullRefresh();let pullBusy=false;
const pullGuard=()=>({allowed:matchMedia('(max-width:760px)').matches&&loggedIn&&!accessEnded&&navigator.onLine&&!document.querySelector('dialog[open]'),busy:pullBusy||textChat.busy||voiceCall?.active||voiceCall?.starting});
const resetPull=()=>{pullGesture.cancel();if(!pullBusy)pullStatus.hidden=true;};
window.addEventListener('touchstart',event=>{resetPull();const touch=event.touches[0];if(!touch)return;const target=event.target instanceof Element?event.target:null;const messageScroll=target?.closest('#transcript')?.scrollTop??0;pullGesture.start({x:touch.clientX,y:touch.clientY,id:touch.identifier,touches:event.touches.length,scrollY:Math.max(window.scrollY,messageScroll),interactive:Boolean(target?.closest('input,textarea,select,button,summary,a,dialog'))},pullGuard());},{passive:true});
window.addEventListener('touchmove',event=>{const touch=event.touches[0];if(!touch){resetPull();return;}const state=pullGesture.move({x:touch.clientX,y:touch.clientY,id:touch.identifier,touches:event.touches.length},pullGuard());if(state.preventDefault){event.preventDefault();pullStatus.hidden=false;pullStatus.textContent=state.phase==='armed'?'Release to refresh':'Pull to refresh';}else if(!pullBusy)pullStatus.hidden=true;},{passive:false});
window.addEventListener('touchcancel',resetPull,{passive:true});
window.addEventListener('touchend',event=>{if(!pullGesture.end(pullGuard(),event.touches.length)){if(!pullBusy)pullStatus.hidden=true;return;}pullBusy=true;updateNetwork();pullStatus.hidden=false;pullStatus.textContent='Refreshing…';void(async()=>{try{const view=document.body.dataset.view;if(view==='chat')await loadConversation();else if(view==='account')await account();else if(view==='connections')await connectionHub.activate();else await workday.refreshCurrent();}catch(error){if(!accessEnded)notice(error instanceof Error?error.message:'Could not refresh. Try again.');}finally{pullBusy=false;pullGesture.finish();pullStatus.hidden=true;updateNetwork();}})();},{passive:true});
async function sendTextMessage(text:string){
 if(!loggedIn||!canChat()||!historyReady||accessEnded||textChat.busy||pullBusy||!navigator.onLine)return;
 if(voiceCall?.active||voiceCall?.starting){notice('End the voice conversation before sending a typed message. Your draft is saved here.');return;}
 const input=$<HTMLTextAreaElement>('message');if(!text.trim())return;notice('');
 show('chat');
 const result=await textChat.submit(text.trim());
 if(result&&!accessEnded){savedTranscript.push({role:'user',text:text.trim()},{role:'assistant',text:result.reply});for(const event of result.events??[])handleMessage(event);if(result.stopped)setChatMode(false);if(input.value.trim()===text.trim())input.value='';resizeComposer();transcripts();$('transcript').scrollTop=$('transcript').scrollHeight;}
}
function updateNetwork(){
  if(accessEnded)return;
  const online=navigator.onLine;
  document.body.classList.toggle('offline',!online);
  networkStatus.hidden=online;
  networkStatus.textContent='You are offline. Reconnect to continue. Typed text stays here, but has not been sent. Check any pending action before trying it again.';
  $<HTMLButtonElement>('talk').disabled=!online||!voiceConnected||!historyReady||textChat.busy||pullBusy;
  $<HTMLTextAreaElement>('message').disabled=!loggedIn||!canChat()||accessEnded;
  $<HTMLButtonElement>('send-message').disabled=!online||!historyReady||textChat.busy||pullBusy||!canChat();
  workspace.ready(online&&historyReady&&!textChat.busy&&!pullBusy&&!accessEnded);
  if(!online){voiceCall?.stop();$('interim').textContent='';}
}
/** Business pill switcher: tap the business identity to switch between owned businesses.
 * Switching navigates with ?business=<id>; the server selects the tenant from the param. */
function setupBusinessSwitcher(businesses:Array<{id:string;name:string;role:string}>,currentId:string){
  const identity=document.querySelector<HTMLElement>('.business-identity');
  if(!identity||businesses.length<2)return;
  identity.setAttribute('role','button');
  identity.setAttribute('tabindex','0');
  identity.setAttribute('aria-label',`Switch business, current: ${businesses.find(b=>b.id===currentId)?.name??'your business'}`);
  identity.style.cursor='pointer';
  const chevron=document.createElement('span');
  chevron.textContent=' ▾';
  chevron.setAttribute('aria-hidden','true');
  identity.querySelector('strong')?.append(chevron);
  const close=()=>{document.querySelector('.business-switcher-menu')?.remove();document.removeEventListener('click',onDoc);};
  const onDoc=(e:MouseEvent)=>{if(!(e.target as HTMLElement).closest('.business-switcher-menu,.business-identity'))close();};
  const open=()=>{
    close();
    const menu=document.createElement('div');
    menu.className='business-switcher-menu';
    menu.setAttribute('role','menu');
    for(const b of businesses){
      const item=document.createElement('button');
      item.setAttribute('role','menuitemradio');
      item.setAttribute('aria-checked',String(b.id===currentId));
      item.className='business-switcher-item'+(b.id===currentId?' current':'');
      item.textContent=`${b.name} · ${b.role}`;
      if(b.id!==currentId)item.onclick=()=>{const url=new URL(location.href);url.searchParams.set('business',b.id);location.assign(url.toString());};
      else item.disabled=true;
      menu.append(item);
    }
    identity.after(menu);
    document.addEventListener('click',onDoc);
  };
  identity.onclick=(e)=>{e.stopPropagation();document.querySelector('.business-switcher-menu')?close():open();};
  identity.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();document.querySelector('.business-switcher-menu')?close():open();}if(e.key==='Escape')close();};
}
window.addEventListener('online',updateNetwork);
window.addEventListener('offline',updateNetwork);
window.addEventListener('pagehide',()=>voiceCall?.stop());
updateNetwork();
type PhoneGuide={mode:'new'|'existing';provider:string|null;question:string;steps:string[];providers:{id:string;name:string;signupUrl:string;consoleUrl:string;guideUrl:string;pricingUrl:string;note:string}[]};
const phoneCard=document.createElement('details');phoneCard.className='account-card optional-phone';
const phoneTitle=document.createElement('summary');phoneTitle.textContent='Business phone · Optional';
const phoneIntro=document.createElement('p');phoneIntro.textContent='You can onboard your business, connect a calendar and use attention alerts without a phone provider. When you are ready, The Mayor can help you connect an existing provider or get started with a new one.';
const phoneChoices=document.createElement('div');phoneChoices.className='phone-choices';
const phoneGuide=document.createElement('div');phoneGuide.id='phone-guide';phoneGuide.setAttribute('aria-live','polite');
const consentSection=document.createElement('div');consentSection.id='recording-consent';consentSection.setAttribute('aria-live','polite');
phoneCard.append(phoneTitle,phoneIntro,phoneChoices,phoneGuide,consentSection);$('logout').before(phoneCard);
const phoneControls=document.createElement('div');phoneCard.append(phoneControls);
let phoneLoading=false;
async function loadPhoneAccount(){
  if(phoneLoading||!loggedIn||!canManage())return;
  phoneLoading=true;
  try{
    await renderPhoneConnection();
    const setup=await api(`/api/businesses/${tenantId}/phone-setup`);
    if(setup.setup)renderPhoneGuide(setup.setup,phoneGuide);
    await loadRecordingConsent();
  }catch{
    const message=document.createElement('p'),retry=document.createElement('button');
    message.setAttribute('role','status');message.textContent='Phone setup could not load. Your other business connections are still available.';
    retry.type='button';retry.className='secondary';retry.textContent='Retry phone setup';retry.onclick=()=>void loadPhoneAccount();
    phoneControls.replaceChildren(message,retry);
  }finally{phoneLoading=false;}
}
async function loadRecordingConsent(){
  consentSection.replaceChildren();
  const title=document.createElement('h4');title.textContent='Call recording consent';consentSection.append(title);
  const blocked=(text:string)=>{const alert=document.createElement('p');alert.className='consent-blocked';alert.setAttribute('role','alert');alert.textContent=text;return alert;};
  try{
    const status=await api(`/api/businesses/${tenantId}/phone-connections/recording-consent`);
    const text=document.createElement('p');text.textContent=status.text;
    consentSection.append(text);
    if(status.acknowledged){
      const done=document.createElement('p');done.setAttribute('role','status');
      done.textContent=`Acknowledged${status.acknowledgedAt?' on '+new Date(status.acknowledgedAt).toLocaleDateString():''}. Calls can be handled.`;
      consentSection.append(done);
    }else{
      consentSection.append(blocked('Calls are blocked until recording consent is acknowledged. No calls can be placed or received until then.'));
      const label=document.createElement('label');
      const box=document.createElement('input');box.type='checkbox';
      label.append(box,document.createTextNode(' I acknowledge the above.'));
      const btn=document.createElement('button');btn.type='button';btn.className='secondary';
      btn.textContent='Acknowledge recording consent';btn.disabled=true;
      box.onchange=()=>{btn.disabled=!box.checked;};
      btn.onclick=async()=>{
        btn.disabled=true;
        try{await api(`/api/businesses/${tenantId}/phone-connections/recording-consent`,{acknowledged:true});await loadRecordingConsent();}
        catch{btn.disabled=false;notice('Could not save the acknowledgement. Please try again.');}
      };
      consentSection.append(label,btn);
    }
  }catch{
    consentSection.append(blocked('Recording consent status could not be checked. Calls remain blocked until consent is confirmed.'));
  }
}
phoneCard.addEventListener('toggle',()=>{if(phoneCard.open)void loadPhoneAccount();});
function renderVoiceManagement(target:HTMLElement,provider:'telnyx'|'twilio'){
 const card=document.createElement('section'),title=document.createElement('h4'),status=document.createElement('p'),refresh=document.createElement('button'),prepare=document.createElement('button');
 title.textContent='Voice application';status.setAttribute('role','status');refresh.type=prepare.type='button';refresh.className=prepare.className='secondary';refresh.textContent='Refresh voice setup';prepare.textContent='Create voice app · keep routing unchanged';prepare.hidden=true;
 const setup=document.createElement('div');card.append(title,status,refresh,prepare,setup);target.append(card);
 const load=async(create=false)=>{refresh.disabled=prepare.disabled=true;status.textContent=create?'Preparing your voice application…':'Checking your voice application…';try{
  const result=await api(`/api/businesses/${tenantId}/phone-connections/${provider}/application`,create?{confirm:'prepare_application'}:undefined);
  status.textContent=(result.application?`${result.application.name} · `:'')+result.next;prepare.hidden=!!result.application||!result.canCreate;
  setup.replaceChildren();if(provider==='telnyx'&&result.stage==='application_prepared'&&result.canCreate)renderTelnyxTestSetup(setup,result.application.id);
 }catch(error){status.textContent=(error as Error).message;prepare.hidden=true;}finally{refresh.disabled=prepare.disabled=false;}};
 refresh.onclick=()=>void load();prepare.onclick=()=>void load(true);void load();
}
function renderTelnyxTestSetup(target:HTMLElement,applicationId:string){
 const details=document.createElement('details'),summary=document.createElement('summary'),help=document.createElement('p'),form=document.createElement('form'),status=document.createElement('p');
 summary.textContent='Prepare a supervised test call';help.textContent='Save the phone you will call from and Telnyx’s public signing key. This does not change routing or activate calls. Caller verification and a supervised test are still required.';form.className='phone-credential-form';status.setAttribute('role','status');
 const caller=document.createElement('input'),key=document.createElement('input');caller.type='tel';caller.autocomplete='tel';caller.placeholder='+1…';caller.required=true;caller.maxLength=16;key.type='text';key.autocomplete='off';key.required=true;key.maxLength=44;key.spellcheck=false;
 for(const [text,input] of [['Your test caller number',caller],['Telnyx public signing key',key]] as const){const label=document.createElement('label');label.textContent=text;label.append(input);form.append(label);}
 const guide=document.createElement('a');guide.href='https://support.telnyx.com/en/articles/4334722-how-to-leverage-webhooks';guide.target='_blank';guide.rel='noopener noreferrer';guide.textContent='Find the public key in Telnyx';
 const save=document.createElement('button');save.type='submit';save.className='secondary';save.textContent='Save test settings';form.append(guide,save);
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;status.textContent='Checking your voice app…';try{const result=await api(`/api/businesses/${tenantId}/phone-connections/telnyx/test-setup`,{applicationId,testCaller:caller.value.trim(),publicKey:key.value.trim(),confirm:'save_test_setup'});status.textContent=result.next;}catch(error){status.textContent=(error as Error).message;}finally{save.disabled=false;}};
 details.append(summary,help,form,status);target.append(details);
}
async function renderTelnyxConnection(container:HTMLElement,onChanged:()=>Promise<void>=()=>renderPhoneConnection()){
  const base=`/api/businesses/${tenantId}/phone-connections`,result=await api(base);
  const connection=result.connections.find((c:any)=>c.provider==='telnyx'&&c.status==='authorized');
  const heading=document.createElement('h3');heading.textContent='Telnyx';container.append(heading);
  const consent=document.createElement('button'),consentHelp=document.createElement('p');
  consent.className='secondary';consent.textContent=connection?'Reconnect with Telnyx':'Connect with Telnyx';
  consent.disabled=!result.authorization?.telnyx?.available;
  consentHelp.textContent=consent.disabled?'Telnyx sign-in is being set up. If you already have an account, secure manual setup is available below.':'Sign in with Telnyx and approve access, then choose your business number.';
  consent.onclick=async()=>{consent.disabled=true;try{
    const response=await api(base+'/telnyx/authorize',{}),url=new URL(response.url);
    if(url.origin!=='https://api.telnyx.com'||url.pathname!=='/v2/oauth/authorize'||url.username||url.password)throw new Error('The connection link could not be verified. Please try again.');
    location.assign(url.href);
  }catch(error){notice((error as Error).message);consent.disabled=false;}};
  container.append(consentHelp,consent);
  if(connection){
    const status=document.createElement('p');status.textContent=`Telnyx number access verified${connection.number?` · Selected: ${connection.number}`:''}. Calls are not enabled yet.`;
    const choose=document.createElement('button'),disconnect=document.createElement('button'),list=document.createElement('div');
    choose.className=disconnect.className='secondary';choose.textContent='Choose an owned number';disconnect.textContent='Disconnect Telnyx';
    choose.onclick=async()=>{try{choose.disabled=true;const response=await api(base+'/telnyx/numbers');list.replaceChildren();
      for(const number of response.numbers){const button=document.createElement('button');button.className='secondary';button.textContent=number.number+(number.eligible?'':` · ${number.status}`);button.disabled=!number.eligible;
        button.onclick=async()=>{try{button.disabled=true;await api(base+'/telnyx/select',{id:number.id});notice('Number selected. Call routing is unchanged; calls are not enabled yet.');await onChanged();}catch(error){notice((error as Error).message);button.disabled=false;}};list.append(button);}
      if(!response.numbers.length)list.textContent='No owned numbers found. Use the setup guide to obtain a number, then refresh.';
    }catch(error){notice((error as Error).message);}finally{choose.disabled=false;}};
    disconnect.onclick=async()=>{try{disconnect.disabled=true;await api(base+'/telnyx/disconnect',{});notice('Disconnected from The Mayor. You can also revoke The Mayor’s access or API key in your Telnyx account.');await onChanged();}catch(error){notice((error as Error).message);disconnect.disabled=false;}};
    container.append(status,choose,disconnect,list);renderVoiceManagement(container,'telnyx');return;
  }
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Advanced: connect using an API key';
  const explanation=document.createElement('p');explanation.textContent='Create an API key with the minimum permissions needed to read your phone numbers and voice settings. Enter it here, never in conversation. It is encrypted on the server. Connecting does not buy numbers or change routing.';
  const help=document.createElement('a');help.href='https://support.telnyx.com/en/articles/4305158-api-keys-and-how-to-use-them';help.target='_blank';help.rel='noopener noreferrer';help.textContent='Telnyx API key instructions';
  const form=document.createElement('form');form.className='phone-credential-form';
  const label=document.createElement('label'),key=document.createElement('input'),submit=document.createElement('button');label.textContent='Telnyx API key';key.type='password';key.autocomplete='off';key.required=true;key.maxLength=512;key.spellcheck=false;label.append(key);submit.type='submit';submit.className='secondary';submit.textContent='Verify and connect';form.append(label,submit);
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;const input={apiKey:key.value.trim()};key.value='';
    try{await api(base+'/telnyx/connect',input);notice('Telnyx number access verified. Choose your business number next. Calling still needs setup and a real test call.');await onChanged();}catch(error){notice((error as Error).message);}finally{input.apiKey='';submit.disabled=false;}};
  details.append(summary,explanation,help,form);container.append(details);
}
async function renderPhoneConnection(target:HTMLElement=phoneControls){
  target.replaceChildren();
  const telnyxControls=document.createElement('section');target.append(telnyxControls);
  await renderTelnyxConnection(telnyxControls,()=>renderPhoneConnection(target));
  const base=`/api/businesses/${tenantId}/phone-connections`;
  const result=await api(base),connection=result.connections.find((c:any)=>c.provider==='twilio'&&c.status==='authorized');
  const heading=document.createElement('h3');heading.textContent='Secure Twilio connection';target.append(heading);
  if(connection){
    const state=document.createElement('p');state.textContent=`Twilio credentials verified${connection.number?` · Selected: ${connection.number}`:''}. Calls are not enabled yet.`;
    const list=document.createElement('div'),refresh=document.createElement('button'),disconnect=document.createElement('button');
    refresh.textContent='Choose an owned number';disconnect.textContent='Disconnect Twilio';refresh.className=disconnect.className='secondary';
    refresh.onclick=async()=>{try{refresh.disabled=true;const response=await api(base+'/twilio/numbers');list.replaceChildren();
      for(const number of response.numbers){const button=document.createElement('button');button.className='secondary';button.textContent=number.number+(number.voice?'':' · No voice capability');button.disabled=!number.voice;
        button.onclick=async()=>{try{button.disabled=true;await api(base+'/twilio/select',{id:number.id});notice('Number selected. Call routing is unchanged; calls are not enabled yet.');await renderPhoneConnection(target);}catch(error){notice((error as Error).message);button.disabled=false;}};list.append(button);}
      if(!response.numbers.length)list.textContent='No owned numbers found. Use the signup/setup guide above to obtain a number, then refresh.';
    }catch(error){notice((error as Error).message);}finally{refresh.disabled=false;}};
    disconnect.onclick=async()=>{try{await api(base+'/twilio/disconnect',{});notice('Disconnected from The Mayor. Revoke the API key in Twilio if you no longer need it.');await renderPhoneConnection(target);}catch(error){notice((error as Error).message);}};
    target.append(state,refresh,disconnect,list);renderVoiceManagement(target,'twilio');return;
  }
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Connect using a Twilio API key';details.append(summary);
  const explanation=document.createElement('p');explanation.textContent='Create a restricted API key with permission to list and fetch your incoming phone numbers. Enter it here, never in conversation. Credentials are encrypted on the server. This step does not buy numbers or change call routing.';
  const help=document.createElement('a');help.href='https://www.twilio.com/docs/iam/api-keys';help.target='_blank';help.rel='noopener noreferrer';help.textContent='Twilio API key instructions';
  const form=document.createElement('form');form.className='phone-credential-form';
  const fields:Record<string,HTMLInputElement>={};
  for(const [key,label,placeholder] of [['accountSid','Account SID','AC…'],['apiKeySid','API Key SID','SK…'],['apiKeySecret','API Key Secret','Your API key secret']]){
    const wrapper=document.createElement('label'),input=document.createElement('input');wrapper.textContent=label;input.required=true;input.type=key==='apiKeySecret'?'password':'text';input.autocomplete='off';input.maxLength=256;input.placeholder=placeholder;input.spellcheck=false;wrapper.append(input);form.append(wrapper);fields[key]=input;
  }
  const testSettings=document.createElement('details'),testSummary=document.createElement('summary');testSummary.textContent='Optional: designated call test';
  const testNote=document.createElement('p');testNote.textContent='For a supervised call test, provide the Twilio Auth Token used to verify webhook signatures and a caller number you own. The restricted API key also needs permission to read calls. Optionally add a Twilio Verify service for SMS verification of the calling number. Its API key needs service-read, verification-create and verification-check permissions. The caller must opt in before a text is requested; provider charges may apply. Production call testing must be enabled separately; this does not change routing.';testSettings.append(testSummary,testNote);
  for(const [key,label] of [['authToken','Twilio Auth Token'],['testCaller','Designated test caller (+country code)'],['verifyServiceSid','Optional Verify Service SID (VA…)']]){const wrapper=document.createElement('label'),input=document.createElement('input');wrapper.textContent=label;input.type=key==='authToken'?'password':key==='testCaller'?'tel':'text';input.autocomplete='off';input.maxLength=64;wrapper.append(input);testSettings.append(wrapper);fields[key]=input;}form.append(testSettings);
  const submit=document.createElement('button');submit.className='secondary';submit.textContent='Verify and connect';submit.type='submit';form.append(submit);
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;
    const input={accountSid:fields.accountSid.value.trim(),apiKeySid:fields.apiKeySid.value.trim(),apiKeySecret:fields.apiKeySecret.value.trim(),...(fields.authToken.value.trim()?{authToken:fields.authToken.value.trim()}:{}),...(fields.testCaller.value.trim()?{testCaller:fields.testCaller.value.trim()}:{} ),...(fields.verifyServiceSid.value.trim()?{verifyServiceSid:fields.verifyServiceSid.value.trim()}:{})};fields.apiKeySecret.value='';fields.authToken.value='';
    try{await api(base+'/twilio/connect',input);notice('Twilio number access verified. Choose your business number next. Call credentials still need a signed test call.');await renderPhoneConnection(target);}catch(error){notice((error as Error).message);}finally{input.apiKeySecret='';input.authToken='';submit.disabled=false;}
  };
  details.append(explanation,help,form);target.append(details);
}
async function choosePhonePath(mode:'new'|'existing',provider?:string,target:HTMLElement=phoneGuide){
  try{
    const input={mode,...(provider?{provider}:{})};
    const guide=loggedIn?await api(`/api/businesses/${tenantId}/phone-setup`,input):await api(`/api/phone-guide?mode=${mode}${provider?`&provider=${provider}`:''}`);
    renderPhoneGuide(guide,target);
  }catch(error){notice((error as Error).message);}
}
for(const [mode,label] of [['new','I need a business number'],['existing','I already have a provider']] as const){
  const button=document.createElement('button');button.className='secondary';button.textContent=label;button.onclick=()=>choosePhonePath(mode);phoneChoices.append(button);
}
function renderPhoneGuide(guide:PhoneGuide,target:HTMLElement){
  target.replaceChildren();const heading=document.createElement('h3');heading.textContent=guide.mode==='new'?'Let’s get you started':'Let’s connect what you have';
  const question=document.createElement('p');question.textContent=guide.question;const steps=document.createElement('ol');
  for(const text of guide.steps){const item=document.createElement('li');item.textContent=text;steps.append(item);}
  target.hidden=false;
  if(target.id==='chat-phone-guide'){
    const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent='Close phone setup';
    close.onclick=()=>{target.hidden=true;$<HTMLTextAreaElement>('message').focus();};
    target.append(close);
  }
  target.append(heading,question,steps);
  for(const provider of guide.providers){
    const row=document.createElement('div');row.className='provider-guide';const name=document.createElement('h4');name.textContent=provider.name;
    const select=document.createElement('button');select.className='secondary';
    select.textContent=guide.provider===provider.id?`${provider.name} selected`:`Choose ${provider.name}`;
    select.disabled=guide.provider===provider.id;
    select.onclick=async()=>{select.disabled=true;try{await choosePhonePath(guide.mode,provider.id,target);}finally{select.disabled=guide.provider===provider.id;}};
    const links=document.createElement('div');links.className='provider-links';
    for(const [label,href] of [[guide.mode==='new'?'Open signup':'Open provider account',guide.mode==='new'?provider.signupUrl:provider.consoleUrl],['Current pricing',provider.pricingUrl],['Setup guide',provider.guideUrl]]){
      const link=document.createElement('a');link.textContent=label;link.href=href;link.target='_blank';link.rel='noopener noreferrer';links.append(link);
    }
    const note=document.createElement('p');note.textContent=provider.note;row.append(name,select,links,note);target.append(row);
  }
  const status=document.createElement('p');status.textContent='This guide does not connect an account or purchase a number.';target.append(status);
  if(target.id==='chat-phone-guide'&&canManage()){
    const open=document.createElement('button'),controls=document.createElement('section');
    open.type='button';open.className='secondary';open.textContent='Retry phone connection options';open.hidden=true;
    controls.setAttribute('aria-label','Phone connection options');controls.setAttribute('aria-live','polite');
    const load=async()=>{open.disabled=true;try{await renderPhoneConnection(controls);open.hidden=true;}catch{controls.textContent='Connection options could not load. Try again.';open.hidden=false;open.disabled=false;}};
    open.onclick=()=>void load();
    target.append(open,controls);
    void load();
  }
}
async function api(path:string,body?:unknown,headers:Record<string,string>={}){
 const captured=path==='/api/auth/sign-out'?null:workspaceAccess.capture();
 const customConnection=/^\/api\/businesses\/[a-f0-9]{32}\/connections(?:\/|$)/.test(path);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),customConnection?20000:15000);
 try{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  const result=await response.json();if(captured!==null)workspaceAccess.assert(captured);if(!response.ok){if(workspaceAccessWasRejected(path,tenantId,loggedIn,result.error))endWorkspaceAccess();throw Object.assign(new Error(result.message??'This service could not finish. Please try again.'),{code:result.error});}return result;
 }catch(error){if(controller.signal.aborted)throw new Error(customConnection?'The connection took too long. Check the connected service before repeating an action.':'This service took too long. Please try again.');throw error;}finally{clearTimeout(timer);}
}
let voiceSeen=0,conversationPositioned=false,conversationAtEnd=true,conversationHeight=0,conversationWidth=0;const voiceRows=new Map<number,{role:string;text:string}>();
const conversationScroll=$('transcript');
conversationScroll.addEventListener('scroll',()=>{
 // A viewport reflow is not a request to stop following the latest message.
 if(conversationScroll.clientHeight>0&&conversationScroll.clientHeight===conversationHeight&&conversationScroll.clientWidth===conversationWidth)conversationAtEnd=conversationScroll.scrollHeight-conversationScroll.scrollTop-conversationScroll.clientHeight<80;
},{passive:true});
new ResizeObserver(()=>{
 if(conversationScroll.clientHeight<=0)return;
 if(!conversationPositioned||conversationAtEnd)conversationScroll.scrollTop=conversationScroll.scrollHeight;
 conversationHeight=conversationScroll.clientHeight;conversationWidth=conversationScroll.clientWidth;
}).observe(conversationScroll);
function transcripts(){
 if(accessEnded)return;
 const list=$('transcript'),follow=list.scrollHeight-list.scrollTop-list.clientHeight<80;
 const live=voice?.transcript??[];
 for(let i=voiceSeen;i<live.length;i++){let row=voiceRows.get(i);if(!row){row={role:live[i].role,text:live[i].text};voiceRows.set(i,row);savedTranscript.push(row);}else row.text=live[i].text;}
 $('chat-empty').hidden=!loggedIn||savedTranscript.length>0;
 const messages=savedTranscript.slice(-200);
 while(list.children.length>messages.length)list.lastElementChild?.remove();
  messages.forEach((message,i)=>{let li=list.children[i] as HTMLElement;if(!li){li=document.createElement('li');li.append(document.createElement('b'),document.createElement('span'));list.append(li);}li.className=message.role==='user'?'message-user':'message-mayor';li.firstElementChild!.textContent=message.role==='user'?'You':assistantName(confirmedProfile);const content=li.querySelector('span')!;if(content.textContent!==message.text)content.textContent=message.text;let copy=li.querySelector<HTMLButtonElement>('.copy-reply');if(message.role!=='user'&&!copy){copy=document.createElement('button');copy.type='button';copy.className='copy-reply';copy.textContent='Copy reply';li.append(copy);}if(copy){copy.hidden=message.role==='user';copy.onclick=async()=>{try{await navigator.clipboard.writeText(content.textContent??'');copy!.textContent='Copied';}catch{notice('Copy could not finish. Select the reply text to copy it.');}};}});
 // History can load while Today is visible, when the chat has no scrollable
 // height. Position it once after it becomes visible; preserve earlier-reading
 // positions on later tab switches and incremental transcript updates.
 if(list.clientHeight>0){if(follow||!conversationPositioned){list.scrollTop=list.scrollHeight;conversationAtEnd=true;}conversationPositioned=true;}
}
async function connect(){
  const session=await api('/api/voice/session',{tenantId});
  voiceCall?.stop();voice?.disconnect();
  voiceRows.clear();voiceSeen=0;updateNetwork();
  const microphone=new MayorMicrophone();
  const client=voice=new VoiceClient({agent:session.agent,name:session.name,query:{business:tenantId},audioInput:microphone});
  const active=()=>voice===client&&!accessEnded;
  const call=voiceCall=createVoiceCall(client,renderVoiceState,message=>{if(!active())return;microphoneProblem=message;notice(message);renderVoiceState();},()=>microphone.prepare());
  bindVoiceAccessRecovery(client,()=>{if(active())endWorkspaceAccess();});
  client.addEventListener('statuschange',status=>{
    if(!active())return;
    call.status(status);
    renderVoiceState();
  });
  client.addEventListener('connectionchange',connected=>{
    if(!active())return;
    if(connected)diagnostics.newConnection();
    if(connected&&$('notice').textContent==='Connection lost. Reconnecting...')notice('');
    voiceConnected=connected;if(!connected)voiceCall?.stop();updateNetwork();renderVoiceState();
  });
  client.addEventListener('transcriptchange',()=>{if(active())transcripts();});
  client.addEventListener('audiolevelchange',level=>{if(active())micLevel.value=Math.min(1,Math.max(0,level*5));});
  client.addEventListener('turnmetrics',metrics=>{if(active()){diagnostics.record(metrics);voiceHealth.refresh();}});
  client.addEventListener('interimtranscript',text=>{if(active())$('interim').textContent=text??'';});
  client.addEventListener('error',message=>{if(active())call.error(message);});
  client.addEventListener('mutechange',muted=>{if(active())$('mute').textContent=muted?'Unmute':'Mute';});
  client.addEventListener('custommessage',data=>{if(active())handleMessage(data);});
  client.connect();
  // Watchdog: the SDK's "Connection lost. Reconnecting..." must never persist
  // silently. If the websocket hasn't established in 20s, say so plainly.
  setTimeout(()=>{
   if(!active()||voiceConnected)return;
   if($('notice').textContent==='Connection lost. Reconnecting...')
    notice('Voice could not connect. Your microphone and text chat still work — try tapping the mic again, or just type below.');
  },20000);
}
function endWorkspaceAccess(){
 if(accessEnded)return;
 chatKeyboard.dispose();
 accessEnded=true;workspaceAccess.end();textChat.cancel();voiceCall?.stop();voice?.disconnect();voiceConnected=false;historyReady=false;loggedIn=false;membershipRole='';sessionUserId='';
 savedTranscript=[];confirmedProfile={};voiceRows.clear();$('transcript').replaceChildren();$('interim').textContent='';
 workspace.clear();workday.clear();connectionHub.reset();voiceHealth.clear();calendarChat.clear();calendarLauncher.hidden=true;$('calendar-status').hidden=true;voiceHelp.open=false;voiceHelp.hidden=true;micLevel.hidden=true;micLevel.value=0;
 $('open-connections').hidden=true;$('open-connections').closest<HTMLElement>('.account-card')!.hidden=true;
 for(const node of [$('profile'),inboxItems,phoneGuide,phoneControls])node.replaceChildren();
 for(const id of ['chat-website-source','chat-phone-guide','chat-connections-guide'])document.getElementById(id)?.remove();
 $('user-detail').textContent='';permissionDetail.textContent='';routineState.textContent='';emailStatus.textContent='';timezoneSuggestion.element.hidden=true;
 $('notice').hidden=true;networkStatus.hidden=true;inbox.hidden=true;
 $('calendar-status').querySelector('span')!.textContent='Calendar unavailable';$<HTMLButtonElement>('calendar-status').disabled=true;
 $('notifications-button').hidden=true;$<HTMLButtonElement>('notifications-button').disabled=true;
 document.querySelector('main')!.hidden=true;document.querySelector('nav')!.hidden=true;
 $<HTMLTextAreaElement>('message').value='';$<HTMLTextAreaElement>('message').disabled=true;
 $<HTMLButtonElement>('send-message').disabled=true;$<HTMLButtonElement>('talk').disabled=true;
 document.querySelector<HTMLElement>('.assistant-dock')!.hidden=true;composerStatus.textContent='';chatActions.hidden=true;
 accessRecovery.show();
}
function handleMessage(data:unknown){
    if(accessEnded)return;
    if(data&&typeof data==='object'){
      if((data as any).type==='connections_guide'){
        let guide=document.getElementById('chat-connections-guide');
        if(!guide){guide=document.createElement('div');guide.id='chat-connections-guide';guide.className='account-card';$('transcript').before(guide);}
        guide.replaceChildren();const open=document.createElement('button');open.type='button';open.className='secondary';open.textContent='Open Connections';open.onclick=()=>show('connections');guide.append(open);
      }
      const message=data as any;
      if(message.type==='calendar_connection_guide'&&message.guide&&Array.isArray(message.guide.providers)){calendarChat.render(message.guide);$('conversation').setAttribute('open','');}
      if(message.type==='calendar_inventory'&&Array.isArray(message.connections)&&message.setup){calendarChat.inventory(message);$('conversation').setAttribute('open','');}
      if(message.type==='business_context'&&message.profile&&typeof message.profile==='object')useBusinessProfile(message.profile);
      if(message.type==='mehyar_expertise'&&Array.isArray(message.services)&&message.services.every((s:any)=>s&&typeof s.name==='string'&&typeof s.scope==='string'))workspace.expertise(message.services);
      if(message.type==='usage_notice'){
        // A new conversation turn retires the previous phone setup panel.
        if(message.kind==='turn'&&message.allowed){const phonePanel=document.getElementById('chat-phone-guide');if(phonePanel)phonePanel.hidden=true;}
        if(message.allowed&&typeof message.remaining==='number'&&message.kind==='turn')usageStatus.textContent=`${message.remaining} of ${message.limit} assistant replies remaining. See Plan & usage for your billing period.`;
        else if(typeof message.message==='string'&&message.message){usageStatus.textContent=message.message;notice(message.message);}
      }
    }
    // Hydrate once per VoiceClient, before enabling input. Its live transcript
    // already survives transport reconnects, so replaying snapshots would duplicate it.
    if(data&&typeof data==='object'&&(data as any).type==='conversation_history'&&!historyReady){
      const messages=(data as any).messages;
      if(Array.isArray(messages)&&messages.length<=50&&messages.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')){
        savedTranscript=messages;historyReady=true;transcripts();updateNetwork();
      }
    }
    if(data&&typeof data==='object'&&(data as any).type==='website_source'){
      const source=(data as any).source;
      let card=document.getElementById('chat-website-source');
      if(!card){card=document.createElement('div');card.id='chat-website-source';card.className='account-card';$('profile').closest('.account-card')!.after(card);}
      card.replaceChildren();const heading=document.createElement('h2');heading.textContent='Website source';const text=document.createElement('p');text.textContent='Reference used to review your business website.';
      const link=document.createElement('a');link.textContent=source.title||source.url;
      try{const url=new URL(source.url);if(url.protocol==='https:')link.href=url.href;}catch{}
      link.target='_blank';link.rel='noopener noreferrer';card.append(heading,text,link);
    }
    if(data&&typeof data==='object'&&(data as any).type==='phone_setup_guide'){
      let card=document.getElementById('chat-phone-guide');
      if(!card){card=document.createElement('div');card.id='chat-phone-guide';card.className='account-card';$('transcript').before(card);}
      renderPhoneGuide((data as any).guide,card);
    }
}

function renderVoiceState(){
 if(accessEnded){document.body.className='idle';delete document.body.dataset.voiceActive;return;}
 const status=voice?.status??'idle',starting=voiceCall?.starting??false;
 document.body.className=!navigator.onLine?'offline':loggedIn&&!voiceConnected?'reconnecting':starting?'starting':textChat.busy?'thinking':status;
 document.body.dataset.voiceActive=String(starting||Boolean(voiceCall?.active));
 $('status').textContent=textChat.busy?'Working on your message…':!historyReady&&loggedIn?'Loading your conversation…':microphoneProblem&&!starting?'Voice needs attention':starting?'Starting microphone…':({idle:'Ready when you are',listening:'I’m listening',thinking:'Thinking it through',speaking:assistantName(confirmedProfile)+' is speaking'})[status];
 $('talk').querySelector('span')!.textContent=starting?'Cancel voice startup':voiceCall?.active?'End conversation':microphoneProblem?'Try microphone again':'Talk to '+assistantName(confirmedProfile);
 $('talk').setAttribute('aria-label',$('talk').querySelector('span')!.textContent!);
 $('dock-voice-label').textContent=$('talk').querySelector('span')!.textContent;
 $('mute').hidden=starting||!voiceCall?.active;
 micLevel.hidden=!voiceCall?.active;if(micLevel.hidden)micLevel.value=0;
 $('voice-hint').textContent=starting?'Allow microphone access in your browser to begin. You can cancel and type instead.':voiceCall?.active?'Speak naturally. You can interrupt me anytime.':microphoneProblem|| (voiceConnected?'Press Talk to begin. I’ll greet you when your microphone is ready.':'Voice is reconnecting. You can still type below.');
}
$('talk').setAttribute('aria-describedby','voice-hint');
$('voice-hint').setAttribute('role','status');
$('talk').onclick=async()=>{show('chat');microphoneProblem='';notice('');if(voiceCall?.starting||voiceCall?.active)voiceCall?.stop();else if(voiceCall)await voiceCall.start();else{microphoneProblem='Voice is not connected yet. Wait for the connection or reload this page, then try again.';renderVoiceState();}};
$('mute').onclick=()=>voice?.toggleMute();
$('text-form').onsubmit=event=>{event.preventDefault();void sendTextMessage($<HTMLTextAreaElement>('message').value);};
$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('text-form').dispatchEvent(new Event('submit',{cancelable:true}));}});
async function signIn(provider='google',capabilities:string[]=[]){
  try{notice('');const data=await api(`/api/auth/start/${provider}`,{capabilities,...(capabilities.length?{tenantId}:{})});
    const url=new URL(data.url);if(!['accounts.google.com','login.microsoftonline.com','accounts.zoho.com'].includes(url.hostname))throw new Error('Unexpected sign-in destination.');location.assign(url.href);
  }catch(error){notice((error as Error).message);}
}
$('sign-in').onclick=()=>signIn();
$('sign-in-microsoft').onclick=()=>signIn('microsoft');
$('chat-google-sign-in').onclick=()=>signIn();
$('chat-microsoft-sign-in').onclick=()=>signIn('microsoft');
$('logout').onclick=async()=>{endWorkspaceAccess();try{await api('/api/auth/sign-out',{});location.reload();}catch{$('status').textContent='Sign-out could not finish. Reload to check your account.';}};
async function account(){
  if(!loggedIn||accessEnded)return;
  if(membershipRole==='billing'){show('billing');return;}
  routineCard.hidden=!canManage();if(canManage())void refreshRoutine();
  emailCard.hidden=!canManage();if(canManage())void refreshEmailPreference();
  phoneCard.hidden=!canManage();
  const memory=await api(`/api/businesses/${tenantId}/profile`);
  if(memory.profile.name)permissionDetail.textContent=`${memory.profile.name} · ${membershipRole}`;
  $('profile').replaceChildren();
  // Single source of truth: the same onboardingProgress() the chat panel uses.
  if(memory.progress&&!memory.progress.basicsComplete){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent='Business profile';
   const done=7-memory.progress.missing.length;
   dd.textContent=`${done} of 7 complete. Still to go: ${memory.progress.missing.join(', ')}. Continue setup by talking to The Mayor.`;
   $('profile').append(dt,dd);
  }
  for(const [key,value] of Object.entries(memory.profile)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key.replace(/([A-Z])/g,' $1');dd.textContent=Array.isArray(value)?value.join(', '):String(value);$('profile').append(dt,dd);}
  const cited=Object.entries(memory.sources??{}).filter(([,source]:[string,any])=>source.kind==='website_owner_confirmed');
  if(cited.length){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent='Confirmed website sources';
    for(const [field,value] of cited){const source=value as any,line=document.createElement('p'),link=document.createElement('a');link.textContent=field.replace(/([A-Z])/g,' $1');
      try{const url=new URL(source.url);if(url.protocol==='https:')link.href=url.href;}catch{}
      link.target='_blank';link.rel='noopener noreferrer';line.append(link,document.createTextNode(`: ${source.quote}`));dd.append(line);}
    $('profile').append(dt,dd);
  }
  const rules=await api(`/api/businesses/${tenantId}/scheduling-policy`);
  if(rules.policy){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent='Confirmed scheduling rules';
    const p=rules.policy;
    const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const time=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
    const lines=[`Time zone: ${p.timeZone}`,...p.weeklyHours.map((h:any)=>`${days[h.day]} ${time(h.startMinute)}–${time(h.endMinute)}`),...p.appointmentTypes.map((t:any)=>`${t.name}: ${t.durationMinutes} minutes, ${t.bufferBeforeMinutes} minutes before / ${t.bufferAfterMinutes} after`),`Booking notice: ${p.minimumNoticeMinutes} minutes. Book up to ${p.maximumAdvanceDays} days ahead. Cancellation notice: ${p.cancellationNoticeMinutes} minutes.`,...p.staff.map((s:any)=>`${s.name}: ${s.appointmentTypes.join(', ')}; ${s.weeklyHours.map((h:any)=>`${days[h.day]} ${time(h.startMinute)}–${time(h.endMinute)}`).join(', ')}`),`Closed dates: ${p.closedDates.join(', ')||'None configured'}`];
    for(const line of lines){const text=document.createElement('p');text.textContent=line;dd.append(text);}$('profile').append(dt,dd);
  }
  if(!rules.policy&&rules.setup?.revision){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent='Scheduling setup · not active';
    for(const line of [...rules.setup.lines,rules.setup.readyForReview?'All required details collected. Ask The Mayor to review and activate your booking rules.':`${rules.setup.nextQuestion} Continue setup by talking to The Mayor.`]){const text=document.createElement('p');text.textContent=line;dd.append(text);}
    $('profile').append(dt,dd);
  }
  if(!canManage())return;
  // Optional phone setup cannot delay or prevent Calendar/Gmail controls.
  if(phoneCard.open)void loadPhoneAccount();

}
function show(tab:WorkdayView){
  if(accessEnded)return;
  voiceHelp.open=false;
  workday.show(tab);
  chatKeyboard.sync();
  if(tab==='chat'&&!conversationPositioned)requestAnimationFrame(()=>{if(document.body.dataset.view==='chat')transcripts();});
  if(tab==='account')account().catch(error=>notice(error.message));
  if(tab==='connections'&&canManage())void connectionHub.activate().catch(error=>notice(error.message));
}
async function init(){
  $('open-connections').hidden=true;$('open-connections').closest<HTMLElement>('.account-card')!.hidden=true;
  const capabilities=await api('/api/auth/capabilities');
  if(!capabilities.providers.google.configured){
    $<HTMLButtonElement>('sign-in').disabled=true;
    $<HTMLButtonElement>('chat-google-sign-in').disabled=true;
    $<HTMLButtonElement>('today-sign-in').disabled=true;
    $('voice-hint').textContent='Google sign-in is being connected. Voice onboarding will be available after setup.';
  }
  if(!capabilities.providers.microsoft.configured){
    $<HTMLButtonElement>('sign-in-microsoft').disabled=true;
    $<HTMLButtonElement>('chat-microsoft-sign-in').disabled=true;
    $<HTMLButtonElement>('today-microsoft-sign-in').disabled=true;
  }
  const session=await api('/api/auth/get-session');
  if(!session){if(new URLSearchParams(location.search).has('auth_error'))notice('Sign-in could not finish. Please try again.');return;}
  sessionUserId=session.user.id;loggedIn=true;$('sign-in').hidden=true;$('sign-in-microsoft').hidden=true;$('chat-sign-in').hidden=true;$('chat-empty').hidden=false;$('logout').hidden=false;$('user-detail').textContent=session.user.email;
  const businesses=await api('/api/businesses');
  let business=selectWorkspaceBusiness(businesses.businesses as Array<{id:string;name:string;role:string}>,new URLSearchParams(location.search).get('business'));
  if(!business){
    const created=await api('/api/businesses',{name:'My business'});
    // Read the actual membership; creation alone must not imply ownership.
    business=(await api('/api/businesses')).businesses.find((item:any)=>item.id===created.id);
  }
  if(!business)throw new Error('Your business membership is not available. Please contact the workspace owner.');
  tenantId=business.id;membershipRole=business.role;
  $('open-connections').hidden=!canManage();$('open-connections').closest<HTMLElement>('.account-card')!.hidden=!canManage();
  document.querySelector<HTMLElement>('.assistant-dock')!.hidden=!canChat();
  workday.ready(business.name,membershipRole);
  setupBusinessSwitcher(businesses.businesses as Array<{id:string;name:string;role:string}>,business.id);
  $('calendar-status').hidden=!canManage();
  calendarLauncher.hidden=!canManage();
  const connectionError=new URLSearchParams(location.search).get('auth_error');
  const connectedProvider=new URLSearchParams(location.search).get('connected');
  if(canManage()&&(connectedProvider==='telnyx'||connectionError==='telnyx_connection')){
    show('chat');$('conversation').setAttribute('open','');
    void api('/api/phone-guide?mode=existing&provider=telnyx').then(guide=>handleMessage({type:'phone_setup_guide',guide})).catch(()=>notice('Phone options could not load. Ask me to connect Telnyx to try again.'));
    notice(connectedProvider==='telnyx'?'Telnyx is connected. Choose your business number below. Calling still needs setup.':'The Telnyx connection did not finish. Try connecting again below.');
  }
  else if(canManage()&&connectedProvider&&['google','microsoft','zoho'].includes(connectedProvider)){void calendarChat.open(undefined,connectedProvider);$('conversation').setAttribute('open','');}
  else if(canManage()&&connectionError){notice('The calendar connection did not finish. Your existing business details are safe. Try connecting again below.');void calendarChat.open(undefined,connectionError.startsWith('zoho_')?'zoho':undefined);$('conversation').setAttribute('open','');}
  inbox.hidden=true;$('notifications-button').hidden=!canManage();if(canManage())void refreshInbox();
  if(canManage()&&new URLSearchParams(location.search).get('notifications')==='1'){inbox.hidden=false;inbox.open=true;}
  timezoneSuggestion.element.hidden=!canChat();timezoneSuggestion.ready(canChat());
  permissionDetail.textContent=`${business.name} · Role: ${membershipRole}. ${canManage()?'You can manage business details, scheduling, and connections.':canChat()?'You can talk to The Mayor and read business details. An owner or manager confirms business and scheduling changes.':membershipRole==='billing'?'You can manage the subscription and read shared usage in Plan & usage.':'You can read business details. Voice chat and connection management are not available for this role.'}`;
  phoneCard.hidden=!canManage();
  if(canChat()){if(!canManage())show('chat');const memory=await api(`/api/businesses/${tenantId}/profile`);confirmedProfile=memory.profile;await loadConversation();useBusinessProfile(memory.profile,memory.progress);void connect().catch(error=>{microphoneProblem=`Voice could not connect. Text chat is available. ${error.message}`;renderVoiceState();});}
  else{
    $('status').textContent='Account access';
    $('voice-hint').textContent=membershipRole==='billing'?'Your role manages the subscription and shared usage in Plan & usage.':'Your role does not include voice or text chat. Business details are available in Account.';
    show(membershipRole==='billing'?'billing':'account');
  }
}
const retryStartup=document.createElement('button');retryStartup.type='button';retryStartup.className='secondary';retryStartup.textContent='Retry loading';retryStartup.hidden=true;composerStatus.after(retryStartup);
async function start(){if(accessEnded)return;retryStartup.hidden=true;try{await init();}catch(error){if(accessEnded)return;notice((error as Error).message);retryStartup.hidden=false;$('status').textContent='Could not load your workspace';}}
retryStartup.onclick=()=>void start();show('chat');void start();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
