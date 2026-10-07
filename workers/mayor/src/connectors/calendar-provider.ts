import {GoogleCalendarClient,GOOGLE_CALENDAR_OPERATIONS as google} from './google-calendar';
import {MicrosoftCalendarClient,MICROSOFT_CALENDAR_OPERATIONS as microsoft} from './microsoft-calendar';
import {ZohoCalendarClient,ZOHO_CALENDAR_OPERATIONS as zoho} from './zoho-calendar';
import type {Provider,ConnectorAuth,ClientOptions} from './types';
export function calendarOperations(provider:Provider){
 if(provider==='zoho')return zoho;
 if(provider==='google')return google;
 if(provider==='microsoft')return {...microsoft,list:microsoft.read,availability:microsoft.read};
 throw new Error('unsupported_calendar_provider');
}
export function calendarClient(provider:Provider,auth:ConnectorAuth,options?:ClientOptions){
 if(provider==='zoho')return new ZohoCalendarClient(auth,options);
 if(provider==='google')return new GoogleCalendarClient(auth,options);
 if(provider==='microsoft')return new MicrosoftCalendarClient(auth,options);
 throw new Error('unsupported_calendar_provider');
}
