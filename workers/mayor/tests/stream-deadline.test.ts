import {expect,it,vi} from 'vitest';
import {StreamDeadlineError,withStreamDeadline} from '../src/stream-deadline';

const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

it('passes values through when the source completes in time',async()=>{
 async function* source(){yield 'a';await delay(5);yield 'b';}
 const seen:string[]=[];
 for await(const value of withStreamDeadline(source(),{idleMs:1000,totalMs:5000}))seen.push(value);
 expect(seen).toEqual(['a','b']);
});

it('fails with an idle deadline when the source goes silent',async()=>{
 async function* source(){yield 'a';await new Promise<void>(()=>{});}
 const guarded=(async()=>{for await(const value of withStreamDeadline(source(),{idleMs:40,totalMs:5000}))void value;})();
 await expect(guarded).rejects.toBeInstanceOf(StreamDeadlineError);
 await expect(guarded.catch(error=>error)).resolves.toMatchObject({kind:'idle'});
});

it('closes the source iterator and calls onTimeout when a deadline fires',async()=>{
 const onTimeout=vi.fn();let closed=false;
 const source={[Symbol.asyncIterator](){return {next:()=>new Promise<IteratorResult<string>>(()=>{}),return:async()=>{closed=true;return {done:true,value:undefined};}};}};
 const guarded=(async()=>{for await(const value of withStreamDeadline(source,{idleMs:40,totalMs:5000,onTimeout}))void value;})();
 await expect(guarded).rejects.toMatchObject({kind:'idle'});
 expect(onTimeout).toHaveBeenCalledWith('idle');
 expect(closed).toBe(true);
});

it('fails with a total deadline even when values keep arriving',async()=>{
 async function* source(){for(;;){await delay(15);yield 'x';}}
 const guarded=(async()=>{for await(const value of withStreamDeadline(source(),{idleMs:5000,totalMs:50}))void value;})();
 await expect(guarded).rejects.toMatchObject({kind:'total'});
});

it('propagates a source error unchanged',async()=>{
 async function* source(){yield 'a';throw new Error('model blew up');}
 const guarded=(async()=>{for await(const value of withStreamDeadline(source(),{idleMs:1000,totalMs:5000}))void value;})();
 await expect(guarded).rejects.toThrow('model blew up');
});
