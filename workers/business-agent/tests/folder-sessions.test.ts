import { describe,it,expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { getAgentByName } from 'agents';
import type { Env } from '../src/env';
import { FolderSessions } from '../src/connectors/folder-sessions';
const scope={userId:'owner',grantId:'grant',authorization:'consent'};
const guard=async()=>{};
const folder=(id:string,parentFolderId='root',childFolderCount=0)=>({id,parentFolderId,childFolderCount,displayName:id,isHidden:false});
async function session(work:(sessions:FolderSessions,storage:DurableObjectStorage)=>Promise<void>) {
  const stub=await getAgentByName((env as unknown as Env).BUSINESS_AGENTS,crypto.randomUUID());
  await runInDurableObject(stub,async(_instance,ctx)=>{const sessions=new FolderSessions(ctx.storage);sessions.initialize();await work(sessions,ctx.storage);});
}
describe('private resumable Outlook folder inventories',()=>{
  it('traverses root pagination and nested folders across restarts before allowing selection',async()=>session(async(sessions,storage)=>{
    const calls:unknown[]=[];
    const client={listFolders:async(parent?:string,cursor?:string)=>{
      calls.push([parent,cursor]);
      if(!parent)return cursor?{items:[folder('b','root',1)]}:{items:[folder('a','root',1)],nextCursor:'private-root'};
      if(parent==='a')return {items:[folder('c','a',1)]};
      if(parent==='b')return {items:[folder('d','b',1)]};
      return {items:[folder(parent==='c'?'e':'f',parent)]};
    }};
    const first=await sessions.read(scope,client,guard);
    expect(first.incomplete).toBe(true);expect(first.inventoryId).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain('private-root');
    await expect(sessions.select(scope,first.continuation!,['a'],guard)).rejects.toMatchObject({code:'folder_inventory_expired'});
    const last=await new FolderSessions(storage).read(scope,client,guard,first.continuation);
    expect(last.incomplete).toBe(false);expect(last.items).toHaveLength(6);
    expect(calls).toEqual([[undefined,undefined],[undefined,'private-root'],['a',undefined],['b',undefined],['c',undefined],['d',undefined]]);
    expect(await sessions.select(scope,last.inventoryId!,['a','f'],guard)).toEqual([folder('a','root',1),folder('f','d')]);
    await expect(sessions.select(scope,last.inventoryId!,['unknown'],guard)).rejects.toMatchObject({code:'unknown_mailbox_folder'});
    await expect(sessions.read(scope,client,guard,first.continuation)).rejects.toMatchObject({code:'folder_inventory_expired'});
  }));
  it('binds inventories to user, account, consent and expiry',async()=>session(async(sessions,storage)=>{
    let calls=0;const client={listFolders:async()=>({items:[],nextCursor:`private-${++calls}`})};
    const first=await sessions.read(scope,client,guard);
    for(const other of [{...scope,userId:'other'},{...scope,grantId:'other'},{...scope,authorization:'renewed'}])
      await expect(sessions.read(other,client,guard,first.continuation)).rejects.toMatchObject({code:'folder_inventory_expired'});
    storage.sql.exec('UPDATE mailbox_folder_sessions SET expires=0');
    await expect(sessions.read(scope,client,guard,first.continuation)).rejects.toMatchObject({code:'folder_inventory_expired'});
    expect(calls).toBe(5);
  }));
  it('retains the last committed page on revocation and withholds collected data',async()=>session(async sessions=>{
    let calls=0;const client={listFolders:async()=>({items:[],nextCursor:`private-${++calls}`})};
    const first=await sessions.read(scope,client,guard);
    await expect(sessions.read(scope,client,async()=>{if(calls>5)throw new Error('revoked');},first.continuation)).rejects.toThrow('revoked');
    let received:string|undefined;
    const last=await sessions.read(scope,{listFolders:async(_parent,cursor)=>{received=cursor;return {items:[]};}},guard,first.continuation);
    expect(received).toBe('private-5');expect(last.incomplete).toBe(false);
  }));
  it('fences concurrent work and stale completion',async()=>session(async(sessions,storage)=>{
    let calls=0;const client={listFolders:async()=>({items:[],nextCursor:`private-${++calls}`})};
    const first=await sessions.read(scope,client,guard);
    await expect(sessions.read(scope,{listFolders:async()=>{
      await expect(sessions.read(scope,client,guard,first.continuation)).rejects.toMatchObject({code:'folder_inventory_busy'});
      storage.sql.exec("UPDATE mailbox_folder_sessions SET work='replacement'");return {items:[]};
    }},guard,first.continuation)).rejects.toMatchObject({code:'folder_inventory_expired'});
    expect(storage.sql.exec<{work:string}>('SELECT work FROM mailbox_folder_sessions').one().work).toBe('replacement');
  }));
  it('stops repeated resources and cursor loops without a selectable inventory',async()=>session(async sessions=>{
    const duplicate=await sessions.read(scope,{listFolders:async()=>({items:[folder('a')],nextCursor:crypto.randomUUID()})},guard);
    expect(duplicate).toEqual({items:[folder('a')],incomplete:true});
    const loop=await sessions.read(scope,{listFolders:async()=>({items:[],nextCursor:'loop'})},guard);
    expect(loop).toEqual({items:[],incomplete:true});
  }));
  it('bounds total traversal and stored bytes without claiming completeness',async()=>session(async sessions=>{
    let calls=0,token:string|undefined;
    for(let batch=0;batch<20;batch++) {
      const result=await sessions.read(scope,{listFolders:async()=>({items:[],nextCursor:`private-${++calls}`})},guard,token);
      expect(result.incomplete).toBe(true);expect(result.inventoryId).toBeUndefined();token=result.continuation;
    }
    expect(calls).toBe(100);expect(token).toBeUndefined();
    await expect(sessions.read(scope,{listFolders:async()=>({items:Array.from({length:600},(_,i)=>({...folder(String(i)),displayName:'x'.repeat(2048)}))})},guard)).rejects.toMatchObject({code:'folder_inventory_too_large'});
  }));
  it('rechecks authority before selection and rejects duplicate selection',async()=>session(async sessions=>{
    const result=await sessions.read(scope,{listFolders:async()=>({items:[folder('a')]})},guard);
    await expect(sessions.select(scope,result.inventoryId!,['a','a'],guard)).rejects.toMatchObject({code:'invalid_mailbox_folders'});
    let checks=0;
    await expect(sessions.select(scope,result.inventoryId!,['a'],async()=>{if(++checks===2)throw new Error('revoked');})).rejects.toThrow('revoked');
  }));
});
