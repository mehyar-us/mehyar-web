import {createElement,Target,Sparkles,Plus,Settings2,Play,Check,ArrowLeft,ListChecks,FlaskConical,Clock,NotebookPen,ClipboardCheck} from 'lucide';
import './business-agent.css';

type Metric={baseline:number;current:number;target:number;unit:string};
type Goal={id:string;revision:number;title:string;description:string;metric:Metric|null;deadline:string|null;archived:boolean};
type Skill={id:string;revision:number;title:string;instructions:string;allowedTools:string[];archived:boolean};
type Builtin={id:string;title:string;instructions:string;allowedTools:string[];steps:string[];description:string};
type Schedule={frequency:'daily'|'weekdays';hour:number;minute:number;timeZone:string};
type ConnectorOptions={gmailGrantId?:string;calendar?:{appointmentType:string;staff?:string}};
type Config={revision:number;enabled:boolean;goalIds:string[];skillIds:string[];connectorOptions:ConnectorOptions;schedule:Schedule|null;nextRunAt:string|null;lastRunAt:string|null;lastStatus:string|null;running:boolean};
type Run={id:string;status:'processing'|'ready'|'failed'|'blocked'|'canceled';trigger:'manual'|'scheduled';createdAt:string;updatedAt?:string;errorCode?:string|null;replyAttemptCounted?:boolean};
type Draft={id:string;title:string;detail:string;priority:'low'|'normal'|'high';dueAt:string|null;customerId:string|null;goalIds:string[];skillIds:string[];sourceIds:string[];acceptedTaskId?:string|null};
type Report={id:string;generatedAt:string;summary:string;sources?:{id:string;kind:string;detail:string}[];goalProgress:{goalId:string;title:string;metric:Metric|null;progress:number|null;source:'manual_entry'}[];metrics:{key:string;label:string;value:number|null}[];priorities:{title:string;detail:string;sourceIds:string[]}[];taskDrafts:Draft[];experiments:{id:string;title:string;hypothesis:string;measure:string;goalIds:string[];skillIds:string[];sourceIds:string[]}[];toolTrace:{tool:string;status:'completed'|'unavailable'|'skipped';detail:string}[];gaps:string[];scope:string};
type Connectors={gmail?:{connections:{grantId:string;status:string}[];available:boolean;scope:string};calendar?:{available:boolean;timeZone:string|null;appointmentTypes:{name:string;staff:string[]}[];scope:string}};
type Identity={revision:number;mission:string;tone:'warm'|'professional'|'direct';principles:string[];workingStyle:string;displayName:string};
type Data={agent:{id:string;label:string};identity?:Identity;goals:Goal[];skills:Skill[];builtins:Builtin[];allowedTools:string[];config:Config;latestReport:Report|null;history:Run[];connectors?:Connectors;scope:string};
type Hooks={api:(path:string,body?:unknown)=>Promise<any>;tenant:()=>string;actor?:()=>string;ask:(text:string)=>void;onChanged?:()=>void};
type Icon=Parameters<typeof createElement>[0];
const toolLabels:Record<string,string>={profile:'Saved business profile',tasks:'Internal tasks',customers:'Saved customers',bookings:'Mayor bookings',goals:'Saved goals',connector_status:'Connection status',gmail_unread:'Unread Gmail · opt in',calendar_openings:'Calendar openings · opt in',bounded_planner:'AI planning'};
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
const icon=(shape:Icon)=>{const el=createElement(shape);el.setAttribute('aria-hidden','true');el.setAttribute('focusable','false');return el;};
const button=(label:string,action:()=>void,className='secondary',shape?:Icon)=>{const el=node('button',label,className);el.type='button';el.onclick=action;if(shape)el.prepend(icon(shape));return el;};
const errorText=(error:unknown)=>error instanceof Error?error.message:'This could not finish. Check your saved records before trying again.';
const sentence=(value:string)=>{const text=value.trim();return /[.!?]$/.test(text)?text:`${text}.`;};
const dateText=(value:string,zone?:string)=>{const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Time unavailable';try{return date.toLocaleString(undefined,zone?{timeZone:zone}:undefined);}catch{return date.toLocaleString();}};
const localDate=(value:string|null)=>{if(!value)return '';const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};

/** Read-only reports and explicit, reviewed saves. Authorization remains with the supplied API. */
export function createBusinessAgent(hooks:Hooks){
 const element=node('section','','business-agent');element.setAttribute('aria-label','Business agent');
 // Deep-link anchor: Settings and Feed entry points scroll here.
 element.id='business-agent';
 const dialogs=new Set<HTMLDialogElement>();
 let data:Data|null=null,epoch=0,loadVersion=0,activeTenant='',activeActor='',busy=false,requestId:string|null=null,revealAfterSave='';
 const base=()=>`/api/businesses/${encodeURIComponent(hooks.tenant())}/harness`;
 const storageKey=()=>`mayor:business-agent:run:${encodeURIComponent(activeActor)}:${encodeURIComponent(activeTenant)}`;
 function saveRequest(id:string|null){requestId=id;if(!activeActor)return;try{if(id)sessionStorage.setItem(storageKey(),id);else sessionStorage.removeItem(storageKey());}catch{/* A stable in-memory request ID still protects retries in this page. */}}
 function restoreRequest(){if(!activeActor){requestId=null;return;}try{const id=sessionStorage.getItem(storageKey());requestId=id&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)?id:null;}catch{requestId=null;}}
 function current(captured:number,tenant:string){return captured===epoch&&tenant===hooks.tenant()&&tenant===activeTenant&&activeActor===(hooks.actor?.()??'');}
 function status(message:string,alert=false){const el=element.querySelector<HTMLElement>('.agent-status');if(el){el.textContent=message;el.setAttribute('role',alert?'alert':'status');}}
 async function load(){
  const tenant=hooks.tenant(),actor=hooks.actor?.()??'';if(!tenant){clear();return false;}
  if(activeTenant!==tenant||activeActor!==actor){clear();activeTenant=tenant;activeActor=actor;restoreRequest();}
  const captured=epoch,version=++loadVersion;
  if(!data){element.replaceChildren(node('h2','Business agent'),node('p','Loading your goals and latest review…','agent-status'));}
  try{const result=await hooks.api(base()) as Data;if(!current(captured,tenant)||version!==loadVersion)return false;data=result;render();return true;}
  catch(error){if(!current(captured,tenant)||version!==loadVersion)return false;status(errorText(error),true);if(!data)element.append(button('Try again',()=>void load()));return false;}
 }
 function dialog(titleText:string){
  const el=node('dialog','','workday-dialog business-agent-dialog'),head=node('div','','dialog-heading'),title=node('h2',titleText),close=button('Close',()=>el.close(),'agent-close');
  title.id='agent-dialog-'+crypto.randomUUID();el.setAttribute('aria-labelledby',title.id);head.append(title,close);el.append(head);document.body.append(el);dialogs.add(el);
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  el.addEventListener('close',()=>{dialogs.delete(el);el.remove();if(previous?.isConnected&&!dialogs.size)previous.focus({preventScroll:true});},{once:true});el.showModal();return el;
 }
 function closeDialog(modal:HTMLDialogElement){if(!dialogs.has(modal))return Promise.resolve();return new Promise<void>(resolve=>{modal.addEventListener('close',()=>resolve(),{once:true});if(modal.open)modal.close();});}
 function field<T extends HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(form:HTMLElement,label:string,control:T):T{const group=node('label','','agent-field');group.append(node('span',label),control);form.append(group);return control;}
 function input(value='',max=160){const el=node('input');el.value=value;el.maxLength=max;return el;}
 function textArea(value='',max=2000){const el=node('textarea');el.value=value;el.maxLength=max;el.rows=4;return el;}
 function formStatus(form:HTMLElement){const el=node('p','','agent-form-status');el.setAttribute('role','status');form.append(el);return el;}
 function submit(form:HTMLFormElement,label='Review changes'){const el=node('button',label,'primary');el.type='submit';form.append(el);return el;}
 function review(parent:HTMLDialogElement,title:string,readback:string[],apply:()=>Promise<void>,back:()=>void,confirmLabel='Confirm changes',savedMessage='Saved.'){
  const head=parent.querySelector<HTMLElement>('.dialog-heading')!,heading=head.querySelector('h2')!;heading.textContent=title;parent.replaceChildren(head);
  const list=node('ul','','agent-readback');readback.forEach(item=>list.append(node('li',item)));const message=node('p','','agent-form-status');message.setAttribute('role','status');const actions=node('div','','agent-actions');
  const no=button('Back',back,'secondary',ArrowLeft),yes=button(confirmLabel,()=>{if(yes.disabled)return;yes.disabled=no.disabled=true;const captured=epoch,tenant=activeTenant;void(async()=>{try{await apply();if(!current(captured,tenant))return;revealAfterSave=/goal/i.test(confirmLabel)?'goals':/skill/i.test(confirmLabel)?'skills':/identity/i.test(confirmLabel)?'identity':/settings/i.test(confirmLabel)?'schedule':/internal task/i.test(confirmLabel)?'plan':'';await closeDialog(parent);if(!current(captured,tenant))return;hooks.onChanged?.();const loaded=await load();if(current(captured,tenant)){status(loaded?savedMessage:`${savedMessage} The latest records could not reload. Refresh before making another change.`,!loaded);if(!dialogs.size&&element.getClientRects().length){const heading=element.querySelector<HTMLElement>('.agent-heading h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}}}catch(error){if(current(captured,tenant)&&parent.isConnected){message.textContent=errorText(error);yes.disabled=no.disabled=false;}}})();},'primary',Check);
  actions.append(no,yes);parent.append(list,message,actions);yes.focus();
 }
 function sourceDetails(ids:string[],report:Report){const details=node('details','','agent-sources');details.append(node('summary',ids.length?`${ids.length} source ${ids.length===1?'record':'records'}`:'Source coverage'));const list=node('ul'),sources=ids.map(id=>report.sources?.find(source=>source.id===id)).filter((source):source is NonNullable<typeof source>=>Boolean(source));for(const source of sources){const item=node('li');item.append(node('strong',source.kind.replace(/_/g,' ')),node('span',` · ${source.detail}`));list.append(item);}if(sources.length)details.append(list);if(sources.length<ids.length)details.append(node('p',`${ids.length-sources.length} saved ${ids.length-sources.length===1?'record was':'records were'} referenced. This older report does not include their readable details.`));if(!ids.length)details.append(node('p','No saved record reference was supplied for this item.'));return details;}
 function render(){
  if(!data)return;const state=data,config=state.config,expanded=new Map(Array.from(element.querySelectorAll<HTMLDetailsElement>('details[data-agent-disclosure]'),detail=>[detail.dataset.agentDisclosure!,detail.open]));element.replaceChildren();
  const heading=node('div','','agent-heading'),copy=node('div'),actions=node('div','','agent-actions');copy.append(node('h2','Business agent'),node('p','Goals, useful skills, and your next move.'));
  const run=button(config.running?'Check review':requestId?'Check saved attempt':'Review my business',()=>{if(config.running)void load();else reviewRun();},'primary',config.running?Clock:Play);run.disabled=busy||!config.revision;actions.append(run);heading.append(copy,actions);element.append(heading);
  const notice=node('p','','agent-status');notice.setAttribute('role','status');element.append(notice);
  const schedule=config.schedule,stateLine=node('p','','agent-state');stateLine.append(icon(config.enabled?Clock:Settings2),node('span',config.enabled?`${schedule?.frequency==='weekdays'?'Weekday':'Daily'} reviews · ${schedule?`${String(schedule.hour).padStart(2,'0')}:${String(schedule.minute).padStart(2,'0')} ${schedule.timeZone}`:''}`:'Automatic reviews paused'));
  if(config.running)stateLine.append(node('span','Review in progress'));
  else if(config.enabled&&config.nextRunAt)stateLine.append(node('span',`Next attempt ${dateText(config.nextRunAt,schedule?.timeZone)}`));
  element.append(stateLine);
  if(state.latestReport)reportView(state.latestReport);
  else{const hasGoals=state.goals.some(goal=>!goal.archived),empty=node('div','','agent-empty');empty.append(icon(Target),node('h3',hasGoals?'Your goals are ready for a review.':'What would move your business forward?'),node('p',hasGoals?'Choose skills and confirm your settings to build a grounded next-step report.':'Save one clear goal, then choose the skills Mayor should use.'));if(hasGoals&&!config.revision)empty.append(button('Choose review skills',openReviewSetup,'primary',Settings2));else if(!hasGoals)empty.append(button('Set a goal',()=>goalForm(),'primary',Plus));element.append(empty);}
  const latest=state.history[0];
  if(latest&&['failed','blocked','canceled'].includes(latest.status)){const failed=node('p','','agent-run-outcome');failed.textContent=`Last review ${latest.status==='blocked'?'could not start':latest.status==='canceled'?'was canceled':'could not finish'}${latest.errorCode?` · ${latest.errorCode.replace(/_/g,' ')}`:''}. ${latest.replyAttemptCounted?'It used a shared reply attempt.':'No shared reply attempt was recorded.'}`;element.append(failed);}
  const manage=node('details','','agent-manage');manage.dataset.agentDisclosure='manage';manage.append(node('summary','Goals, skills & automation'));
  const goals=node('details','','agent-management-section');goals.dataset.agentDisclosure='goals';goals.append(node('summary','Goals'));
  for(const goal of state.goals.filter(item=>!item.archived)){const row=node('div','','agent-manage-row'),copy=node('div');copy.append(node('strong',goal.title));if(goal.metric)copy.append(node('span',`${goal.metric.current.toLocaleString()} → ${goal.metric.target.toLocaleString()} ${goal.metric.unit} · manually entered`));if(goal.deadline)copy.append(node('span',`Due ${dateText(goal.deadline)}`));row.append(copy,button('Edit',()=>goalForm(goal)));goals.append(row);}goals.append(button('Add goal',()=>goalForm(),'secondary',Plus));
  const archivedGoals=state.goals.filter(item=>item.archived);if(archivedGoals.length){const archived=node('details');archived.dataset.agentDisclosure='archived-goals';archived.append(node('summary',`Archived goals · ${archivedGoals.length}`));for(const goal of archivedGoals){const row=node('div','','agent-manage-row');row.append(node('strong',goal.title),button('Restore',()=>restoreRecord(goal,'goal')));archived.append(row);}goals.append(archived);}
  const skills=node('details','','agent-management-section');skills.dataset.agentDisclosure='skills';skills.append(node('summary','Custom skills'));
  for(const skill of state.skills.filter(item=>!item.archived)){const row=node('div','','agent-manage-row');row.append(node('strong',skill.title),button('Edit',()=>skillForm(skill)));skills.append(row);}skills.append(button('Add skill',()=>skillForm(),'secondary',NotebookPen));
  const archivedSkills=state.skills.filter(item=>item.archived);if(archivedSkills.length){const archived=node('details');archived.dataset.agentDisclosure='archived-skills';archived.append(node('summary',`Archived skills · ${archivedSkills.length}`));for(const skill of archivedSkills){const row=node('div','','agent-manage-row');row.append(node('strong',skill.title),button('Restore',()=>restoreRecord(skill,'skill')));archived.append(row);}skills.append(archived);}
  manage.append(goals,skills);if(state.identity)manage.append(identityForm(state.identity));const settings=node('details');settings.dataset.agentDisclosure='schedule';settings.append(node('summary','Skills & review schedule'),configuration(state));manage.append(settings);element.append(manage);
  const coverage=node('details','','agent-coverage');coverage.append(node('summary','Review history & sources'),node('p',state.scope));
  for(const item of state.history){const row=node('p');row.textContent=`${dateText(item.createdAt)} · ${item.trigger==='scheduled'?'Scheduled':'Requested'} · ${item.status}${item.replyAttemptCounted?' · one reply attempt':''}`;coverage.append(row);}element.append(coverage);
  for(const detail of element.querySelectorAll<HTMLDetailsElement>('details[data-agent-disclosure]')){const key=detail.dataset.agentDisclosure!;if(expanded.has(key))detail.open=expanded.get(key)!;if(revealAfterSave&&((key==='manage'&&revealAfterSave!=='plan')||key===revealAfterSave||(revealAfterSave==='plan'&&key.startsWith('plan:'))))detail.open=true;}revealAfterSave='';
 }
 function reportView(report:Report){
  const section=node('section','','agent-report');section.append(node('h3','Your latest business review'),node('p',dateText(report.generatedAt),'agent-timestamp'),node('p',report.summary,'agent-report-summary'));
  if(report.goalProgress.length){const goals=node('div','','agent-goal-progress');
   for(const goal of report.goalProgress){const card=node('article'),heading=node('h4',goal.title);heading.prepend(icon(Target));card.append(heading);
    if(goal.metric){card.append(node('p',`${goal.metric.current.toLocaleString()} / ${goal.metric.target.toLocaleString()} ${goal.metric.unit} · manually entered`));if(goal.progress!==null&&Number.isFinite(goal.progress)){const meter=node('progress');meter.max=1;meter.value=Math.max(0,Math.min(1,goal.progress));meter.setAttribute('aria-label',`${goal.title} · progress from manually entered values`);meter.textContent=`${(meter.value*100).toFixed(0)}%`;card.append(meter);}card.append(node('small',`Starting value ${goal.metric.baseline.toLocaleString()} ${goal.metric.unit}`));}
    else card.append(node('p','No measured progress entered yet.'));goals.append(card);
   }section.append(goals);
  }
  const metrics=node('div','','agent-metrics');for(const metric of report.metrics){const row=node('div');row.append(node('strong',metric.value===null?'Unknown':metric.value.toLocaleString()),node('span',metric.label));metrics.append(row);}section.append(metrics);
  const nextSteps=node('details','','agent-next-steps');nextSteps.dataset.agentDisclosure='plan:'+report.id;nextSteps.open=!matchMedia('(max-width:760px)').matches;nextSteps.append(node('summary','Plan & next steps'));
  if(report.priorities.length){const priorities=node('section','','agent-priorities');priorities.append(node('h4','What needs attention'));for(const item of report.priorities){const card=node('article');card.append(node('h5',item.title),node('p',item.detail),sourceDetails(item.sourceIds,report));priorities.append(card);}nextSteps.append(priorities);}
  if(report.taskDrafts.length){const drafts=node('section','','agent-drafts');drafts.append(node('h4','Suggested tasks'));
   for(const draft of report.taskDrafts){const card=node('article'),heading=node('h5',draft.title);heading.prepend(icon(ListChecks));card.append(heading,node('p',draft.detail),sourceDetails(draft.sourceIds,report));if(draft.acceptedTaskId)card.append(node('span','Saved as an internal task','agent-saved'));else card.append(button('Review task',()=>taskForm(report.id,draft),'secondary',ClipboardCheck));drafts.append(card);}nextSteps.append(drafts);
  }
  if(report.experiments.length){const experiments=node('section','','agent-experiments');experiments.append(node('h4','Experiments to consider'));for(const item of report.experiments){const card=node('article'),heading=node('h5',item.title);heading.prepend(icon(FlaskConical));card.append(heading,node('p',item.hypothesis),node('p',`Measure: ${item.measure}`),sourceDetails(item.sourceIds,report),button('Work through this',()=>hooks.ask(`Help me plan the experiment “${item.title}” for this business. Hypothesis: ${sentence(item.hypothesis)} Measure: ${sentence(item.measure)} Check the saved business profile and current records first, label unknowns, and prepare a draft for my review without sending messages or changing records.`),'secondary',Sparkles));experiments.append(card);}nextSteps.append(experiments);}
  if(report.priorities.length||report.taskDrafts.length||report.experiments.length)section.append(nextSteps);
  const scope=node('details','','agent-coverage');scope.append(node('summary','What this review checked'));
  for(const trace of report.toolTrace){const row=node('p'),detail=trace.tool==='bounded_planner'&&trace.status==='completed'?'Prepared a plan from the selected records.':trace.detail;row.append(node('strong',`${toolLabels[trace.tool]??trace.tool} · ${trace.status}`),node('span',` ${detail}`));scope.append(row);}if(report.gaps.length){const list=node('ul');report.gaps.forEach(gap=>list.append(node('li',gap)));scope.append(list);}scope.append(node('p',report.scope));section.append(scope);element.append(section);
 }
 function openReviewSetup(){for(const detail of element.querySelectorAll<HTMLDetailsElement>('details[data-agent-disclosure]'))if(['manage','schedule'].includes(detail.dataset.agentDisclosure!))detail.open=true;const heading=element.querySelector<HTMLElement>('.agent-configuration h3');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}}
 function goalForm(goal?:Goal){
  const modal=dialog(goal?'Edit goal':'Set a business goal'),form=node('form','','agent-form'),newId=crypto.randomUUID();
  const title=field(form,'Goal',input(goal?.title??''));title.required=true;
  const description=field(form,'What should improve?',textArea(goal?.description??''));description.required=true;
  const hasMetric=node('input');hasMetric.type='checkbox';hasMetric.checked=Boolean(goal?.metric);const toggle=node('label','','agent-check');toggle.append(hasMetric,node('span','Track a manually entered measure'));form.append(toggle);
  const fields=node('div','','agent-metric-fields'),numbers:HTMLInputElement[]=[];
  for(const [label,value] of [['Starting value',goal?.metric?.baseline],['Current value',goal?.metric?.current],['Target value',goal?.metric?.target]] as const){const number=input(value===undefined?'':String(value));number.type='number';number.step='any';field(fields,label,number);numbers.push(number);}
  const unit=field(fields,'Unit',input(goal?.metric?.unit??'',32));form.append(fields);
  const updateMetric=()=>{fields.hidden=!hasMetric.checked;for(const control of [...numbers,unit]){control.required=hasMetric.checked;control.disabled=!hasMetric.checked;}};hasMetric.onchange=updateMetric;updateMetric();
  const deadline=field(form,'Target date · optional',input(localDate(goal?.deadline??null)));deadline.type='datetime-local';
  const message=formStatus(form),save=submit(form);const head=modal.firstElementChild!;
  const restore=()=>{head.querySelector('h2')!.textContent=goal?'Edit goal':'Set a business goal';modal.replaceChildren(head,form);save.disabled=false;title.focus();};
  const prepare=(archived=false)=>{let metric:Metric|null=null;if(hasMetric.checked){const values=numbers.map(number=>Number(number.value));if(values.some(value=>!Number.isFinite(value))||!unit.value.trim()){message.textContent='Enter three numeric values and a unit.';return;}metric={baseline:values[0],current:values[1],target:values[2],unit:unit.value.trim()};}
   const deadlineValue=deadline.value?new Date(deadline.value):null;if(deadlineValue&&!Number.isFinite(deadlineValue.getTime())){message.textContent='Choose a valid target date.';return;}
   const payload={id:goal?.id??newId,revision:goal?.revision??0,title:title.value.trim(),description:description.value.trim(),metric,deadline:deadlineValue?.toISOString()??null,archived};
   review(modal,archived?'Archive this goal?':'Review your goal',[`${archived?'Archive':'Save'} “${payload.title}”.`,payload.description,metric?`Manually entered: starting ${metric.baseline}, current ${metric.current}, target ${metric.target} ${metric.unit}.`:'No measured progress is entered.',payload.deadline?`Target date ${dateText(payload.deadline)}.`:'No target date.'],async()=>{await hooks.api(base()+'/goals',payload);},restore,archived?'Archive goal':'Save goal');};
  form.onsubmit=event=>{event.preventDefault();prepare();};if(goal&&!goal.archived)form.append(button('Archive goal',()=>{if(form.reportValidity())prepare(true);}));modal.append(form);title.focus();
 }
 function skillForm(skill?:Skill){
  if(!data)return;const modal=dialog(skill?'Edit skill':'Add a custom skill'),form=node('form','','agent-form'),newId=crypto.randomUUID();
  const title=field(form,'Skill name',input(skill?.title??''));title.required=true;const instructions=field(form,'Instructions for this business',textArea(skill?.instructions??''));instructions.required=true;instructions.rows=6;
  form.append(node('p','Explain the outcome, the facts to check, and what a useful draft should contain.','agent-help'));
  const tools=node('fieldset','','agent-choices');tools.append(node('legend','Records this skill may read'));const choices:HTMLInputElement[]=[];
  for(const id of data.allowedTools){const label=node('label','','agent-check'),choice=node('input');choice.type='checkbox';choice.value=id;choice.checked=skill?skill.allowedTools.includes(id):['profile','tasks','goals'].includes(id);choices.push(choice);label.append(choice,node('span',toolLabels[id]??id));tools.append(label);}form.append(tools);
  const message=formStatus(form),save=submit(form),head=modal.firstElementChild!;const restore=()=>{head.querySelector('h2')!.textContent=skill?'Edit skill':'Add a custom skill';modal.replaceChildren(head,form);save.disabled=false;title.focus();};
  const prepare=(archived=false)=>{const allowedTools=choices.filter(choice=>choice.checked).map(choice=>choice.value);if(!allowedTools.length){message.textContent='Choose at least one source this skill may read.';return;}const payload={id:skill?.id??newId,revision:skill?.revision??0,title:title.value.trim(),instructions:instructions.value.trim(),allowedTools,archived};review(modal,archived?'Archive this skill?':'Review your skill',[`${archived?'Archive':'Save'} “${payload.title}”.`,payload.instructions,`May read: ${allowedTools.map(id=>toolLabels[id]??id).join(', ')}.`,...(allowedTools.some(id=>['gmail_unread','calendar_openings'].includes(id))?['Connected sources are used only if you separately select them in this operator’s review settings.']:[])],async()=>{await hooks.api(base()+'/skills',payload);},restore,archived?'Archive skill':'Save skill');};
  form.onsubmit=event=>{event.preventDefault();prepare();};if(skill&&!skill.archived)form.append(button('Archive skill',()=>{if(form.reportValidity())prepare(true);}));modal.append(form);title.focus();
 }
 function restoreRecord(record:Goal|Skill,kind:'goal'|'skill'){
  const modal=dialog(kind==='goal'?'Restore this goal?':'Restore this skill?'),payload={...record,archived:false},readback=[`Restore “${record.title}”.`];
  if('description'in record){readback.push(record.description||'No description.',record.metric?`Manually entered: starting ${record.metric.baseline}, current ${record.metric.current}, target ${record.metric.target} ${record.metric.unit}.`:'No measured progress is entered.',record.deadline?`Target date ${dateText(record.deadline)}.`:'No target date.');}
  else{readback.push(record.instructions,`May read: ${record.allowedTools.map(id=>toolLabels[id]??id).join(', ')}.`);if(record.allowedTools.some(id=>['gmail_unread','calendar_openings'].includes(id)))readback.push('Connected sources are used only if separately selected in this operator’s review settings.');}
  review(modal,kind==='goal'?'Restore this goal?':'Restore this skill?',readback,async()=>{await hooks.api(base()+(kind==='goal'?'/goals':'/skills'),payload);},()=>modal.close(),kind==='goal'?'Restore goal':'Restore skill',kind==='goal'?'Goal restored.':'Skill restored.');
 }
 function identityForm(identity:Identity){
  const details=node('details','','agent-identity');details.dataset.agentDisclosure='identity';details.append(node('summary','Identity & working style'));
  const nameRow=node('div','','agent-manage-row');nameRow.append(node('strong',identity.displayName),button('Change name',()=>{
   const modal=dialog('Choose your assistant’s name'),form=node('form','','agent-form'),name=field(form,'Assistant name',input(identity.displayName,40));name.required=true;
   form.append(node('p','Continue in the Assistant to send your choice and confirm it.','agent-help'));submit(form,'Continue in Assistant');
   form.onsubmit=event=>{event.preventDefault();const value=name.value.trim();if(!value)return;modal.close();hooks.ask(`Call yourself ${value}`);};modal.append(form);name.focus();
  }));details.append(nameRow);
  const form=node('form','','agent-form'),mission=field(form,'Mission',textArea(identity.mission,1200));
  const tone=field(form,'Tone',node('select'));tone.append(new Option('Warm','warm'),new Option('Professional','professional'),new Option('Direct','direct'));tone.value=identity.tone;
  const principles=field(form,'Principles · one per line',textArea(identity.principles.join('\n'),1500));
  const style=field(form,'How Mayor should work with you',textArea(identity.workingStyle,800));
  const message=formStatus(form);submit(form,'Review identity');
  form.onsubmit=event=>{event.preventDefault();const values=principles.value.split('\n').map(value=>value.trim()).filter(Boolean);if(values.length>6||values.some(value=>value.length>240)){message.textContent='Enter up to six principles, up to 240 characters each.';return;}const payload={revision:identity.revision,mission:mission.value.trim(),tone:tone.value,principles:values,workingStyle:style.value.trim()};
   const modal=dialog('Review identity & working style');review(modal,'Review identity & working style',[`Mission: ${payload.mission}`,`Tone: ${payload.tone}.`,`Principles: ${payload.principles.join(' · ')}`,`Working style: ${payload.workingStyle}`,'These are shared instructions for this business. They do not grant new tools or authorize messages.'],async()=>{await hooks.api(base()+'/identity',payload);},()=>modal.close(),'Save identity');
  };details.append(form);return details;
 }
 function configuration(state:Data){
  const config=state.config,activeGoals=state.goals.filter(item=>!item.archived),form=node('form','','agent-form agent-configuration');form.append(node('h3','Review settings'));
  const goalIds=node('fieldset','','agent-choices');goalIds.append(node('legend','Goals for this agent · choose up to eight'));const goalChoices:HTMLInputElement[]=[];
  for(const goal of activeGoals){const label=node('label','','agent-check'),choice=node('input');choice.type='checkbox';choice.value=goal.id;choice.checked=config.goalIds.includes(goal.id)||config.revision===0&&activeGoals.length===1;goalChoices.push(choice);label.append(choice,node('span',goal.title));goalIds.append(label);}if(!goalChoices.length)goalIds.append(node('p','Set a goal to guide this agent.'));form.append(goalIds);
  const skills=node('fieldset','','agent-choices');skills.append(node('legend','Skills · choose up to eight'));const skillChoices:HTMLInputElement[]=[];
  for(const item of [...state.builtins,...state.skills.filter(skill=>!skill.archived)]){const card=node('div','','agent-skill-choice'),label=node('label','','agent-check'),choice=node('input');choice.type='checkbox';choice.value=item.id;choice.checked=config.skillIds.includes(item.id);skillChoices.push(choice);label.append(choice,node('span',item.title));card.append(label);const detail=node('details');detail.append(node('summary','How this skill works'),node('p',item.instructions));if('steps'in item){const list=node('ol');item.steps.forEach(step=>list.append(node('li',step)));detail.append(list);}card.append(detail);skills.append(card);}form.append(skills);
  const connectorOptions=config.connectorOptions??{},connections=node('details','','agent-connectors');connections.append(node('summary','Optional connected sources'));
  const gmail=field(connections,'Unread Gmail for this review',node('select'));gmail.append(new Option('Do not read Gmail',''));for(const [index,grant] of (state.connectors?.gmail?.connections??[]).entries()){const option=new Option(`Saved Gmail connection ${index+1} · ${grant.status.replace(/_/g,' ')}`,grant.grantId);option.disabled=grant.status!=='authorized'||!state.connectors?.gmail?.available;gmail.append(option);}gmail.value=connectorOptions.gmailGrantId??'';if(state.connectors?.gmail?.scope)connections.append(node('p',state.connectors.gmail.scope,'agent-help'));
  const calendar=field(connections,'Calendar openings for this review',node('select'));calendar.append(new Option('Do not check calendar openings',''));for(const type of state.connectors?.calendar?.appointmentTypes??[])calendar.append(new Option(type.name,type.name));calendar.value=connectorOptions.calendar?.appointmentType??'';if(state.connectors?.calendar?.scope)connections.append(node('p',state.connectors.calendar.scope,'agent-help'));
  const staff=field(connections,'Calendar staff · optional',node('select'));staff.append(new Option('No staff filter',''));const staffChoices=()=>{const selected=state.connectors?.calendar?.appointmentTypes?.find(type=>type.name===calendar.value);staff.replaceChildren(new Option('No staff filter',''));for(const name of selected?.staff??[])staff.append(new Option(name,name));staff.disabled=!calendar.value;};calendar.onchange=staffChoices;staffChoices();staff.value=connectorOptions.calendar?.staff??'';form.append(connections);
  const scheduled=node('label','','agent-check'),enabled=node('input');enabled.type='checkbox';enabled.checked=config.enabled;scheduled.append(enabled,node('span','Run automatically'));form.append(scheduled);
  const schedule=node('div','','agent-schedule'),frequency=field(schedule,'Frequency',node('select'));frequency.append(new Option('Weekdays','weekdays'),new Option('Every day','daily'));frequency.value=config.schedule?.frequency??'weekdays';
  const time=field(schedule,'Local review time',input(`${String(config.schedule?.hour??9).padStart(2,'0')}:${String(config.schedule?.minute??0).padStart(2,'0')}`));time.type='time';time.step='300';time.required=true;
  const zone=field(schedule,'Time zone',input(config.schedule?.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone,100));zone.required=true;form.append(schedule,node('p','Each AI review uses one shared reply attempt.','agent-help'));
  const message=formStatus(form);submit(form,'Review agent settings');
  form.onsubmit=event=>{event.preventDefault();const selectedGoals=goalChoices.filter(choice=>choice.checked).map(choice=>choice.value),selectedSkills=skillChoices.filter(choice=>choice.checked).map(choice=>choice.value);if(selectedGoals.length>8||!selectedSkills.length||selectedSkills.length>8){message.textContent='Choose up to eight goals and between one and eight skills.';return;}const [hour,minute]=time.value.split(':').map(Number);if(!Number.isInteger(hour)||!Number.isInteger(minute)||minute%5!==0){message.textContent='Choose a time in five-minute increments.';return;}try{new Intl.DateTimeFormat('en',{timeZone:zone.value.trim()});}catch{message.textContent='Use a valid time zone, such as America/New_York.';return;}
   const options:ConnectorOptions={...(gmail.value?{gmailGrantId:gmail.value}:{}),...(calendar.value?{calendar:{appointmentType:calendar.value,...(staff.value?{staff:staff.value}:{})}}:{})},payload={revision:config.revision,enabled:enabled.checked,goalIds:selectedGoals,skillIds:selectedSkills,connectorOptions:options,schedule:{frequency:frequency.value as Schedule['frequency'],hour,minute,timeZone:zone.value.trim()}};
   const modal=dialog('Review agent settings');review(modal,'Review agent settings',[`Goals: ${selectedGoals.map(id=>state.goals.find(goal=>goal.id===id)?.title??id).join(', ')||'No selected goals'}.`,`Skills: ${selectedSkills.map(id=>[...state.builtins,...state.skills].find(skill=>skill.id===id)?.title??id).join(', ')}.`,payload.enabled?`Run ${payload.schedule.frequency==='daily'?'every day':'Monday through Friday'} at ${time.value} in ${payload.schedule.timeZone}.`:`Pause automatic reviews. Save ${time.value} in ${payload.schedule.timeZone} for later.`,gmail.value?'Read unread Gmail from the selected saved connection.':'Do not read Gmail.',calendar.value?'Check openings for the selected calendar service.':'Do not check live calendar openings.','Each AI review uses one shared reply attempt. Reports suggest actions; tasks require a separate review.'],async()=>{await hooks.api(base()+'/config',payload);},()=>modal.close(),'Save agent settings');
  };return form;
 }
 function reviewRun(){
  if(!data||busy||!data.config.revision)return;const modal=dialog(requestId?'Check your saved attempt':'Review my business');const retry=Boolean(requestId);
  review(modal,retry?'Check your saved attempt':'Review my business',[retry?'Check the same saved request. This does not start a second reply attempt.':'Run one AI review using this operator’s saved goals, skills, and allowed sources.','Each AI review uses one shared reply attempt.','Suggested tasks remain drafts until you review and confirm them.'],async()=>{
   const tenant=activeTenant,captured=epoch;saveRequest(requestId??crypto.randomUUID());busy=true;status(retry?'Checking the saved attempt…':'Reviewing your business…');
   try{const result=await hooks.api(base()+'/run',{requestId}) as {run:Run;report:Report|null;replay:boolean};if(!current(captured,tenant))return;if(result.run.status!=='processing')saveRequest(null);if(data)data={...data,latestReport:result.report??data.latestReport,history:[result.run,...data.history.filter(item=>item.id!==result.run.id)]};}
   finally{if(current(captured,tenant))busy=false;}
  },()=>modal.close(),retry?'Check saved attempt':'Start review','Your review attempt was checked.');
 }
 function taskForm(runId:string,draft:Draft){
  const modal=dialog('Review suggested task'),form=node('form','','agent-form');const title=field(form,'Task',input(draft.title));title.required=true;
  const priority=field(form,'Priority',node('select'));for(const value of ['low','normal','high'])priority.append(new Option(value[0].toUpperCase()+value.slice(1),value));priority.value=draft.priority;
  const due=field(form,'Due date · optional',input(localDate(draft.dueAt)));due.type='datetime-local';form.append(node('p',draft.detail,'agent-help'));
  const message=formStatus(form),save=submit(form,'Review internal task'),head=modal.firstElementChild!;const restore=()=>{head.querySelector('h2')!.textContent='Review suggested task';modal.replaceChildren(head,form);save.disabled=false;title.focus();};
  form.onsubmit=event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;const captured=epoch,tenant=activeTenant;void(async()=>{try{const dueAt=due.value?new Date(due.value).toISOString():null;const result=await hooks.api(base()+'/tasks/prepare',{runId,draftId:draft.id,title:title.value.trim(),priority:priority.value,dueAt,customerId:draft.customerId??null});if(!current(captured,tenant)||!modal.isConnected)return;const proposal=result.proposal as {id:string;expiresAt:string;readback:string};review(modal,'Confirm internal task',[proposal.readback,`This review expires ${dateText(proposal.expiresAt)}.`],async()=>{await hooks.api(base()+'/tasks/confirm',{proposal:{id:proposal.id}});},restore,'Save internal task');}catch(error){if(current(captured,tenant)&&modal.isConnected){message.textContent=errorText(error);save.disabled=false;}}})();};modal.append(form);title.focus();
 }
 function clear(){epoch++;loadVersion++;data=null;activeTenant='';activeActor='';requestId=null;busy=false;revealAfterSave='';element.replaceChildren();for(const modal of [...dialogs]){modal.close();modal.remove();}dialogs.clear();}
 /** Scroll to the Business agent section and open "Goals, skills & automation".
  * Returns false when the section is not rendered yet (caller retries). */
 function reveal():boolean{
  if(!element.isConnected||!data)return false;
  const manage=element.querySelector<HTMLDetailsElement>('details[data-agent-disclosure="manage"]');
  if(!manage)return false;
  manage.open=true;
  element.scrollIntoView({block:'start',behavior:'smooth'});
  const heading=element.querySelector<HTMLElement>('.agent-heading h2');
  if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  return true;
 }
 return {element,load,clear,reveal};
}
