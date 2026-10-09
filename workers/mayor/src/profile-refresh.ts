import {verticalProfile} from './verticals';
import type {Profile} from './memory';

/** Fields the vertical refresh recomputes. Never touches anything else. */
export type RefreshField='description'|'industry';
export interface ProfileRefreshChange{field:RefreshField;from:string|null;to:string}
export interface ProfileRefreshPreview{
 vertical:string;
 label:string;
 /** Empty when the profile already matches the vertical. */
 changes:ProfileRefreshChange[];
 description:string;
 industry:string;
}

const cleanList=(values:unknown):string[]=>Array.isArray(values)
 ?values.filter((v):v is string=>typeof v==='string'&&v.trim().length>0).map(v=>v.trim())
 :[];

/** Compose an honest business description from the vertical profile and the
 * owner's saved onboarding answers. Deterministic — no model call, no invented
 * facts. Stays within the profileSchema description limit. */
export function composeVerticalDescription(vertical:string,profile:Profile):string{
 const vp=verticalProfile(vertical);
 const parts:string[]=[];
 const services=cleanList(profile.services).slice(0,6);
 const locations=cleanList(profile.locations).slice(0,3);
 let head=vp.label;
 if(services.length)head+=` offering ${services.join(', ')}`;
 parts.push(head+'.');
 if(locations.length)parts.push(`Serving ${locations.join('; ')}.`);
 const hours=typeof profile.hours==='string'?profile.hours.trim():'';
 if(hours)parts.push(`Hours: ${hours.slice(0,300)}`);
 return parts.join(' ').slice(0,2000);
}

/** Preview what a vertical refresh would change. Returns null when no vertical
 * is set (nothing authoritative to refresh from). */
export function profileRefreshPreview(profile:Profile):ProfileRefreshPreview|null{
 const vp=verticalProfile(profile.vertical);
 if(vp.vertical==='other')return null;
 const description=composeVerticalDescription(vp.vertical,profile);
 const industry=vp.label;
 const changes:ProfileRefreshChange[]=[];
 if((profile.description??'').trim()!==description)
  changes.push({field:'description',from:profile.description??null,to:description});
 if((profile.industry??'').trim()!==industry)
  changes.push({field:'industry',from:profile.industry??null,to:industry});
 return {vertical:vp.vertical,label:vp.label,changes,description,industry};
}
