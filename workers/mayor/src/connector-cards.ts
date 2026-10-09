/** Crew 6h — in-conversation connector cards.
 *
 * Pattern: the same typed-event channel the chat turn already uses
 * (context.connection.send(JSON.stringify({type:'calendar_connection_guide',...}))
 * in voice.ts, rendered by handleMessage in web/main.ts).
 *
 * Card kinds:
 *  - 'offer'      service name + what it unlocks + [Show me how][I have my key]
 *  - 'oauth'      OAuth service: [Connect <provider>] via the existing sign-in
 *  - 'guide'      numbered key-finding steps (the teaching path)
 *  - 'credential' password-type key capture; posts straight to the existing
 *                 credential-store endpoint (/connections/add). The secret NEVER
 *                 touches chat text or the model.
 *  - 'reconnect'  dead-credential card when a connector call fails auth.
 *
 * SECRET BOUNDARY (compliance-critical): nothing in this file ever accepts,
 * carries, or emits a secret value. Card payloads describe WHERE a key goes,
 * never a key. assertNoSecretLeak enforces that at runtime and in tests.
 */
import {type ConnectorGuide,genericConnectorGuide,guideForService,resolveConnectorService} from './connector-guides';

export type ConnectorCardKind='offer'|'guide'|'credential'|'reconnect'|'oauth';
export interface ConnectorCardAction{
 id:'connect_oauth'|'show_guide'|'enter_key'|'reconnect'|'dismiss'|'open_connections';
 label:string;
 provider?:'google'|'microsoft'|'zoho';
 /** OAuth capabilities requested on connect (default: base sign-in). */
 capabilities?:string[];
 /** Prefill for the credential card's endpoint field (editable, no secret). */
 endpoint?:string;
}
export interface ConnectorCardGuide{steps:string[];note?:string;docUrl?:string}
export interface ConnectorCardPayload{
 id:string;kind:ConnectorCardKind;service:string;name:string;title:string;body:string;
 unlocks?:string;guide?:ConnectorCardGuide;endpoint?:string;
 actions:ConnectorCardAction[];state:'pending';
}
export interface ConnectorCardEvent{type:'connector_card';card:ConnectorCardPayload}

const NEGATION=/\b(?:do\s*not|don't|doesn't|never)\s+(?:connect|reconnect|hook\s+up|link|add|set\s*up|sync|integrate)\b/i;
const REMOVAL=/\b(?:disconnect|remove|delete|unlink|no\s+longer)\b/i;
const CONNECT_VERB=/\b(?:connect|reconnect|hook\s+up|link|add|set\s*up|sync|integrate|connecting|linking)\b/i;
const KEY_WORD=/\b(?:api[_ ]?key|secret|token|credential)s?\b/i;
const CALENDAR_WORD=/\bcalendar\b/i;

/** Deterministic connector-need detection on the owner's message.
 * Returns the canonical service key, or null. Calendar mentions for
 * google/microsoft/zoho are owned by the connectCalendar flow → null. */
export function detectConnectorNeed(text:string):{service:string;name:string}|null{
 if(typeof text!=='string'||text.length>2000)return null;
 if(NEGATION.test(text)||REMOVAL.test(text))return null;
 const service=resolveConnectorService(text);
 if(!service)return null;
 const hasVerb=CONNECT_VERB.test(text),hasKeyWord=KEY_WORD.test(text);
 if(!hasVerb&&!hasKeyWord)return null;
 if((service==='google'||service==='microsoft'||service==='zoho')&&CALENDAR_WORD.test(text))return null;
 const guide=guideForService(service);
 return {service,name:guide?.name??service};
}

function base(guide:ConnectorGuide,kind:ConnectorCardKind,title:string,body:string):ConnectorCardPayload{
 return {
  id:crypto.randomUUID(),kind,service:guide.service,name:guide.name,title,body,
  unlocks:guide.unlocks,
  guide:{steps:guide.steps,...(guide.note?{note:guide.note}:{}),...(guide.docUrl?{docUrl:guide.docUrl}:{})},
  ...(guide.apiBase?{endpoint:guide.apiBase}:{}),
  actions:[{id:'dismiss',label:'Not now'}],state:'pending',
 };
}

/** "Connect my Booksy" card: what it unlocks + the two paths (teach me / I have a key). */
export function connectorOfferEvent(guide:ConnectorGuide):ConnectorCardEvent{
 if(guide.authKind==='oauth'){
  const card=base(guide,'oauth',`Connect ${guide.name}?`,
   `Connect with ${guide.name} below — it uses ${guide.name}'s own secure sign-in, so The Mayor never sees your password.`);
  card.actions=[{id:'connect_oauth',label:`Connect ${guide.name}`,provider:guide.oauthProvider},...card.actions];
  return {type:'connector_card',card};
 }
 const card=base(guide,'offer',`Connect ${guide.name}?`,guide.unlocks);
 card.actions=[
  {id:'show_guide',label:'Show me how to get a key'},
  {id:'enter_key',label:'I already have a key'},
  ...card.actions];
 return {type:'connector_card',card};
}

/** Teaching-path card: numbered plain-language steps, no jargon. */
export function guideCardEvent(guide:ConnectorGuide):ConnectorCardEvent{
 const card=base(guide,'guide',`Getting your ${guide.name} key`,
  guide.authKind==='request_access'
   ?`${guide.name} does not hand out keys from the dashboard — access is approved by them. Here is the honest path:`
   :'Follow these steps, then paste the key into the secure box:');
 if(guide.authKind!=='oauth')card.actions=[{id:'enter_key',label:'I have my key'},...card.actions];
 else card.actions=[{id:'connect_oauth',label:`Connect ${guide.name}`,provider:guide.oauthProvider},...card.actions];
 return {type:'connector_card',card};
}

/** Secure capture card: password-type input, posts straight to /connections/add. */
export function credentialCardEvent(guide:ConnectorGuide):ConnectorCardEvent{
 const card=base(guide,'credential',`Enter your ${guide.name} key`,
  'Type or paste your key below. It goes straight to secure encrypted storage — it never appears in this chat and The Mayor never sees it.');
 card.actions=[{id:'open_connections',label:'Open Connections instead'},...card.actions];
 return {type:'connector_card',card};
}

/** Dead-credential card: auth failure on a connector call, not a cryptic error. */
export function reconnectCardEvent(guide:ConnectorGuide):ConnectorCardEvent{
 const card=base(guide,'reconnect',`${guide.name} needs reconnecting`,
  `Your ${guide.name} connection stopped working — usually an expired sign-in or a permission that changed. Reconnect to continue; nothing else changes.`);
 card.actions=guide.authKind==='oauth'
  ?[{id:'connect_oauth',label:`Reconnect ${guide.name}`,provider:guide.oauthProvider},{id:'dismiss',label:'Later'}]
  :[{id:'enter_key',label:'Enter a new key'},{id:'dismiss',label:'Later'}];
 return {type:'connector_card',card};
}

/** Offer event for a free-text service name (unknown → generic guide). */
export function connectorOfferForName(serviceName:string):ConnectorCardEvent{
 return connectorOfferEvent(genericConnectorGuide(serviceName));
}

/* ---------------- dead-credential detection ---------------- */

/** HttpError codes from custom-connectors.ts / connectors/credentials.ts that
 * mean "this credential is dead" rather than a transient or input failure. */
const AUTH_FAILURE_CODES=new Set([
 'authentication_required','invalid_credential','connection_unavailable','insufficient_scope',
 'connection_provider_rejected','connection_custody_unavailable','token_custody_unavailable',
 'workspace_suspended',
]);
export function isConnectorAuthFailureCode(code:unknown):boolean{
 return typeof code==='string'&&AUTH_FAILURE_CODES.has(code);
}
/** True when this error should surface a reconnect card instead of its message. */
export function isConnectorAuthFailure(error:unknown):boolean{
 if(!error||typeof error!=='object')return false;
 const record=error as Record<string,unknown>;
 if(isConnectorAuthFailureCode(record.code))return true;
 const message=typeof record.message==='string'?record.message.toLowerCase():'';
 return /\b(?:unauthorized|invalid[_ ]grant|token (?:expired|revoked)|reauthenticat|reconnect)/.test(message);
}

/* ---------------- secret boundary ---------------- */

const SECRET_KEY=/^(?:secret|api[_-]?key|client[_-]?secret|bearer|password|credential|access[_-]?token|refresh[_-]?token)$/i;
/** Throws if any payload node carries a secret-shaped VALUE under a
 * secret-named key. Prose that merely mentions "API key" is fine — only
 * actual secret values are forbidden. Exported so tests assert the contract. */
export function assertNoSecretLeak(value:unknown,depth=0):void{
 if(depth>10||value===null||typeof value!=='object')return;
 if(Array.isArray(value)){for(const item of value)assertNoSecretLeak(item,depth+1);return;}
 for(const [key,item] of Object.entries(value)){
  if(SECRET_KEY.test(key)&&typeof item==='string'&&item.length>0)
   throw new Error(`connector card must never carry a secret (key "${key}")`);
  assertNoSecretLeak(item,depth+1);
 }
}

/** Masked display after save: "••••1234". Client-side only, on the value the
 * owner just typed — never persisted, never logged. */
export function maskSecretTail(secret:string):string{
 const tail=secret.slice(-4);
 return '••••'+(tail||'');
}

/** Dedupe window for deterministic offer cards per session+service (1 hour). */
export const CONNECTOR_CARD_DEDUPE_MS=3600000;
