// Real, user-initiated browser speech. No audio is stored by this website.
export type MayorVoiceState = "idle" | "starting" | "listening" | "transcribing" | "speaking";
type RecognitionEvent = { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
type Recognition = {
  lang:string; continuous:boolean; interimResults:boolean;
  onstart:(()=>void)|null; onend:(()=>void)|null;
  onerror:((event:{error:string})=>void)|null;
  onresult:((event:RecognitionEvent)=>void)|null;
  start:()=>void; stop:()=>void; abort:()=>void;
};
export type MayorSpeechPlatform = {
  SpeechRecognition?:new()=>Recognition; webkitSpeechRecognition?:new()=>Recognition;
  speechSynthesis?:Pick<SpeechSynthesis,"speak"|"cancel"|"getVoices">;
  SpeechSynthesisUtterance?:new(text:string)=>SpeechSynthesisUtterance;
};
export function createMayorVoice(platform:MayorSpeechPlatform, callbacks:{state:(v:MayorVoiceState)=>void; transcript:(text:string,final:boolean)=>void; error:(message:string)=>void}) {
  const RecognitionConstructor=platform.SpeechRecognition||platform.webkitSpeechRecognition;
  let recognition:Recognition|null=null, generation=0, activeUtterance:SpeechSynthesisUtterance|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{generation++;clearTimeout(timer);recognition?.abort();recognition=null;platform.speechSynthesis?.cancel();activeUtterance=null;callbacks.state("idle");};
  const listen=(lang="en-US")=>{
    stop();if(!RecognitionConstructor){callbacks.error("Voice input is unavailable in this browser. Type your question, or use your keyboard's dictation.");return;}
    const id=generation, r=new RecognitionConstructor();recognition=r;r.lang=lang;r.continuous=false;r.interimResults=true;
    callbacks.state("starting");
    r.onstart=()=>{if(id===generation)callbacks.state("listening");};
    r.onresult=(event)=>{if(id!==generation)return;const results=Array.from(event.results);const final=results.every(result=>result.isFinal);callbacks.transcript(results.map(result=>result[0].transcript).join(" ").slice(0,1600),final);};
    r.onerror=(event)=>{if(id!==generation)return;stop();callbacks.error(event.error==="not-allowed"||event.error==="service-not-allowed"?"Microphone access was not allowed. You can keep typing, or enable it in your browser settings.":event.error==="no-speech"?"No speech was heard. Try again or type your question.":event.error==="network"?"This browser could not reach its speech recognition service. Your typed draft stays here. Try keyboard dictation or another browser.":event.error==="audio-capture"?"No microphone is available to this browser. Check your input device, or keep typing.":`Voice input could not finish (${event.error}). Your typed draft stays here.`);};
    r.onend=()=>{if(id!==generation)return;clearTimeout(timer);recognition=null;callbacks.state("idle");};
    timer=setTimeout(()=>{if(id===generation){stop();callbacks.error("Listening stopped after 30 seconds. Review your draft before sending.");}},30000);
    try{r.start();}catch{stop();callbacks.error("The microphone could not start. You can still type your question.");}
  };
  const speak=(text:string,lang="en-US")=>{
    stop();if(!platform.speechSynthesis||!platform.SpeechSynthesisUtterance){callbacks.error("Read aloud is unavailable in this browser. The complete answer is here as text.");return;}
    const id=generation, utterance=new platform.SpeechSynthesisUtterance(text.slice(0,2200)); utterance.lang=lang;
    activeUtterance=utterance;
    const voice=platform.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()===lang.toLowerCase())||platform.speechSynthesis.getVoices().find(v=>v.lang.startsWith(lang.split("-")[0]));
    if(voice)utterance.voice=voice;
    utterance.onstart=()=>{if(id===generation){clearTimeout(timer);callbacks.state("speaking");timer=setTimeout(()=>{if(id===generation)stop();},120000);}};
    utterance.onend=()=>{if(id===generation){clearTimeout(timer);activeUtterance=null;callbacks.state("idle");}};
    utterance.onerror=()=>{if(id===generation){stop();callbacks.error("Read aloud could not finish. The answer is available as text.");}};
    timer=setTimeout(()=>{if(id===generation){stop();callbacks.error("Your browser did not start audio. Try Read aloud again or continue with text.");}},8000);
    try{platform.speechSynthesis.speak(utterance);}catch{stop();callbacks.error("Audio could not start. Continue with text.");}
  };
  const finishListening=()=>{try{recognition?.stop();}catch{stop();}};
  return {listen,speak,stop,finishListening,supportsInput:!!RecognitionConstructor,supportsOutput:!!(platform.speechSynthesis&&platform.SpeechSynthesisUtterance)};
}
