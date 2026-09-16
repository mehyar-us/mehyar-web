import {describe,it,expect} from 'vitest';
import {calendarDirectory} from '../src/connectors/calendar-directory';
const calendar=(id:string,canWrite=true)=>({id,name:id,canWrite});
describe('bounded calendar directory',()=>{
  it('follows cursors and rechecks authority before and after every page',async()=>{
    const cursors:(string|undefined)[]=[],events:string[]=[];
    const result=await calendarDirectory({listCalendars:async cursor=>{
      cursors.push(cursor);events.push('read');
      return cursor?{items:[calendar('second')]}:{items:[calendar('first')],nextCursor:'private'};
    }},async()=>{events.push('guard');});
    expect(cursors).toEqual([undefined,'private']);
    expect(events).toEqual(['guard','read','guard','guard','read','guard']);
    expect(result).toEqual({items:[calendar('first'),calendar('second')],incomplete:false});
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('bounds looping cursors and merges duplicate authority conservatively',async()=>{
    let calls=0;
    const result=await calendarDirectory({listCalendars:async()=>({items:[calendar('same',++calls===1)],nextCursor:'loop'})},async()=>{});
    expect(calls).toBe(2);expect(result).toEqual({items:[calendar('same',false)],incomplete:true});
  });
  it('limits provider reads to ten pages',async()=>{
    let calls=0;
    const result=await calendarDirectory({listCalendars:async()=>({items:[calendar(String(++calls))],nextCursor:String(calls)})},async()=>{});
    expect(calls).toBe(10);expect(result.items).toHaveLength(10);expect(result.incomplete).toBe(true);
  });
  it('bounds the returned resource inventory',async()=>{
    const result=await calendarDirectory({listCalendars:async()=>({items:Array.from({length:1001},(_,i)=>calendar(String(i)))})},async()=>{});
    expect(result.items).toHaveLength(1000);expect(result.incomplete).toBe(true);
  });
  it('withholds prior pages when authority is revoked during a later page',async()=>{
    let calls=0;
    await expect(calendarDirectory({listCalendars:async()=>({items:[calendar(String(++calls))],nextCursor:String(calls)})},async()=>{
      if(calls===2)throw new Error('revoked');
    })).rejects.toThrow('revoked');expect(calls).toBe(2);
  });
  it('rejects malformed provider authority rather than treating it as writable',async()=>{
    await expect(calendarDirectory({listCalendars:async()=>({items:[{...calendar('id'),canWrite:'true' as unknown as boolean}]})},async()=>{}))
      .rejects.toMatchObject({kind:'invalid_response'});
  });
});
