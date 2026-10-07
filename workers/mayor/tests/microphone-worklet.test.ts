import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
it('captures 20 ms PCM16 little-endian frames across render blocks, with RMS and no speaker output',()=>{
 let Processor:any;const sent:any[]=[];
 runInNewContext(readFileSync(new URL('../web/public/microphone-worklet.js',import.meta.url),'utf8'),{
  AudioWorkletProcessor:class{port={postMessage:(value:any)=>sent.push(value)};},
  registerProcessor:(_name:string,value:any)=>{Processor=value;},Float32Array,ArrayBuffer,DataView,Math,
 });
 const processor=new Processor(),block=new Float32Array(128).fill(.5);
 processor.process([[block]]);processor.process([[block]]);expect(sent).toHaveLength(0);
 processor.process([[block]]);expect(sent).toHaveLength(1);expect(sent[0].pcm.byteLength).toBe(640);
 expect(new DataView(sent[0].pcm).getInt16(0,true)).toBe(16384);expect(sent[0].rms).toBe(.5);
 processor.process([[new Float32Array(256).fill(-1)]]);expect(sent).toHaveLength(2);
 expect(new DataView(sent[1].pcm).getInt16(638,true)).toBe(-32768);
});
