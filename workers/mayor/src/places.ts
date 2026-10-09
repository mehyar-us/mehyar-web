/**
 * Crew 4 — Google Places onboarding.
 *
 * Thin client for the Google Places API (New). Data minimization (product
 * compliance, item 7): every request carries an X-Goog-FieldMask that asks
 * ONLY for the fields the "Is this you?" card renders — id, displayName,
 * formattedAddress, nationalPhoneNumber, regularOpeningHours.weekdayDescriptions,
 * photos (first photo only), primaryType. No other Place data is ever requested.
 *
 * Graceful degradation: GOOGLE_PLACES_API_KEY is a worker secret that does not
 * exist in prod yet (human step: Google Cloud Console → enable Places API (New)
 * → create a restricted key → `wrangler secret put GOOGLE_PLACES_API_KEY`).
 * When the key is absent every entry point degrades — search returns
 * {placesEnabled:false} and details returns null — so onboarding falls back to
 * today's manual question flow. Nothing here ever throws or blocks onboarding.
 */

export interface PlaceCard{
 placeId:string;
 name:string;
 address:string;
 phone:string;
 /** Weekday opening-hours lines, e.g. "Monday: 9:00 AM – 5:00 PM". */
 hours:string[];
 photoUrl:string;
 /** Google primary type, e.g. "hair_salon". Drives vertical detection. */
 category:string;
}

export interface PlacesSearchOutcome{
 /** false when GOOGLE_PLACES_API_KEY is absent or the API is unreachable —
  * the caller falls back to the manual question flow. */
 placesEnabled:boolean;
 places:PlaceCard[];
}

const TEXT_SEARCH_URL='https://places.googleapis.com/v1/places:searchText';
const PLACE_DETAILS_BASE='https://places.googleapis.com/v1/places/';
// Field masks: ONLY what the card renders (compliance item 7).
const SEARCH_FIELD_MASK='places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours.weekdayDescriptions,places.photos,places.primaryType';
const DETAILS_FIELD_MASK='id,displayName,formattedAddress,nationalPhoneNumber,regularOpeningHours.weekdayDescriptions,photos,primaryType';
const MAX_CANDIDATES=5;

/** Read the Places key from env without touching src/env.ts. Accepts unknown so
 * callers never fight the Env type — the value is validated defensively. */
export function placesApiKey(env:unknown):string|undefined{
 const raw=(env as {GOOGLE_PLACES_API_KEY?:unknown}|null|undefined)?.GOOGLE_PLACES_API_KEY;
 const key=typeof raw==='string'?raw.trim():'';
 return key?key:undefined;
}

interface PlacesRaw{
 id?:unknown;
 displayName?:{text?:unknown};
 formattedAddress?:unknown;
 nationalPhoneNumber?:unknown;
 regularOpeningHours?:{weekdayDescriptions?:unknown};
 photos?:Array<{name?:unknown}>;
 primaryType?:unknown;
}

function asString(value:unknown):string{
 return typeof value==='string'?value:'';
}

function photoUrlFor(photoName:unknown,apiKey:string):string{
 if(typeof photoName!=='string'||!photoName)return '';
 // The media URL carries the key as Google's documented web pattern. The
 // details route is auth-gated (401 unauthenticated) and the prod key must
 // carry HTTP-referrer restrictions so it cannot be reused off mayor.mehyar.us.
 return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=640&key=${encodeURIComponent(apiKey)}`;
}

function toPlaceCard(raw:PlacesRaw,apiKey:string):PlaceCard|null{
 const placeId=asString(raw.id);
 const name=asString(raw.displayName?.text);
 if(!placeId||!name)return null;
 const weekday=raw.regularOpeningHours?.weekdayDescriptions;
 return {
  placeId,
  name,
  address:asString(raw.formattedAddress),
  phone:asString(raw.nationalPhoneNumber),
  hours:Array.isArray(weekday)?weekday.filter((line):line is string=>typeof line==='string'):[],
  photoUrl:photoUrlFor(raw.photos?.[0]?.name,apiKey),
  category:asString(raw.primaryType),
 };
}

/**
 * Text search for up to 5 candidate businesses. Never throws: a missing key,
 * an empty query, an HTTP error, or a network failure all degrade to
 * {placesEnabled:false, places:[]} so the caller falls back to manual entry.
 */
export async function searchPlacesText(
 query:string,
 apiKey:string|undefined|null,
 fetchImpl:typeof fetch=globalThis.fetch,
):Promise<PlacesSearchOutcome>{
 const key=typeof apiKey==='string'?apiKey.trim():'';
 const text=(typeof query==='string'?query:'').trim();
 if(!key||!text)return {placesEnabled:false,places:[]};
 try{
  const response=await fetchImpl(TEXT_SEARCH_URL,{
   method:'POST',
   headers:{'content-type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':SEARCH_FIELD_MASK},
   body:JSON.stringify({textQuery:text,maxResultCount:MAX_CANDIDATES}),
  });
  if(!response.ok)return {placesEnabled:false,places:[]};
  const data=await response.json() as {places?:PlacesRaw[]};
  const raw=Array.isArray(data.places)?data.places:[];
  const places:PlaceCard[]=[];
  for(const candidate of raw){
   const card=toPlaceCard(candidate,key);
   if(card)places.push(card);
   if(places.length>=MAX_CANDIDATES)break;
  }
  return {placesEnabled:true,places};
 }catch{
  return {placesEnabled:false,places:[]};
 }
}

/**
 * Full card data for one place. Never throws: returns null when the key is
 * absent, the id is empty, the lookup fails, or the network fails.
 */
export async function getPlaceDetails(
 placeId:string,
 apiKey:string|undefined|null,
 fetchImpl:typeof fetch=globalThis.fetch,
):Promise<PlaceCard|null>{
 const key=typeof apiKey==='string'?apiKey.trim():'';
 const id=(typeof placeId==='string'?placeId:'').trim();
 if(!key||!id)return null;
 try{
  const response=await fetchImpl(`${PLACE_DETAILS_BASE}${encodeURIComponent(id)}`,{
   headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':DETAILS_FIELD_MASK},
  });
  if(!response.ok)return null;
  return toPlaceCard(await response.json() as PlacesRaw,key);
 }catch{
  return null;
 }
}
