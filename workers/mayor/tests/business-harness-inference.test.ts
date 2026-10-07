import {it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
import {inferHarnessPlan,type HarnessContext} from '../src/business-harness';

const context:HarnessContext={checkedAt:'2026-10-04T02:00:00.000Z',dates:[],openTasks:[],profile:{name:'Synthetic workshop'},identity:{revision:0,displayName:'Mayor',mission:'Use recorded facts',tone:'direct',principles:[],workingStyle:''},goals:[],skills:[{id:'builtin:daily-priorities',title:'Daily priorities',instructions:'Choose a reversible next step.',allowedTools:['tasks']}],sources:[{id:'metrics:tasks',kind:'counts',detail:'One open task; customer outcomes are unknown.'}],metrics:[{key:'open_tasks',label:'Open tasks',value:1}],gaps:[],toolTrace:[],memoryRevision:1,dataRevision:1,authorizations:[{grantId:'private-grant',provider:'google',userId:'private-user',accountId:'private-account',revision:1,grantedScopes:'private-scopes',selectedCapabilities:'private-capabilities'}]};
const plan={summary:'Review the saved facts and choose one reversible next step.',priorities:[{title:'Review the recorded handoff gap',detail:'Check the saved notes before acting.',sourceIds:['metrics:tasks']}],taskDrafts:[{workType:'new_task',existingTaskId:null,title:'Draft a maintenance handoff checklist',detail:'Prepare an internal draft for operator review.',priority:'normal',goalIds:[],skillIds:['builtin:daily-priorities'],sourceIds:['metrics:tasks']}],experiments:[],gaps:['Customer outcomes are unknown.']};
const flatCall=()=>({name:'returnBusinessPlan',arguments:JSON.stringify(plan)});
const publicPlan={...plan,taskDrafts:plan.taskDrafts.map(({workType,existingTaskId,...item})=>item)};
const usage={prompt_tokens:20,completion_tokens:30,total_tokens:50};
function runtime(output:Record<string,any>){
 const frames=output.tool_calls?[{tool_calls:output.tool_calls.map((call:any,index:number)=>({...call,index})),choices:output.choices,usage:output.usage}]:[{choices:output.choices?.map((choice:any)=>({delta:choice.message,finish_reason:choice.finish_reason})),usage:output.usage}];
 const run=vi.fn(async(..._args:unknown[])=>new ReadableStream<Uint8Array>({start(controller){for(const frame of frames)controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close();}}));
 return {env:{AI:{run}} as unknown as Env,run};
}

it.each(['native','compatible'])('uses one non-executable structured return tool through the actual provider %s format',async format=>{
 const output=format==='native'?{response:null,tool_calls:[flatCall()],usage}:{response:null,choices:[{message:{content:null,reasoning_content:'Private reasoning is not a plan receipt.',tool_calls:[{id:'call-plan',type:'function',function:flatCall()}]},finish_reason:'tool_calls'}],usage};
 const fixture=runtime(output);
 expect(await inferHarnessPlan(fixture.env,context)).toEqual(publicPlan);
 expect(fixture.run).toHaveBeenCalledTimes(1);
 const inputs=fixture.run.mock.calls[0][1] as Record<string,any>;
 expect(inputs.response_format).toBeUndefined();
 expect(inputs.tools).toHaveLength(1);
 expect(inputs.tools[0].function.name).toBe('returnBusinessPlan');
 expect(inputs.tool_choice).toEqual({type:'function',function:{name:'returnBusinessPlan'}});
 expect(inputs.chat_template_kwargs).toEqual({enable_thinking:false});
 expect(inputs.max_tokens).toBe(1800);
 expect(inputs.stream).toBe(true);
 expect(JSON.stringify(inputs.messages)).not.toContain('private-grant');
 expect(JSON.stringify(inputs.messages)).not.toContain('authorizations');
 expect(JSON.stringify(inputs.messages)).toContain('Never introduce numeric experiment sizes');
 expect(JSON.stringify(inputs.messages)).toContain('Zero new tasks is valid');
 expect(JSON.stringify(inputs.messages)).toContain('reuse_existing');
 expect(inputs.tools[0].function.parameters.properties.taskDrafts.items.required).toEqual(expect.arrayContaining(['workType','existingTaskId']));
});

it('does not promote a complete structured object found only in private reasoning',async()=>{
 const fixture=runtime({response:null,choices:[{message:{content:null,reasoning:JSON.stringify(plan),reasoning_content:JSON.stringify(plan)},finish_reason:'stop'}],usage});
 await expect(inferHarnessPlan(fixture.env,context)).rejects.toThrow(/required tool|one complete structured plan|could not finish/);
 expect(fixture.run).toHaveBeenCalledTimes(1);
});

it.each(['duplicate','invalid','truncated'])('rejects %s return receipts without another model call',async invalid=>{
 const calls=invalid==='duplicate'?[flatCall(),flatCall()]:invalid==='invalid'?[{name:'returnBusinessPlan',arguments:'{"summary":"incomplete"}'}]:[flatCall()];
 const fixture=runtime({response:null,tool_calls:calls,choices:[{finish_reason:invalid==='truncated'?'length':'tool_calls'}],usage});
 await expect(inferHarnessPlan(fixture.env,context)).rejects.toThrow();
 expect(fixture.run).toHaveBeenCalledTimes(1);
});

it('requires private disposition in native output while legacy injection remains a separate contract',async()=>{
 const legacy={...plan,taskDrafts:plan.taskDrafts.map(({workType,existingTaskId,...item})=>item)},fixture=runtime({response:null,tool_calls:[{name:'returnBusinessPlan',arguments:JSON.stringify(legacy)}],usage});
 await expect(inferHarnessPlan(fixture.env,context)).rejects.toThrow();expect(fixture.run).toHaveBeenCalledTimes(1);
});
