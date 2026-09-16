import {describe,it,expect} from 'vitest';
import {calendarDirectory} from '../src/connectors/calendar-directory';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import type {Env} from '../src/env';
import {CalendarSessions} from '../src/connectors/calendar-sessions';
const scope={userId:'owner',grantId:'grant',provider:'google'};
async function session(work:(sessions:CalendarSessions,storage:DurableObjectStorage)=>Promise<void>){
  const stub=await getAgentByName((env as unknown as Env).BUSINESS_AGENTS,crypto.randomUUID());
  await runInDurableObject(stub,async(_instance,ctx)=>{const sessions=new CalendarSessions(ctx.storage);sessions.initialize();await work(sessions,ctx.storage);});
}
const calendar=(id:string,canWrite=true)=>({id,name:id,canWrite});
describe('bounded calendar directory',()=>{
  it('continues beyond a batch with private cursors and conservative duplicate authority',async()=>session(async(sessions,storage)=>{
    let reads=0;const client={listCalendars:async(cursor?:string)=>{reads++;expect(cursor).toBe(reads===1?undefined:`provider-secret-${reads-1}`);return {items:[calendar('same',reads<6),calendar(String(reads))],...(reads<11?{nextCursor:`provider-secret-${reads}`}:{})};}};
    const first=await sessions.read(scope,client,async()=>{});expect(reads).toBe(5);expect(first.incomplete).toBe(true);expect(JSON.stringify(first)).not.toContain('provider-secret');
    const second=await new CalendarSessions(storage).read(scope,client,async()=>{},first.continuation);expect(reads).toBe(10);expect(second.items.find(c=>c.id==='same')?.canWrite).toBe(false);
    const last=await sessions.read(scope,client,async()=>{},second.continuation);expect(last.incomplete).toBe(false);expect(last.continuation).toBeUndefined();expect(last.items).toHaveLength(12);
    expect(storage.sql.exec('SELECT * FROM calendar_directory_sessions').toArray()).toEqual([]);
  }));
  it('rejects cross-account, cross-user and expired handles without provider reads',async()=>session(async(sessions,storage)=>{
    let reads=0;const client={listCalendars:async()=>({items:[calendar(String(++reads))],nextCursor:`private-${reads}`})};
    const first=await sessions.read(scope,client,async()=>{});
    for(const other of [{...scope,userId:'other'},{...scope,grantId:'other'},{...scope,provider:'microsoft'}])await expect(sessions.read(other,client,async()=>{},first.continuation)).rejects.toMatchObject({code:'calendar_continuation_expired'});
    storage.sql.exec('UPDATE calendar_directory_sessions SET expires=0');await expect(sessions.read(scope,client,async()=>{},first.continuation)).rejects.toMatchObject({code:'calendar_continuation_expired'});expect(reads).toBe(5);
  }));
  it('does not return partial data after revoked access or advance its continuation',async()=>session(async sessions=>{
    let reads=0;const client={listCalendars:async()=>({items:[calendar(String(++reads))],nextCursor:`private-${reads}`})};
    const first=await sessions.read(scope,client,async()=>{});
    await expect(sessions.read(scope,client,async()=>{if(reads>=6)throw new Error('revoked');},first.continuation)).rejects.toThrow('revoked');
    let received:string|undefined;await sessions.read(scope,{listCalendars:async cursor=>{received=cursor;return {items:[]};}},async()=>{},first.continuation);expect(received).toBe('private-5');
  }));
  it('fences concurrent continuation work and stale completion',async()=>session(async(sessions,storage)=>{
    let reads=0;const first=await sessions.read(scope,{listCalendars:async()=>({items:[],nextCursor:`cursor-${++reads}`})},async()=>{});
    await expect(sessions.read(scope,{listCalendars:async()=>{
      await expect(sessions.read(scope,{listCalendars:async()=>{throw new Error('unexpected read');}},async()=>{},first.continuation)).rejects.toMatchObject({code:'calendar_directory_busy'});
      storage.sql.exec("UPDATE calendar_directory_sessions SET work='replacement'");return {items:[]};
    }},async()=>{},first.continuation)).rejects.toMatchObject({code:'calendar_continuation_expired'});
    expect(storage.sql.exec<{work:string}>('SELECT work FROM calendar_directory_sessions').one().work).toBe('replacement');
  }));
  it('stops cursor loops without offering another continuation',async()=>session(async sessions=>{
    const result=await sessions.read(scope,{listCalendars:async()=>({items:[calendar('one')],nextCursor:'loop'})},async()=>{});
    expect(result).toEqual({items:[calendar('one')],incomplete:true});
  }));
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
