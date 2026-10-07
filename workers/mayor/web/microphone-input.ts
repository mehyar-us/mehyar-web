import type {VoiceAudioInput} from '@cloudflare/voice/client';
import {prepareMicrophone} from './microphone-check';

/** One permission request and one stream per call, including cancelled startups. */
export class MayorMicrophone implements VoiceAudioInput{
 onAudioLevel:((rms:number)=>void)|null=null;
 onAudioData:((pcm:ArrayBuffer)=>void)|null=null;
 private generation=0;
 private stream?:MediaStream;
 private context?:AudioContext;
 private source?:MediaStreamAudioSourceNode;
 private processor?:AudioWorkletNode;
 private active=false;
 async prepare(){
  this.stop();const attempt=this.generation;
  // Invoke capture directly in the click turn. Playback/capture initialization
  // must not postpone the browser permission request behind a network response.
  const permission=prepareMicrophone();
  try{
   const stream=await permission;
   if(attempt!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
   this.stream=stream;
   const context=new AudioContext({sampleRate:16000});this.context=context;
   await context.resume();
   if(attempt!==this.generation)return;
   if(context.sampleRate!==16000)throw new Error('This browser cannot initialize voice capture at the required sample rate.');
   await context.audioWorklet.addModule('/microphone-worklet.js');
   if(attempt!==this.generation)return;
   this.processor=new AudioWorkletNode(context,'mayor-microphone');
   this.processor.port.onmessage=({data})=>{
    if(!this.active||attempt!==this.generation)return;
    this.onAudioLevel?.(data.rms);this.onAudioData?.(data.pcm);
   };
  }catch(error){if(attempt===this.generation)this.stop();throw error;}
 }
 async start(){
  if(!this.stream||!this.context||!this.processor)throw new Error('Microphone preparation did not finish. Try again.');
  if(this.active)return;
  this.source=this.context.createMediaStreamSource(this.stream);
  this.source.connect(this.processor);this.processor.connect(this.context.destination);
  this.active=true;
 }
 stop(){
  this.generation++;this.active=false;
  this.source?.disconnect();this.source=undefined;
  if(this.processor){this.processor.port.onmessage=null;this.processor.disconnect();this.processor.port.close();this.processor=undefined;}
  this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;
  if(this.context){void this.context.close().catch(()=>{});this.context=undefined;}
 }
}
