import './connections.css';
import {loadConnectionsDialogs,unloadConnectionsDialogs} from './connections-dialogs-loader';
import type {DialogBags,DialogCallbacks,DialogScreen,DialogViewState} from './connections-dialogs';
import {loadConnectionsHub,unloadConnectionsHub} from './connections-hub-loader';
import type {ConnectionsHubActions,ConnectionsHubView,CustomCardView,HubAction,ProviderCardView} from './connections-hub';

type Provider='google'|'microsoft'|'zoho';
type Capability={id:string;label:string;enabled:boolean;reason?:string};
type Grant={id:string;provider:string;tenantId:string|null;status:string;selectedCapabilities:string[];grantedCapabilities?:string[]};
type Connection={id:string;label:string;type:'api'|'webhook'|'mcp';endpoint?:string;origin?:string;status:string;hasSecret?:boolean;revision:number;toolCount?:number;lastCheckedAt?:string|null;lastCheckStatus?:string|null};
type Tool={name:string;title?:string;description?:string;effect:'read'|'write';inputSchema?:unknown};
type Proposal={id:string;expiresAt:string;effect:'read'|'write';readback:string|string[];connectionId:string;tool:string;args:unknown};
type Token={id:string;label:string;scopes:string[];createdAt:string;expiresAt:string;lastUsedAt:string|null;revokedAt:string|null};
export type ConnectionsHooks={
 api:(path:string,body?:unknown)=>Promise<any>;
 tenant:()=>string;
 actor?:()=>string;
 canManage:()=>boolean;
 onConnect:(provider:Provider,capabilities:string[])=>void|Promise<void>;
 onCalendar:(provider?:Provider)=>void|Promise<void>;
 onAccount:()=>void|Promise<void>;
 ask:(text:string)=>void;
 pendingProviders?:readonly {id:string;label:string;status:string}[];
 onChanged?:()=>void;
};
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
const errorText=(error:unknown)=>error instanceof Error?error.message:'This could not finish. Please try again.';
const pretty=(value:unknown)=>JSON.stringify(value,null,2)??'No result was returned.';
const canonical=(value:unknown):string=>value!==null&&typeof value==='object'?(Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}'):JSON.stringify(value);
const dateText=(value:string|null)=>{if(!value)return 'Never';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleDateString():'Unavailable';};
const providerLabels:Record<Provider,string>={google:'Google',microsoft:'Microsoft',zoho:'Zoho'};

/** Account changes and outbound tools require explicit actions; the supplied API owns authorization. */
export function createConnections(hooks:ConnectionsHooks){
 const element=node('section','','connections-hub');element.setAttribute('aria-label','Connections');
 const dialogs=new Set<HTMLDialogElement>();
 let epoch=0,version=0,active=false,activeTenant='',activeActor='';
 let providers:Record<string,{configured:boolean;capabilities:Capability[]}>={},grants:Grant[]=[],selection:any=null;
 let custom:Connection[]=[],tokens:Token[]=[],endpoint='',builtInError='',customError='',tokenError='';
 const base=()=>`/api/businesses/${encodeURIComponent(activeTenant)}`;
 const stamp=()=>({epoch,tenant:activeTenant,actor:activeActor});
 function current(saved:ReturnType<typeof stamp>){return active&&saved.epoch===epoch&&saved.tenant===activeTenant&&saved.tenant===hooks.tenant()&&saved.actor===activeActor&&saved.actor===(hooks.actor?.()??'');}
 function managed(saved:ReturnType<typeof stamp>){return current(saved)&&hooks.canManage();}
 function announce(message:string,alert=false){const status=element.querySelector<HTMLElement>('.connections-status');if(status){status.textContent=message;status.setAttribute('role',alert?'alert':'status');}}
 function focusHeading(){requestAnimationFrame(()=>{const heading=element.querySelector<HTMLElement>('.connections-heading h2');if(heading&&element.getClientRects().length){heading.tabIndex=-1;heading.focus({preventScroll:true});}});}
 function reset(){active=false;epoch++;version++;for(const modal of dialogs){if(modal.open)modal.close();modal.replaceChildren();modal.remove();}dialogs.clear();providers={};grants=[];selection=null;custom=[];tokens=[];endpoint='';builtInError=customError=tokenError='';activeTenant=activeActor='';element.replaceChildren();hubRendered=false;unloadConnectionsHub(element);}
 async function activate(){
  const tenant=hooks.tenant(),actor=hooks.actor?.()??'';if(!tenant){reset();return;}
  if(activeTenant!==tenant||activeActor!==actor){reset();activeTenant=tenant;activeActor=actor;}
  active=true;const saved=stamp(),load=++version;
  if(!hubRendered)pushHub(loadingHubView());
  const requests=await Promise.allSettled([
   hooks.canManage()?Promise.all([hooks.api('/api/auth/capabilities'),hooks.api('/api/auth/grants'),hooks.api(base()+'/calendars/selected')]):Promise.resolve(null),
   hooks.canManage()?hooks.api(base()+'/connections'):Promise.resolve(null),
   hooks.api(base()+'/mcp/tokens'),
  ]);
  if(!current(saved)||load!==version)return;
  const [builtIn,connections,mcp]=requests;
  if(builtIn.status==='fulfilled'&&builtIn.value){providers=builtIn.value[0].providers??{};grants=builtIn.value[1].grants??[];selection=builtIn.value[2].selection??null;builtInError='';}else{providers={};grants=[];selection=null;builtInError=builtIn.status==='rejected'?errorText(builtIn.reason):'';}
  if(connections.status==='fulfilled'&&connections.value){custom=connections.value.connections??[];customError='';}else{custom=[];customError=connections.status==='rejected'?errorText(connections.reason):'';}
  if(mcp.status==='fulfilled'){tokens=mcp.value.tokens??[];endpoint=safeMcpEndpoint(mcp.value.endpoint);tokenError='';}else{tokens=[];endpoint='';tokenError=errorText(mcp.reason);}
  render();
 }
 function safeMcpEndpoint(value:unknown){if(typeof value!=='string')return '';try{const url=new URL(value,location.origin);return url.origin===location.origin&&url.pathname==='/mcp'&&!url.search&&!url.hash?url.href:'';}catch{return '';}}
 // React migration S5c: dialog screens render as React (connections-dialogs.tsx)
 // inside the native <dialog> the module still owns — showModal, the pending
 // guard, close cleanup, and focus restore stay here; all flow logic
 // (idempotency signatures, proposal validation, stamp guards) stays here too.
 type Stamp=ReturnType<typeof stamp>;
 interface DialogSession{
  modal:HTMLDialogElement;mount:HTMLElement;view:DialogViewState;bags:DialogBags;callbacks:DialogCallbacks;
  review?:{apply:()=>Promise<unknown>;back?:()=>void;onSaved?:(result:any)=>void;retrySafe:boolean;saved:Stamp};
  add?:{requestId:string;signature:string;saved:Stamp};
  tools?:{connection:Connection;list:Tool[];saved:Stamp};
  toolFlow?:{connection:Connection;tool:Tool;requestId:string;signature:string;expired:boolean;saved:Stamp;proposal:Proposal|null};
  tokenSaved?:Stamp;tokenBack?:()=>void;
 }
 const sessions=new Map<HTMLDialogElement,DialogSession>();
 function pushDialog(session:DialogSession){loadConnectionsDialogs(session.mount,{view:session.view,bags:session.bags,callbacks:session.callbacks});}
 function setScreen(session:DialogSession,title:string,screen:DialogScreen){session.view={...session.view,title,screen};pushDialog(session);}
 function dialog(titleText:string){
  const modal=node('dialog','','workday-dialog connections-dialog');document.body.append(modal);dialogs.add(modal);
  const titleId='connections-dialog-'+crypto.randomUUID();modal.setAttribute('aria-labelledby',titleId);
  const mount=document.createElement('div');modal.append(mount);
  const saved=stamp(),previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const session:DialogSession={modal,mount,view:{title:titleText,titleId,pending:false,screen:null},bags:{add:{label:'',type:'api',endpoint:'',authentication:'none',secret:'',readNames:''},token:{label:'',days:'30'},tool:{args:'{}'}},callbacks:null as unknown as DialogCallbacks};
  session.callbacks=makeDialogCallbacks(session);
  sessions.set(modal,session);
  modal.addEventListener('cancel',event=>{if(modal.dataset.pending==='true')event.preventDefault();});
  modal.addEventListener('close',()=>{dialogs.delete(modal);sessions.delete(modal);unloadConnectionsDialogs(mount);modal.replaceChildren();modal.remove();if(current(saved)&&previous?.isConnected)previous.focus({preventScroll:true});},{once:true});
  pushDialog(session);
  modal.showModal();return modal;
 }
 function closeDialog(modal:HTMLDialogElement){return new Promise<void>(resolve=>{if(!dialogs.has(modal)){resolve();return;}modal.addEventListener('close',()=>resolve(),{once:true});modal.close();});}
 function pending(modal:HTMLDialogElement,value:boolean){modal.dataset.pending=String(value);modal.setAttribute('aria-busy',String(value));const session=sessions.get(modal);if(session){session.view={...session.view,pending:value};pushDialog(session);}}
 function review(modal:HTMLDialogElement,title:string,lines:string[],confirmLabel:string,apply:()=>Promise<unknown>,back?:()=>void,onSaved?: (result:any)=>void,retrySafe=true){
  const session=sessions.get(modal);if(!session)return;
  session.review={apply,back,onSaved,retrySafe,saved:stamp()};
  setScreen(session,title,{kind:'review',lines,confirmLabel,backLabel:back?'Back':'Cancel',message:'',alert:false,buttonsDisabled:false});
 }
 function makeDialogCallbacks(session:DialogSession):DialogCallbacks{
  const modal=session.modal;
  const screenOf=()=>session.view.screen;
  return {
   close:()=>modal.close(),
   reviewBack:()=>{if(session.review?.back)session.review.back();else modal.close();},
   reviewConfirm:()=>{void(async()=>{
    const reviewState=session.review,screen=screenOf();
    if(!reviewState||screen?.kind!=='review'||screen.buttonsDisabled)return;
    if(!current(reviewState.saved))return;
    setScreen(session,session.view.title,{...screen,buttonsDisabled:true,message:'Working…',alert:false});
    pending(modal,true);
    try{
     const result=await reviewState.apply();
     if(!current(reviewState.saved)||!modal.isConnected)return;
     if(reviewState.onSaved){reviewState.onSaved(result);return;}
     await closeDialog(modal);if(!current(reviewState.saved))return;
     hooks.onChanged?.();await activate();if(current(reviewState.saved)){announce('Saved.');focusHeading();}
    }catch(error){
     if(current(reviewState.saved)&&modal.isConnected){
      const latest=screenOf();
      if(latest?.kind==='review'){
       if(reviewState.retrySafe)setScreen(session,session.view.title,{...latest,message:errorText(error),alert:true,buttonsDisabled:false});
       else{setScreen(session,session.view.title,{...latest,message:'Token creation could not be confirmed. Close this window and check your token list before creating another.',alert:true,buttonsDisabled:true});modal.addEventListener('close',()=>{if(current(reviewState.saved))void activate();},{once:true});}
      }
     }
    }finally{if(modal.isConnected)pending(modal,false);}
   })();},
   addSubmit:()=>{
    const add=session.add;if(!add||!managed(add.saved))return;
    const bag=session.bags.add;
    try{
     const url=new URL(bag.endpoint);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use an HTTPS endpoint without credentials in the URL.');
     const values={label:bag.label.trim(),type:bag.type,endpoint:url.href,authentication:bag.authentication,...(bag.secret?{secret:bag.secret}:{}),...(bag.type==='mcp'?{readOnlyTools:[...new Set(bag.readNames.split(/[\n,]/).map(value=>value.trim()).filter(Boolean))]}:{})};
     const next=canonical(values);if(add.signature&&add.signature!==next)add.requestId=crypto.randomUUID();add.signature=next;
     const body={requestId:add.requestId,...values};
     const typeLabel=bag.type==='api'?'API':bag.type==='webhook'?'Webhook':'MCP · HTTP';
     review(modal,'Review connection',[body.label,`${typeLabel} · ${url.hostname}`,bag.authentication==='none'?'No saved key.':'The key is stored securely and will not be displayed.',bag.type==='mcp'&&bag.readNames.trim()?'Only the tool names you listed may run as reads. Other tools require approval.':'Outbound writes require approval.'],'Add connection',async()=>{if(!managed(add.saved))throw new Error('Your connection access has ended.');const result=await hooks.api(base()+'/connections/add',body);bag.secret='';delete (body as {secret?:string}).secret;return result;},()=>setScreen(session,'Add a connection',{kind:'add-form',message:'',alert:false}));
    }catch(error){setScreen(session,'Add a connection',{kind:'add-form',message:errorText(error),alert:true});}
   },
   toolOpen:(index)=>{const tools=session.tools;if(!tools)return;const tool=tools.list[index];if(tool)toolForm(session,tools.connection,tool);},
   toolFormSubmit:()=>{
    const flow=session.toolFlow,screen=screenOf();
    if(!flow||!managed(flow.saved)||screen?.kind!=='tool-form'||screen.saveDisabled)return;
    let parsed:unknown,next:string;
    try{parsed=JSON.parse(session.bags.tool.args);if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Use a JSON object for the tool arguments.');next=canonical(parsed);if(new TextEncoder().encode(next).length>8192)throw new Error('Keep tool arguments within 8 KB.');}
    catch(error){setScreen(session,session.view.title,{...screen,message:errorText(error),alert:true});return;}
    if(flow.signature&&flow.signature!==next)flow.requestId=crypto.randomUUID();flow.signature=next;
    setScreen(session,session.view.title,{...screen,saveDisabled:true,message:'Preparing preview…',alert:false});
    void(async()=>{
     try{
      const response=await hooks.api(base()+'/connections/tools/prepare',{connectionId:flow.connection.id,tool:flow.tool.name,args:parsed,requestId:flow.requestId});
      if(!managed(flow.saved)||!modal.isConnected)return;
      const proposal=response.proposal as Proposal;
      if(!proposal||typeof proposal.id!=='string'||proposal.connectionId!==flow.connection.id||proposal.tool!==flow.tool.name||!['read','write'].includes(proposal.effect)||canonical(proposal.args)!==next)throw new Error('The saved preview did not match this action. Open the tool again.');
      flow.proposal=proposal;
      setScreen(session,proposal.effect==='write'?'Approve external action':'Review read',{kind:'tool-preview',detailTitle:`${flow.connection.label} · ${flow.tool.name}`,lines:(Array.isArray(proposal.readback)?proposal.readback:[proposal.readback]).map(line=>String(line)),argsPretty:pretty(proposal.args),runLabel:proposal.effect==='write'?'Approve & run':'Run read',status:'',statusAlert:false,buttonsDisabled:false});
     }catch(error){if(current(flow.saved)&&modal.isConnected)setScreen(session,flow.tool.title??flow.tool.name,{kind:'tool-form',connectionLabel:flow.connection.label,schemaPretty:flow.tool.inputSchema?pretty(flow.tool.inputSchema):null,message:errorText(error),alert:true,saveDisabled:false});}
    })();
   },
   previewBack:()=>{
    const flow=session.toolFlow;if(!flow)return;
    if(flow.expired){flow.requestId=crypto.randomUUID();flow.expired=false;}
    setScreen(session,flow.tool.title??flow.tool.name,{kind:'tool-form',connectionLabel:flow.connection.label,schemaPretty:flow.tool.inputSchema?pretty(flow.tool.inputSchema):null,message:'',alert:false,saveDisabled:false});
   },
   previewRun:()=>{
    const flow=session.toolFlow,screen=screenOf();
    if(!flow||screen?.kind!=='tool-preview'||screen.buttonsDisabled||!flow.proposal)return;
    if(!managed(flow.saved))return;
    const proposal=flow.proposal;
    if(!Number.isFinite(Date.parse(proposal.expiresAt))||Date.parse(proposal.expiresAt)<=Date.now()){flow.expired=true;setScreen(session,session.view.title,{...screen,status:'This preview expired. Go back to prepare it again.',statusAlert:true});return;}
    setScreen(session,session.view.title,{...screen,buttonsDisabled:true,status:'Running…',statusAlert:false});
    pending(modal,true);
    void(async()=>{
     try{
      const result=await hooks.api(base()+'/connections/tools/confirm',{proposalId:proposal.id,approved:true});
      if(!managed(flow.saved)||!modal.isConnected)return;
      const text=pretty(result.result??result);
      setScreen(session,'Tool result',{kind:'tool-result',text:text.slice(0,24000),truncated:text.length>24000});
      hooks.onChanged?.();
     }catch(error){if(current(flow.saved)&&modal.isConnected){const latest=screenOf();if(latest?.kind==='tool-preview')setScreen(session,session.view.title,{...latest,status:`${errorText(error)} The result could not be confirmed. Check the destination before starting another action.`,statusAlert:true});}}
     finally{if(modal.isConnected)pending(modal,false);}
    })();
   },
   tokenSubmit:()=>{
    if(!session.tokenSaved||!current(session.tokenSaved))return;
    const bag=session.bags.token,saved=session.tokenSaved;
    review(modal,'Review token',[bag.label.trim(),`Read-only access to your business. Expires in ${bag.days} days.`],'Create token',()=>hooks.api(base()+'/mcp/tokens',{label:bag.label.trim(),scopes:['business:read'],expiresInDays:Number(bag.days)}),()=>session.tokenBack?.(),result=>{
     if(!current(saved))return;
     const valid=typeof result.token==='string'&&result.token.startsWith('mayor_mcp_');
     setScreen(session,'Save your token',{kind:'token-saved',invalid:!valid,token:valid?result.token:'',endpoint:valid?safeMcpEndpoint(result.endpoint):'',message:''});
     if(valid){result.token='';modal.addEventListener('close',()=>{if(current(saved))void activate();},{once:true});}
    },false);
   },
   tokenCopy:()=>{void(async()=>{
    const screen=screenOf();if(screen?.kind!=='token-saved'||!session.tokenSaved)return;
    try{await navigator.clipboard.writeText(screen.token);if(current(session.tokenSaved))setScreen(session,'Save your token',{...screen,message:'Token copied.'});}
    catch{if(current(session.tokenSaved))setScreen(session,'Save your token',{...screen,message:'Copy is unavailable. Select the text and copy it.'});}
   })();},
   tokenDone:()=>modal.close(),
   resultDone:()=>modal.close(),
  };
 }


 // React migration S5a: the hub's main render is React (connections-hub.tsx)
 // driven by this view model; the dialog system below stays imperative.
 let hubRendered=false;
 const hubActions:ConnectionsHubActions={refresh:()=>void activate(),addConnection:()=>addConnection(),copyText:(text:string)=>copyValue(text),createToken:()=>createToken()};
 function pushHub(view:ConnectionsHubView){hubRendered=true;loadConnectionsHub(element,{view,actions:hubActions});}
 function loadingHubView():ConnectionsHubView{return {loading:true,canManage:false,builtInError:'',providers:[],pending:[],customError:'',customEmpty:true,customs:[],mcpError:'',mcpEndpoint:'',tokens:[],activeTokenCount:0};}
 function buildHubView():ConnectionsHubView{
  const connected=(provider:Provider)=>grants.some(grant=>grant.provider===provider&&grant.tenantId===activeTenant&&grant.status==='authorized');
  const order=(['google','microsoft','zoho'] as Provider[]).slice().sort((a,b)=>Number(connected(b))-Number(connected(a)));
  return {
   loading:false,
   canManage:hooks.canManage(),
   builtInError,
   providers:hooks.canManage()&&!builtInError?order.map(provider=>providerView(provider)):[],
   pending:(hooks.pendingProviders??[]).map(pending=>({key:pending.id,title:pending.label,detail:'Social channels',status:pending.status})),
   customError,
   customEmpty:!custom.length,
   customs:custom.map(connection=>customView(connection)),
   mcpError:tokenError,
   mcpEndpoint:endpoint,
   tokens:tokens.map(token=>({id:token.id,label:token.label,line:token.revokedAt?'Revoked':Date.parse(token.expiresAt)<=Date.now()?'Expired':`Read only \u00b7 expires ${dateText(token.expiresAt)}`,revoke:token.revokedAt?null:()=>revokeToken(token)})),
   activeTokenCount:tokens.filter(token=>!token.revokedAt).length,
  };
 }
 function render(){pushHub(buildHubView());}
 function providerView(provider:Provider):ProviderCardView{
  const config=providers[provider],own=grants.filter(grant=>grant.provider===provider&&grant.tenantId===activeTenant&&grant.status!=='revoked'),toolCapabilities=['calendar_read','calendar_manage','gmail_read'];
  const hasTool=(grant:Grant)=>grant.selectedCapabilities.some(id=>toolCapabilities.includes(id)&&grant.grantedCapabilities?.includes(id));
  const requested=own.filter(grant=>grant.selectedCapabilities.some(id=>toolCapabilities.includes(id))),authorized=requested.filter(grant=>grant.status==='authorized'&&hasTool(grant)),grant=authorized.find(item=>item.id===selection?.grantId)??authorized[0]??requested[0];
  const selected=selection?.provider===provider,available=selected&&selection?.available!==false;
  const title=providerLabels[provider],detail=provider==='google'?'Calendar & Gmail':'Calendar';
  const stateText=grant?.status==='authorized'&&hasTool(grant)?'Connected':grant?'Reconnect needed':'Not connected';
  const cap=config?.capabilities??[],enabled=cap.filter(value=>value.enabled).map(value=>value.id);
  const actions:HubAction[]=[];
  const connect:HubAction={label:grant?'Reconnect':'Connect',icon:'plug',className:'secondary',disabled:!enabled.includes('calendar_manage'),run:()=>{const allowed=[...new Set(['calendar_manage',...(grant?.selectedCapabilities??[])])].filter(id=>enabled.includes(id));void invoke(()=>hooks.onConnect(provider,allowed));}};
  if(!grant||grant.status!=='authorized'||!hasTool(grant))actions.push(connect);
  let gmailLine:string|undefined,selectionLine:string|undefined,setupLine:string|undefined;
  if(grant?.status==='authorized'&&hasTool(grant)){
   const calendarGrant=authorized.find(value=>value.selectedCapabilities.some(id=>(id==='calendar_read'||id==='calendar_manage')&&value.grantedCapabilities?.includes(id)));
   if(calendarGrant)actions.push({label:selected?'Calendar settings':'Choose calendar',icon:'calendar',className:'secondary',run:()=>void invoke(()=>hooks.onCalendar(provider))});
   else if(enabled.includes('calendar_manage'))actions.push({label:'Connect calendar',icon:'calendar',className:'secondary',run:()=>void invoke(()=>hooks.onConnect(provider,[...new Set([...grant.selectedCapabilities.filter(id=>enabled.includes(id)),'calendar_manage'])]))});
   if(provider==='google'&&cap.some(value=>value.id==='gmail_read')){
    const gmailAllowed=enabled.includes('gmail_read'),gmailGrant=authorized.find(value=>value.selectedCapabilities.includes('gmail_read')&&value.grantedCapabilities?.includes('gmail_read'));
    gmailLine=gmailGrant?'Gmail read access connected':gmailAllowed?'Gmail read access available':'Gmail connection unavailable';
    if(!gmailGrant&&gmailAllowed)actions.push({label:'Connect Gmail',icon:'mail',className:'secondary',run:()=>void invoke(()=>hooks.onConnect('google',[...new Set([...(grant.selectedCapabilities??[]).filter(id=>enabled.includes(id)),'gmail_read'])]))});
   }
   actions.push({label:'Disconnect',icon:'unplug',className:'quiet',run:()=>disconnectProvider(provider,grant)});
  }
  if(provider==='google'&&(!grant||grant.status!=='authorized'||!hasTool(grant)))gmailLine=enabled.includes('gmail_read')?'Gmail read access available':'Gmail connection unavailable';
  if(selected)selectionLine=available?`Selected \u00b7 ${selection.calendar?.name??'Calendar'}`:'Selected calendar needs attention';
  if(!enabled.includes('calendar_manage')&&!grant)setupLine='Connection setup is unavailable.';
  return {key:provider,title,detail,icon:provider==='google'?'mail':'calendar',stateText,gmailLine,selectionLine,setupLine,actions};
 }
 async function invoke(action:()=>void|Promise<void>){const saved=stamp();if(!managed(saved))return;try{await action();}catch(error){if(current(saved))announce(errorText(error),true);}}
 function disconnectProvider(provider:Provider,grant:Grant){if(!hooks.canManage())return;const modal=dialog(`Disconnect ${providerLabels[provider]}?`),saved=stamp();review(modal,'Review disconnect',[`Disconnect the saved ${providerLabels[provider]} access.`,provider==='google'?'Calendar and Gmail access on this grant will stop.':'Calendar access on this grant will stop.'],'Disconnect',async()=>{if(!managed(saved))throw new Error('Your connection access has ended.');return hooks.api('/api/auth/grants/revoke',{grantId:grant.id,tenantId:activeTenant});});}
 const checkingIds=new Set<string>();
 function customView(connection:Connection):CustomCardView{
  const detail=connection.origin??connection.endpoint??connection.type.toUpperCase();
  const stateText=connection.status==='connected'?'Configured':connection.status==='disconnected'?'Disconnected':connection.status==='error'?'Needs attention':connection.status==='ready'?'Ready':connection.status.replace(/_/g,' ');
  const checkWord=connection.lastCheckStatus==='verified'?'Verified':connection.lastCheckStatus==='reachable'?'Reachable':connection.lastCheckStatus==='configured'?(connection.type==='webhook'?"Configuration saved — health cannot be checked without sending a message":'Configuration checked'):'Last check';
  const lastCheckLine=connection.lastCheckedAt?`${checkWord} \u00b7 ${dateText(connection.lastCheckedAt)}`:(connection.type==='webhook'?"Health cannot be checked without sending a message":undefined);
  const icon=connection.type==='webhook'?'webhook':connection.type==='mcp'?'server':'braces';
  const endpointRef=connection.endpoint??connection.origin;
  if(connection.status==='disconnected')return {key:connection.id,title:connection.label,detail,icon,stateText,lastCheckLine,endpointRef,actions:null};
  const saved=stamp();
  const check:HubAction={label:'Check',icon:'refresh',className:'secondary',disabled:checkingIds.has(connection.id),run:()=>{if(!managed(saved))return;checkingIds.add(connection.id);pushHub(buildHubView());void(async()=>{try{const result=await hooks.api(base()+`/connections/${encodeURIComponent(connection.id)}/check`,{});if(!managed(saved))return;await activate();if(current(saved)){announce(typeof result.message==='string'?result.message:result.status==='configured'?'Configuration checked. No external action was sent.':'Connection checked.');focusHeading();}}catch(error){if(current(saved))announce(errorText(error),true);}finally{checkingIds.delete(connection.id);if(element.isConnected&&hubRendered)pushHub(buildHubView());}})();}};
  return {key:connection.id,title:connection.label,detail,icon,stateText,lastCheckLine,endpointRef,actions:[{label:'Tools',icon:'play',className:'secondary',run:()=>void toolList(connection)},check,{label:'Disconnect',icon:'unplug',className:'quiet',run:()=>disconnectCustom(connection)}]};
 }
 function addConnection(){
  if(!hooks.canManage())return;const modal=dialog('Add a connection'),session=sessions.get(modal)!;
  session.add={requestId:crypto.randomUUID(),signature:'',saved:stamp()};
  modal.addEventListener('close',()=>{session.bags.add.secret='';if(session.add)session.add.signature='';},{once:true});
  setScreen(session,'Add a connection',{kind:'add-form',message:'',alert:false});
 }
 function disconnectCustom(connection:Connection){if(!hooks.canManage())return;const modal=dialog('Disconnect connection?'),saved=stamp();review(modal,'Review disconnect',[connection.label,'Saved access to this connection will stop.'],'Disconnect',async()=>{if(!managed(saved))throw new Error('Your connection access has ended.');return hooks.api(base()+`/connections/${encodeURIComponent(connection.id)}/disconnect`,{revision:connection.revision});});}
 async function toolList(connection:Connection){
  if(!hooks.canManage())return;const modal=dialog(`${connection.label} tools`),session=sessions.get(modal)!,saved=stamp();
  setScreen(session,`${connection.label} tools`,{kind:'tools',message:'Loading tools…',alert:false,tools:null});
  try{
   const result=await hooks.api(base()+`/connections/${encodeURIComponent(connection.id)}/tools`);
   if(!managed(saved)||!modal.isConnected)return;
   const tools=result.tools as Tool[];
   if(!Array.isArray(tools)||!tools.length){setScreen(session,`${connection.label} tools`,{kind:'tools',message:'No tools were returned.',alert:false,tools:null});return;}
   const valid=tools.filter(tool=>tool&&typeof tool.name==='string'&&['read','write'].includes(tool.effect));
   session.tools={connection,list:valid,saved};
   setScreen(session,`${connection.label} tools`,{kind:'tools',message:'',alert:false,tools:valid.map(tool=>({name:tool.name,title:tool.title??tool.name,description:tool.description,effect:tool.effect}))});
  }catch(error){if(current(saved)&&modal.isConnected)setScreen(session,`${connection.label} tools`,{kind:'tools',message:errorText(error),alert:true,tools:null});}
 }
 function toolForm(session:DialogSession,connection:Connection,tool:Tool){
  session.toolFlow={connection,tool,requestId:crypto.randomUUID(),signature:'',expired:false,saved:stamp(),proposal:null};
  session.bags.tool.args='{}';
  setScreen(session,tool.title??tool.name,{kind:'tool-form',connectionLabel:connection.label,schemaPretty:tool.inputSchema?pretty(tool.inputSchema):null,message:'',alert:false,saveDisabled:false});
 }

 async function copyValue(text:string):Promise<boolean>{const saved=stamp();try{await navigator.clipboard.writeText(text);return current(saved);}catch{if(current(saved))announce('Copy is unavailable in this browser.',true);return false;}}
 async function copy(text:string,success:string,status?:HTMLElement){const saved=stamp();try{await navigator.clipboard.writeText(text);if(current(saved)){if(status)status.textContent=success;else announce(success);}}catch{if(current(saved)){if(status)status.textContent='Copy is unavailable. Select the text and copy it.';else announce('Copy is unavailable in this browser.',true);}}}
 function createToken(){
  const modal=dialog('Create a Mayor token'),session=sessions.get(modal)!;
  session.tokenSaved=stamp();
  session.tokenBack=()=>setScreen(session,'Create a Mayor token',{kind:'token-form'});
  setScreen(session,'Create a Mayor token',{kind:'token-form'});
 }
 function revokeToken(token:Token){const modal=dialog('Revoke token?'),saved=stamp();review(modal,'Review revoke',[token.label,'Assistants using this token will lose access.'],'Revoke token',()=>{if(!current(saved))throw new Error('Your workspace access has ended.');return hooks.api(base()+`/mcp/tokens/${encodeURIComponent(token.id)}/revoke`,{});});}
 return {element,activate,reset};
}
