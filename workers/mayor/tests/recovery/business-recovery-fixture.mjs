// Synthetic restore-only records: no provider calls, credentials or live data.
const quote=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
export function businessRecoveryFixtureSql(){
 const statements=[],insert=(table,row)=>statements.push(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`);
 const now='2026-10-03T10:00:00.000Z',later='2099-01-01T10:00:00.000Z',tenant='business-recovery-fixture';
 const schedule=JSON.stringify({frequency:'weekdays',hour:9,minute:0,timeZone:'America/New_York'});
 insert('agent_tenants',{id:tenant,name:'Synthetic recovery business',created_at:now});
 insert('mayor_harness_state',{tenant_id:tenant,revision:4});
 insert('mayor_harness_identity',{tenant_id:tenant,mission:'Preserve the reviewed business identity',tone:'warm',principles_json:'["Review before changing records"]',working_style:'Concise',revision:3,updated_by:'restore-active',updated_at:now});
 for(const archived of [0,1]){
  insert('mayor_harness_goals',{id:`restore-goal-${archived}`,tenant_id:tenant,title:archived?'Archived goal':'Active goal',description:'Manually entered recovery fixture',metric_json:JSON.stringify({baseline:0,current:3,target:10,unit:'reviewed drafts'}),deadline:later,archived,revision:5,created_by:'restore-active',updated_by:'restore-active',created_at:now,updated_at:now});
  insert('mayor_harness_skills',{id:`restore-skill-${archived}`,tenant_id:tenant,title:archived?'Archived skill':'Active skill',instructions:'Review saved task records',allowed_tools_json:'["tasks"]',archived,revision:7,created_by:'restore-active',updated_by:'restore-active',created_at:now,updated_at:now});
 }
 // Include a paused manual lease, a stale due date, a fully idle configuration,
 // and an in-flight run whose configuration lease is already missing.
 const cases=[
  {name:'active',revision:2,enabled:1,next:now,date:'2026-10-03',token:'restore-active-lease',lease:later},
  {name:'manual',revision:7,enabled:0,next:null,date:null,token:'restore-manual-lease',lease:later},
  {name:'due',revision:11,enabled:0,next:null,date:'2026-10-03',token:null,lease:null},
  {name:'idle',revision:13,enabled:0,next:null,date:null,token:null,lease:null},
  {name:'orphan',revision:17,enabled:0,next:null,date:null,token:null,lease:null},
 ];
 for(const fixture of cases){
  const actor={tenant_id:tenant,user_id:`restore-${fixture.name}`};insert('agent_memberships',{...actor,role:'owner'});
  const config={...actor,enabled:fixture.enabled,schedule_json:schedule,revision:fixture.revision,next_run_at:fixture.next,due_local_date:fixture.date,lease_token:fixture.token,lease_until:fixture.lease,last_run_at:now,last_status:'ready',created_at:now,updated_at:now};
  insert('mayor_business_routines',{...config,template_ids_json:'["daily-priorities"]',attempts:2});
  insert('mayor_harness_configs',{...config,goal_ids_json:'["restore-goal-0"]',skill_ids_json:'["builtin:daily-priorities"]',connector_options_json:'{}'});
  if(['active','manual','orphan'].includes(fixture.name)){
   insert('mayor_business_routine_runs',{id:`restore-routine-${fixture.name}`,...actor,config_revision:fixture.revision,dedupe_key:`manual:${fixture.name}`,trigger_kind:'manual',state:'processing',lease_token:`captured-${fixture.name}`,lease_until:later,brief_json:'{"partial":"not accepted"}',created_at:now,updated_at:now});
   insert('mayor_harness_runs',{id:`restore-harness-${fixture.name}`,...actor,config_revision:fixture.revision,data_revision:4,memory_revision:2,dedupe_key:`manual:${fixture.name}`,trigger_kind:'manual',state:'processing',lease_token:`captured-${fixture.name}`,lease_until:later,report_json:'{"partial":"not accepted"}',reply_attempt_counted:fixture.name==='manual'?0:1,model_started_at:fixture.name==='manual'?null:now,created_at:now,updated_at:now});
  }
 }
 const actor={tenant_id:tenant,user_id:'restore-idle'};
 const brief=JSON.stringify({id:'restore-routine-ready',generatedAt:now,summary:'Previously accepted brief',metrics:[],priorities:[],suggestions:[],gaps:[],scope:'Synthetic saved records'});
 for(const state of ['ready','failed','discarded'])insert('mayor_business_routine_runs',{id:`restore-routine-${state}`,...actor,config_revision:13,dedupe_key:`manual:${state}`,trigger_kind:'manual',state,lease_token:state==='ready'?'historical-ready-token':null,lease_until:null,brief_json:state==='ready'?brief:null,read_at:now,created_at:now,updated_at:now});
 insert('mayor_tasks',{id:'restore-accepted-task',tenant_id:tenant,title:'Previously reviewed internal task',created_by:actor.user_id,updated_by:actor.user_id,created_at:now,updated_at:now});
 const report=JSON.stringify({id:'restore-harness-ready',generatedAt:now,summary:'Previously accepted report',metrics:[],goalProgress:[],priorities:[],taskDrafts:[{id:'draft-1',acceptedTaskId:'restore-accepted-task'}],experiments:[],toolTrace:[],gaps:[],scope:'Synthetic saved records'});
 for(const state of ['ready','failed','blocked','canceled'])insert('mayor_harness_runs',{id:`restore-harness-${state}`,...actor,config_revision:13,data_revision:4,memory_revision:2,dedupe_key:`manual:${state}`,trigger_kind:'manual',state,lease_token:state==='ready'?'historical-ready-token':null,lease_until:null,report_json:state==='ready'?report:null,error_code:state==='failed'?'prior_failure':null,reply_attempt_counted:1,model_started_at:now,read_at:now,created_at:now,updated_at:now});
 for(const kind of ['goal','skill','config','task','identity'])insert('mayor_harness_proposals',{id:`restore-pending-${kind}`,...actor,kind,input_json:JSON.stringify({retained:kind}),state:'pending',expires_at:kind==='goal'?now:later,created_at:now});
 insert('mayor_harness_proposals',{id:'restore-already-expired',...actor,kind:'task',input_json:'{"retained":"expired"}',state:'pending',expires_at:'1970-01-01T00:00:00.000Z',created_at:now});
 insert('mayor_harness_proposals',{id:'restore-confirmed',...actor,kind:'task',input_json:'{"retained":"confirmed"}',state:'confirmed',expires_at:later,created_at:now});
 insert('mayor_harness_task_acceptances',{...actor,run_id:'restore-harness-ready',draft_id:'draft-1',task_id:'restore-accepted-task',input_json:'{"retained":"accepted details"}',created_at:now});
 insert('mayor_billing_usage_periods',{tenant_id:tenant,period_key:'restore-period',kind:'turn',count:12,last_claim_id:'retained-claim'});
 for(const [index,status] of ['awaiting_payment','queued','in_review','report_ready','needs_review'].entries()){
  const ready=status==='report_ready',active=['awaiting_payment','queued','in_review'].includes(status);
  insert('mayor_audit_orders',{id:`restore-audit-${status}`,mode:'test',request_id:`restore-request-${status}`,request_hash:`retained-request-${index}`,status_token_hash:`retained-receipt-${index}`,stripe_session_id:`cs_synthetic_${index}`,stripe_payment_intent_id:`pi_synthetic_${index}`,stripe_customer_id:`cus_synthetic_${index}`,checkout_url:`https://example.invalid/synthetic-checkout-${index}`,expires_at:4070908800,provider_started_at:1791021600,payment_status:status==='awaiting_payment'?'pending':status==='needs_review'?'refunded':'paid',fulfillment_status:status,intake_json:'{"businessName":"Synthetic audit recovery"}',processing_token:active?'captured-checkout-token':null,lease_expires_at:active?4070908800:null,paid_at:status==='awaiting_payment'?null:now,created_at:now,updated_at:now,report_json:ready?'{"saved":"accepted report"}':null,review_json:ready?'{"approved":true}':null,report_created_at:ready?now:null,analysis_token:active?'captured-analysis-token':null,analysis_lease_expires_at:active?4070908800:null,analysis_attempts:3,analysis_next_attempt_at:active?4070908800:0,analysis_error_code:status==='needs_review'?'prior_review_hold':null,analysis_stage:'review',analysis_stage_attempts:2,evidence_json:'{"retained":"source evidence"}',draft_json:'{"retained":"draft"}',analysis_review_count:1,analysis_job_id:`retained-job-${index}`,analysis_job_model:'synthetic-retained-model',analysis_job_reference:`retained-reference-${index}`,analysis_job_started_at:1791021600,analysis_job_poll_failures:1});
 }
 for(const status of ['pending','processing','processed','failed'])insert('mayor_billing_events',{mode:'test',event_id:`evt_synthetic_${status}`,payload_hash:`retained-hash-${status}`,status,event_type:'checkout.session.completed',processing_token:status==='processing'?'captured-event-token':null,lease_expires_at:status==='processing'?4070908800:null,error_code:status==='failed'?'prior_failure':null,received_at:now});
 return statements.join('\n');
}
