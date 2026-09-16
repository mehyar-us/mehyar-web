import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
type Folder={id:string;displayName:string;parentFolderId:string;childFolderCount:number;isHidden:boolean};
type Inventory={items:Folder[];incomplete:boolean;continuation?:string;inventoryId?:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function valid(value:unknown):value is Inventory {
  const v=value as Inventory|null;
  if(!v||typeof v.incomplete!=='boolean'||!Array.isArray(v.items)||v.items.length>10000)return false;
  if(v.continuation!==undefined&&(typeof v.continuation!=='string'||!uuid.test(v.continuation)))return false;
  if(v.inventoryId!==undefined&&(typeof v.inventoryId!=='string'||!uuid.test(v.inventoryId)))return false;
  if(v.incomplete?v.inventoryId!==undefined:(!v.inventoryId||v.continuation!==undefined))return false;
  const ids=new Set<string>();
  return v.items.every(f=>{
    if(!f||typeof f.id!=='string'||!f.id||f.id.length>2048||ids.has(f.id)||typeof f.displayName!=='string'||!f.displayName||f.displayName.length>2048
      ||typeof f.parentFolderId!=='string'||!f.parentFolderId||f.parentFolderId===f.id||typeof f.isHidden!=='boolean'
      ||!Number.isSafeInteger(f.childFolderCount)||f.childFolderCount<0)return false;
    ids.add(f.id);return true;
  });
}
export default function OutlookFolders({tenantId,grantId,online,onUnauthorized}:{tenantId:string;grantId:string;online:boolean;onUnauthorized:(error:unknown)=>void}) {
  const [inventory,setInventory]=useState<Inventory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string[]>([]),[configured,setConfigured]=useState<number|null>(null);
  const [pending,setPending]=useState<{inventoryId:string;folderIds:string[]}|null>(null);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>{request.current?.abort();setInventory(null);setSelected([]);setPending(null);setConfigured(null);setError('');setBusy(false);return()=>request.current?.abort();},[tenantId,grantId,online]);
  async function load(continuation?:string) {
    request.current?.abort();setInventory(null);setSelected([]);setPending(null);setConfigured(null);setError('');if(!online)return;
    const controller=new AbortController();request.current=controller;setBusy(true);
    try {
      const result=await api<unknown>(`/api/tenants/${encodeURIComponent(tenantId)}/connections/${encodeURIComponent(grantId)}/mailbox/folders`,
        {method:'POST',body:JSON.stringify(continuation?{continuation}:{}),signal:controller.signal});
      if(!valid(result))throw new Error('The folder list could not be verified. Reload it.');
      if(!controller.signal.aborted)setInventory(result);
    } catch(cause) {
      if(controller.signal.aborted)return;
      if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);
      setError(cause instanceof Error?cause.message:'The folder list is unavailable. Reload it.');
    } finally {if(!controller.signal.aborted)setBusy(false);}
  }
  async function configure() {
    if(!online||busy||!inventory?.inventoryId||inventory.incomplete)return;
    const payload=pending??{inventoryId:inventory.inventoryId,folderIds:selected};
    if(!payload.folderIds.length||payload.folderIds.length>100)return;
    setPending(payload);setBusy(true);setError('');
    const controller=new AbortController();request.current=controller;
    try {
      const result=await api<{state:string;configuredFolders:number}>(`/api/tenants/${encodeURIComponent(tenantId)}/connections/${encodeURIComponent(grantId)}/mailbox/setup`,
        {method:'POST',body:JSON.stringify(payload),signal:controller.signal});
      if(result.state!=='configured'||result.configuredFolders!==payload.folderIds.length)throw new Error('Setup could not be verified.');
      if(!controller.signal.aborted){setConfigured(result.configuredFolders);setPending(null);}
    }catch(cause){
      if(controller.signal.aborted)return;
      if(cause instanceof ApiError&&cause.status===401)onUnauthorized(cause);
      setError(`${cause instanceof Error?cause.message:'Setup could not be verified.'} Retry the same selection or reload the folder list.`);
    }finally{if(!controller.signal.aborted)setBusy(false);}
  }
  const byId=new Map(inventory?.items.map(f=>[f.id,f])??[]);
  return <section className="mailbox-panel" aria-label="Outlook mailbox folders" aria-busy={busy}>
    <h3>Outlook mailbox folders</h3>
    <p>Discover the folders available for monitoring. Loading this list does not start monitoring or send messages.</p>
    {!online?<p role="status">Reconnect to load mailbox folders.</p>:<>
      {error&&<p role="alert">{error}</p>}
      {busy&&<p role="status">{pending?'Saving folder selection…':'Loading mailbox folders…'}</p>}
      {configured!==null&&<p role="status">{configured} folders configured. This confirms setup, not that synchronization has completed. Existing folders keep their progress and any recovery state.</p>}
      {inventory&&<>
        <p role="status">{inventory.incomplete?inventory.continuation?'More folders remain to be discovered.':'Discovery could not finish. Reload the list or contact support.':'Folder discovery complete. Monitoring is not configured by this step.'}</p>
        <p>{inventory.items.length} folders discovered.</p>
        {inventory.items.length>0&&<ul>{inventory.items.map(f=>{
          const label=`${f.displayName}${byId.has(f.parentFolderId)?` — in ${byId.get(f.parentFolderId)!.displayName}`:''}${f.isHidden?' (hidden)':''}`;
          return <li key={f.id}>{inventory.incomplete?label:<label><input type="checkbox" checked={selected.includes(f.id)} disabled={busy||!!pending||configured!==null||selected.length>=100&&!selected.includes(f.id)}
            onChange={event=>setSelected(ids=>event.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/>{label}</label>}</li>;
        })}</ul>}
        {!inventory.incomplete&&configured===null&&<>
          <p>Select up to 100 folders. Setup adds monitoring for these folders; it does not remove previously configured folders or authorize sending.</p>
          <button type="button" disabled={busy||selected.length===0} onClick={()=>void configure()}>{pending?'Retry same folder setup':'Set up selected folders'}</button>
        </>}
        {inventory.continuation&&<button type="button" disabled={busy} onClick={()=>void load(inventory.continuation)}>Load more folders</button>}
      </>}
      <button type="button" disabled={busy} onClick={()=>void load()}>{inventory||error?'Reload folder list':'Discover mailbox folders'}</button>
    </>}
  </section>;
}
