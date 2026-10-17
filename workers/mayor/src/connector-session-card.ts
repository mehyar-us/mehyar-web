/**
 * connector-session-card.ts — One Connector P3: the conversation renderer.
 *
 * Turns an engine session view (src/connector-engine.ts) into the SAME
 * connector-card payload the chat has always rendered (src/connector-cards.ts),
 * so one session object drives the conversation face first (design §8).
 * The card carries the session id; its actions drive the session through the
 * engine routes (begin / attach / verify), and the client re-reads the card
 * from GET .../sessions/:sid/card after each action — the walk-down to the
 * next method after a failed verify is therefore just the next card.
 *
 * SECRET BOUNDARY: identical to connector-cards.ts — payloads describe where
 * a credential goes, never a credential. assertNoSecretLeak runs on every
 * card before it leaves this module.
 */
import {assertNoSecretLeak,type ConnectorCardEvent,type ConnectorCardPayload} from './connector-cards';
import {CAPABILITIES} from './auth/capabilities';
import {getConnectorSession,listConnectorSessions,startConnectorSession} from './connector-engine';
import type {Actor,Env} from './env';

/** Structural mirror of the engine's sessionView (kept local to avoid a
 * module cycle; the engine's view is the source of truth). */
export interface SessionCardView{
 id:string;service:string;name:string;source:string;
 state:'offered'|'capturing'|'verifying'|'connected'|'gave_up';
 method:({kind:string;oneClick:boolean}&Record<string,unknown>)|null;
 methodIndex:number;methodsTotal:number;
 failureKind:string|null;connectionId:string|null;
 unlocks:string;capabilities?:string[];platformGate:string|null;firstAttempt:boolean;
}

const FAILURE_PLAIN:Record<string,string>={
 bad_credential:'The sign-in or key was rejected.',
 insufficient_scope:'The sign-in did not include the permissions The Mayor needs.',
 method_removed:'That way of connecting is no longer offered.',
 platform_gate:'This platform is gating the connection behind its own approval.',
 network:'The connection check could not get through.',
 owner_abandoned:'The attempt was set aside.',
 unknown:'Something went wrong while checking the connection.',
};

/** Door 1: the capabilities a recipe's OAuth method must request, from
 * its semantic tags ('calendar' -> calendar_manage, 'email' ->
 * gmail_read), filtered to ids the provider's catalog actually has —
 * so a card's Connect tap signs in WITH the scopes the engine's
 * verify will check for, instead of identity-only. */
const TAG_TO_CAPABILITY:Record<string,string>={calendar:'calendar_manage',email:'gmail_read'};
function oauthCapabilities(view:SessionCardView,provider:unknown):string[]{
 if(typeof provider!=='string')return [];
 const catalog=(CAPABILITIES as Record<string,readonly {id:string}[]>)[provider]??[];
 const known=new Set(catalog.map(c=>c.id));
 const wanted=(view.capabilities??[]).map(tag=>TAG_TO_CAPABILITY[tag]).filter((id):id is string=>Boolean(id));
 return [...new Set(wanted.filter(id=>known.has(id)))];
}

function providerName(provider:unknown):string{
 return typeof provider==='string'&&provider?provider[0].toUpperCase()+provider.slice(1):'the provider';
}

/** The conversation card for one session view. Pure: no I/O, fully testable.
 * With appOrigin, actionable cards also carry the phone-handoff face
 * (P3 slice 2): the same session, continued on the owner's phone. */
export function sessionCard(view:SessionCardView,appOrigin?:string):ConnectorCardPayload{
 const name=view.name;
 const card:ConnectorCardPayload={
  id:`session-${view.id}`,kind:'status',service:view.service,name,
  title:`Connect ${name}`,body:'',actions:[{id:'dismiss',label:'Not now'}],state:'pending',
  sessionId:view.id,sessionState:view.state,
 };
 const gateNote=view.platformGate?` Note: ${view.platformGate}`:'';
 const firstNote=view.firstAttempt?`First time connecting ${name} — I'll walk you through it. `:'';
 if(view.state==='connected'&&view.method?.kind==='assisted'){
  // Door 4: an assisted connection is the owner's own confirmation —
  // no credential was checked and no data flows from the platform.
  // It must not wear the verified connections' label or unlocks copy.
  card.title=`${name} is set up`;
  card.body=`Set up by your confirmation: you completed the steps on ${name} itself. The Mayor cannot read data from ${name} — this is your confirmation, not a data feed.`;
  card.actions=[{id:'open_connections',label:'View in Connections'},{id:'dismiss',label:'Done'}];
 }else if(view.state==='connected'){
  card.title=`${name} is connected`;
  card.body=view.unlocks||`${name} is connected and verified.`;
  card.actions=[{id:'open_connections',label:'View in Connections'},{id:'dismiss',label:'Done'}];
 }else if(view.state==='gave_up'){
  card.title=`That way didn't work for ${name}`;
  card.body=`${FAILURE_PLAIN[view.failureKind??'unknown']??FAILURE_PLAIN.unknown} Ask me to connect ${name} again and I'll take the next way.${gateNote}`;
  card.actions=[{id:'open_connections',label:'View in Connections'},{id:'dismiss',label:'Close'}];
 }else if(view.state==='verifying'){
  card.title=`Checking your ${name} connection…`;
  card.body=`Verifying the connection with ${name} — this takes a few seconds.`;
  card.actions=[{id:'dismiss',label:'Hide'}];
 }else{
  // offered | capturing — the card is the ONE next action for the current way.
  const method=view.method;
  const lead=`${firstNote}${view.unlocks?`${view.unlocks} `:''}`;
  if(!method){
   card.body=`${lead}There is no way to connect ${name} right now.${gateNote}`;
  }else if(method.kind==='oauth'){
   if(method.oneClick){
    card.kind='oauth';
    card.body=`${lead}One tap: sign in with ${providerName(method.provider)} on its own secure page — The Mayor never sees your password.${gateNote}`;
    card.actions=[{id:'connect_oauth',label:`Connect ${name}`,provider:method.provider as 'google'|'microsoft'|'zoho',capabilities:oauthCapabilities(view,method.provider)},{id:'dismiss',label:'Not now'}];
   }else{
    card.body=`${lead}Sign-in for ${name} is not set up on The Mayor's side yet, so this way cannot start. Ask me in chat and I'll take the next way available.${gateNote}`;
   }
  }else if(method.kind==='api_key'||method.kind==='webhook'||method.kind==='mcp'){
   const capture=(method.capture??{}) as {label?:string;hint?:string};
   card.kind='credential';
   card.body=`${lead}Paste your ${capture.label??`${name} key`} into the secure box — it goes straight to encrypted storage, is checked right away, and never appears in this chat.${gateNote}`;
   if(capture.hint)card.guide={steps:[capture.hint]};
   if(typeof method.apiBase==='string')card.endpoint=method.apiBase;
   card.actions=[{id:'show_guide',label:'Show me how'},{id:'enter_key',label:'I have my key'},{id:'dismiss',label:'Not now'}];
  }else if(method.kind==='assisted'){
   const steps=Array.isArray(method.steps)?(method.steps as string[]):[];
   card.kind='guide';
   card.body=`${lead}${name} doesn't offer a direct connection, so here is the guided way — do these steps with ${name}, then tap “I've done this”.${gateNote}`;
   card.guide={steps,...(typeof method.note==='string'?{note:method.note}:{})};
   card.actions=[{id:'confirm_done',label:"I've done this"},{id:'dismiss',label:'Not now'}];
  }else{
   card.body=`${lead}The Mayor can walk you through connecting ${name} in chat.${gateNote}`;
  }
 }
 if(appOrigin&&(view.state==='offered'||view.state==='capturing')&&view.method){
  card.handoffUrl=`${appOrigin}/connect/${view.id}`;
  card.actions=[...card.actions,{id:'phone_handoff',label:'Finish on your phone'}];
 }
 assertNoSecretLeak(card);
 return card;
}

export function sessionCardEvent(view:SessionCardView,appOrigin?:string):ConnectorCardEvent{
 return {type:'connector_card',card:sessionCard(view,appOrigin)};
}

/**
 * The card for a business's session for `service`, reusing the open attempt
 * when one exists (one live attempt per service) and starting a new session
 * otherwise. Returns null on any engine failure — callers fall back to the
 * guide offer card so a connector hiccup never breaks a conversation turn.
 */
export async function ensureSessionCard(env:Env,actor:Actor,service:string):Promise<ConnectorCardEvent|null>{
 try{
  const {sessions}=await listConnectorSessions(env,actor) as {sessions:SessionCardView[]};
  const open=sessions.find(s=>s.service===service&&(s.state==='offered'||s.state==='capturing'||s.state==='verifying'));
  if(open)return sessionCardEvent(open,env.APP_ORIGIN);
  const view=await startConnectorSession(env,actor,{service}) as SessionCardView;
  return sessionCardEvent(view,env.APP_ORIGIN);
 }catch{return null;}
}

/** Fresh card for one session (the client's post-action re-read). */
export async function sessionCardFor(env:Env,actor:Actor,sessionId:string):Promise<ConnectorCardEvent>{
 const view=await getConnectorSession(env,actor,sessionId) as SessionCardView;
 return sessionCardEvent(view,env.APP_ORIGIN);
}
