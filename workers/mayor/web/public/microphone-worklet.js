// 20 ms mono PCM16 frames. Output stays silent: never monitor the microphone
// through speakers, which would cause feedback. No audio is persisted here.
class MayorMicrophoneProcessor extends AudioWorkletProcessor{
 constructor(){super();this.samples=new Float32Array(320);this.used=0;}
 process(inputs){
  const channels=inputs[0];if(!channels?.length)return true;
  for(let i=0;i<channels[0].length;i++){
   let sample=0;for(const channel of channels)sample+=channel[i]??0;
   this.samples[this.used++]=Math.max(-1,Math.min(1,sample/channels.length));
   if(this.used===320){
    const pcm=new ArrayBuffer(640),view=new DataView(pcm);let energy=0;
    for(let j=0;j<320;j++){const value=this.samples[j];energy+=value*value;view.setInt16(j*2,Math.round(value*(value<0?32768:32767)),true);}
    this.port.postMessage({pcm,rms:Math.sqrt(energy/320)},[pcm]);this.used=0;
   }
  }
  return true;
 }
}
registerProcessor('mayor-microphone',MayorMicrophoneProcessor);
