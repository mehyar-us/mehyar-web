import {HttpError} from '../http';
import {ConnectorError,type Calendar,type Page} from './types';

type State={items:Calendar[];seen:string[];cursor?:string;pages:number;authorization:string};
type Scope={userId:string;grantId:string;provider:string;authorization:string};
type Row={id:string;user_id:string;grant_id:string;provider:string;state:string;expires:number;work:string|null;lease:number};
export type DirectoryResult={items:Calendar[];incomplete:boolean;continuation?:string};

/** Expiring per-business traversal state. Opaque tokens never contain provider cursors. */
export class CalendarSessions{
  constructor(private storage:DurableObjectStorage){}
  initialize(){this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS calendar_directory_sessions
    (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,grant_id TEXT NOT NULL,provider TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,work TEXT,lease INTEGER NOT NULL DEFAULT 0)`);}
  async read(scope:Scope,client:{listCalendars(cursor?:string):Promise<Page<Calendar>>},guard:()=>Promise<void>,token?:string):Promise<DirectoryResult>{
    await guard();
    const now=Date.now(),work=crypto.randomUUID();
    this.storage.sql.exec('DELETE FROM calendar_directory_sessions WHERE expires<=?',now);
    const row=this.storage.transactionSync(()=>{
      if(token&&!/^[a-f0-9-]{36}$/.test(token))throw new HttpError(400,'invalid_calendar_continuation','Reload the calendar list.');
      let saved=token?this.storage.sql.exec<Row>('SELECT * FROM calendar_directory_sessions WHERE id=?',token).toArray()[0]:undefined;
      if(token&&(!saved||saved.user_id!==scope.userId||saved.grant_id!==scope.grantId||saved.provider!==scope.provider||JSON.parse(saved.state).authorization!==scope.authorization))throw new HttpError(409,'calendar_continuation_expired','The calendar list expired. Reload it.');
      if(!saved){
        const count=this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM calendar_directory_sessions').one().count;
        if(count>=10)throw new HttpError(429,'calendar_directory_limit','Too many calendar lists are open. Try again in ten minutes.');
        saved={id:crypto.randomUUID(),user_id:scope.userId,grant_id:scope.grantId,provider:scope.provider,state:JSON.stringify({items:[],seen:[],pages:0,authorization:scope.authorization}),expires:now+600000,work:null,lease:0};
        this.storage.sql.exec('INSERT INTO calendar_directory_sessions(id,user_id,grant_id,provider,state,expires) VALUES(?,?,?,?,?,?)',saved.id,saved.user_id,saved.grant_id,saved.provider,saved.state,saved.expires);
      }
      if(saved.lease>now)throw new HttpError(409,'calendar_directory_busy','This calendar list is already loading.');
      this.storage.sql.exec('UPDATE calendar_directory_sessions SET work=?,lease=? WHERE id=?',work,now+120000,saved.id);
      return saved;
    });
    try{
      const state=JSON.parse(row.state) as State,items=new Map(state.items.map(item=>[item.id,item])),seen=new Set(state.seen);
      let incomplete=true,resumable=true;
      for(let n=0;n<5;n++){
        await guard();const page=await client.listCalendars(state.cursor);await guard();state.pages++;
        if(!Array.isArray(page.items)||page.items.length>1000)throw new ConnectorError('invalid_response','calendar.directory');
        for(const item of page.items){
          if(typeof item.id!=='string'||!item.id||item.id.length>2048||typeof item.name!=='string'||item.name.length>1000||typeof item.canWrite!=='boolean')throw new ConnectorError('invalid_response','calendar.directory');
          const prior=items.get(item.id);items.set(item.id,{...item,canWrite:item.canWrite&&(prior?.canWrite??true)});
        }
        state.items=[...items.values()];
        const next=page.nextCursor;
        if(next!==undefined&&(typeof next!=='string'||next.length>8192))throw new ConnectorError('invalid_response','calendar.directory');
        if(items.size>10000||new TextEncoder().encode(JSON.stringify(state.items)).length>1000000){throw new HttpError(409,'calendar_directory_too_large','This calendar directory needs service support before selection.');}
        if(!next){incomplete=false;resumable=false;break;}
        if(seen.has(next)||state.pages>=100){resumable=false;break;}
        seen.add(next);state.cursor=next;state.seen=[...seen];
      }
      await guard();
      const nextToken=crypto.randomUUID();
      this.storage.transactionSync(()=>{
        const current=this.storage.sql.exec<Row>('SELECT * FROM calendar_directory_sessions WHERE id=?',row.id).toArray()[0];
        if(!current||current.work!==work||current.lease<=Date.now()||current.expires<=Date.now())throw new HttpError(409,'calendar_continuation_expired','The calendar list expired. Reload it.');
        if(resumable)this.storage.sql.exec('UPDATE calendar_directory_sessions SET id=?,state=?,work=NULL,lease=0 WHERE id=?',nextToken,JSON.stringify(state),row.id);
        else this.storage.sql.exec('DELETE FROM calendar_directory_sessions WHERE id=?',row.id);
      });
      return {items:state.items,incomplete,...(resumable?{continuation:nextToken}:{})};
    }catch(error){
      // A failed read has no business effect; retry uses the last committed page state.
      this.storage.sql.exec('UPDATE calendar_directory_sessions SET work=NULL,lease=0 WHERE id=? AND work=?',row.id,work);
      if(!token)this.storage.sql.exec('DELETE FROM calendar_directory_sessions WHERE id=? AND work IS NULL',row.id);
      throw error;
    }
  }
}
