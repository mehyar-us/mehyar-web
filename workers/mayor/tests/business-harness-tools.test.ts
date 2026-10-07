import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
const backend=vi.hoisted(()=>({readBusinessHarness:vi.fn(),prepareHarnessGoal:vi.fn(),prepareHarnessSkill:vi.fn(),prepareHarnessConfig:vi.fn(),prepareHarnessIdentity:vi.fn(),prepareHarnessTask:vi.fn(),runBusinessHarnessNow:vi.fn()}));
vi.mock('../src/business-harness',()=>backend);
import {businessHarnessTools} from '../src/business-harness-tools';

const goalId='c056c68a-0575-4d71-91cd-ae2f6c6089c',proposalId='7f191eba-1a8d-493a-8b1f-f07977fffe75';
const state={goals:[{id:goalId,revision:4,title:'Repeat visits',description:'Preserve the actual saved description',metric:{baseline:10,current:11,target:15,unit:'visits'},deadline:null,archived:false}],skills:[],config:{revision:3,enabled:true,goalIds:[goalId],skillIds:['builtin:daily-priorities'],schedule:{frequency:'weekdays',hour:9,minute:0,timeZone:'America/New_York'},connectorOptions:{}},identity:{revision:2,mission:'Organize the workshop',tone:'warm',principles:['Use saved facts'],workingStyle:'Ask one question'}};
const proposal={id:proposalId,expiresAt:'2026-10-04T01:00:00.000Z',readback:'Read the complete reviewed values, then say yes.',requiresUiReview:false,input:{}};
function setup(transcript:string){const authorize=vi.fn(async()=>{}),claim=vi.fn(),readback=vi.fn(),pending=vi.fn(),valid=vi.fn(()=>true);return {tools:businessHarnessTools({env:{} as Env,actor:{tenantId:'a'.repeat(32),userId:'operator'},transcript,previousAssistant:'',authorize,claim,readback,pending,valid}),authorize,claim,readback,pending,valid};}
const options={toolCallId:'test',messages:[]};
beforeEach(()=>{vi.clearAllMocks();backend.readBusinessHarness.mockResolvedValue(state);for(const method of ['prepareHarnessGoal','prepareHarnessSkill','prepareHarnessConfig','prepareHarnessIdentity','prepareHarnessTask'] as const)backend[method].mockResolvedValue(proposal);});
describe('voice agent proposal orchestration',()=>{
 it('preserves saved goal fields and takes revision from the server',async()=>{
  const hooks=setup('Update my goal target');await hooks.tools.proposeAgentGoal.execute!({id:goalId,metric:{baseline:10,current:11,target:20,unit:'visits'}},options);
  expect(backend.prepareHarnessGoal.mock.calls[0][2]).toMatchObject({id:goalId,revision:4,title:'Repeat visits',description:state.goals[0].description,archived:false,metric:{target:20}});
  expect(hooks.pending).toHaveBeenCalledWith('goal',proposal);expect(hooks.readback).toHaveBeenCalledWith(proposal.readback,false);
 });
 it('keeps a pause from clearing selected goals, skills or the saved clock time',async()=>{
  const hooks=setup('Pause my business agent');await hooks.tools.proposeAgentSchedule.execute!({enabled:false},options);
  expect(backend.prepareHarnessConfig.mock.calls[0][2]).toEqual({...state.config,enabled:false});
 });
 it('overrides a contradictory model enable in the actual paused selection failure without bypassing review',async()=>{
  const skillId=crypto.randomUUID();backend.readBusinessHarness.mockResolvedValue({...state,goals:[{...state.goals[0],title:'Build a repeat-maintenance process'}],skills:[{id:skillId,title:'Maintenance planning',archived:false}],builtins:[]});
  const hooks=setup('Use the Build a repeat-maintenance process goal and the Maintenance planning custom skill for my business agent. Save these agent settings with automatic reviews paused, and no connector reads.');
  await hooks.tools.proposeAgentSchedule.execute!({enabled:true,goalTitles:['Build a repeat-maintenance process'],skillTitles:['Maintenance planning'],schedule:null,clearConnectorReads:true},options);
  expect(backend.prepareHarnessConfig.mock.calls[0][2]).toEqual({...state.config,enabled:false,goalIds:[goalId],skillIds:[skillId],schedule:null,connectorOptions:{}});
  expect(hooks.readback).toHaveBeenCalledWith(proposal.readback,false);expect(hooks.pending).toHaveBeenCalledWith('config',proposal);
 });
 it('keeps authoritative pauses behind title, permission and refusal guards',async()=>{
  backend.readBusinessHarness.mockResolvedValue({...state,builtins:[]});
  const unrequested=setup('Pause my business agent');await expect(unrequested.tools.proposeAgentSchedule.execute!({enabled:true,goalTitles:['Repeat visits']},options)).rejects.toThrow('current request');
  const refusal=setup('Do not pause my business agent');await expect(refusal.tools.proposeAgentSchedule.execute!({enabled:true},options)).rejects.toThrow('explicitly requests');
  const lookup=setup('Show my agent settings with automatic reviews paused');await expect(lookup.tools.proposeAgentSchedule.execute!({enabled:true},options)).rejects.toThrow('explicitly requests');
  const contradiction=setup('Pause my business agent and enable automatic reviews');await expect(contradiction.tools.proposeAgentSchedule.execute!({enabled:true},options)).rejects.toThrow('paused or enabled');
  const denied=setup('Pause my business agent');denied.authorize.mockRejectedValue(new Error('Access ended'));await expect(denied.tools.proposeAgentSchedule.execute!({enabled:true},options)).rejects.toThrow('Access ended');
  expect(backend.prepareHarnessConfig).not.toHaveBeenCalled();expect(contradiction.pending).not.toHaveBeenCalled();expect(denied.pending).not.toHaveBeenCalled();
 });
 it('resolves explicitly named saved selections and clears reads without trusting invented IDs',async()=>{
  const skillId=crypto.randomUUID();backend.readBusinessHarness.mockResolvedValue({...state,skills:[{id:skillId,title:'Maintenance planning',archived:false}],builtins:[]});
  const hooks=setup('Use the Repeat visits goal and Maintenance planning skill for my business agent. Save settings paused with no connector reads.');
  await hooks.tools.proposeAgentSchedule.execute!({enabled:false,goalTitles:['Repeat visits'],skillTitles:['Maintenance planning'],clearConnectorReads:true},options);
  expect(backend.prepareHarnessConfig.mock.calls[0][2]).toEqual({...state.config,enabled:false,goalIds:[goalId],skillIds:[skillId],connectorOptions:{}});
  expect(hooks.pending).toHaveBeenCalledWith('config',proposal);
 });
 it('rejects ambiguous, archived and unrequested title selections and contradictory connector choices',async()=>{
  const hooks=setup('Use the Repeat visits goal for my business agent. Save settings paused with no connector reads.');
  backend.readBusinessHarness.mockResolvedValue({...state,goals:[...state.goals,{...state.goals[0],id:crypto.randomUUID()}],builtins:[]});
  await expect(hooks.tools.proposeAgentSchedule.execute!({goalTitles:['Repeat visits']},options)).rejects.toThrow('unambiguous');
  backend.readBusinessHarness.mockResolvedValue({...state,goals:[{...state.goals[0],archived:true}],builtins:[]});
  await expect(hooks.tools.proposeAgentSchedule.execute!({goalTitles:['Repeat visits']},options)).rejects.toThrow('unambiguous');
  backend.readBusinessHarness.mockResolvedValue({...state,builtins:[]});
  await expect(hooks.tools.proposeAgentSchedule.execute!({goalTitles:['Repeat visits'],goalIds:[goalId]},options)).rejects.toThrow('never both');
  await expect(hooks.tools.proposeAgentSchedule.execute!({clearConnectorReads:true,connectorOptions:{gmailGrantId:crypto.randomUUID()}},options)).rejects.toThrow('without selecting');
  const lookup=setup('Pause my business agent');await expect(lookup.tools.proposeAgentSchedule.execute!({goalTitles:['Repeat visits']},options)).rejects.toThrow('current request');
  expect(backend.prepareHarnessConfig).not.toHaveBeenCalled();expect(hooks.pending).not.toHaveBeenCalled();
 });
 it('does not arm voice confirmation when the readback requires the visual review',async()=>{
  backend.prepareHarnessIdentity.mockResolvedValue({...proposal,requiresUiReview:true});const hooks=setup('Change your working style');
  expect(await hooks.tools.proposeAgentIdentity.execute!({workingStyle:'A long reviewed style'},options)).toEqual({status:'needs_ui_review'});
  expect(hooks.pending).not.toHaveBeenCalled();expect(hooks.readback).toHaveBeenCalledWith(proposal.readback,true);
 });
 it('rejects an unseen goal and ordinary lookup before preparing a write',async()=>{
  const unseen=setup('Update my goal');await expect(unseen.tools.proposeAgentGoal.execute!({id:crypto.randomUUID(),title:'Unseen'},options)).rejects.toThrow('Read the current business goal');
  const lookup=setup('Show my goals');await expect(lookup.tools.proposeAgentGoal.execute!({title:'Injected write'},options)).rejects.toThrow('explicitly requests');expect(backend.prepareHarnessGoal).not.toHaveBeenCalled();
 });
 it('drops a proposal when authorization changes after the server prepared it',async()=>{
  const hooks=setup('Add a goal');let checks=0;hooks.authorize.mockImplementation(async()=>{if(++checks===3)throw new Error('Access ended');});
  await expect(hooks.tools.proposeAgentGoal.execute!({title:'Real request'},options)).rejects.toThrow('Access ended');expect(hooks.pending).not.toHaveBeenCalled();expect(hooks.readback).not.toHaveBeenCalled();
 });
 it('uses one internal metering flag and a stable UUID for retries inside the turn',async()=>{
  backend.runBusinessHarnessNow.mockResolvedValue({run:{status:'failed'},report:null,replay:false});const hooks=setup('Generate an AI report');
  await hooks.tools.runAgentReview.execute!({},options);await hooks.tools.runAgentReview.execute!({},options);
  expect(backend.runBusinessHarnessNow.mock.calls[0][2]).toEqual(backend.runBusinessHarnessNow.mock.calls[1][2]);expect(backend.runBusinessHarnessNow.mock.calls[0][3]).toEqual({alreadyMetered:true});expect(hooks.pending).not.toHaveBeenCalled();
  const advice=setup('Help me grow my business');await expect(advice.tools.runAgentReview.execute!({},options)).rejects.toThrow('explicit run request');
 });
});
