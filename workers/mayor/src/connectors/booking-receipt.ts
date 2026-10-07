import {z} from 'zod';
import {ConnectorError,type AppointmentInput,type Provider} from './types';
import {rescheduleReceipt} from './reschedule';

/** A successful HTTP response is insufficient if it describes a different event. */
export function bookingReceipt(provider:Provider,raw:unknown,calendarId:string,input:AppointmentInput,expectedId?:string){
 const fail=()=>new ConnectorError('ambiguous_write',`${provider}.calendar.create_receipt`);
 if(!raw||typeof raw!=='object')throw fail();
 const event=raw as Record<string,unknown>;
 if(typeof event.id!=='string'||!event.id||(expectedId&&event.id!==expectedId))throw fail();
 if(provider==='zoho'&&event.mayorRequestId!==input.requestId)throw fail();
 if(provider==='microsoft'&&event.transactionId!==input.requestId)throw fail();
 if((provider!=='microsoft'?event.summary:event.subject)!==input.title)throw fail();
 const recipients=z.array(provider!=='microsoft'?z.object({email:z.string()}):z.object({emailAddress:z.object({address:z.string()})})).safeParse(event.attendees??[]);
 if(!recipients.success)throw fail();
 const addresses=recipients.data.map((entry:any)=>(provider!=='microsoft'?entry.email:entry.emailAddress.address).toLowerCase()).sort();
 if(JSON.stringify(addresses)!==JSON.stringify(input.attendees.map(a=>a.toLowerCase()).sort()))throw fail();
 return rescheduleReceipt(provider,event,calendarId,event.id,input);
}
