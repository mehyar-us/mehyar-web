import {ConnectorError,type Calendar,type Page} from './types';

/** Provider cursors stay server-side. Bound work and reject cursor loops without
 * presenting an incomplete directory as a complete account inventory. */
export async function calendarDirectory(client:{listCalendars(cursor?:string):Promise<Page<Calendar>>},guard:()=>Promise<void>) {
  const calendars=new Map<string,Calendar>(),seen=new Set<string>();
  let cursor:string|undefined;
  for(let page=0;page<10;page++) {
    await guard();
    const result=await client.listCalendars(cursor);
    await guard();
    for(const calendar of result.items) {
      if(typeof calendar.id!=='string'||!calendar.id||typeof calendar.name!=='string'||typeof calendar.canWrite!=='boolean')
        throw new ConnectorError('invalid_response','calendar.directory');
      // A repeated resource with different authority must never widen access.
      const previous=calendars.get(calendar.id);
      if(previous)calendars.set(calendar.id,{...calendar,canWrite:previous.canWrite&&calendar.canWrite});
      else {
        if(calendars.size>=1000)return {items:[...calendars.values()],incomplete:true};
        calendars.set(calendar.id,calendar);
      }
    }
    cursor=result.nextCursor;
    if(!cursor)return {items:[...calendars.values()],incomplete:false};
    if(seen.has(cursor))return {items:[...calendars.values()],incomplete:true};
    seen.add(cursor);
  }
  return {items:[...calendars.values()],incomplete:true};
}
