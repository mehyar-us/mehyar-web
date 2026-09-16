import { HttpError } from '../http';
import { ConnectorError, type Page } from './types';
import type { MailFolder } from './mail-folders';

type Scope = { userId:string; grantId:string; authorization:string };
type Pending = { parent?:string; cursor?:string; seen:string[] };
type State = { items:MailFolder[]; pending:Pending[]; pages:number; complete:boolean };
type Row = { id:string; scope:string; state:string; expires:number; work:string|null; lease:number };
export type FolderInventory = { items:MailFolder[]; incomplete:boolean; continuation?:string; inventoryId?:string };
const expired = () => new HttpError(409,'folder_inventory_expired','Reload the mailbox folder list.');
const scopeKey = (scope:Scope) => JSON.stringify([scope.userId,scope.grantId,scope.authorization]);

/** Stored only in the owning business Agent. Provider cursors never leave its storage. */
export class FolderSessions {
  constructor(private storage:DurableObjectStorage) {}
  initialize() {
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS mailbox_folder_sessions
      (id TEXT PRIMARY KEY,scope TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,work TEXT,lease INTEGER NOT NULL DEFAULT 0)`);
  }
  private row(scope:Scope,id:string) {
    if(!/^[a-f0-9-]{36}$/.test(id))throw expired();
    const row=this.storage.sql.exec<Row>('SELECT * FROM mailbox_folder_sessions WHERE id=?',id).toArray()[0];
    if(!row||row.scope!==scopeKey(scope)||row.expires<=Date.now())throw expired();
    return row;
  }
  async read(scope:Scope,client:{listFolders(parent?:string,cursor?:string):Promise<Page<MailFolder>>},guard:()=>Promise<void>,token?:string):Promise<FolderInventory> {
    await guard();
    const now=Date.now(),work=crypto.randomUUID();
    const row=this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM mailbox_folder_sessions WHERE expires<=?',now);
      let saved:Row;
      if(token)saved=this.row(scope,token);
      else {
        if(this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM mailbox_folder_sessions').one().count>=10)
          throw new HttpError(429,'folder_inventory_limit','Too many folder lists are open. Try again in ten minutes.');
        saved={id:crypto.randomUUID(),scope:scopeKey(scope),state:JSON.stringify({items:[],pending:[{seen:[]}],pages:0,complete:false}),expires:now+600000,work:null,lease:0};
        this.storage.sql.exec('INSERT INTO mailbox_folder_sessions(id,scope,state,expires) VALUES(?,?,?,?)',saved.id,saved.scope,saved.state,saved.expires);
      }
      if(JSON.parse(saved.state).complete)throw expired();
      if(saved.lease>now)throw new HttpError(409,'folder_inventory_busy','This folder list is already loading.');
      this.storage.sql.exec('UPDATE mailbox_folder_sessions SET work=?,lease=? WHERE id=?',work,now+120000,saved.id);
      return saved;
    });
    try {
      const state=JSON.parse(row.state) as State;
      const items=new Map(state.items.map(item=>[item.id,item]));
      let stopped=false;
      for(let n=0;n<5&&state.pending.length;n++) {
        const task=state.pending[0]!;
        await guard();const page=await client.listFolders(task.parent,task.cursor);await guard();
        state.pages++;
        if(!Array.isArray(page.items)||page.items.length>1000)throw new ConnectorError('invalid_response','mailbox.folder_inventory');
        for(const item of page.items) {
          // The provider adapter validates fields. Repeated IDs across pages or branches
          // indicate a changing/looping directory; never call that a complete snapshot.
          if(items.has(item.id)||item.id===item.parentFolderId||(task.parent!==undefined&&item.parentFolderId!==task.parent)) {
            stopped=true;break;
          }
          items.set(item.id,item);
          if(item.childFolderCount>0)state.pending.push({parent:item.id,seen:[]});
        }
        state.items=[...items.values()];
        if(page.nextCursor) {
          if(task.seen.includes(page.nextCursor))stopped=true;
          else {task.seen.push(page.nextCursor);task.cursor=page.nextCursor;}
        } else state.pending.shift();
        if(state.items.length>10000||new TextEncoder().encode(JSON.stringify(state)).length>1000000)
          throw new HttpError(409,'folder_inventory_too_large','This mailbox needs service support before folder selection.');
        if(state.pages>=100&&state.pending.length)stopped=true;
        if(stopped)break;
      }
      state.complete=!stopped&&state.pending.length===0;
      await guard();
      const next=crypto.randomUUID();
      this.storage.transactionSync(()=>{
        const current=this.row(scope,row.id);
        if(current.work!==work||current.lease<=Date.now())throw expired();
        if(stopped)this.storage.sql.exec('DELETE FROM mailbox_folder_sessions WHERE id=?',row.id);
        else this.storage.sql.exec('UPDATE mailbox_folder_sessions SET id=?,state=?,work=NULL,lease=0 WHERE id=?',next,JSON.stringify(state),row.id);
      });
      return {items:state.items,incomplete:!state.complete,...(stopped?{}:state.complete?{inventoryId:next}:{continuation:next})};
    } catch(error) {
      this.storage.sql.exec('UPDATE mailbox_folder_sessions SET work=NULL,lease=0 WHERE id=? AND work=?',row.id,work);
      if(!token)this.storage.sql.exec('DELETE FROM mailbox_folder_sessions WHERE id=? AND work IS NULL',row.id);
      throw error;
    }
  }
  /** Selection must be resolved from a complete, current-consent inventory, never client-supplied folder metadata. */
  async select(scope:Scope,inventoryId:string,ids:string[],guard:()=>Promise<void>):Promise<MailFolder[]> {
    await guard();
    if(!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw new HttpError(400,'invalid_mailbox_folders','Select between one and 100 distinct folders.');
    const read=()=>{
      const row=this.row(scope,inventoryId),state=JSON.parse(row.state) as State;
      if(!state.complete||row.work)throw expired();
      const items=new Map(state.items.map(item=>[item.id,item]));
      return ids.map(id=>{const item=items.get(id);if(!item)throw new HttpError(400,'unknown_mailbox_folder','Reload and select a listed folder.');return item;});
    };
    read();await guard();return read();
  }
}
