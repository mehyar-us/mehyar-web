import {it,expect} from 'vitest';
import {GoogleCalendarClient} from '../../src/connectors/google-calendar';

it('invokes native Worker fetch with its required global receiver',async()=>{
 // Preserve the actual workerd WebIDL receiver check while avoiding external
 // networking and credentials: only the requested URL becomes a data fixture.
 const nativeTransport=new Proxy(fetch,{apply(target,receiver,args){
  return Reflect.apply(target,receiver,['data:application/json,%7B%22items%22%3A%5B%5D%7D',args[1]]);
 }});
 const client=new GoogleCalendarClient({accountEmail:'fixture@example.test',accessToken:'synthetic-only',grantedScopes:['https://www.googleapis.com/auth/calendar.calendarlist.readonly']},{fetch:nativeTransport});
 expect(await client.listCalendars()).toEqual({items:[],nextCursor:undefined});
});
