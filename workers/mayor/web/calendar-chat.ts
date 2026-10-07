type Guide={message:string;website:string|null;suggested:string|null;preferred?:string|null;providers:Array<{id:string;label:string;available:boolean;status:string}>};
type Options={api:(path:string,body?:unknown)=>Promise<any>;tenant:()=>string;signIn:(provider:string,capabilities:string[])=>Promise<void>;followup:(text:string)=>void};
export function createCalendarChat(options:Options){
 const element=document.createElement('section');element.className='calendar-chat account-card';element.hidden=true;element.setAttribute('aria-label','Calendar connections');
 const title=document.createElement('h3');title.textContent='Your calendars';
 const message=document.createElement('p');message.setAttribute('role','status');
 const actions=document.createElement('div');actions.className='calendar-chat-actions';
 const detail=document.createElement('div');detail.className='calendar-chat-detail';detail.setAttribute('aria-live','polite');
 const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),check=document.createElement('button');
 label.textContent='Business website (optional)';input.type='url';input.placeholder='https://yourbusiness.com';input.maxLength=2048;input.setAttribute('autocomplete','url');label.append(input);
 check.type='submit';check.className='secondary';check.textContent='Suggest from website';form.append(label,check);
 const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent='Close calendar options';close.onclick=()=>{element.hidden=true;};
 element.append(title,message,actions,detail,form,close);
 let generation=0;
 const base=()=>`/api/businesses/${options.tenant()}/calendars`;
 const say=(text:string)=>{detail.textContent=text;};
 async function choose(provider:string){
  const data=await options.api('/api/auth/grants');
  const grant=data.grants.find((g:any)=>g.provider===provider&&g.tenantId===options.tenant()&&g.status==='authorized'&&g.grantedCapabilities?.includes('calendar_manage'));
  if(!grant){say('This account needs permission to manage appointments. Use Reconnect below, then we’ll choose your calendar.');return;}
  const directory=await options.api(base()+'/discover',{provider,grantId:grant.id});detail.replaceChildren();
  const prompt=document.createElement('p');prompt.textContent='Which calendar should I use for appointments?';detail.append(prompt);
  for(const calendar of directory.calendars){
   const pick=document.createElement('button');pick.type='button';pick.className='secondary';pick.textContent=`Use ${calendar.name}${calendar.canWrite?'':' (read only)'}`;pick.disabled=!calendar.canWrite;
   pick.onclick=async()=>{pick.disabled=true;try{await options.api(base()+'/selected',{provider,grantId:grant.id,calendarId:calendar.id});say(`You’re set—${calendar.name} is selected. Next, let’s check your appointment hours and rules.`);const next=document.createElement('button');next.type='button';next.textContent='Set up appointment rules';next.onclick=()=>options.followup('Help me set up my appointment scheduling rules. Ask one missing question at a time.');detail.append(next);}catch(error){say((error as Error).message);}};
   detail.append(pick);
  }
  if(!directory.calendars.length)say('I couldn’t find calendars in that account. Try another account or reconnect with calendar access.');
 }
 async function connect(provider:string){
  const [data,caps]=await Promise.all([options.api('/api/auth/grants'),options.api('/api/auth/capabilities')]);
  const grant=data.grants.find((g:any)=>g.provider===provider&&g.tenantId===options.tenant()&&g.status!=='revoked');
  const selected=(grant?.selectedCapabilities??[]).filter((id:string)=>caps.providers[provider]?.capabilities.some((c:any)=>c.id===id&&c.enabled));
  await options.signIn(provider,[...new Set<string>(['calendar_manage',...selected])]);
 }
 function render(guide:Guide){
  element.hidden=false;message.textContent=guide.message;actions.replaceChildren();detail.replaceChildren();
  if(guide.website)input.value=guide.website;
  for(const provider of [...guide.providers].sort((a,b)=>Number(b.id===guide.suggested)-Number(a.id===guide.suggested))){
   const row=document.createElement('div'),name=document.createElement('strong'),note=document.createElement('p');row.className='calendar-provider';
   name.textContent=provider.label+(provider.id===guide.preferred?' · Your choice':provider.id===guide.suggested?' · Suggested':'');
   note.textContent=!provider.available?`${provider.label} needs setup by The Mayor team before you can connect.`:provider.status==='reconnect_required'?'Your permission needs refreshing.':provider.status==='authorized'?'Account connected. Choose the calendar you want me to use.':'Connect securely with your provider. No password is shared with The Mayor.';
   row.append(name,note);
   if(provider.available){
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=provider.status==='not_connected'?`Connect ${provider.label}`:`Reconnect ${provider.label}`;
    button.onclick=async()=>{button.disabled=true;try{await connect(provider.id);}catch(error){say((error as Error).message);}finally{button.disabled=false;}};row.append(button);
    if(provider.status==='authorized'){const pick=document.createElement('button');pick.type='button';pick.className='secondary';pick.textContent='Choose calendar';pick.onclick=async()=>{pick.disabled=true;try{await choose(provider.id);}catch(error){say((error as Error).message);}finally{pick.disabled=false;}};row.append(pick);}
   }
   actions.append(row);
  }
  element.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
 }
 async function open(website?:string,provider?:string){
  const turn=++generation;element.hidden=false;message.textContent='Let me check your calendar connections…';actions.replaceChildren();detail.replaceChildren();
  try{const guide=await options.api(base()+'/guide',{...(website?{website}:{}),...(provider?{provider}:{})});if(turn!==generation)return;render(guide);
   if(provider&&guide.providers.some((p:any)=>p.id===provider&&p.available&&p.status==='authorized'))await choose(provider);
  }catch(error){if(turn===generation)message.textContent=(error as Error).message;}
 }
 form.onsubmit=event=>{event.preventDefault();if(input.reportValidity())void open(input.value.trim()||undefined);};
 function inventory(data:{message:string;connections:Array<{provider:string;available:boolean;calendars:Array<{name:string;canWrite:boolean}>}>;setup:{active:boolean;lines:string[];nextQuestion:string|null}}){
  generation++;element.hidden=false;message.textContent=data.message;actions.replaceChildren();detail.replaceChildren();
  for(const connection of data.connections){
   const row=document.createElement('div'),name=document.createElement('strong'),list=document.createElement('ul');row.className='calendar-provider';
   name.textContent=({google:'Google',microsoft:'Microsoft',zoho:'Zoho'} as Record<string,string>)[connection.provider]??connection.provider;row.append(name);
   if(connection.available){for(const calendar of connection.calendars){const item=document.createElement('li');item.textContent=`${calendar.name}${calendar.canWrite?'':' · Read only'}`;list.append(item);}row.append(list);}
   else{const error=document.createElement('p');error.textContent='I couldn’t read these calendars. Check or reconnect your account.';row.append(error);}
   actions.append(row);
  }
  const heading=document.createElement('h4');heading.textContent=data.setup.active?'Active appointment rules':'Saved setup progress';detail.append(heading);
  for(const line of data.setup.lines){const item=document.createElement('p');item.textContent=line;detail.append(item);}
  if(!data.setup.lines.length){const empty=document.createElement('p');empty.textContent='No appointment rules saved yet.';detail.append(empty);}
  const next=document.createElement('button');next.type='button';next.className='secondary';next.textContent=data.setup.active?'Review appointment rules':'Continue appointment setup';
  next.onclick=()=>options.followup(data.setup.active?'Read my current appointment rules and ask what I want to change. Do not save changes without my confirmation.':'Help me finish my appointment scheduling rules. Ask one missing question at a time.');detail.append(next);
  const manage=document.createElement('button');manage.type='button';manage.className='secondary';manage.textContent='Manage calendar connections';manage.onclick=()=>void open();detail.append(manage);
 }
 return {element,open,render,inventory,clear(){generation++;element.hidden=true;actions.replaceChildren();detail.replaceChildren();input.value='';message.textContent='';}};
}
