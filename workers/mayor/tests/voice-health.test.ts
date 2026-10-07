import {afterEach,expect,it,vi} from 'vitest';
import {createVoiceDiagnostics} from '../web/voice-diagnostics';
import {createVoiceHealth} from '../web/voice-health';

// A minimal synthetic DOM verifies privacy/export behavior, not visual layout.
class Element{
 children:Element[]=[];attributes=new Map<string,string>();textContent='';id='';className='';disabled=false;hidden=false;
 onclick:(()=>void)|null=null;href='';download='';
 constructor(readonly tag:string){}
 setAttribute(name:string,value:string){this.attributes.set(name,value);}
 append(...nodes:Element[]){this.children.push(...nodes);}
 click(){this.onclick?.();}remove(){}
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
function fixture(){
 const elements:Element[]=[];
 vi.stubGlobal('document',{createElement:(tag:string)=>{const element=new Element(tag);elements.push(element);return element;}});
 const fetch=vi.fn(()=>{throw new Error('No network request is allowed');});vi.stubGlobal('fetch',fetch);
 const diagnostics=createVoiceDiagnostics(),health=createVoiceHealth(diagnostics);
 const button=(label:string)=>elements.find(element=>element.tag==='button'&&element.textContent===label)!;
 const metrics={turnId:'private-turn-reference',source:'speech',outcome:'completed',turnTotalMs:1200,finalInputToFirstAudioMs:800,
  transcript:'Private customer transcript must never be exported',tenantId:'private-business-reference'};
 return {elements,diagnostics,health,button,metrics,fetch};
}
it('requires opt-in before retaining metrics and clearing stops collection',()=>{
 const f=fixture();f.diagnostics.record(f.metrics);expect(f.diagnostics.count).toBe(0);
 expect(f.button('Download voice report').disabled).toBe(true);
 f.button('Start local diagnostics').click();f.diagnostics.record(f.metrics);f.health.refresh();
 expect(f.diagnostics.count).toBe(1);expect(f.button('Download voice report').disabled).toBe(false);
 f.button('Clear report').click();expect(f.diagnostics.active).toBe(false);expect(f.diagnostics.count).toBe(0);
 f.diagnostics.record(f.metrics);expect(f.diagnostics.count).toBe(0);expect(f.fetch).not.toHaveBeenCalled();
});
it('downloads content-free JSON locally, preserves measurements when stopped and releases the object URL',async()=>{
 vi.useFakeTimers();const f=fixture();let downloaded!:Blob;
 const create=vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{downloaded=blob as Blob;return 'blob:local-voice-report';});
 const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 f.button('Start local diagnostics').click();f.diagnostics.record(f.metrics);f.health.refresh();f.button('Stop collection').click();
 expect(f.diagnostics.count).toBe(1);expect(f.diagnostics.active).toBe(false);f.button('Download voice report').click();
 expect(create).toHaveBeenCalledOnce();expect(downloaded.type).toBe('application/json');
 const body=await downloaded.text(),report=JSON.parse(body);
 expect(report.measurement).toBe('server_voice_pipeline');expect(report.retainedTurns).toBe(1);
 expect(body).not.toContain('Private customer');expect(body).not.toContain('private-business-reference');expect(body).not.toContain('private-turn-reference');
 expect(report.limitations).toContain('Not acoustic end-of-speech to audible playback latency.');
 expect(f.elements.find(element=>element.tag==='a')?.download).toBe('mayor-voice-diagnostics.json');
 await vi.advanceTimersByTimeAsync(1000);expect(revoke).toHaveBeenCalledWith('blob:local-voice-report');expect(f.fetch).not.toHaveBeenCalled();
});
it('keeps a local report available after a browser download failure without exposing error content',()=>{
 const f=fixture();vi.spyOn(URL,'createObjectURL').mockImplementation(()=>{throw new Error('Private browser detail');});
 f.button('Start local diagnostics').click();f.diagnostics.record(f.metrics);f.health.refresh();f.button('Download voice report').click();
 expect(f.diagnostics.count).toBe(1);expect(f.button('Download voice report').disabled).toBe(false);
 const visible=f.elements.map(element=>element.textContent).join(' ');
 expect(visible).toContain('The report could not be downloaded');expect(visible).not.toContain('Private browser detail');expect(f.fetch).not.toHaveBeenCalled();
});
