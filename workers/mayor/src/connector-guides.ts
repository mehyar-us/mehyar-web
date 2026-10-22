/** Crew 6h — guided connector onboarding: per-service step-by-step key-finding guides.
 *
 * Each guide is plain-language, no jargon, and HONEST about access models
 * (compliance item 12): services without a self-serve API say so instead of
 * inventing a settings path. Steps were researched against each service's
 * current developer documentation on 2026-10-09.
 *
 * The secret itself never appears here: guides describe WHERE to find a key,
 * never a key value. The credential capture card posts the secret straight to
 * the encrypted store (custom-connectors.ts); the model never sees it.
 */

export type ConnectorAuthKind='oauth'|'api_key'|'request_access';
export type OAuthProviderId='google'|'microsoft'|'zoho';

export interface ConnectorGuide{
 /** Canonical key, e.g. 'booksy'. */
 service:string;
 /** Display name, e.g. 'Booksy'. */
 name:string;
 /** How the owner authorizes The Mayor. */
 authKind:ConnectorAuthKind;
 /** Set for authKind==='oauth'. */
 oauthProvider?:OAuthProviderId;
 /** Prefill for the credential capture card's endpoint field (editable). */
 apiBase?:string;
 /** What the connection unlocks, in the owner's words. */
 unlocks:string;
 /** Numbered, plain-language steps. No jargon. */
 steps:string[];
 /** Honesty caveat shown under the steps when access is gated. */
 note?:string;
 /** Public docs link (https only), for the "Learn more" link. */
 docUrl?:string;
}

/** Canonical guide catalog. 'generic' is the fallback, resolved by name. */
const GUIDES:ConnectorGuide[]=[
 {
  service:'vagaro',name:'Vagaro',authKind:'request_access',
  apiBase:'https://api.vagaro.com/us/api/v2',
  unlocks:'Reads your Vagaro appointments and customer list — reminders, no-show follow-up, and win-back for clients who have not rebooked.',
  steps:[
   'Log in to your Vagaro business account on a computer (not the phone app).',
   'Open Settings, then Developers, then APIs & Webhooks.',
   'Request API access. Vagaro reviews these requests by hand — plan on about 5 to 7 business days. You will need a paid, non-trial Vagaro plan with card processing turned on.',
   'When Vagaro approves you, they will give you a Client ID and a Client Secret.',
   'Paste the Client ID and Client Secret into the secure box below. They are encrypted the moment you save, and they are never shown again.',
  ],
  note:'Vagaro does not hand out API keys from the dashboard — every integration is approved one by one. If your plan is a free trial, upgrade first or the request will be declined.',
  docUrl:'https://docs.vagaro.com/',
 },
 {
  service:'booksy',name:'Booksy',authKind:'request_access',
  unlocks:'Reads your Booksy bookings — reminders and win-back for clients who have not rebooked.',
  steps:[
   'Booksy does not publish a self-serve API key for businesses, so there is nothing to copy from your Booksy settings.',
   'To request developer or integration access, contact Booksy support from inside your Booksy business account (Help / Contact us).',
   'Ask specifically for integration or API access for your business.',
   'When Booksy issues you credentials, paste them into the secure box below. They are encrypted the moment you save, and they are never shown again.',
  ],
  note:'We will not pretend a Booksy key exists in your settings when it does not. If support says no API is available for your account, you can still book and manage clients through The Mayor’s own calendar.',
 },
 {
  service:'fresha',name:'Fresha',authKind:'request_access',
  unlocks:'Reads your Fresha appointments and client list — reminders, no-show follow-up, and rebooking.',
  steps:[
   'Fresha offers API access through its partner program — there is no key sitting in your Fresha dashboard to copy.',
   'Request partner API access through Fresha support (in your Fresha account, open Help and start a chat, or use the contact form on fresha.com).',
   'Fresha will review the request and, if approved, issue you API credentials.',
   'Paste the credentials into the secure box below. They are encrypted the moment you save, and they are never shown again.',
  ],
  note:'Partner review is at Fresha’s discretion. While you wait, The Mayor can still handle bookings through your connected calendar.',
 },
 {
  service:'square',name:'Square',authKind:'api_key',
  apiBase:'https://connect.squareup.com/v2',
  unlocks:'Takes card payments and reads your Square sales — see what is actually coming in, not just what was booked.',
  steps:[
   'Go to developer.squareup.com and sign in with the same Square account you use for your business.',
   'Open “Apps” from the top menu and create an app — name it something clear like “The Mayor”.',
   'Open your new app and switch to the Production view (not Sandbox).',
   'Under the API keys section, copy your production Access token (it starts with sq0atp-).',
   'Paste it into the secure box below. It is encrypted the moment you save, and it is never shown again.',
  ],
  note:'Never paste a Sandbox token — it only works on fake test data. Use the Production token for your real business.',
  docUrl:'https://developer.squareup.com/',
 },
 {
  service:'stripe',name:'Stripe',authKind:'api_key',
  apiBase:'https://api.stripe.com/v1',
  unlocks:'Reads your Stripe payments — track real revenue from your online checkout, refunds and all.',
  steps:[
   'Go to dashboard.stripe.com and sign in.',
   'Click “Developers” in the top-right corner, then “API keys”.',
   'Make sure you are looking at Live mode (the toggle at the top), not Test mode.',
   'Under “Secret key”, click “Reveal” on the live secret key (it starts with sk_live_).',
   'Copy it and paste it into the secure box below. It is encrypted the moment you save, and it is never shown again.',
  ],
  note:'A test key (sk_test_) only sees test charges. For your real revenue, always use the live secret key — and keep it private like a password.',
  docUrl:'https://docs.stripe.com/',
 },
 {
  service:'google_business',name:'Google Business Profile',authKind:'oauth',oauthProvider:'google',
  unlocks:'Connects your Google account so The Mayor can see how your business shows up on Google — hours, reviews, and your Maps listing.',
  steps:[
   'Tap “Connect Google” below and sign in with the Google account that manages your business.',
   'Approve the access request. This uses Google’s own secure sign-in — The Mayor never sees your Google password.',
   'Done. Your business profile becomes visible to The Mayor through that Google connection.',
   'If you manage more than one location, sign in with the account that owns the right one — you can switch it later.',
  ],
  note:'Today this Google connection powers calendars and Gmail. Business Profile reads (reviews, hours) build on the same secure sign-in.',
  docUrl:'https://developers.google.com/my-business',
 },
 {
  service:'google',name:'Google',authKind:'oauth',oauthProvider:'google',
  unlocks:'Connects your Google account — calendars for appointments and Gmail for your inbox.',
  steps:[
   'Tap “Connect Google” below and sign in with your Google account.',
   'Approve the access request. This uses Google’s own secure sign-in — The Mayor never sees your Google password.',
   'Choose which calendar The Mayor should use for appointments.',
   'That’s it — The Mayor will now read and manage that calendar for you.',
  ],
 },
 {
  service:'microsoft',name:'Microsoft',authKind:'oauth',oauthProvider:'microsoft',
  unlocks:'Connects your Microsoft account — Outlook calendars for appointments.',
  steps:[
   'Tap “Connect Microsoft” below and sign in with your Microsoft account.',
   'Approve the access request. This uses Microsoft’s own secure sign-in — The Mayor never sees your Microsoft password.',
   'Choose which calendar The Mayor should use for appointments.',
   'That’s it — The Mayor will now read and manage that calendar for you.',
  ],
 },
 {
  service:'zoho',name:'Zoho',authKind:'oauth',oauthProvider:'zoho',
  unlocks:'Connects your Zoho account — Zoho calendars for appointments.',
  steps:[
   'Tap “Connect Zoho” below and sign in with your Zoho account.',
   'Approve the access request. This uses Zoho’s own secure sign-in — The Mayor never sees your Zoho password.',
   'Choose which calendar The Mayor should use for appointments.',
   'That’s it — The Mayor will now read and manage that calendar for you.',
  ],
 },
];

/** Lowercase aliases → canonical service key. Order matters: longer names first. */
const ALIASES:ReadonlyArray<readonly [alias:string,service:string]>=[
 ['google business profile','google_business'],['google my business','google_business'],
 ['google business','google_business'],['business profile','google_business'],
 ['booksy','booksy'],['vagaro','vagaro'],['fresha','fresha'],['shedul','fresha'],
 ['square','square'],['stripe','stripe'],['outlook','microsoft'],['microsoft','microsoft'],
 ['zoho','zoho'],['google','google'],
];

/** Resolve a free-text service mention to a canonical guide key. Null when unknown. */
export function resolveConnectorService(text:string):string|null{
 const value=text.toLowerCase();
 for(const [alias,service] of ALIASES)if(new RegExp(`\\b${alias.replace(/ /g,'\\s+')}\\b`).test(value))return service;
 return null;
}

/** Exact guide for a canonical service key. Null when unknown. */
export function guideForService(service:string):ConnectorGuide|null{
 return GUIDES.find(g=>g.service===service)??null;
}

/** Generic fallback guide for a service we have no specific guide for. */
export function genericConnectorGuide(serviceName:string):ConnectorGuide{
 const name=serviceName.trim().slice(0,60)||'that service';
 return {
  service:'unknown',name,authKind:'api_key',
  unlocks:`Connects ${name} so The Mayor can read what it knows about your business.`,
  steps:[
   'Open the service’s website in your browser and sign in.',
   'Open Settings (sometimes called Account or Profile), then look for a section called “Developer”, “API”, or “Integrations”.',
   'Look for a button like “Create API key”, “Generate token”, or “New secret”. Create one and give it a clear name like “The Mayor”.',
   'Copy the key right away — most services only show it once.',
   'Paste it into the secure box below. It is encrypted the moment you save, and it is never shown again.',
  ],
  note:'If you cannot find an API or Developer section, the service may not offer self-serve keys — contact their support and ask for integration access.',
 };
}

/** Top guided services for a vertical (salon first per the 6h brief). */
export function topServicesForVertical(vertical?:string):ConnectorGuide[]{
 const salon=['vagaro','booksy','fresha'].map(guideForService).filter((g):g is ConnectorGuide=>Boolean(g));
 const payments=['square','stripe'].map(guideForService).filter((g):g is ConnectorGuide=>Boolean(g));
 const googleBusiness=guideForService('google_business');
 const list=[...(googleBusiness?[googleBusiness]:[])];
 if(vertical==='salon')list.push(...salon,...payments);
 else list.push(...payments,...salon);
 return list;
}
