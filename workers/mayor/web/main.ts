import {createElement,X,Camera} from 'lucide';
import {createTimeZoneSuggestion} from './time-zone';
import {createTextChat,readNdjsonTurn,applyTextOutcome,type TextTurnOutcome} from './text-chat';
import {createVoiceTranscriptMerge} from './voice-merge';
import {createConversationCardRegistry} from './conversation-cards';
import {createCalendarChat} from './calendar-chat';
import {renderConnectorCard,isConnectorCardPayload} from './connector-cards';
import {createPullRefresh} from './pull-refresh';
import {bindChatKeyboardViewport,chatComposerHeightLimit} from './chat-keyboard-viewport';
import {MayorMicrophone} from './microphone-input';
import {VoiceClient} from '@cloudflare/voice/client';
import './style.css';
import './workspace.css';
import './workday.css';
import './proactive.css';
import {createWorkday,type WorkdayView} from './workday';
import {captureBillingIntent,dismissBillingIntent,hasBillingIntent,peekBillingIntent,takeBillingIntent} from './billing-intent';
import {createConnections} from './connections';
import {createVoiceDiagnostics} from './voice-diagnostics';
import {createVoiceHealth} from './voice-health';
import {createVoiceCall,voiceUnavailableNotice} from './voice-call';
import {createVoiceConsentStore,showVoiceConsentSheet} from './voice-consent';
import {bindVoiceAccessRecovery,createAccessRecoveryView} from './voice-access-recovery';
import {createBusinessWorkspace,playSoundCheck} from './business-workspace';
import {createWorkspaceAccessGuard,workspaceAccessWasRejected,selectWorkspaceBusiness} from './workspace-access';
import {assistantName,assistantGreeting} from '../src/assistant-persona';
import {namingGreeting,validateBusinessName} from './business-naming';
import {VERTICAL_PROFILES} from '../src/verticals';
import {verticalMappingNote} from '../src/vertical-mapping';
import {createPlacesOnboarding} from './places-onboarding';
import {loadOfferBlock} from './offer-loader';
import {loadTrendpost} from './trendpost-loader';
import {loadConnectorSessions} from './connector-sessions-loader';
import {loadAccountCards} from './account-cards-loader';
import {mountChatApp,pushChatApp,type ChatAppSnapshot} from './chat-app';
import type {TranscriptRow} from './transcript-list';
import {loadNotificationsInbox} from './notifications-inbox-loader';
import {mountDeskStrip,pushDeskStrip,type DeskSnapshot} from './desk-loader';
import type {DeskIntent} from './desk/intents';
import './mobile-compact.css';
import './desk.css';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
function resizeComposer(){const input=$<HTMLTextAreaElement>('message');input.style.height='auto';const keyboardHeight=document.body.dataset.chatKeyboard==='open'?parseFloat(document.body.style.getPropertyValue('--chat-viewport-height')):undefined;const limit=chatComposerHeightLimit(matchMedia('(max-width:760px)').matches,keyboardHeight,document.body.dataset.view==='chat'?window.innerHeight:undefined);input.style.height=`${Math.min(limit,Math.max(36,input.scrollHeight))}px`;input.style.overflowY=input.scrollHeight>limit?'auto':'hidden';}
$('message').addEventListener('input',resizeComposer);window.addEventListener('resize',resizeComposer);
const chatKeyboard=bindChatKeyboardViewport($<HTMLTextAreaElement>('message'),resizeComposer);
// Chat reenvision Slice 1: ONE React root (ChatApp) owns the chat view —
// presence bar, onboarding progress host, and the conversation section
// with the timeline. It mounts before anything looks up the elements it
// renders (#conversation, #transcript, #status, #onboarding-progress).
// The composer cluster renders from the same tree through a portal into
// the dock host below; the dock form itself is ported in Slice 3.
const composerHost=document.createElement('div');composerHost.style.display='contents';$('text-form').after(composerHost);
let chatSnapshot:ChatAppSnapshot={businessName:'',statusText:'Ready when you are',rows:[],assistantLabel:'The Mayor',earlierVisible:false,composer:{statusText:'',stopWaitingVisible:false,actionsHidden:false,newChatHidden:false,retryVisible:false}};
const chatCallbacks={onCopyFailed:()=>notice('Copy could not finish. Select the reply text to copy it.'),onStopWaiting:()=>textChat.cancel(),onNewChat:()=>void startNewChat(),onRetry:()=>void start(),
 // Chat reenvision Slice 2: history paging + in-flow turn actions.
 onEarlier:()=>void loadEarlier(),onCancelQueued:(turnId:string)=>textChat.cancelQueued(turnId),onRetryTurn:()=>{const outcome=textChat.retryFailed();if(outcome)void settleTextOutcome(outcome);},onDismissError:()=>textChat.dismissFailed()};
mountChatApp($('chat-app'),chatSnapshot,chatCallbacks,{composerHost});
function pushChatView(){pushChatApp(chatSnapshot);}
// ── The Desk strip (Reinvention Slice 1, blueprint §3.1) ────────────
// A React strip at the head of the home (chat) view: Morning Line +
// the intent stream (carried-intent Ribbon, completion Receipt,
// attention Lines, today's people), rendered from the primitive
// catalog in web/desk/. The strip is fed snapshots built here from
// state the shell already owns — the intent carrier (peeked, never
// consumed by rendering), the public catalog (price/seats, fail-quiet),
// the operations overview, and billing status (commitments). It
// fetches nothing on its own and writes nothing to the carrier.
interface DeskCatalog {foundingPriceLabel?:string;proPriceLabel?:string;seats?:{remaining:number;total:number}|null;soldOut?:boolean;packLabels?:Partial<Record<'small'|'medium'|'large',{name:string;priceLabel:string}>>;}
let deskCatalog:DeskCatalog={};
let deskOverview:any=null;
let deskBilling:any=null;
let deskEngineIntents:DeskIntent[]=[];
let deskIntentDismissed=false;
let deskMounted=false;
let deskDataAt=0;
let deskDataFlight:Promise<void>|null=null;
const deskMoneyExact=(cents:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);
const deskMoney=(cents:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
function deskRibbonIntent():DeskIntent|null{
 if(deskIntentDismissed)return null;
 const intent=peekBillingIntent();
 if(!intent)return null;
 if(intent.kind==='plan'&&intent.id==='founding'){
  if(deskCatalog.soldOut)return {id:'ribbon-founding',version:1,type:'intent-ribbon',planRef:'founding',state:'unhonorable',headline:'Founding just filled',detail:'Every founding seat is claimed. The standard plan is the way in now — same Mayor, standard price.',alternativeLabel:deskCatalog.proPriceLabel?`Pro — ${deskCatalog.proPriceLabel}/mo`:'Pro — the standard plan',summary:'Founding just filled. The standard plan is the way in now.'};
  return {id:'ribbon-founding',version:1,type:'intent-ribbon',planRef:'founding',state:'carried',headline:"Founding — you're headed here.",detail:loggedIn?'Continue and the billing dialog opens on this exact plan. Nothing to pay yet.':"We'll set up your shop first, then open this exact plan. Nothing to pay yet.",...(deskCatalog.foundingPriceLabel?{priceLabel:deskCatalog.foundingPriceLabel}:{}),seats:deskCatalog.seats??null,summary:"Founding — you're headed here. We'll set up your shop first, then open this exact plan."};
 }
 // rot551 fold C5: the summary-before-the-wall covers every carried
 // intent, not only founding — a Pro or pack buyer sees what they're
 // buying before authenticating to buy it. Same builder discipline:
 // catalog-fed labels only (fail-quiet — no label, no price), seats
 // never ride a non-founding Ribbon, and the carrier is only peeked.
 if(intent.kind==='plan'&&intent.id==='pro'){
  return {id:'ribbon-pro',version:1,type:'intent-ribbon',planRef:'pro',state:'carried',headline:"Pro — you're headed here.",detail:loggedIn?'Continue and the billing dialog opens on this exact plan. Nothing to pay yet.':"We'll set up your shop first, then open this exact plan. Nothing to pay yet.",...(deskCatalog.proPriceLabel?{priceLabel:`${deskCatalog.proPriceLabel}/mo`}:{}),summary:"Pro — you're headed here. We'll set up your shop first, then open this exact plan."};
 }
 if(intent.kind==='pack'){
  const pack=deskCatalog.packLabels?.[intent.id];
  const name=pack?`${pack.name} top-up`:'Top-up';
  return {id:`ribbon-pack-${intent.id}`,version:1,type:'intent-ribbon',planRef:'pack',packId:intent.id,state:'carried',headline:`${name} — you're headed here.`,detail:loggedIn?'Continue and the billing dialog opens on this exact top-up. Nothing to pay yet.':"We'll set up your shop first, then open this exact top-up. Nothing to pay yet.",...(pack?{priceLabel:pack.priceLabel}:{}),summary:`${name} — you're headed here. We'll set up your shop first, then open this exact top-up.`};
 }
 return null;
}
function deskIntents():DeskIntent[]{
 const intents:DeskIntent[]=[];
 const ribbon=deskRibbonIntent();if(ribbon)intents.push(ribbon);
 if(!loggedIn)return intents;
 const commitment=Array.isArray(deskBilling?.commitments)?deskBilling.commitments.find((row:any)=>row?.kind==='purchase_intent'&&row?.status==='fulfilled'):null;
 if(commitment)intents.push({id:`receipt-${commitment.id}`,version:1,type:'receipt',text:commitment.plan_ref==='founding'?"Founding — you're in.":'Your plan is active.',detail:`${deskMoneyExact(Number(commitment.amount_cents??0))}/mo · locked for life while this subscription stays active.`,summary:"Founding — you're in. Your founding price is locked for life while this subscription stays active."});
 if(deskOverview){
  for(const item of (deskOverview.attention??[]).slice(0,3))intents.push({id:`attention-${item.id}`,version:1,type:'line',text:`${item.title} — ${item.detail}`,summary:`${item.title} — ${item.detail}`});
  for(const appt of (deskOverview.appointments??[]).slice(0,3)){
   const title=appt?.input?.title??appt?.title??'Appointment';
   const name=appt?.customer?.name??appt?.customerName??'';
   intents.push({id:`appt-${appt?.id??title}`,version:1,type:'person',name:name||title,context:name?title:undefined,state:'known',summary:name?`${name} — ${title}`:title});
  }
 }
 // Slice 2: the engine's cards merge AFTER the snapshot's own
 // intents. An engine fetch failure leaves this empty — the Desk
 // keeps working without engine intents (see loadDeskData).
 intents.push(...deskEngineIntents);
 if(!intents.length)intents.push({id:'desk-empty',version:1,type:'empty',text:'Nothing needs you right now.',summary:'Nothing needs you right now.'});
 return intents;
}
function deskSnapshotNow():DeskSnapshot{
 const counts=deskOverview?.counts;
 return {signedIn:loggedIn,businessName:chatSnapshot.businessName||'The Mayor',statusLine:chatSnapshot.statusText,stats:loggedIn&&counts?[{label:'Bookings today',value:String(counts.appointmentsToday??0)},{label:'Waiting on you',value:String(counts.attention??0)},{label:'Open tasks',value:String(counts.tasksOpen??0)}]:undefined,intents:deskIntents()};
}
function refreshDesk(){
 const snapshot=deskSnapshotNow();
 if(!deskMounted){deskMounted=true;mountDeskStrip($('desk-root'),snapshot,{onDismissIntent:()=>{deskIntentDismissed=true;dismissBillingIntent();stripIntentParams();refreshDesk();},onActionVerb:(actionId:string,verb:'approve'|'dismiss'|'edit',text?:string)=>{void deskActionVerb(actionId,verb,text);},onRuleScenario:(scenarioId:string,allowed:boolean)=>{void deskRuleScenario(scenarioId,allowed);},onRevokeGrant:(grantId:string)=>{void deskRevokeGrant(grantId);}});}
 else pushDeskStrip(snapshot);
 // Name the intent inside the auth surface too (blueprint §2.1 E-0):
 // the sign-in block carries the plan line while signed out — founding
 // since Slice 1; rot551 fold C5 extends the same line to the Pro and
 // pack intents, same fail-quiet discipline (no catalog label, no price).
 const line=$('signin-intent-line');
 if(line){
  const intent=peekBillingIntent();
  if(!loggedIn&&intent&&!deskIntentDismissed&&intent.kind==='plan'&&intent.id==='founding'){
   line.textContent=deskCatalog.foundingPriceLabel?`Founding — you're headed here. Sign in and we'll open the Founding plan you chose — ${deskCatalog.foundingPriceLabel}.`:"Founding — you're headed here. Sign in and we'll open the Founding plan you chose.";
   line.hidden=false;
  }else if(!loggedIn&&intent&&!deskIntentDismissed&&intent.kind==='plan'&&intent.id==='pro'){
   line.textContent=deskCatalog.proPriceLabel?`Pro — you're headed here. Sign in and we'll open the Pro plan you chose — ${deskCatalog.proPriceLabel}/mo.`:"Pro — you're headed here. Sign in and we'll open the Pro plan you chose.";
   line.hidden=false;
  }else if(!loggedIn&&intent&&!deskIntentDismissed&&intent.kind==='pack'){
   const pack=deskCatalog.packLabels?.[intent.id];
   const name=pack?`${pack.name} top-up`:'Top-up';
   line.textContent=pack?`${name} — you're headed here. Sign in and we'll open the top-up you chose — ${pack.priceLabel}.`:`${name} — you're headed here. Sign in and we'll open the top-up you chose.`;
   line.hidden=false;
  }else line.hidden=true;
 }
}
function stripIntentParams(){
 try{
  const url=new URL(location.href);
  if(!url.searchParams.has('plan')&&!url.searchParams.has('pack'))return;
  url.searchParams.delete('plan');url.searchParams.delete('pack');
  history.replaceState(history.state,'',url.toString());
 }catch{/* the carrier is already consumed; the param is inert */}
}
async function loadDeskCatalog(){
 try{
  const response=await fetch('/api/billing/catalog');
  if(!response.ok)return;
  const catalog=await response.json() as any;
  const founding=catalog?.founding;
  const pro=(catalog?.plans??[]).find((plan:any)=>plan.id==='pro');
  // rot551 fold C5: pack labels ride the same catalog read, so the
  // pre-auth summary can name a carried top-up and its one-time price.
  // Fail-quiet per pack: a malformed entry is dropped, never guessed.
  const packLabels:DeskCatalog['packLabels']={};
  for(const pack of (catalog?.creditPacks??[])){
   if(!pack||(pack.id!=='small'&&pack.id!=='medium'&&pack.id!=='large')||typeof pack.priceCents!=='number')continue;
   packLabels[pack.id]={name:typeof pack.name==='string'&&pack.name?pack.name:pack.id,priceLabel:`${deskMoney(pack.priceCents)} one-time`};
  }
  deskCatalog={
   ...(typeof catalog?.foundingPriceCents==='number'?{foundingPriceLabel:`${deskMoneyExact(catalog.foundingPriceCents)}/mo · locked for life`}:{}),
   ...(pro?{proPriceLabel:deskMoney(pro.priceCents)}:{}),
   seats:founding?.available&&typeof founding.seats_remaining==='number'?{remaining:founding.seats_remaining,total:founding.seats_total}:null,
   soldOut:Boolean(founding?.available&&founding.seats_remaining===0),
   ...(Object.keys(packLabels).length?{packLabels}:{}),
  };
 }catch{/* fail-quiet: the Ribbon renders with no price and no count */}
 refreshDesk();
}
async function loadDeskData(force=false){
 if(!tenantId)return;
 if(!force&&Date.now()-deskDataAt<15000)return;
 if(deskDataFlight)return deskDataFlight;
 deskDataFlight=(async()=>{
  try{
   const [overview,billing,engine]=await Promise.all([api(`/api/businesses/${tenantId}/overview`).catch(()=>null),api(`/api/businesses/${tenantId}/billing`).catch(()=>null),api(`/api/businesses/${tenantId}/engine/desk`).catch(()=>null)]);
   if(overview)deskOverview=overview;
   if(billing)deskBilling=billing;
   // Fail-quiet: a failed engine fetch keeps the last known engine
   // intents (initially none) and never surfaces an error — the
   // Desk works without the engine.
   if(engine&&Array.isArray(engine.intents))deskEngineIntents=engine.intents as DeskIntent[];
   deskDataAt=Date.now();
   refreshDesk();
  }finally{deskDataFlight=null;}
 })();
 return deskDataFlight;
}
/** Re-read the engine's Desk intents after a card verb resolves and
 * re-push the snapshot. Degrades quietly on failure, like the load. */
async function refreshEngineDeskIntents(){
 if(!tenantId)return;
 try{
  const engine=await api(`/api/businesses/${tenantId}/engine/desk`);
  if(engine&&Array.isArray(engine.intents))deskEngineIntents=engine.intents as DeskIntent[];
 }catch{/* fail-quiet: the Desk keeps its current intents */}
 refreshDesk();
}
async function deskActionVerb(actionId:string,verb:'approve'|'dismiss'|'edit',text?:string){
 try{await api(`/api/businesses/${tenantId}/engine/actions/${actionId}/${verb}`,verb==='edit'?{text:text??''}:{});}catch{/* the refetch below shows the card's true state */}
 await refreshEngineDeskIntents();
}
async function deskRuleScenario(scenarioId:string,allowed:boolean){
 try{await api(`/api/businesses/${tenantId}/engine/scenarios/${scenarioId}/rule`,{allowed});}catch{/* the refetch below shows the card's true state */}
 await refreshEngineDeskIntents();
}
async function deskRevokeGrant(grantId:string){
 try{await api(`/api/businesses/${tenantId}/engine/grants/${grantId}/revoke`,{});}catch{/* the refetch below shows the card's true state */}
 await refreshEngineDeskIntents();
}
// The signed-out home block is a static, server-injected subtree (the
// worker SSR-fills #offer-block in the served HTML). It joins the
// conversation section as the SAME live node — adopted, never
// re-rendered — so the signed-out home stays byte-identical.
const signInDonor=$('chat-sign-in-donor');$('conversation').prepend($('chat-sign-in'));signInDonor.remove();
/** The presence bar's status line is the #status source now: every former
 * $('status').textContent write routes through here. */
function setStatusText(text:string){chatSnapshot={...chatSnapshot,statusText:text};pushChatView();}
// Alerts must stay visible when the Account tab is open too.
let voice:VoiceClient|undefined, tenantId='', loggedIn=false, membershipRole='',sessionUserId='';
let voiceCall:ReturnType<typeof createVoiceCall>|undefined;
let accessEnded=false;
const workspaceAccess=createWorkspaceAccessGuard();
const accessRecovery=createAccessRecoveryView(()=>location.reload());
document.querySelector('header')!.after(accessRecovery.element);
const workspace=createBusinessWorkspace(text=>{if(historyReady&&!accessEnded){void sendTextMessage(text);}},()=>show('connections'),{onRefreshProfile:()=>void refreshBusinessProfile()});
const calendarChat=createCalendarChat({api,tenant:()=>tenantId,signIn,followup:text=>void sendTextMessage(text)});
$('conversation').after(calendarChat.element);
const calendarLauncher=document.createElement('button');calendarLauncher.type='button';calendarLauncher.className='quiet calendar-launcher';calendarLauncher.textContent='Calendar settings';calendarLauncher.hidden=true;
calendarLauncher.onclick=()=>{show('chat');void calendarChat.open();};calendarChat.element.after(calendarLauncher);
$('account-view').append(workspace.element);
const usageStatus=document.createElement('p');usageStatus.id='usage-status';usageStatus.className='privacy-note';usageStatus.textContent='';
$('text-form').after(usageStatus);
const soundCheck=document.createElement('button');soundCheck.type='button';soundCheck.className='sound-check';soundCheck.textContent='Check speaker sound';
soundCheck.onclick=async()=>{soundCheck.disabled=true;try{await playSoundCheck();notice('Did you hear the tone? If not, check your speaker volume and whether this tab is muted. Then choose Talk to The Mayor.');}catch{notice('Audio could not start here. Open mayor.mehyar.us in your regular browser and try the sound check again.');}finally{soundCheck.disabled=false;}};
const voiceHelp=document.createElement('details');voiceHelp.className='voice-help';
const voiceHelpSummary=document.createElement('summary');voiceHelpSummary.setAttribute('aria-label','Voice help');voiceHelpSummary.setAttribute('aria-controls','voice-help-panel');voiceHelpSummary.title='Voice help';
const helpIcon=document.createElement('i');helpIcon.dataset.lucide='circle-help';helpIcon.setAttribute('aria-hidden','true');voiceHelpSummary.append(helpIcon);
const voiceHelpContent=document.createElement('div');voiceHelpContent.id='voice-help-panel';voiceHelpContent.className='voice-help-content';voiceHelpContent.append($('voice-hint'),soundCheck);
voiceHelp.append(voiceHelpSummary,voiceHelpContent);document.querySelector('.header-actions')!.append(voiceHelp);
voiceHelp.addEventListener('keydown',event=>{if(event.key==='Escape'&&voiceHelp.open){event.preventDefault();voiceHelp.open=false;voiceHelpSummary.focus();}});
// 6i voice consent: first-use disclosure for the in-PWA owner<->assistant voice
// chat (AI identity + audio never stored + transcript saved like typed messages).
// Per-device, no D1 migration; withdrawable anytime from this panel.
const voiceConsent=createVoiceConsentStore();
let consentSheetCleanup:(()=>void)|undefined;
const closeConsentSheet=()=>{consentSheetCleanup?.();consentSheetCleanup=undefined;};
function openVoiceConsentSheet(mode:'first-run'|'review'){
 closeConsentSheet();
 consentSheetCleanup=showVoiceConsentSheet({mode,
  onAccept:async()=>{voiceConsent.grant();closeConsentSheet();await startVoiceCall();},
  onDecline:()=>{closeConsentSheet();notice('No problem — you can still type below. Tap the mic anytime to try voice.');renderVoiceState();},
  onWithdraw:()=>{voiceConsent.withdraw();closeConsentSheet();notice('Voice choice cleared. You will be asked again the next time you tap the mic.');},
 });
}
const voicePrivacy=document.createElement('button');voicePrivacy.type='button';voicePrivacy.className='secondary';voicePrivacy.textContent='Voice privacy';
voicePrivacy.onclick=()=>openVoiceConsentSheet('review');voiceHelpContent.append(voicePrivacy);
// New chat control in the Assistant view header (visible on the chat view only,
// desktop and mobile). Starts a fresh conversation thread; past history is
// archived server-side, never deleted. Keyboard-operable with visible focus.
const newChatHeader=document.createElement('button');newChatHeader.type='button';newChatHeader.id='new-chat';newChatHeader.className='secondary';newChatHeader.textContent='New chat';newChatHeader.setAttribute('aria-label','Start a new conversation');newChatHeader.hidden=true;newChatHeader.onclick=()=>void startNewChat();document.querySelector('.header-actions')!.append(newChatHeader);
const micLevel=document.createElement('meter');micLevel.id='mic-level';micLevel.min=0;micLevel.max=1;micLevel.value=0;micLevel.hidden=true;micLevel.setAttribute('aria-label','Microphone input level');soundCheck.after(micLevel);
const canManage=()=>!accessEnded&&['owner','manager'].includes(membershipRole);
const canChat=()=>!accessEnded&&(namingMode||['owner','manager','staff'].includes(membershipRole));
const connectionHub=createConnections({api,tenant:()=>tenantId,actor:()=>sessionUserId,canManage,onConnect:(provider,capabilities)=>signIn(provider,capabilities),onCalendar:provider=>{show('chat');void calendarChat.open(undefined,provider);},onAccount:()=>show('account'),ask:text=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value=text;resizeComposer();input.focus();},pendingProviders:[{id:'facebook',label:'Facebook & Instagram',status:'App review pending'}]});
$('connections-content').append(connectionHub.element);
$('open-connections').onclick=()=>show('connections');
const workday=createWorkday({api,tenant:()=>tenantId,actor:()=>sessionUserId,canManage,canChat,onNavigate:show,ask:text=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value=text;resizeComposer();input.focus();},onNotice:message=>notice(message),onChanged:()=>void refreshInbox(),onSignIn:()=>void signIn()});
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-prompt]'))button.onclick=()=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value=button.dataset.prompt??'';resizeComposer();input.focus();};
// Homepage sell-first rework (rot564, 2026-10-22): the home carries ONE
// sign-in block — the chat welcome's OAuth pair. The header button and
// the Today panel's start button route the visitor to that block (the
// start flow's landing: panel in view, primary button focused) instead
// of carrying duplicate OAuth pairs of their own.
const goToSignInBlock=()=>{show('chat');$('chat-sign-in').scrollIntoView({block:'center'});$<HTMLButtonElement>('chat-google-sign-in').focus({preventScroll:true});};
$('today-start').onclick=()=>goToSignInBlock();
$('calendar-status').onclick=()=>{show('connections');$('connections-heading').focus();};
$('dock-voice-label').onclick=()=>{show('chat');$('talk').click();};
// React migration S2c: the notifications inbox renders via React from
// this snapshot; fetching, label logic, and navigation stay here.
const inboxHost=document.createElement('div');inboxHost.style.display='contents';$('notice').after(inboxHost);
interface InboxItemView{id:string;title:string;message:string;actionLabel:string;unread:boolean;destination:'today'|'tasks'|'chat'|'missed-calls'|'account';anchor:string}
let inboxSnapshot:{hidden:boolean;open:boolean;summaryText:string;statusText:string;items:InboxItemView[];hasMore:boolean;showReconnect:boolean;refreshDisabled:boolean;markingReadId:string|null}={hidden:true,open:false,summaryText:'Notifications',statusText:'',items:[],hasMore:false,showReconnect:false,refreshDisabled:false,markingReadId:null};
function pushInbox(){loadNotificationsInbox(inboxHost,{...inboxSnapshot,onToggle:(open)=>{inboxSnapshot={...inboxSnapshot,open};if(open)void refreshInbox();},onRefresh:()=>void refreshInbox(),onItemAction:(item)=>inboxItemAction(item),onMarkRead:(item)=>void markInboxRead(item),onReconnect:()=>{show('connections');$('connections-heading').focus();}});}
let inboxLoading=false;
async function refreshInbox(){
 if(!tenantId||!canManage())return;
 if(inboxLoading)return;
 inboxLoading=true;inboxSnapshot={...inboxSnapshot,refreshDisabled:true,statusText:'Checking your business profile and saved calendar connection\u2026'};pushInbox();
 try{
  // api() already bounds requests at 15s: a hanging provider check can never
  // leave the button permanently disabled. The finally below always re-enables.
  const result=await api(`/api/businesses/${tenantId}/notifications/refresh`,{});
  const unread=result.notifications.filter((item:any)=>!item.read).length;
  const items:InboxItemView[]=result.notifications.map((item:any)=>{
   const destination=item.action==='today'||item.action==='briefing'||item.action==='suggestions'?'today':item.action==='tasks'?'tasks':item.action==='chat'?'chat':item.action==='missed-calls'?'missed-calls':'account';
   // Real backend kinds (src/notifications.ts): action 'briefing' | 'suggestions'
   // deep-link into the Today proactive sections; a future item.anchor
   // ('briefing'|'suggestions'|'roi'|'suggestion:<cardId>') overrides either.
   const anchor=typeof item.anchor==='string'&&item.anchor?item.anchor:item.action==='briefing'?'briefing':item.action==='suggestions'?'suggestions':'';
   const anchorLabel=anchor==='briefing'?'Open morning briefing':anchor==='suggestions'?'Open suggestions':anchor==='roi'?'Open ROI dashboard':anchor.startsWith('suggestion')?'Open suggestion':undefined;
   const actionLabel=anchorLabel??(destination==='today'?'Open agent report':destination==='tasks'?'Open business playbook':destination==='account'?'Review account':destination==='missed-calls'?'Review missed call':'Talk to '+assistantName(confirmedProfile));
   return {id:item.id,title:item.title,message:item.message,actionLabel,unread:!item.read,destination,anchor};
  });
  inboxSnapshot={...inboxSnapshot,summaryText:`Notifications${unread?` (${unread} unread)`:''}`,statusText:result.notifications.length?'Account items needing attention. Manage recurring checks and email alerts in Account.':'No account alerts are open. Manage recurring checks and email alerts in Account.',items,hasMore:Boolean(result.hasMore),showReconnect:false};pushInbox();
 }catch(error){
  const message=error instanceof Error?error.message:'Notifications could not be checked. Try again.';
  // Never a dead end: on calendar/connection failures offer the reconnect path.
  inboxSnapshot={...inboxSnapshot,summaryText:'Notifications',statusText:message,items:[],hasMore:false,showReconnect:/calendar|connection|verify|reconnect/i.test(message)};pushInbox();
 }finally{inboxLoading=false;inboxSnapshot={...inboxSnapshot,refreshDisabled:false};pushInbox();}
}
function inboxItemAction(item:InboxItemView){inboxSnapshot={...inboxSnapshot,open:false};pushInbox();const destination=item.destination,anchor=item.anchor;if(destination==='missed-calls'){show('today');workday.openMissedCalls();return;}if(destination==='tasks'){workday.openTasks();return;}const target=anchor==='roi'?'feed':destination;show(target);if(anchor&&(target==='today'||target==='feed'))workday.proactive.highlight(anchor);else(target==='today'?$('today-heading'):target==='feed'?$('feed-heading'):target==='account'?$('account-heading'):$('talk')).focus();}
async function markInboxRead(item:InboxItemView){inboxSnapshot={...inboxSnapshot,markingReadId:item.id};pushInbox();try{await api(`/api/businesses/${tenantId}/notifications/${item.id}/read`,{});inboxSnapshot={...inboxSnapshot,markingReadId:null};await refreshInbox();}catch(error){inboxSnapshot={...inboxSnapshot,markingReadId:null,statusText:error instanceof Error?error.message:'Could not mark this notification read.'};pushInbox();}}
$('notifications-button').onclick=()=>{const hidden=!inboxSnapshot.hidden;inboxSnapshot={...inboxSnapshot,hidden,open:!hidden};pushInbox();};
// React migration S2a: the Settings account cards (recurring check, email
// notifications, Business agent) render via React from these snapshots;
// fetching and actions stay here. The host uses display:contents so the
// cards sit in the account view exactly where the imperative ones did.
const accountCardsHost=document.createElement('div');accountCardsHost.style.display='contents';$('logout').before(accountCardsHost);
let accountCardsVisible=false;
let routineSnapshot={stateText:'',pauseVisible:false,pauseDisabled:false};
let emailSnapshot={statusText:'',toggleLabel:'',toggleVisible:false,toggleDisabled:true};
let emailsEnabled=false;
function pushAccountCards(){loadAccountCards(accountCardsHost,{visible:accountCardsVisible,routine:routineSnapshot,email:emailSnapshot,onPauseCheck:()=>void pauseRoutine(),onTalkAboutCheck:()=>{show('chat');$('talk').focus();},onToggleEmail:()=>void toggleEmail(),onOpenAgent:()=>workday.openBusinessAgent()});}
async function refreshRoutine(){
 if(!canManage())return;routineSnapshot={stateText:'Loading your check\u2026',pauseVisible:false,pauseDisabled:false};pushAccountCards();
 try{
  const check=await api(`/api/businesses/${tenantId}/recurring-check`);
  const schedule=check.schedule;
  const parts=[check.enabled?'Enabled':check.revision?'Paused':'Not set up'];
  if(schedule)parts.push(`${schedule.frequency==='daily'?'Daily':'Weekdays'} at ${String(schedule.hour).padStart(2,'0')}:${String(schedule.minute).padStart(2,'0')} \u00b7 ${schedule.timeZone}`);
  if(check.running)parts.push('A check is in progress');
  else if(check.nextRunAt)parts.push(`Next check after: ${new Date(check.nextRunAt).toLocaleString(undefined,{timeZone:schedule.timeZone})} (${schedule.timeZone})`);
  if(check.lastRunAt)parts.push(`Last attempt: ${new Date(check.lastRunAt).toLocaleString()} \u00b7 ${check.lastStatus==='ok'?'Completed':'Could not finish; review Notifications'}`);
  else parts.push('No completed attempts yet.');
  routineSnapshot={stateText:parts.join('. '),pauseVisible:Boolean(check.enabled),pauseDisabled:false};pushAccountCards();
 }catch(error){routineSnapshot={...routineSnapshot,stateText:error instanceof Error?error.message:'Could not load your recurring check.'};pushAccountCards();}
}
async function pauseRoutine(){routineSnapshot={...routineSnapshot,pauseDisabled:true};pushAccountCards();try{await api(`/api/businesses/${tenantId}/recurring-check/pause`,{});await refreshRoutine();}catch(error){routineSnapshot={...routineSnapshot,stateText:error instanceof Error?error.message:'Could not pause the check.',pauseDisabled:false};pushAccountCards();}}
async function refreshEmailPreference(){
 if(!canManage())return;emailSnapshot={statusText:'Loading email preferences\u2026',toggleLabel:emailSnapshot.toggleLabel,toggleVisible:false,toggleDisabled:true};pushAccountCards();
 try{
  const preference=await api(`/api/businesses/${tenantId}/email-preferences`);emailsEnabled=preference.enabled;
  const states:Record<string,string>={pending:'A notification email is queued.',sending:'An email is being submitted.',accepted:'The email provider accepted the latest message; inbox delivery is not confirmed.',uncertain:'The send outcome is unknown. It will not be automatically resent.',failed:'The latest email could not be sent.',cancelled:'The queued email was cancelled.'};
  emailSnapshot={statusText:preference.available?`${emailsEnabled?'Enabled':'Off'}${preference.email?` \u00b7 ${preference.email}`:' \u00b7 A verified sign-in email is required'}. ${preference.lastDelivery?states[preference.lastDelivery.state]??'':''}`:'Email sending is not configured yet.',toggleLabel:emailsEnabled?'Turn off email alerts':'Enable email alerts',toggleVisible:true,toggleDisabled:!emailsEnabled&&(!preference.available||!preference.email)};pushAccountCards();
 }catch(error){emailSnapshot={...emailSnapshot,statusText:error instanceof Error?error.message:'Could not load email preferences.'};pushAccountCards();}
}
async function toggleEmail(){emailSnapshot={...emailSnapshot,toggleDisabled:true};pushAccountCards();try{await api(`/api/businesses/${tenantId}/email-preferences`,{enabled:!emailsEnabled});await refreshEmailPreference();}catch(error){emailSnapshot={...emailSnapshot,statusText:error instanceof Error?error.message:'Could not save email preferences.',toggleDisabled:false};pushAccountCards();}}
// Harness entry point: goals, saved skills and the agent review schedule live
// in Today's Business agent section; Settings links there instead of
// duplicating the surface.

const permissionDetail=document.createElement('p');permissionDetail.id='permission-detail';
$('user-detail').after(permissionDetail);
const timezoneSuggestion=createTimeZoneSuggestion(text=>{show('chat');void sendTextMessage(text);});
$('logout').before(timezoneSuggestion.element);
const diagnostics=createVoiceDiagnostics();
const voiceHealth=createVoiceHealth(diagnostics);
$('account-view').append(voiceHealth.element);
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
// Crew 5 UX: true between sign-in and the owner naming their business. The
// app never auto-creates a nameless business — namingMode gates the composer
// so the owner's answer to "What's your business called?" becomes the name.
let namingMode=false;
let savedTranscript:Array<{role:string;text:string}>=[];
// Chat reenvision Slice 2 — history paging state. serverPrefix counts
// the leading savedTranscript rows that came from the server history
// (session/voice rows append after them); historyEarlier mirrors the
// server's hasMore for the loaded pages. The page size is a client
// choice within the server's persisted list — paging is real even
// though the persisted history itself is bounded (see the report).
const HISTORY_PAGE=20;
let serverPrefix=0,historyEarlier=false,earlierLoading=false;
let confirmedProfile:Record<string,unknown>={};
function composerPlaceholder(){const name=assistantName(confirmedProfile);return `Ask ${name.length<=14?name:'Mayor'}…`;}
const ONBOARDING_STEP_LABELS:Record<string,string>={name:'Business name',industry:'Industry',services:'Services',locations:'Locations',hours:'Hours',timeZone:'Time zone',staff:'Team',appointmentTypes:'Appointment length'};
// Crew 4 Places: Google listing lookup entry, mounted into the onboarding
// progress card below. Created after the phone card exists; see below.
let placesOnboarding:ReturnType<typeof createPlacesOnboarding>|undefined;
function renderOnboardingProgress(progress?:{missing:string[];basicsComplete:boolean;total?:number}){
 const el=$('onboarding-progress');el.replaceChildren();
 if(!progress||progress.basicsComplete){el.hidden=true;placesOnboarding?.reset();return;}
 const total=progress.total??7;
 const done=total-progress.missing.length;
 const bar=document.createElement('div');bar.className='op-bar';bar.setAttribute('role','progressbar');
 bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax',String(total));bar.setAttribute('aria-valuenow',String(done));
 bar.setAttribute('aria-label',`Business profile ${done} of ${total} complete`);
 const fill=document.createElement('div');fill.className='op-fill';fill.style.width=`${Math.round(done/total*100)}%`;bar.append(fill);
 const text=document.createElement('p');
 text.textContent=`Business profile: ${done} of ${total} complete. Still to go: ${progress.missing.map(field=>ONBOARDING_STEP_LABELS[field]??field).join(', ')}.`;
 const again=document.createElement('button');again.type='button';again.className='secondary';again.textContent='Continue setup';
 again.onclick=()=>{show('chat');const input=$<HTMLTextAreaElement>('message');input.value='Resume onboarding from my confirmed details. Ask one missing question.';resizeComposer();input.focus();};
 el.append(bar,text,again);
 // One-tap Google listing lookup as an alternative to the manual questions.
 placesOnboarding?.mount(el);
 el.hidden=false;
}
function useBusinessProfile(profile:Record<string,unknown>,progress?:{missing:string[];basicsComplete:boolean}){
 confirmedProfile=profile;workspace.profile(profile);renderOnboardingProgress(progress);
 const name=assistantName(profile);$<HTMLTextAreaElement>('message').placeholder=composerPlaceholder();resizeComposer();
 $('chat-view').querySelector<HTMLImageElement>('.portrait img')!.alt=name;
 if(typeof profile.name==='string'&&profile.name&&profile.name!==chatSnapshot.businessName){chatSnapshot={...chatSnapshot,businessName:profile.name};pushChatView();}
 if(!savedTranscript.length&&canChat())savedTranscript.push({role:'assistant',text:assistantGreeting(profile,canManage())});
 if(historyReady)transcripts();
}
/** Crew 4b — one-tap business profile refresh from the saved vertical.
 * Shows the owner exactly what would change (About + Industry only) and saves
 * nothing until the owner taps Save on the confirmation card. */
async function refreshBusinessProfile(){
 if(!loggedIn||accessEnded||!canManage())return;
 try{
  const preview=await api(`/api/businesses/${tenantId}/profile/refresh-preview`,{});
  if(!preview.changes||!preview.changes.length){notice('Your business profile already matches your business type.');return;}
  workspace.showRefreshConfirm(preview,async()=>{
   try{
    const updated=await api(`/api/businesses/${tenantId}/profile/refresh-confirm`,{revision:preview.revision});
    confirmedProfile=updated.profile;workspace.profile(updated.profile);workspace.hideRefreshConfirm();
    notice('Business profile refreshed from your business type.');
   }catch(error){notice(error instanceof Error?error.message:'Could not save the refreshed profile.');workspace.hideRefreshConfirm();}
  });
 }catch(error){notice(error instanceof Error?error.message:'Could not preview the profile refresh.');}
}
// React migration S2b: the composer cluster (status line, startup Retry,
// Stop waiting / New chat actions) renders via React from this snapshot;
// the text-chat engine and flows stay here. display:contents keeps the
// cluster in the composer column exactly where the elements sat.
let composerSnapshot={statusText:'',stopWaitingVisible:false,actionsHidden:false,newChatHidden:false,retryVisible:false};
function pushComposer(){chatSnapshot={...chatSnapshot,composer:{...composerSnapshot}};pushChatView();}
function setComposerStatus(text:string){composerSnapshot={...composerSnapshot,statusText:text};pushComposer();}
function setRetryVisible(visible:boolean){composerSnapshot={...composerSnapshot,retryVisible:visible};pushComposer();}
const textChat=createTextChat(async(text,requestId,signal,imageIds,stream)=>{
 const captured=workspaceAccess.capture();const endpoint=`/api/businesses/${tenantId}/conversation`;
 // Chat reenvision Slice 2: the client asks for the NDJSON stream. A
 // server (or intermediary) that cannot stream answers with the whole
 // reply as JSON exactly as before — detected by content type, never
 // assumed — so either deploy order is safe.
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-mayor-stream':'ndjson'},body:JSON.stringify({text,requestId,imageIds}),signal});
 workspaceAccess.assert(captured);
 if(!response.ok){
  const result=await response.json().catch(()=>({})) as {message?:string;error?:string};
  if(workspaceAccessWasRejected(endpoint,tenantId,loggedIn,result.error))endWorkspaceAccess();
  // The Plan & usage notice reflects genuine quota failures ONLY (402 /
  // allowance exhausted). A model or gateway failure (502) must never imply
  // the allowance is the problem.
  if(response.status===402&&typeof result.message==='string'&&result.message)usageStatus.textContent=result.message;
  const err=new Error(result.message??'Could not send. Your draft is still here.') as Error&{status?:number};
  err.status=response.status;throw err;
 }
 if((response.headers.get('content-type')??'').includes('application/x-ndjson')&&response.body)return await readNdjsonTurn(response.body,stream);
 return await response.json();
},(busy,message)=>{if(accessEnded)return;composerSnapshot={...composerSnapshot,statusText:message,stopWaitingVisible:busy};pushComposer();updateNetwork();renderVoiceState();},{
 serviceDownCopy:(status)=>status===502
  ?'The assistant couldn\u2019t reach the AI service — try again in a moment.'
  :undefined,
 // Streaming event frames render the moment they arrive, in their
 // turn's position; the whole-reply fallback's events arrive with the
 // result and are delivered by the engine on completion. Both paths
 // land in the same handler the voice socket uses.
 onEvent:event=>{if(!accessEnded)handleMessage(event);},
 onView:()=>{if(!accessEnded){transcripts();updateNetwork();}},
});
// Crew 6j — chat photo attach (mobile-first: camera + photo library).
// Photos upload first to tenant-scoped storage; the turn references the ids.
const MAX_CHAT_PHOTOS=2;
const attachedPhotos:{id:string;thumbUrl:string}[]=[];
const attachButton=document.createElement('button');
attachButton.type='button';attachButton.className='icon-button';attachButton.id='attach-photo';
attachButton.setAttribute('aria-label','Attach a photo');attachButton.disabled=true;
{const icon=createElement(Camera);icon.setAttribute('aria-hidden','true');attachButton.append(icon);}
$('send-message').before(attachButton);
const attachMenu=document.createElement('div');attachMenu.className='attach-menu';attachMenu.hidden=true;attachMenu.setAttribute('role','menu');
const takePhotoBtn=document.createElement('button');takePhotoBtn.type='button';takePhotoBtn.textContent='Take photo';takePhotoBtn.setAttribute('role','menuitem');
const libraryBtn=document.createElement('button');libraryBtn.type='button';libraryBtn.textContent='Photo library';libraryBtn.setAttribute('role','menuitem');
attachMenu.append(takePhotoBtn,libraryBtn);$('text-form').after(attachMenu);
const cameraInput=document.createElement('input');cameraInput.type='file';cameraInput.accept='image/*';cameraInput.setAttribute('capture','environment');cameraInput.hidden=true;cameraInput.tabIndex=-1;cameraInput.setAttribute('aria-hidden','true');
const libraryInput=document.createElement('input');libraryInput.type='file';libraryInput.accept='image/*';libraryInput.hidden=true;libraryInput.tabIndex=-1;libraryInput.setAttribute('aria-hidden','true');
document.body.append(cameraInput,libraryInput);
const photoChips=document.createElement('div');photoChips.className='photo-chips';photoChips.setAttribute('aria-live','polite');photoChips.hidden=true;
$('text-form').before(photoChips);
function renderPhotoChips(){
 photoChips.replaceChildren();
 for(const photo of attachedPhotos){
  const chip=document.createElement('span');chip.className='photo-chip';
  const img=document.createElement('img');img.src=photo.thumbUrl;img.alt='Attached photo';
  const remove=document.createElement('button');remove.type='button';remove.className='photo-chip-remove';remove.setAttribute('aria-label','Remove photo');remove.textContent='×';
  remove.onclick=()=>void removeAttachedPhoto(photo.id);
  chip.append(img,remove);photoChips.append(chip);
 }
 photoChips.hidden=!attachedPhotos.length;
}
async function downscalePhoto(file:File):Promise<Blob>{
 const bitmap=await createImageBitmap(file);
 const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);
 bitmap.close();
 const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
 if(!blob)throw new Error('That photo could not be read.');
 return blob;
}
async function uploadAttachedPhoto(file:File){
 if(attachedPhotos.length>=MAX_CHAT_PHOTOS){notice('Two photos max per message.');return;}
 if(!/^image\//.test(file.type)){notice('Send a photo file (JPEG, PNG, or WebP).');return;}
 try{
  setComposerStatus('Uploading photo…');
  const blob=await downscalePhoto(file);
  const form=new FormData();form.append('image',blob,'photo.jpg');
  const response=await fetch(`/api/businesses/${tenantId}/conversation/images`,{method:'POST',body:form});
  const result=await response.json();
  if(!response.ok)throw new Error(result.message??'Photo upload failed.');
  attachedPhotos.push({id:result.id,thumbUrl:URL.createObjectURL(blob)});
  renderPhotoChips();setComposerStatus('');
 }catch(error){setComposerStatus('');notice(error instanceof Error?error.message:'Photo upload failed.');}
}
async function removeAttachedPhoto(id:string){
 const index=attachedPhotos.findIndex(p=>p.id===id);
 if(index>=0){const [photo]=attachedPhotos.splice(index,1);URL.revokeObjectURL(photo.thumbUrl);renderPhotoChips();}
 try{await api(`/api/businesses/${tenantId}/conversation/images/delete`,{id});}catch{/* already gone server-side */}
}
function clearAttachedPhotos(){for(const photo of attachedPhotos)URL.revokeObjectURL(photo.thumbUrl);attachedPhotos.length=0;renderPhotoChips();}
attachButton.onclick=event=>{event.stopPropagation();attachMenu.hidden=!attachMenu.hidden;if(!attachMenu.hidden)takePhotoBtn.focus();};
document.addEventListener('click',event=>{if(!attachMenu.hidden&&!attachMenu.contains(event.target as Node)&&event.target!==attachButton)attachMenu.hidden=true;});
takePhotoBtn.onclick=()=>{attachMenu.hidden=true;cameraInput.click();};
libraryBtn.onclick=()=>{attachMenu.hidden=true;libraryInput.click();};
const onPhotoPicked=(input:HTMLInputElement)=>async()=>{const file=input.files?.[0];input.value='';if(file)await uploadAttachedPhoto(file);};
cameraInput.onchange=onPhotoPicked(cameraInput);
libraryInput.onchange=onPhotoPicked(libraryInput);
async function loadConversation(){
 const result=await api(`/api/businesses/${tenantId}/conversation?limit=${HISTORY_PAGE}`);
 savedTranscript=result.messages.map((m:any)=>({role:m.role,text:m.content}));serverPrefix=savedTranscript.length;historyEarlier=result.hasMore===true;
 if(!savedTranscript.length&&canChat())savedTranscript.push({role:'assistant',text:assistantGreeting(confirmedProfile,canManage())});voiceMerge.replacedByServer(voice?.transcript.length??0);clearConversationCards();historyReady=true;transcripts();updateNetwork();
}
/** Load the next older page of history and prepend it, keeping the
 * reading position anchored where it was. */
async function loadEarlier(){
 if(!historyReady||accessEnded||earlierLoading||!historyEarlier)return;
 earlierLoading=true;
 const list=$('transcript'),beforeHeight=list.scrollHeight,beforeTop=list.scrollTop;
 try{
  const result=await api(`/api/businesses/${tenantId}/conversation?limit=${HISTORY_PAGE}&before=${serverPrefix}`);
  const older=(result.messages as Array<{role:string;content:string}>).map(m=>({role:m.role,text:m.content}));
  if(older.length){savedTranscript=[...older,...savedTranscript];serverPrefix+=older.length;}
  historyEarlier=result.hasMore===true;
  transcripts();
  requestAnimationFrame(()=>{list.scrollTop=beforeTop+(list.scrollHeight-beforeHeight);});
 }catch{notice('Earlier messages could not load. Try again.');}
 finally{earlierLoading=false;}
}
/** Start a new chat: the server archives the current thread (past history is
 * preserved in the archive table, never deleted) and resets the live agent
 * thread; the client clears the transcript and re-renders the business-first
 * greeting via assistantGreeting, which leads with the saved business name. */
async function startNewChat(){
 if(!loggedIn||accessEnded)return;
 if(textChat.busy){notice('Your reply is still sending. Start a new chat once it finishes.');return;}
 if(textChat.pending){notice('You have a message waiting in this chat. Let it send, or cancel it, before starting a new chat.');return;}
 if(voiceCall?.active||voiceCall?.starting){notice('End the voice conversation before starting a new chat.');return;}
 notice('');
 try{
  await api(`/api/businesses/${tenantId}/conversation/reset`,{});
  textChat.reset();serverPrefix=0;historyEarlier=false;
  savedTranscript=[];
  if(canChat())savedTranscript.push({role:'assistant',text:assistantGreeting(confirmedProfile,canManage())});
  voiceMerge.replacedByServer(voice?.transcript.length??0);
  clearConversationCards();
  clearTranscriptRender();$('interim').textContent='';
  historyReady=true;transcripts();updateNetwork();
  show('chat');$('transcript').scrollTop=0;
  notice('Started a new conversation. Your earlier messages stay saved with this business.');
  $<HTMLTextAreaElement>('message').focus();
 }catch(error){notice(error instanceof Error?error.message:'Could not start a new chat. Your conversation is unchanged.');}
}
const pullStatus=document.createElement('div');pullStatus.className='pull-refresh-status';pullStatus.hidden=true;pullStatus.setAttribute('role','status');document.body.append(pullStatus);
const pullGesture=createPullRefresh();let pullBusy=false;
const pullGuard=()=>({allowed:matchMedia('(max-width:760px)').matches&&loggedIn&&!accessEnded&&navigator.onLine&&!document.querySelector('dialog[open]'),busy:pullBusy||textChat.busy||voiceCall?.active||voiceCall?.starting});
const resetPull=()=>{pullGesture.cancel();if(!pullBusy)pullStatus.hidden=true;};
window.addEventListener('touchstart',event=>{resetPull();const touch=event.touches[0];if(!touch)return;const target=event.target instanceof Element?event.target:null;const messageScroll=target?.closest('#transcript')?.scrollTop??0;pullGesture.start({x:touch.clientX,y:touch.clientY,id:touch.identifier,touches:event.touches.length,scrollY:Math.max(window.scrollY,messageScroll),interactive:Boolean(target?.closest('input,textarea,select,button,summary,a,dialog'))},pullGuard());},{passive:true});
window.addEventListener('touchmove',event=>{const touch=event.touches[0];if(!touch){resetPull();return;}const state=pullGesture.move({x:touch.clientX,y:touch.clientY,id:touch.identifier,touches:event.touches.length},pullGuard());if(state.preventDefault){event.preventDefault();pullStatus.hidden=false;pullStatus.textContent=state.phase==='armed'?'Release to refresh':'Pull to refresh';}else if(!pullBusy)pullStatus.hidden=true;},{passive:false});
window.addEventListener('touchcancel',resetPull,{passive:true});
window.addEventListener('touchend',event=>{if(!pullGesture.end(pullGuard(),event.touches.length)){if(!pullBusy)pullStatus.hidden=true;return;}pullBusy=true;updateNetwork();pullStatus.hidden=false;pullStatus.textContent='Refreshing…';void(async()=>{try{const view=document.body.dataset.view;if(view==='chat')await loadConversation();else if(view==='account')await account();else if(view==='connections')await connectionHub.activate();else await workday.refreshCurrent();}catch(error){if(!accessEnded)notice(error instanceof Error?error.message:'Could not refresh. Try again.');}finally{pullBusy=false;pullGesture.finish();pullStatus.hidden=true;updateNetwork();}})();},{passive:true});
async function settleTextOutcome(outcomePromise:Promise<TextTurnOutcome>){
 const outcome=await outcomePromise;
 if(accessEnded)return;
 // DEF-014: done AND stopped outcomes commit to the saved transcript
 // (applyTextOutcome owns the row shapes). A stopped turn's partial
 // is conversation history, not overlay vapor: once committed, the
 // engine's stopped overlay retires and the pair renders from the
 // saved model — surviving every later submit.
 const applied=applyTextOutcome(savedTranscript,outcome);
 if(outcome.status==='stopped')textChat.commitStopped();
 if(!applied)return;
 transcripts();
 if(outcome.status==='done')$('transcript').scrollTop=$('transcript').scrollHeight;
}
async function sendTextMessage(text:string){
 if(!loggedIn||!canChat()||!historyReady||accessEnded||pullBusy||!navigator.onLine)return;
 if(voiceCall?.active||voiceCall?.starting){notice('End the voice conversation before sending a typed message. Your draft is saved here.');return;}
 const input=$<HTMLTextAreaElement>('message');if(!text.trim())return;notice('');
 show('chat');
 // Crew 5 UX: the first message after sign-in (no business yet) IS the
 // business name — it creates the business, with that real name, once.
 if(namingMode){await claimBusinessName(text.trim());return;}
 const imageIds=attachedPhotos.map(p=>p.id);
 // Slice 2: submitting during a turn QUEUES the message (pending
 // bubble with cancel) instead of dropping it on the busy check that
 // used to sit in this guard.
 const outcome=textChat.submit(text.trim(),imageIds);
 if(!outcome)return;
 // The message is accepted the moment it is sent: the optimistic (or
 // queued) bubble IS the message, so the composer and the photo chips
 // clear at accept, not at completion. The turn carries the photo ids;
 // Try again reuses them.
 if(input.value.trim()===text.trim())input.value='';
 clearAttachedPhotos();resizeComposer();
 void settleTextOutcome(outcome);
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
  $<HTMLButtonElement>('attach-photo').disabled=!online||!historyReady||textChat.busy||pullBusy||!canChat();
  workspace.ready(online&&historyReady&&!textChat.busy&&!pullBusy&&!accessEnded);
  if(!online){voiceCall?.stop();$('interim').textContent='';}
}
/** Business pill: always shows the current business name in the header.
 * The chevron and dropdown are interactive only when 2+ businesses exist;
 * switching navigates with ?business=<id>; the server selects the tenant from the param. */
function setupBusinessSwitcher(businesses:Array<{id:string;name:string;role:string}>,currentId:string){
  const identity=document.querySelector<HTMLElement>('.business-identity');
  if(!identity)return;
  const current=businesses.find(b=>b.id===currentId);
  const currentName=current?.name??'your business';
  const nameEl=identity.querySelector('#business-name');
  if(nameEl&&current){nameEl.textContent=current.name;identity.title=current.name;}
  identity.setAttribute('aria-label',`Current business: ${currentName}${businesses.length>1?'. Activate to switch business.':''}`);
  if(businesses.length<2)return;
  identity.setAttribute('role','button');
  identity.setAttribute('tabindex','0');
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
// TEST ONLY simulator: record a fake missed call and simulate its text-back.
// Simulation writes local rows only — it never contacts a provider or sends a real SMS.
const missedCallSim=document.createElement('details');missedCallSim.className='account-card test-simulator';
const simSummary=document.createElement('summary');simSummary.textContent='TEST ONLY · Simulate a missed call';
const simIntro=document.createElement('p');simIntro.textContent='Record a fake missed call and simulate its text-back to watch the money loop end to end. Nothing is sent to a real phone. Use a fake test number.';
const simForm=document.createElement('form');
const simCaller=document.createElement('input'),simBusiness=document.createElement('input');
simCaller.type='tel';simCaller.required=true;simCaller.maxLength=16;simCaller.value='+15550131234';simCaller.autocomplete='off';
simBusiness.type='tel';simBusiness.required=true;simBusiness.maxLength=16;simBusiness.placeholder='+15550139876';simBusiness.autocomplete='off';
for(const [labelText,input] of [['Fake caller number',simCaller],['Fake business number',simBusiness]] as const){const label=document.createElement('label');label.textContent=labelText;label.append(input);simForm.append(label);}
const simGo=document.createElement('button');simGo.type='submit';simGo.className='secondary';simGo.textContent='Simulate missed call';
const simStatus=document.createElement('p');simStatus.setAttribute('role','status');
simForm.append(simGo,simStatus);
const simTextBack=document.createElement('button');simTextBack.type='button';simTextBack.className='secondary';simTextBack.textContent='Simulate text-back · no real SMS sent';simTextBack.hidden=true;
let simCallId='';
simForm.onsubmit=async event=>{event.preventDefault();simGo.disabled=true;simStatus.textContent='Recording the fake missed call…';simTextBack.hidden=true;
 try{const result=await api(`/api/businesses/${tenantId}/phone/test-missed-call`,{callerNumber:simCaller.value.trim(),businessNumber:simBusiness.value.trim()});
  simCallId=result.missedCall.id;simStatus.textContent='Fake missed call recorded. Now simulate its text-back.';simTextBack.hidden=false;}
 catch(error){simStatus.textContent=error instanceof Error?error.message:'The fake call could not be recorded.';}
 finally{simGo.disabled=false;}};
simTextBack.onclick=async()=>{simTextBack.disabled=true;
 try{await api(`/api/businesses/${tenantId}/phone/test-missed-call/${simCallId}/text-back`,{});
  simStatus.textContent='Simulated text-back recorded. Check Notifications.';simTextBack.hidden=true;
  notice('Simulated text-back recorded. Check Notifications.');await refreshInbox();}
 catch(error){simStatus.textContent=error instanceof Error?error.message:'The simulated text-back failed.';}
 finally{simTextBack.disabled=false;}};
missedCallSim.append(simSummary,simIntro,simForm,simTextBack);
phoneCard.append(missedCallSim);
// Crew 4 Places onboarding: the same TEST ONLY endpoints the simulator above
// uses (fake test numbers, local rows only — never a real SMS), driven from
// the post-confirm "immediate test" step.
async function runPlacesMissedCallTest(){
 const recorded=await api(`/api/businesses/${tenantId}/phone/test-missed-call`,{callerNumber:'+15550131234',businessNumber:'+15550139876'});
 await api(`/api/businesses/${tenantId}/phone/test-missed-call/${recorded.missedCall.id}/text-back`,{});
 notice('Test missed call recorded — check Notifications. Nothing was sent to a real phone.');
 await refreshInbox();
}
placesOnboarding=createPlacesOnboarding({
 api:(path,body)=>api(path,body),
 tenant:()=>tenantId,
 canManage,
 openCalendarConnect:()=>{show('chat');void calendarChat.open();},
 openPhoneCard:()=>{show('account');phoneCard.open=true;phoneCard.scrollIntoView({block:'start',behavior:'smooth'});},
 runMissedCallTest:()=>runPlacesMissedCallTest(),
 onProgress:progress=>renderOnboardingProgress(progress),
});
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
 // Engine events (Slice 0, §1.7): when this browser holds a current
 // GRANTED analytics consent record, assert it on the request — the
 // server then includes analytics copies of money-path events in the
 // response, and the consent-gated loader (the only dispatcher) fires
 // them after re-verifying the record itself. No assertion, no copies.
 const consentApi=(globalThis as any).MayorConsent as {choice?:()=>string|null;emitEngineEvents?:(directives:unknown)=>number}|undefined;
 const consentHeaders:Record<string,string>=consentApi?.choice?.()==='granted'?{'x-mayor-analytics-consent':'granted'}:{};
 try{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...consentHeaders,...headers},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  const result=await response.json();if(captured!==null)workspaceAccess.assert(captured);if(!response.ok){if(workspaceAccessWasRejected(path,tenantId,loggedIn,result.error))endWorkspaceAccess();throw Object.assign(new Error(result.message??'This service could not finish. Please try again.'),{code:result.error});}
  if(Array.isArray(result?.analyticsEvents)&&result.analyticsEvents.length){try{consentApi?.emitEngineEvents?.(result.analyticsEvents);}catch{/* measurement never breaks the money path */}}
  return result;
 }catch(error){if(controller.signal.aborted)throw new Error(customConnection?'The connection took too long. Check the connected service before repeating an action.':'This service took too long. Please try again.');throw error;}finally{clearTimeout(timer);}
}
let conversationPositioned=false,conversationAtEnd=true,conversationHeight=0,conversationWidth=0;
/** DEF-021/022: the voice merge lives in voice-merge.ts (index map +
 * seen cursor with an explicit contract for replacement/reconnect). */
const voiceMerge=createVoiceTranscriptMerge();
/** DEF-006: cards mounted around #transcript by harness events are
 * registered here so a conversation reset removes them all. */
const conversationCards=createConversationCardRegistry();
function clearConversationCards(){
 conversationCards.clear();
 for(const id of ['chat-connections-guide','chat-phone-guide'])document.getElementById(id)?.remove();
}
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
function clearTranscriptRender(){chatSnapshot={...chatSnapshot,rows:[],earlierVisible:false};pushChatView();}
function transcripts(){
 if(accessEnded)return;
 const list=$('transcript'),follow=list.scrollHeight-list.scrollTop-list.clientHeight<80;
 const live=voice?.transcript??[];
 voiceMerge.merge(savedTranscript,live);
 $('chat-empty').hidden=!loggedIn||savedTranscript.length>0;
 // Chat reenvision Slice 2: the silent 200-row cap is GONE. The full
 // loaded history renders; anything older still held by the server is
 // one tap away via "Earlier ↑" (historyEarlier). The engine's
 // live-turn overlay — the optimistic owner row, the acting/streaming
 // assistant row, stopped/failed items, queued owner rows — renders
 // after the saved rows, in turn order.
 // The rows render inside the ChatApp tree from this model; the list
 // element, its scroll bookkeeping, and the ResizeObserver follow logic
 // stay here. Cards and guides mount before/after the list, never
 // inside it, so the tree owns the rows alone.
 const rows:TranscriptRow[]=savedTranscript.map(m=>({role:m.role,text:m.text}));
 const tv=textChat.snapshot();
 if(tv.stopped){rows.push({role:'user',text:tv.stopped.text,turnId:tv.stopped.requestId},{role:'assistant',text:tv.stopped.partial,state:'stopped',turnId:tv.stopped.requestId});}
 if(tv.failed){rows.push({role:'user',text:tv.failed.text,turnId:tv.failed.requestId},{role:'assistant',text:tv.failed.partial,state:'error',error:tv.failed.message,turnId:tv.failed.requestId});}
 if(tv.active){rows.push({role:'user',text:tv.active.text,state:'sending',turnId:tv.active.requestId},{role:'assistant',text:tv.active.partial,state:tv.active.phase,turnId:tv.active.requestId});}
 for(const queued of tv.queue)rows.push({role:'user',text:queued.text,state:'queued',turnId:queued.requestId});
 chatSnapshot={...chatSnapshot,rows,assistantLabel:assistantName(confirmedProfile),earlierVisible:historyEarlier&&historyReady};pushChatView();
 // History can load while Today is visible, when the chat has no scrollable
 // height. Position it once after it becomes visible; preserve earlier-reading
 // positions on later tab switches and incremental transcript updates.
 requestAnimationFrame(()=>{if(list.clientHeight>0){if(follow||!conversationPositioned){list.scrollTop=list.scrollHeight;conversationAtEnd=true;}conversationPositioned=true;}});
}
async function connect(){
  const session=await api('/api/voice/session',{tenantId});
  voiceCall?.stop();voice?.disconnect();
  // DEF-022: the saved rows stay, so the merge map stays too — the new
  // client's indices restart at 0 and must reconcile against the rows
  // already in the transcript, never duplicate them.
  voiceMerge.reconnected();updateNetwork();
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
  client.addEventListener('transcriptchange',()=>{if(active()){transcripts();call.activity();}});
  client.addEventListener('audiolevelchange',level=>{if(active())micLevel.value=Math.min(1,Math.max(0,level*5));});
  client.addEventListener('turnmetrics',metrics=>{if(active()){diagnostics.record(metrics);voiceHealth.refresh();}});
  client.addEventListener('interimtranscript',text=>{if(active()){$('interim').textContent=text??'';call.activity();}});
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
 closeConsentSheet();
 accessEnded=true;namingMode=false;workspaceAccess.end();textChat.reset();serverPrefix=0;historyEarlier=false;voiceCall?.stop();voice?.disconnect();voiceConnected=false;historyReady=false;loggedIn=false;membershipRole='';sessionUserId='';
 savedTranscript=[];confirmedProfile={};voiceMerge.clear();conversationCards.clear();clearTranscriptRender();$('interim').textContent='';
 workspace.clear();workday.clear();connectionHub.reset();voiceHealth.clear();calendarChat.clear();calendarLauncher.hidden=true;$('calendar-status').hidden=true;voiceHelp.open=false;voiceHelp.hidden=true;micLevel.hidden=true;micLevel.value=0;
 $('open-connections').hidden=true;$('open-connections').closest<HTMLElement>('.account-card')!.hidden=true;
 for(const node of [$('profile'),phoneGuide,phoneControls])node.replaceChildren();inboxSnapshot={...inboxSnapshot,items:[],hasMore:false,showReconnect:false};pushInbox();
 for(const id of ['chat-website-source','chat-phone-guide','chat-connections-guide'])document.getElementById(id)?.remove();
 $('user-detail').textContent='';permissionDetail.textContent='';accountCardsVisible=false;routineSnapshot={stateText:'',pauseVisible:false,pauseDisabled:false};emailSnapshot={statusText:'',toggleLabel:'',toggleVisible:false,toggleDisabled:true};pushAccountCards();timezoneSuggestion.element.hidden=true;
 $('notice').hidden=true;networkStatus.hidden=true;inboxSnapshot={...inboxSnapshot,hidden:true,open:false};pushInbox();
 $('calendar-status').querySelector('span')!.textContent='Calendar unavailable';$<HTMLButtonElement>('calendar-status').disabled=true;
 $('notifications-button').hidden=true;$<HTMLButtonElement>('notifications-button').disabled=true;
 document.querySelector('main')!.hidden=true;document.querySelector('nav')!.hidden=true;
 $<HTMLTextAreaElement>('message').value='';$<HTMLTextAreaElement>('message').disabled=true;
 $<HTMLButtonElement>('send-message').disabled=true;$<HTMLButtonElement>('talk').disabled=true;$<HTMLButtonElement>('attach-photo').disabled=true;
 document.querySelector<HTMLElement>('.assistant-dock')!.hidden=true;composerSnapshot={...composerSnapshot,statusText:'',actionsHidden:true};pushComposer();newChatHeader.hidden=true;
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
      if(message.type==='calendar_connection_guide'&&message.guide&&Array.isArray(message.guide.providers)){calendarChat.render(message.guide);}
      // Crew 6h — in-conversation connector cards: offer / guide / credential
      // capture / reconnect. The card never carries a secret; the capture form
      // posts straight to the encrypted credential store.
      if(message.type==='connector_card'&&isConnectorCardPayload(message.card)){
        const card=renderConnectorCard(message.card,{api,tenant:()=>tenantId,signIn,onNotice:message=>notice(message)});
        $('transcript').after(card);
        // DEF-006: registered so New chat / history reload removes it —
        // a live credential form must not outlive its conversation.
        conversationCards.register(card);
        card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
      }
      if(message.type==='calendar_inventory'&&Array.isArray(message.connections)&&message.setup){calendarChat.inventory(message);}
      if(message.type==='business_context'&&message.profile&&typeof message.profile==='object')useBusinessProfile(message.profile);
      if(message.type==='mehyar_expertise'&&Array.isArray(message.services)&&message.services.every((s:any)=>s&&typeof s.name==='string'&&typeof s.scope==='string'))workspace.expertise(message.services);
      if(message.type==='usage_notice'){
        // A new conversation turn retires the previous phone setup panel.
        if(message.kind==='turn'&&message.allowed){const phonePanel=document.getElementById('chat-phone-guide');if(phonePanel)phonePanel.hidden=true;}
        if(message.allowed&&typeof message.remaining==='number'&&message.kind==='turn')usageStatus.textContent=`${message.remaining} of ${message.limit} reply attempts remaining. See Plan & usage for your billing period.`;
        else if(typeof message.message==='string'&&message.message){usageStatus.textContent=message.message;notice(message.message);}
      }
    }
    // Hydrate once per VoiceClient, before enabling input. Its live transcript
    // already survives transport reconnects, so replaying snapshots would duplicate it.
    if(data&&typeof data==='object'&&(data as any).type==='conversation_history'&&!historyReady){
      const messages=(data as any).messages;
      if(Array.isArray(messages)&&messages.length<=50&&messages.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')){
        // DEF-021: the saved array was just replaced — the voice merge
        // must drop its row references and treat the server snapshot as
        // the record, or merged voice rows orphan (mutations land on
        // objects no longer rendered) and re-push as duplicates.
        savedTranscript=messages;serverPrefix=0;historyEarlier=false;voiceMerge.replacedByServer(voice?.transcript.length??0);historyReady=true;transcripts();updateNetwork();
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
 setStatusText(textChat.busy?'Working on your message…':!historyReady&&loggedIn?'Loading your conversation…':microphoneProblem&&!starting?'Voice needs attention':starting?'Starting microphone…':({idle:'Ready when you are',listening:'I’m listening',thinking:'Thinking it through',speaking:assistantName(confirmedProfile)+' is speaking'})[status]);
 $('talk').querySelector('span')!.textContent=starting?'Cancel voice startup':voiceCall?.active?'End conversation':microphoneProblem?'Try microphone again':'Talk to '+assistantName(confirmedProfile);
 $('talk').setAttribute('aria-label',$('talk').querySelector('span')!.textContent!);
 $('dock-voice-label').textContent=$('talk').querySelector('span')!.textContent;
 $('mute').hidden=starting||!voiceCall?.active;
 // DEF-024: the mute label is current state, not history. It used to
 // be written only by the mutechange event, so after a reconnect the
 // fresh (unmuted) client inherited the previous client's "Unmute" —
 // an owner could believe they were muted while live. Write it from
 // the actual state on every render.
 $('mute').textContent=voice?.isMuted?'Unmute':'Mute';
 micLevel.hidden=!voiceCall?.active;if(micLevel.hidden)micLevel.value=0;
 $('voice-hint').textContent=starting?'Allow microphone access in your browser to begin. You can cancel and type instead.':voiceCall?.active?'Speak naturally. You can interrupt me anytime.':microphoneProblem|| (voiceConnected?'Press Talk to begin. I’ll greet you when your microphone is ready.':'Voice is reconnecting. You can still type below.');
}
type VoiceProbe={ok:boolean;reason:string};
/** Capability probe before any call starts. A network failure is "unknown":
 *  never block the normal attempt on a failed probe — existing error handling
 *  still covers the call itself. */
async function probeVoiceReadiness():Promise<VoiceProbe|null>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
 try{
  const response=await fetch('/api/voice/readiness',{signal:controller.signal});
  if(!response.ok)return null;
  const body=await response.json() as {available?:boolean;reason?:string|null};
  if(body.available===false)return {ok:false,reason:typeof body.reason==='string'&&body.reason.trim()?body.reason.trim():'voice service is not configured'};
  return {ok:true,reason:''};
 }catch{return null;}finally{clearTimeout(timer);}
}
/** Honest start: when the server says voice is down, say so in the existing
 *  notice UI and never start a call — no infinite spinner, no dead Talk
 *  button, no silence presented as a working call. */
async function startVoiceCall(){
 if(!voiceCall)return;
 const probe=await probeVoiceReadiness();
 if(probe&&!probe.ok){
  const message=voiceUnavailableNotice(probe.reason);
  microphoneProblem=message;notice(message);renderVoiceState();return;
 }
 await voiceCall.start();
}
$('talk').setAttribute('aria-describedby','voice-hint');
$('voice-hint').setAttribute('role','status');
$('talk').onclick=async()=>{show('chat');microphoneProblem='';notice('');if(voiceCall?.starting||voiceCall?.active)voiceCall?.stop();else if(voiceCall){if(!voiceConsent.granted()){openVoiceConsentSheet('first-run');return;}await startVoiceCall();}else{microphoneProblem='Voice is not connected yet. Wait for the connection or reload this page, then try again.';renderVoiceState();}};
$('mute').onclick=()=>voice?.toggleMute();
$('text-form').onsubmit=event=>{event.preventDefault();void sendTextMessage($<HTMLTextAreaElement>('message').value);};
$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('text-form').dispatchEvent(new Event('submit',{cancelable:true}));}});
// Crew 5 UX: the conversation is home, not a tab. Tapping the persistent
// composer from any view returns to the conversation first.
$('message').addEventListener('focus',()=>{if(loggedIn&&!accessEnded&&!namingMode&&document.body.dataset.view!=='chat')show('chat');});
async function signIn(provider='google',capabilities:string[]=[]){
  try{notice('');const data=await api(`/api/auth/start/${provider}`,{capabilities,...(capabilities.length?{tenantId}:{})});
    const url=new URL(data.url);if(!['accounts.google.com','login.microsoftonline.com','accounts.zoho.com'].includes(url.hostname))throw new Error('Unexpected sign-in destination.');location.assign(url.href);
  }catch(error){notice((error as Error).message);}
}
$('sign-in').onclick=()=>goToSignInBlock();
$('chat-google-sign-in').onclick=()=>signIn();
$('chat-microsoft-sign-in').onclick=()=>signIn('microsoft');
$('logout').onclick=async()=>{endWorkspaceAccess();try{await api('/api/auth/sign-out',{});location.reload();}catch{setStatusText('Sign-out could not finish. Reload to check your account.');}};
async function account(){
  if(!loggedIn||accessEnded)return;
  if(membershipRole==='billing'){show('billing');return;}
  accountCardsVisible=canManage();pushAccountCards();if(canManage()){void refreshRoutine();void refreshEmailPreference();}
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
  // Business vertical drives the vertical-aware SMS text-back wording. Server accepts the enum keys from src/verticals.ts.
  {
   const dt=document.createElement('dt');dt.textContent='Business type';
   const dd=document.createElement('dd');
   const picker=document.createElement('select');picker.setAttribute('aria-label','Business type');
   for(const [key,vertical] of Object.entries(VERTICAL_PROFILES)){const option=document.createElement('option');option.value=key;option.textContent=vertical.label;picker.append(option);}
   const current=(memory.profile as {vertical?:string}).vertical??'other';picker.value=current;
   const note=document.createElement('p');note.className='privacy-note';note.textContent='Sets the wording of missed-call text-backs and appointment reminders.';
   // Crew 6b: when the vertical came from the adjacent-vertical map, say
   // "using X mode" explicitly — never a silent mismatch.
   const mappedNote=document.createElement('p');mappedNote.className='privacy-note';
   const mappedText=verticalMappingNote(memory.profile as {vertical?:string;verticalMappedFrom?:string});
   if(mappedText)mappedNote.textContent=mappedText;else mappedNote.hidden=true;
   dd.append(picker,note,mappedNote);$('profile').append(dt,dd);
   if(canManage()){
    picker.onchange=async()=>{
     picker.disabled=true;
     try{
      const updated=await api(`/api/businesses/${tenantId}/profile`,{vertical:picker.value,clearVerticalMapping:true,revision:memory.revision});
      memory.revision=updated.revision;confirmedProfile.vertical=picker.value;
      mappedNote.hidden=true;
      notice('Business type saved. Text-back messages will use this wording.');
     }catch(error){notice(error instanceof Error?error.message:'Could not save the business type.');picker.value=(memory.profile as {vertical?:string}).vertical??'other';}
     finally{picker.disabled=false;}
    };
   }else picker.disabled=true;
  }
  // Crew 6c — customer-facing language. Owner-chosen; deterministic Spanish
  // templates (text-backs, reminders, cards, notifications) when 'es'.
  // Saved through the same owner-confirmed profile flow as the business type.
  {
   const dt=document.createElement('dt');dt.textContent='Customer language';
   const dd=document.createElement('dd');
   const picker=document.createElement('select');picker.setAttribute('aria-label','Customer language');
   for(const [value,label] of [['en','English'],['es','Español']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;picker.append(option);}
   const current=(memory.profile as {language?:string}).language??'en';picker.value=current;
   const note=document.createElement('p');note.className='privacy-note';note.textContent='Customer-facing texts (text-backs, reminders, cards, notifications) send in Spanish when Español is chosen.';
   dd.append(picker,note);$('profile').append(dt,dd);
   if(canManage()){
    picker.onchange=async()=>{
     picker.disabled=true;
     try{
      const updated=await api(`/api/businesses/${tenantId}/profile`,{language:picker.value,revision:memory.revision});
      memory.revision=updated.revision;confirmedProfile.language=picker.value;
      notice('Language saved. Customer-facing messages will use this language.');
     }catch(error){notice(error instanceof Error?error.message:'Could not save the language.');picker.value=(memory.profile as {language?:string}).language??'en';}
     finally{picker.disabled=false;}
    };
   }else picker.disabled=true;
  }
  // Tone picker: Friendly (default) vs Professional register for customer-facing
  // copy — text-backs, reminders, suggestion drafts, and the persona. Owner-chosen.
  // Server accepts the enum keys from src/verticals.ts.
  {
   const dt=document.createElement('dt');dt.textContent='Tone';
   const dd=document.createElement('dd');
   const picker=document.createElement('select');picker.setAttribute('aria-label','Tone');
   for(const [key,label] of [['friendly','Friendly'],['professional','Professional']] as const){const option=document.createElement('option');option.value=key;option.textContent=label;picker.append(option);}
   const current=(memory.profile as {tone?:string}).tone??'friendly';picker.value=current;
   const note=document.createElement('p');note.className='privacy-note';note.textContent='Professional keeps customer messages formal — no casual upsell. Choose it for law, clinics, and financial services.';
   dd.append(picker,note);$('profile').append(dt,dd);
   if(canManage()){
    picker.onchange=async()=>{
     picker.disabled=true;
     try{
      const updated=await api(`/api/businesses/${tenantId}/profile`,{tone:picker.value,revision:memory.revision});
      memory.revision=updated.revision;confirmedProfile.tone=picker.value;
      notice('Tone saved. Customer messages will use this register.');
     }catch(error){notice(error instanceof Error?error.message:'Could not save tone.');picker.value=(memory.profile as {tone?:string}).tone??'friendly';}
     finally{picker.disabled=false;}
    };
   }else picker.disabled=true;
  }
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
  if(tab==='chat')void loadDeskData();
  if(tab==='account')account().catch(error=>notice(error.message));
  if(tab==='connections'&&canManage()){void connectionHub.activate().catch(error=>notice(error.message));loadConnectorSessions({api,tenant:()=>tenantId,signIn,onNotice:message=>notice(message)});}
}
async function init(){
  // Purchase intent (NEW-1): stash a valid /billing?plan|pack intent
  // before anything else, so the sign-in round trip cannot lose it.
  captureBillingIntent();
  // Public offer block: catalog-priced plans on the logged-out view. Non-blocking;
  // the price-free fallback stays if the catalog can't be reached.
  void loadOfferBlock();
  // The Desk strip (Slice 1): the catalog feeds the founding Ribbon's
  // price/seats (fail-quiet); the strip itself mounts on arrival.
  void loadDeskCatalog();
  refreshDesk();
  $('open-connections').hidden=true;$('open-connections').closest<HTMLElement>('.account-card')!.hidden=true;
  const capabilities=await api('/api/auth/capabilities');
  if(!capabilities.providers.google.configured){
    $<HTMLButtonElement>('chat-google-sign-in').disabled=true;
    $('voice-hint').textContent='Google sign-in is being connected. Voice onboarding will be available after setup.';
  }
  if(!capabilities.providers.microsoft.configured){
    $<HTMLButtonElement>('chat-microsoft-sign-in').disabled=true;
  }
  const session=await api('/api/auth/get-session');
  if(!session){
    // Logged-out landing: hide the app nav and account-assuming header copy.
    // The view is a clean sign-in landing with a single primary CTA.
    document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!.hidden=true;
    $('business-identity').hidden=true;
    if(new URLSearchParams(location.search).has('auth_error'))notice('Sign-in could not finish. Please try again.');
    if(new URLSearchParams(location.search).has('start')||hasBillingIntent()){
      // Start path (rot159): the /sales hero's 'Start free' lands a new
      // visitor at the start — sign-in panel in view, primary button
      // focused. Signed-in users never reach this logged-out branch.
      // A purchase intent (NEW-1) gets the same guided landing; the
      // intent itself rides the stash through sign-in (below).
      $('chat-sign-in').scrollIntoView({block:'center'});
      $<HTMLButtonElement>('chat-google-sign-in').focus({preventScroll:true});
    }
    return;
  }
  sessionUserId=session.user.id;loggedIn=true;$('sign-in').hidden=true;$('chat-sign-in').hidden=true;$('chat-empty').hidden=false;$('logout').hidden=false;$('user-detail').textContent=session.user.email;
  document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!.hidden=false;
  const businesses=await api('/api/businesses');
  const business=selectWorkspaceBusiness(businesses.businesses as Array<{id:string;name:string;role:string}>,new URLSearchParams(location.search).get('business'));
  // Crew 5 UX: never auto-create a nameless business. With no membership the
  // owner names the business in conversation first; only that real name is
  // ever sent to POST /api/businesses (see claimBusinessName).
  if(!business){enterNamingMode();return;}
  await enterBusiness(businesses.businesses as Array<{id:string;name:string;role:string}>,business);
  // Trendpost panel (2026-10-14): lazy React island in the Today view.
  void loadTrendpost(business.id);
}

/** First-run: the conversation asks "What's your business called?" and the
 * owner's answer becomes the business name. No business exists yet here. */
function enterNamingMode(){
  namingMode=true;
  refreshDesk();
  document.querySelector<HTMLElement>('.assistant-dock')!.hidden=false;
  composerSnapshot={...composerSnapshot,actionsHidden:false,newChatHidden:true};pushComposer();
  // No conversation exists yet — a reset would hit a tenant-less endpoint.
  show('chat');
  savedTranscript=[{role:'assistant',text:namingGreeting()}];
  // The composer is the naming input; there is no conversation history yet.
  historyReady=true;transcripts();updateNetwork();
  $<HTMLTextAreaElement>('message').placeholder='Your business name…';
  setStatusText('Welcome to The Mayor');
  $('voice-hint').textContent='Name your business first — then we can talk.';
}

/** The owner's answer to the naming question creates the business, once. */
async function claimBusinessName(name:string){
  const problem=validateBusinessName(name);
  if(problem){notice(problem);return;}
  notice('Creating your business…');
  try{
    const created=await api('/api/businesses',{name:name.trim()});
    // Read the actual membership; creation alone must not imply ownership.
    const list=await api('/api/businesses');
    const business=list.businesses.find((item:any)=>item.id===created.id);
    if(!business)throw new Error('Your business was created but is not available yet. Reload to continue.');
    namingMode=false;savedTranscript=[];
    await enterBusiness(list.businesses,business);
    notice(`Welcome, ${business.name} — your front desk is ready. Tell me what you do and we’ll set up the rest together.`);
  }catch(error){notice(error instanceof Error?error.message:'Could not create your business. Try again.');}
}

async function enterBusiness(businesses:Array<{id:string;name:string;role:string}>,business:{id:string;name:string;role:string}){
  tenantId=business.id;membershipRole=business.role;composerSnapshot={...composerSnapshot,newChatHidden:false};chatSnapshot={...chatSnapshot,businessName:business.name};pushComposer();
  $('business-identity').hidden=false;
  $('open-connections').hidden=!canManage();$('open-connections').closest<HTMLElement>('.account-card')!.hidden=!canManage();
  document.querySelector<HTMLElement>('.assistant-dock')!.hidden=!canChat();newChatHeader.hidden=!canChat();composerSnapshot={...composerSnapshot,actionsHidden:false};pushComposer();
  workday.ready(business.name,membershipRole);
  setupBusinessSwitcher(businesses,business.id);
  $('calendar-status').hidden=!canManage();
  calendarLauncher.hidden=!canManage();
  const connectionError=new URLSearchParams(location.search).get('auth_error');
  const connectedProvider=new URLSearchParams(location.search).get('connected');
  if(canManage()&&(connectedProvider==='telnyx'||connectionError==='telnyx_connection')){
    show('chat');
    void api('/api/phone-guide?mode=existing&provider=telnyx').then(guide=>handleMessage({type:'phone_setup_guide',guide})).catch(()=>notice('Phone options could not load. Ask me to connect Telnyx to try again.'));
    notice(connectedProvider==='telnyx'?'Telnyx is connected. Choose your business number below. Calling still needs setup.':'The Telnyx connection did not finish. Try connecting again below.');
  }
  else if(canManage()&&connectedProvider&&['google','microsoft','zoho'].includes(connectedProvider)){void calendarChat.open(undefined,connectedProvider);}
  else if(canManage()&&connectionError){notice('The calendar connection did not finish. Your existing business details are safe. Try connecting again below.');void calendarChat.open(undefined,connectionError.startsWith('zoho_')?'zoho':undefined);}
  inboxSnapshot={...inboxSnapshot,hidden:true};pushInbox();$('notifications-button').hidden=!canManage();if(canManage())void refreshInbox();
  if(canManage()&&new URLSearchParams(location.search).get('notifications')==='1'){inboxSnapshot={...inboxSnapshot,hidden:false,open:true};pushInbox();void refreshInbox();}
  timezoneSuggestion.element.hidden=!canChat();timezoneSuggestion.ready(canChat());
  permissionDetail.textContent=`${business.name} · Role: ${membershipRole}. ${canManage()?'You can manage business details, scheduling, and connections.':canChat()?'You can talk to The Mayor and read business details. An owner or manager confirms business and scheduling changes.':membershipRole==='billing'?'You can manage the subscription and read shared usage in Plan & usage.':'You can read business details. Voice chat and connection management are not available for this role.'}`;
  phoneCard.hidden=!canManage();
  if(canChat()){if(!canManage())show('chat');const memory=await api(`/api/businesses/${tenantId}/profile`);confirmedProfile=memory.profile;await loadConversation();useBusinessProfile(memory.profile,memory.progress);void connect().catch(error=>{microphoneProblem=`Voice could not connect. Text chat is available. ${error.message}`;renderVoiceState();});}
  else{
    setStatusText('Account access');
    $('voice-hint').textContent=membershipRole==='billing'?'Your role manages the subscription and shared usage in Plan & usage.':'Your role does not include voice or text chat. Business details are available in Account.';
    show(membershipRole==='billing'?'billing':'account');
  }
  // SPA deep links: /today, /feed, /billing, /connectors, /settings, /account
  // serve the app shell (see spaViewForPath in src/public-routes.ts).
  // Activate the matching view; workday.show() already guards by role.
  // Slice 1: /today lands on the Desk — the home view (chat view head)
  // where the Morning Line + intent stream live; the legacy workday
  // overview remains on its Today tab until the view-merge slice.
  const deepLink:Record<string,WorkdayView>={'/today':'chat','/feed':'feed','/billing':'billing','/connectors':'connections','/settings':'account','/account':'account'};
  const deepView=deepLink[location.pathname];
  if(deepView)show(deepView);
  // Purchase intent (NEW-1): a /sales or /pricing buy click lands
  // here after sign-in (URL param, or the stash from the pre-sign-in
  // boot). Land on billing with the plan/pack preselected.
  const purchaseIntent=takeBillingIntent();
  if(purchaseIntent){
    workday.billingIntent(purchaseIntent);
    // The carrier is consumed: clear the URL params so a peek (the
    // Ribbon) or a later boot can never resurrect a spent intent.
    stripIntentParams();
  }
  refreshDesk();
  void loadDeskData();
  // Stripe return (Slice 1): the owner lands in the Desk — the home
  // view — with the fulfilled intent visible as a completion Receipt
  // once the billing sync writes it. The sync itself runs through
  // workday.ready()'s billing load; the Desk re-reads on a beat so
  // the Receipt lands without a manual refresh.
  if(new URLSearchParams(location.search).get('billing')==='success'){
    show('chat');
    window.setTimeout(()=>{void loadDeskData(true);},3000);
  }
  // One Connector phone handoff (P3 slice 2): /connect/<session id> renders
  // that session's card in chat — the same attempt, continued on this device.
  const handoff=location.pathname.match(/^\/connect\/([a-f0-9-]{36})$/);
  if(handoff){
    show('chat');
    try{
      const event=await api(`/api/businesses/${encodeURIComponent(tenantId)}/connector-engine/sessions/${handoff[1]}/card`);
      const payload=(event as {card?:unknown})?.card;
      if(isConnectorCardPayload(payload)){
        const card=renderConnectorCard(payload,{api,tenant:()=>tenantId,signIn,onNotice:message=>notice(message)});
        $('transcript').after(card);
        card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
        notice(`Continuing your ${payload.name} connection — pick up right here.`);
      }else notice('That connection link did not match an attempt on this account.');
    }catch{notice('That connection link did not match an attempt on this account.');}
  }
}
async function start(){if(accessEnded)return;setRetryVisible(false);try{await init();}catch(error){if(accessEnded)return;notice((error as Error).message);setRetryVisible(true);setStatusText('Could not load your workspace');}}
pushComposer();show('chat');void start();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
