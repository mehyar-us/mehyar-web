import {createElement,Plug,CalendarDays,Mail,Globe,Webhook,Braces,Server,Plus,Check,Copy,X,ArrowLeft,RefreshCw,Unplug,KeyRound,ChevronRight,Play} from 'lucide';
import './connections.css';

type Provider='google'|'microsoft'|'zoho';
type Icon=Parameters<typeof createElement>[0];
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
const icon=(shape:Icon)=>{const el=createElement(shape);el.setAttribute('aria-hidden','true');el.setAttribute('focusable','false');return el;};
const button=(label:string,action:()=>void,className='secondary',shape?:Icon)=>{const el=node('button',label,className);el.type='button';el.onclick=action;if(shape)el.prepend(icon(shape));return el;};
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
 function focusHeading(){const heading=element.querySelector<HTMLElement>('.connections-heading h2');if(heading&&element.getClientRects().length){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
 function reset(){active=false;epoch++;version++;for(const modal of dialogs){if(modal.open)modal.close();modal.replaceChildren();modal.remove();}dialogs.clear();providers={};grants=[];selection=null;custom=[];tokens=[];endpoint='';builtInError=customError=tokenError='';activeTenant=activeActor='';element.replaceChildren();}
 async function activate(){
  const tenant=hooks.tenant(),actor=hooks.actor?.()??'';if(!tenant){reset();return;}
  if(activeTenant!==tenant||activeActor!==actor){reset();activeTenant=tenant;activeActor=actor;}
  active=true;const saved=stamp(),load=++version;
  if(!element.childElementCount)element.append(node('p','Loading connections…','connections-status'));
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
 function dialog(titleText:string){
  const modal=node('dialog','','workday-dialog connections-dialog'),head=node('div','','dialog-heading'),title=node('h2',titleText),close=button('',()=>modal.close(),'connection-icon-button',X);close.setAttribute('aria-label','Close');
  title.id='connections-dialog-'+crypto.randomUUID();modal.setAttribute('aria-labelledby',title.id);head.append(title,close);modal.append(head);document.body.append(modal);dialogs.add(modal);
  const saved=stamp(),previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.addEventListener('cancel',event=>{if(modal.dataset.pending==='true')event.preventDefault();});
  modal.addEventListener('close',()=>{dialogs.delete(modal);modal.replaceChildren();modal.remove();if(current(saved)&&previous?.isConnected)previous.focus({preventScroll:true});},{once:true});
  modal.showModal();return modal;
 }
 function closeDialog(modal:HTMLDialogElement){return new Promise<void>(resolve=>{if(!dialogs.has(modal)){resolve();return;}modal.addEventListener('close',()=>resolve(),{once:true});modal.close();});}
 function pending(modal:HTMLDialogElement,value:boolean){modal.dataset.pending=String(value);modal.setAttribute('aria-busy',String(value));const close=modal.querySelector<HTMLButtonElement>('.dialog-heading button');if(close)close.disabled=value;}
 function field<T extends HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(form:HTMLElement,label:string,control:T){const wrapper=node('label','','connection-field');wrapper.append(node('span',label),control);form.append(wrapper);return control;}
 function input(value='',max=200){const el=node('input');el.value=value;el.maxLength=max;return el;}
 function select(choices:{value:string;label:string}[],value=''){const el=node('select');for(const choice of choices){const option=node('option',choice.label);option.value=choice.value;el.append(option);}if(value)el.value=value;return el;}
 function formMessage(parent:HTMLElement){const status=node('p','','connection-form-status');status.setAttribute('role','status');parent.append(status);return status;}
 function submit(parent:HTMLFormElement,label:string){const actions=node('div','','connection-actions'),save=node('button',label,'primary');save.type='submit';actions.append(save);parent.append(actions);return save;}
 function review(modal:HTMLDialogElement,title:string,lines:string[],confirmLabel:string,apply:()=>Promise<unknown>,back?:()=>void,onSaved?: (result:any)=>void,retrySafe=true){
  const head=modal.querySelector<HTMLElement>('.dialog-heading')!;head.querySelector('h2')!.textContent=title;modal.replaceChildren(head);
  const list=node('ul','','connection-readback');for(const line of lines)list.append(node('li',line));modal.append(list);const message=formMessage(modal),actions=node('div','','connection-actions'),saved=stamp();
  const goBack=button(back?'Back':'Cancel',()=>back?back():modal.close(),'secondary',back?ArrowLeft:undefined);
  const confirm=button(confirmLabel,()=>{if(confirm.disabled||!current(saved))return;confirm.disabled=goBack.disabled=true;pending(modal,true);message.textContent='Working…';void(async()=>{try{const result=await apply();if(!current(saved)||!modal.isConnected)return;if(onSaved){onSaved(result);return;}await closeDialog(modal);if(!current(saved))return;hooks.onChanged?.();await activate();if(current(saved)){announce('Saved.');focusHeading();}}catch(error){if(current(saved)&&modal.isConnected){message.textContent=retrySafe?errorText(error):'Token creation could not be confirmed. Close this window and check your token list before creating another.';message.setAttribute('role','alert');if(retrySafe)confirm.disabled=goBack.disabled=false;else modal.addEventListener('close',()=>{if(current(saved))void activate();},{once:true});}}finally{if(modal.isConnected)pending(modal,false);}})();},'primary',Check);
  actions.append(goBack,confirm);modal.append(actions);confirm.focus();
 }
 function card(title:string,detail:string,shape:Icon,status:string){const item=node('article','','connection-card'),header=node('div','','connection-card-header'),mark=node('span','','connection-mark'),copy=node('div');mark.append(icon(shape));copy.append(node('h3',title),node('p',detail,'connection-subtle'));header.append(mark,copy);item.append(header,node('p',status,'connection-state'));return item;}
 function render(){
  element.replaceChildren();const heading=node('div','','connections-heading');heading.append(node('div'));heading.firstElementChild!.append(node('h2','Connections'),node('p','Bring your tools together.','connection-subtle'));
  heading.append(button('Check status',()=>void activate(),'connection-icon-button',RefreshCw));element.append(heading);heading.lastElementChild!.setAttribute('aria-label','Check connection status');
  const status=node('p','','connections-status');status.setAttribute('role','status');element.append(status);
  const services=node('section','','connection-section');services.append(node('h3','Your accounts'));const grid=node('div','','connection-grid');services.append(grid);element.append(services);
  if(!hooks.canManage())grid.append(node('p','Your business owner manages shared connections.','connection-subtle'));
  else if(builtInError){const error=node('p',builtInError,'connection-error');error.setAttribute('role','alert');grid.append(error);}
  else{const connected=(provider:Provider)=>grants.some(grant=>grant.provider===provider&&grant.tenantId===activeTenant&&grant.status==='authorized');
   // Value order: connected providers first, then the canonical Google > Microsoft > Zoho order. Stable sort keeps the canonical order within each group.
   const order=(['google','microsoft','zoho'] as Provider[]).slice().sort((a,b)=>Number(connected(b))-Number(connected(a)));
   for(const provider of order)renderProvider(grid,provider);}
  for(const pending of hooks.pendingProviders??[]){const pendingCard=card(pending.label,'Social channels',Globe,pending.status);pendingCard.classList.add('connection-pending');grid.append(pendingCard);}
  if(hooks.canManage()){
   const section=node('section','','connection-section'),title=node('div','','connection-section-heading');title.append(node('h3','Custom connections'),button('Add',addConnection,'secondary',Plus));section.append(title);const cards=node('div','','connection-grid');section.append(cards);
   if(customError){const error=node('p',customError,'connection-error');error.setAttribute('role','alert');cards.append(error);}else if(!custom.length)cards.append(node('p','Connect an API, webhook, or HTTP MCP server.','connection-subtle'));else for(const connection of custom)renderCustom(cards,connection);
   element.append(section);
  }
  renderMcp();
 }
 function renderProvider(grid:HTMLElement,provider:Provider){
  const config=providers[provider],own=grants.filter(grant=>grant.provider===provider&&grant.tenantId===activeTenant&&grant.status!=='revoked'),toolCapabilities=['calendar_read','calendar_manage','gmail_read'];
  const hasTool=(grant:Grant)=>grant.selectedCapabilities.some(id=>toolCapabilities.includes(id)&&grant.grantedCapabilities?.includes(id));
  const requested=own.filter(grant=>grant.selectedCapabilities.some(id=>toolCapabilities.includes(id))),authorized=requested.filter(grant=>grant.status==='authorized'&&hasTool(grant)),grant=authorized.find(item=>item.id===selection?.grantId)??authorized[0]??requested[0];
  const selected=selection?.provider===provider,available=selected&&selection?.available!==false;
  const title=providerLabels[provider],detail=provider==='google'?'Calendar & Gmail':'Calendar';
  const item=card(title,detail,provider==='google'?Mail:CalendarDays,grant?.status==='authorized'&&hasTool(grant)?'Connected':grant?'Reconnect needed':'Not connected');
  const cap=config?.capabilities??[],enabled=cap.filter(value=>value.enabled).map(value=>value.id),actions=node('div','','connection-actions');
  const connect=button(grant?'Reconnect':'Connect',()=>{const allowed=[...new Set(['calendar_manage',...(grant?.selectedCapabilities??[])])].filter(id=>enabled.includes(id));void invoke(()=>hooks.onConnect(provider,allowed));},'secondary',Plug);connect.disabled=!enabled.includes('calendar_manage');
  if(!grant||grant.status!=='authorized'||!hasTool(grant))actions.append(connect);
  if(grant?.status==='authorized'&&hasTool(grant)){
   const calendarGrant=authorized.find(value=>value.selectedCapabilities.some(id=>(id==='calendar_read'||id==='calendar_manage')&&value.grantedCapabilities?.includes(id)));
   if(calendarGrant)actions.append(button(selected?'Calendar settings':'Choose calendar',()=>void invoke(()=>hooks.onCalendar(provider)),'secondary',CalendarDays));
   else if(enabled.includes('calendar_manage'))actions.append(button('Connect calendar',()=>void invoke(()=>hooks.onConnect(provider,[...new Set([...grant.selectedCapabilities.filter(id=>enabled.includes(id)),'calendar_manage'])])),'secondary',CalendarDays));
   if(provider==='google'&&cap.some(value=>value.id==='gmail_read')){
    const gmailAllowed=enabled.includes('gmail_read'),gmailGrant=authorized.find(value=>value.selectedCapabilities.includes('gmail_read')&&value.grantedCapabilities?.includes('gmail_read'));
    item.append(node('p',gmailGrant?'Gmail read access connected':gmailAllowed?'Gmail read access available':'Gmail connection unavailable','connection-subtle'));
    if(!gmailGrant&&gmailAllowed)actions.append(button('Connect Gmail',()=>void invoke(()=>hooks.onConnect('google',[...new Set([...(grant.selectedCapabilities??[]).filter(id=>enabled.includes(id)),'gmail_read'])])),'secondary',Mail));
   }
   actions.append(button('Disconnect',()=>disconnectProvider(provider,grant),'quiet',Unplug));
  }
  if(provider==='google'&&(!grant||grant.status!=='authorized'||!hasTool(grant)))item.append(node('p',enabled.includes('gmail_read')?'Gmail read access available':'Gmail connection unavailable','connection-subtle'));
  if(selected)item.append(node('p',available?`Selected · ${selection.calendar?.name??'Calendar'}`:'Selected calendar needs attention','connection-selection'));
  if(!enabled.includes('calendar_manage')&&!grant)item.append(node('p','Connection setup is unavailable.','connection-subtle'));
  item.append(actions);grid.append(item);
 }
 async function invoke(action:()=>void|Promise<void>){const saved=stamp();if(!managed(saved))return;try{await action();}catch(error){if(current(saved))announce(errorText(error),true);}}
 function disconnectProvider(provider:Provider,grant:Grant){if(!hooks.canManage())return;const modal=dialog(`Disconnect ${providerLabels[provider]}?`),saved=stamp();review(modal,'Review disconnect',[`Disconnect the saved ${providerLabels[provider]} access.`,provider==='google'?'Calendar and Gmail access on this grant will stop.':'Calendar access on this grant will stop.'],'Disconnect',async()=>{if(!managed(saved))throw new Error('Your connection access has ended.');return hooks.api('/api/auth/grants/revoke',{grantId:grant.id,tenantId:activeTenant});});}
 function renderCustom(grid:HTMLElement,connection:Connection){
  const detail=connection.origin??connection.endpoint??connection.type.toUpperCase(),item=card(connection.label,detail,connection.type==='webhook'?Webhook:connection.type==='mcp'?Server:Braces,connection.status==='connected'?'Configured':connection.status==='disconnected'?'Disconnected':connection.status==='error'?'Needs attention':connection.status==='ready'?'Ready':connection.status.replace(/_/g,' '));
  if(connection.lastCheckedAt)item.append(node('p',`${connection.lastCheckStatus==='reachable'?'Reachable':connection.lastCheckStatus==='configured'?'Configuration checked':'Last check'} · ${dateText(connection.lastCheckedAt)}`,'connection-subtle'));
  if(connection.status==='disconnected'){grid.append(item);return;}
  const actions=node('div','','connection-actions'),saved=stamp();
  const check=button('Check',()=>{if(!managed(saved))return;check.disabled=true;void(async()=>{try{const result=await hooks.api(base()+`/connections/${encodeURIComponent(connection.id)}/check`,{});if(!managed(saved))return;await activate();if(current(saved)){announce(typeof result.message==='string'?result.message:result.status==='configured'?'Configuration checked. No external action was sent.':'Connection checked.');focusHeading();}}catch(error){if(current(saved))announce(errorText(error),true);}finally{if(check.isConnected)check.disabled=false;}})();},'secondary',RefreshCw);
  actions.append(button('Tools',()=>void toolList(connection),'secondary',Play),check,button('Disconnect',()=>disconnectCustom(connection),'quiet',Unplug));item.append(actions);grid.append(item);
 }
 function addConnection(){
  if(!hooks.canManage())return;const modal=dialog('Add a connection'),form=node('form','','connection-form'),label=field(form,'Name',input('',80)),type=field(form,'Connection type',select([{value:'api',label:'API'},{value:'webhook',label:'Webhook'},{value:'mcp',label:'MCP · HTTP'}])),endpoint=field(form,'HTTPS endpoint',input('',2048));
  label.required=true;endpoint.required=true;endpoint.type='url';endpoint.placeholder='https://';
  const settings=node('details','','connection-details');settings.append(node('summary','Authentication & read permissions'));form.append(settings);
  const authentication=field(settings,'Authentication',select([{value:'none',label:'None'},{value:'bearer',label:'Bearer token'},{value:'api_key',label:'API key'}])),secret=field(settings,'Key or token',input('',4096));secret.type='password';secret.minLength=8;secret.autocomplete='new-password';secret.spellcheck=false;
  const readNames=node('textarea');readNames.rows=2;readNames.maxLength=1200;readNames.placeholder='One tool name per line';const readField=field(settings,'MCP tools you permit to run as reads',readNames).parentElement!;readField.hidden=true;
  type.onchange=()=>{readField.hidden=type.value!=='mcp';};authentication.onchange=()=>{secret.disabled=authentication.value==='none';secret.required=authentication.value!=='none';if(secret.disabled)secret.value='';};authentication.onchange(new Event('change'));
  const message=formMessage(form),save=submit(form,'Review connection');modal.append(form);label.focus();const saved=stamp();let requestId=crypto.randomUUID(),signature='';
  modal.addEventListener('close',()=>{secret.value='';signature='';},{once:true});
  const back=()=>{modal.querySelector('h2')!.textContent='Add a connection';modal.replaceChildren(modal.querySelector('.dialog-heading')!,form);save.disabled=false;label.focus();};
  form.onsubmit=event=>{event.preventDefault();if(!managed(saved))return;try{const url=new URL(endpoint.value);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use an HTTPS endpoint without credentials in the URL.');const values={label:label.value.trim(),type:type.value,endpoint:url.href,authentication:authentication.value,...(secret.value?{secret:secret.value}:{}),...(type.value==='mcp'?{readOnlyTools:[...new Set(readNames.value.split(/[\n,]/).map(value=>value.trim()).filter(Boolean))]}:{})};const next=canonical(values);if(signature&&signature!==next)requestId=crypto.randomUUID();signature=next;const body={requestId,...values};review(modal,'Review connection',[body.label,`${type.options[type.selectedIndex].text} · ${url.hostname}`,authentication.value==='none'?'No saved key.':'The key is stored securely and will not be displayed.',type.value==='mcp'&&readNames.value.trim()?'Only the tool names you listed may run as reads. Other tools require approval.':'Outbound writes require approval.'],'Add connection',async()=>{if(!managed(saved))throw new Error('Your connection access has ended.');const result=await hooks.api(base()+'/connections/add',body);secret.value='';delete body.secret;return result;},back);}catch(error){message.textContent=errorText(error);message.setAttribute('role','alert');}};
 }
 function disconnectCustom(connection:Connection){if(!hooks.canManage())return;const modal=dialog('Disconnect connection?'),saved=stamp();review(modal,'Review disconnect',[connection.label,'Saved access to this connection will stop.'],'Disconnect',async()=>{if(!managed(saved))throw new Error('Your connection access has ended.');return hooks.api(base()+`/connections/${encodeURIComponent(connection.id)}/disconnect`,{revision:connection.revision});});}
 async function toolList(connection:Connection){
  if(!hooks.canManage())return;const modal=dialog(`${connection.label} tools`),message=formMessage(modal),saved=stamp();message.textContent='Loading tools…';
  try{const result=await hooks.api(base()+`/connections/${encodeURIComponent(connection.id)}/tools`);if(!managed(saved)||!modal.isConnected)return;message.textContent='';const tools=result.tools as Tool[];if(!Array.isArray(tools)||!tools.length){message.textContent='No tools were returned.';return;}const list=node('div','','connection-tool-list');for(const tool of tools){if(!tool||typeof tool.name!=='string'||!['read','write'].includes(tool.effect))continue;const row=node('article','','connection-tool');row.append(node('h3',tool.title??tool.name));if(tool.description)row.append(node('p',tool.description,'connection-subtle'));row.append(node('span',tool.effect==='read'?'Read':'Approval required','connection-tool-effect'),button('Open',()=>toolForm(modal,connection,tool),'secondary',ChevronRight));list.append(row);}modal.append(list);}
  catch(error){if(current(saved)&&modal.isConnected){message.textContent=errorText(error);message.setAttribute('role','alert');}}
 }
 function toolForm(modal:HTMLDialogElement,connection:Connection,tool:Tool){
  const head=modal.querySelector<HTMLElement>('.dialog-heading')!;
  head.querySelector('h2')!.textContent=tool.title??tool.name;modal.replaceChildren(head);
  const form=node('form','','connection-form');form.append(node('p',connection.label,'connection-subtle'));
  const args=node('textarea');args.rows=6;args.spellcheck=false;args.maxLength=8192;args.value='{}';field(form,'Exact arguments · JSON',args);
  if(tool.inputSchema){const schema=node('details','','connection-details');schema.append(node('summary','Input fields'),node('pre',pretty(tool.inputSchema),'connection-code'));form.append(schema);}
  const message=formMessage(form),save=submit(form,'Preview action');modal.append(form);args.focus();const saved=stamp();
  let requestId=crypto.randomUUID(),signature='',expired=false;
  const back=()=>{if(expired){requestId=crypto.randomUUID();expired=false;}head.querySelector('h2')!.textContent=tool.title??tool.name;modal.replaceChildren(head,form);save.disabled=false;message.textContent='';args.focus();};
  form.onsubmit=event=>{
   event.preventDefault();if(!managed(saved)||save.disabled)return;
   let parsed:unknown,next:string;
   try{parsed=JSON.parse(args.value);if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Use a JSON object for the tool arguments.');next=canonical(parsed);if(new TextEncoder().encode(next).length>8192)throw new Error('Keep tool arguments within 8 KB.');}
   catch(error){message.textContent=errorText(error);message.setAttribute('role','alert');return;}
   if(signature&&signature!==next)requestId=crypto.randomUUID();signature=next;save.disabled=true;message.textContent='Preparing preview…';
   void(async()=>{
    try{
     const response=await hooks.api(base()+'/connections/tools/prepare',{connectionId:connection.id,tool:tool.name,args:parsed,requestId});
     if(!managed(saved)||!modal.isConnected)return;
     const proposal=response.proposal as Proposal;
     if(!proposal||typeof proposal.id!=='string'||proposal.connectionId!==connection.id||proposal.tool!==tool.name||!['read','write'].includes(proposal.effect)||canonical(proposal.args)!==next)throw new Error('The saved preview did not match this action. Open the tool again.');
     head.querySelector('h2')!.textContent=proposal.effect==='write'?'Approve external action':'Review read';modal.replaceChildren(head);
     const detail=node('div','','connection-tool-preview');detail.append(node('p',`${connection.label} · ${tool.name}`));
     for(const line of Array.isArray(proposal.readback)?proposal.readback:[proposal.readback])detail.append(node('p',String(line)));
     detail.append(node('pre',pretty(proposal.args),'connection-code'));
     const actions=node('div','','connection-actions'),status=formMessage(modal),no=button('Back',back,'secondary',ArrowLeft);
     const yes=button(proposal.effect==='write'?'Approve & run':'Run read',()=>{
      if(yes.disabled||!managed(saved))return;
      if(!Number.isFinite(Date.parse(proposal.expiresAt))||Date.parse(proposal.expiresAt)<=Date.now()){expired=true;status.textContent='This preview expired. Go back to prepare it again.';status.setAttribute('role','alert');return;}
      yes.disabled=no.disabled=true;pending(modal,true);status.textContent='Running…';
      void(async()=>{
       try{
        const result=await hooks.api(base()+'/connections/tools/confirm',{proposalId:proposal.id,approved:true});if(!managed(saved)||!modal.isConnected)return;
        head.querySelector('h2')!.textContent='Tool result';modal.replaceChildren(head);
        const text=pretty(result.result??result),output=node('pre',text.slice(0,24000),'connection-code');modal.append(output);
        if(text.length>24000)modal.append(node('p','This result is shortened for display.','connection-subtle'));
        const done=button('Done',()=>modal.close(),'primary',Check);modal.append(done);done.focus();hooks.onChanged?.();
       }catch(error){if(current(saved)&&modal.isConnected){status.textContent=`${errorText(error)} The result could not be confirmed. Check the destination before starting another action.`;status.setAttribute('role','alert');}}finally{if(modal.isConnected)pending(modal,false);}
      })();
     },'primary',Play);
     actions.append(no,yes);modal.append(detail,actions);yes.focus();
    }catch(error){if(current(saved)&&modal.isConnected){message.textContent=errorText(error);message.setAttribute('role','alert');save.disabled=false;}}
   })();
  };
 }
 function renderMcp(){
  const section=node('section','','connection-section'),title=node('div','','connection-section-heading');title.append(node('h3','Use Mayor in another assistant'));section.append(title);
  if(tokenError){const error=node('p',tokenError,'connection-error');error.setAttribute('role','alert');section.append(error);element.append(section);return;}
  section.append(node('p','Read your saved business records through MCP.','connection-subtle'));
  const actions=node('div','','connection-actions');if(endpoint)actions.append(button('Copy endpoint',()=>void copy(endpoint,'Endpoint copied.'),'secondary',Copy));actions.append(button('Create token',createToken,'secondary',KeyRound));section.append(actions);
  const details=node('details','','connection-details');details.append(node('summary',`Your tokens (${tokens.filter(token=>!token.revokedAt).length})`));
  if(!tokens.length)details.append(node('p','No tokens yet.','connection-subtle'));
  for(const token of tokens){const row=node('div','','connection-token'),text=node('div');text.append(node('strong',token.label),node('p',token.revokedAt?'Revoked':Date.parse(token.expiresAt)<=Date.now()?'Expired':`Read only · expires ${dateText(token.expiresAt)}`,'connection-subtle'));row.append(text);if(!token.revokedAt)row.append(button('Revoke',()=>revokeToken(token),'quiet',Unplug));details.append(row);}section.append(details);element.append(section);
 }
 async function copy(text:string,success:string,status?:HTMLElement){const saved=stamp();try{await navigator.clipboard.writeText(text);if(current(saved)){if(status)status.textContent=success;else announce(success);}}catch{if(current(saved)){if(status)status.textContent='Copy is unavailable. Select the text and copy it.';else announce('Copy is unavailable in this browser.',true);}}}
 function createToken(){
  const modal=dialog('Create a Mayor token'),form=node('form','','connection-form'),label=field(form,'Token name',input('',80)),days=field(form,'Expires after',select([{value:'7',label:'7 days'},{value:'30',label:'30 days'},{value:'90',label:'90 days'}],'30'));label.required=true;label.placeholder='My assistant';form.append(node('p','Read only. No task, booking, or message changes.','connection-subtle'));const save=submit(form,'Review token');modal.append(form);label.focus();const saved=stamp();
  const back=()=>{modal.querySelector('h2')!.textContent='Create a Mayor token';modal.replaceChildren(modal.querySelector('.dialog-heading')!,form);save.disabled=false;label.focus();};
  form.onsubmit=event=>{event.preventDefault();if(!current(saved))return;review(modal,'Review token',[label.value.trim(),`Read-only access to your business. Expires in ${days.value} days.`],'Create token',()=>hooks.api(base()+'/mcp/tokens',{label:label.value.trim(),scopes:['business:read'],expiresInDays:Number(days.value)}),back,result=>{
   if(!current(saved))return;const head=modal.querySelector<HTMLElement>('.dialog-heading')!;head.querySelector('h2')!.textContent='Save your token';modal.replaceChildren(head);modal.append(node('p','Shown once. Keep it private.','connection-subtle'));
   if(typeof result.token!=='string'||!result.token.startsWith('mayor_mcp_')){modal.append(node('p','The token was not returned. Check your token list before creating another.','connection-error'));return;}
   const tokenInput=node('textarea');tokenInput.value=result.token;tokenInput.readOnly=true;tokenInput.rows=3;tokenInput.spellcheck=false;tokenInput.setAttribute('aria-label','Your new private MCP token');modal.append(tokenInput);const message=formMessage(modal);modal.append(button('Copy token',()=>void copy(tokenInput.value,'Token copied.',message),'primary',Copy),button('Done',()=>modal.close(),'secondary',Check));const url=safeMcpEndpoint(result.endpoint);if(url)modal.append(node('p',url,'connection-endpoint'));tokenInput.focus();tokenInput.select();result.token='';
   modal.addEventListener('close',()=>{tokenInput.value='';if(current(saved))void activate();},{once:true});
  },false);};
 }
 function revokeToken(token:Token){const modal=dialog('Revoke token?'),saved=stamp();review(modal,'Review revoke',[token.label,'Assistants using this token will lose access.'],'Revoke token',()=>{if(!current(saved))throw new Error('Your workspace access has ended.');return hooks.api(base()+`/mcp/tokens/${encodeURIComponent(token.id)}/revoke`,{});});}
 return {element,activate,reset};
}
