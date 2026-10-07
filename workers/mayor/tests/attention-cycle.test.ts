import {it,expect} from 'vitest';
import {runAttentionCycle} from '../src/attention-cycle';
it.each(['checks','queue','delivery'] as const)('continues independent work after %s fails, while surfacing failure',async failing=>{
 const order:string[]=[],reports:unknown[]=[];
 const stage=(name:string)=>async()=>{order.push(name);if(name===failing)throw new Error('private credential and provider body');return 1;};
 await expect(runAttentionCycle({checks:stage('checks'),queue:stage('queue'),delivery:stage('delivery')},(name,result)=>reports.push({name,...result}))).rejects.toThrow(`Attention cycle failed: ${failing}.`);
 expect(order).toEqual(['checks','queue','delivery']);
 expect(reports).toHaveLength(3);expect(reports).toContainEqual({name:failing,ok:false});
 expect(JSON.stringify(reports)).not.toContain('private');
});
it('queues only after checks finish and delivers only after queueing finishes',async()=>{
 const order:string[]=[];
 const stage=(name:string)=>async()=>{order.push(name+' start');await Promise.resolve();order.push(name+' finish');return 1;};
 await runAttentionCycle({checks:stage('checks'),queue:stage('queue'),delivery:stage('delivery')},()=>{});
 expect(order).toEqual(['checks start','checks finish','queue start','queue finish','delivery start','delivery finish']);
});
