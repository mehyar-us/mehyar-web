// Explicit user action starts capture. Stop offers review; never sends a question.
export function encodeMayorWave(samples:Float32Array, sampleRate:number) {
  const length=Math.min(480000,Math.floor(samples.length*16000/sampleRate)), out=new ArrayBuffer(44+length*2), v=new DataView(out);
  const label=(at:number,text:string)=>{for(let i=0;i<text.length;i++)v.setUint8(at+i,text.charCodeAt(i));};
  label(0,'RIFF');v.setUint32(4,36+length*2,true);label(8,'WAVE');label(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);label(36,'data');v.setUint32(40,length*2,true);
  for(let i=0;i<length;i++){const from=Math.floor(i*sampleRate/16000), to=Math.min(samples.length,Math.max(from+1,Math.floor((i+1)*sampleRate/16000)));let sum=0;for(let j=from;j<to;j++)sum+=samples[j];const n=Math.max(-1,Math.min(1,sum/(to-from)));v.setInt16(44+i*2,n<0?n*32768:n*32767,true);}
  return out;
}
export function createMayorRecorder(callbacks:{state:(state:'idle'|'starting'|'listening'|'transcribing')=>void;transcript:(text:string)=>void;error:(text:string)=>void}) {
  let generation=0, recorder:MediaRecorder|null=null, stream:MediaStream|null=null, timer:ReturnType<typeof setTimeout>|undefined, abort:AbortController|null=null, context:AudioContext|null=null;
  const release=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;};
  const cancel=()=>{generation++;abort?.abort();abort=null;if(recorder?.state==='recording')recorder.stop();recorder=null;release();void context?.close().catch(()=>{});context=null;callbacks.state('idle');};
  const start=async()=>{
    cancel();const id=generation;callbacks.state('starting');
    timer=setTimeout(()=>{if(id===generation){cancel();callbacks.error('Microphone permission is still pending. Allow access in your browser, then tap the mic again. You can continue with text.');}},20000);
    try {
      const acquired=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(id!==generation){acquired.getTracks().forEach(t=>t.stop());return;}clearTimeout(timer);stream=acquired;
      const r=new MediaRecorder(acquired), chunks:BlobPart[]=[];let size=0;recorder=r;
      r.ondataavailable=e=>{if(id!==generation)return;size+=e.data.size;if(size>2000000){cancel();callbacks.error('Voice message was too large. Try a shorter question.');return;}chunks.push(e.data);};
      r.onerror=()=>{if(id!==generation)return;cancel();callbacks.error('The microphone could not record. Your typed draft stays here.');};
      r.onstop=async()=>{
        if(id!==generation)return;release();recorder=null;callbacks.state('transcribing');
        try {
          const audio=new Blob(chunks,{type:r.mimeType});const decodingContext=new AudioContext();context=decodingContext;const decoded=await decodingContext.decodeAudioData(await audio.arrayBuffer());
          if(id!==generation)return;if(decoded.duration>30.5||decoded.duration<0.1)throw Error('duration');
          const mono=new Float32Array(decoded.length);for(let c=0;c<decoded.numberOfChannels;c++){const channel=decoded.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/decoded.numberOfChannels;}
          const wave=encodeMayorWave(mono,decoded.sampleRate);await decodingContext.close();
          if(id!==generation)return;if(context===decodingContext)context=null;
          abort=new AbortController();timer=setTimeout(()=>abort?.abort(),30000);
          const res=await fetch('/api/explore-voice',{method:'POST',headers:{'content-type':'audio/wav'},body:wave,signal:abort.signal});const data=await res.json();
          if(id!==generation)return;if(!res.ok)throw Error(data.message||'Voice transcription is unavailable.');
          if(typeof data.text!=='string'||data.text.length>1600)throw Error('No usable transcript was returned.');callbacks.transcript(data.text);
        }catch(e){if(id===generation)callbacks.error(e instanceof Error&&e.name!=='AbortError'?e.message:'Voice transcription was interrupted. Your draft stays here.');}
        finally{if(id===generation){clearTimeout(timer);abort=null;void context?.close().catch(()=>{});context=null;callbacks.state('idle');}}
      };
      r.start(250);callbacks.state('listening');timer=setTimeout(()=>{if(id===generation&&r.state==='recording')r.stop();},29000);
    }catch(e){if(id===generation){cancel();callbacks.error(e instanceof DOMException&&e.name==='NotAllowedError'?'Microphone access was not allowed. Continue with text or enable it in your browser.':'No microphone could start in this browser. Continue with text.');}}
  };
  const finish=()=>{if(recorder?.state==='recording')recorder.stop();};
  return {start,finish,cancel};
}
