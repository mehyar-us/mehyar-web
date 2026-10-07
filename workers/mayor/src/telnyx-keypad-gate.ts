import {validAssistantName} from './assistant-persona';
/** This controller owns keypad input before the AI starts. say must resolve only
 * after prompt playback ends; verification hooks are server-side, never tools. */
export type TelnyxCallGate={start(resume:()=>void):void;digit(value:string):void;close():void};
type Hooks={
 say(text:string):Promise<void>;
 send():Promise<{nonce:string}>;
 check(nonce:string,code:string):Promise<{state:string;nonce:string}>;
 end():void;
};
export class TelnyxKeypadGate implements TelnyxCallGate{
 private phase:'new'|'busy'|'consent'|'code'|'done'='new';
 private digits='';private nonce='';private resume=()=>{};
 private timer:ReturnType<typeof setTimeout>|undefined;
 private lifetime:ReturnType<typeof setTimeout>|undefined;
 private name:string;
 constructor(private hooks:Hooks,name='The Mayor'){this.name=validAssistantName(name)?name:'The Mayor';}
 start(resume:()=>void){
  if(this.phase!=='new')return;this.resume=resume;
  this.lifetime=setTimeout(()=>this.end(),300000);
  void this.prompt(`I am ${this.name}, an AI for this business. To verify your calling number, press 1 to receive a text code. Message and data rates may apply. Press 2 to continue without appointment access.`,'consent');
 }
 private clearTimer(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;}
 private async prompt(text:string,next:'consent'|'code'){
  this.phase='busy';this.clearTimer();
  try{await this.hooks.say(text);if(this.closed())return;this.phase=next;this.timer=setTimeout(()=>this.end(),next==='consent'?20000:60000);}catch{this.end();}
 }
 private closed(){return this.phase==='done';}
 digit(value:string){
  if(this.phase!=='consent'&&this.phase!=='code')return;
  if(!/^[0-9*#]$/.test(value)){this.end();return;}
  if(this.phase==='consent'){
   if(value==='2'){void this.finish(false);return;}
   if(value!=='1')return;
   this.phase='busy';this.clearTimer();void this.send();return;
  }
  if(value==='*'){this.digits='';return;}
  if(value==='#'){
   const code=this.digits;this.digits='';this.clearTimer();this.phase='busy';
   if(!code){void this.finish(false);return;}
   if(code.length<4){void this.prompt('Enter the code using your keypad, then press pound. Press star to clear, or pound without a code to continue without verification.','code');return;}
   void this.check(code);return;
  }
  if(this.digits.length>=10){this.end();return;}this.digits+=value;
 }
 private async send(){
  try{
   const result=await this.hooks.send();if(this.closed())return;this.nonce=result.nonce;
   await this.prompt('Enter the text code on your keypad, then press pound. Do not say it aloud. Press star to clear, or pound without a code to continue without verification.','code');
  }catch{if(!this.closed())await this.finish(false);}
 }
 private async check(code:string){
  try{
   const result=await this.hooks.check(this.nonce,code);if(this.closed())return;
   this.nonce=result.nonce;
   if(result.state==='approved')await this.finish(true);
   else if(result.state==='pending')await this.prompt('That code was not accepted. Please try again using your keypad, then press pound.','code');
   else await this.finish(false);
  }catch{if(!this.closed())await this.finish(false);}
 }
 private async finish(verified:boolean){
  this.phase='busy';this.clearTimer();this.digits='';this.nonce='';
  try{
   await this.hooks.say(verified?`Your calling number is verified. Appointment access also requires permission from the business. You can speak to ${this.name} now.`:`Continuing without verification. You can ask ${this.name} for a callback, but appointment access is unavailable.`);
   if(this.closed())return;this.close();this.resume();
  }catch{this.end();}
 }
 private end(){if(this.closed())return;this.close();this.hooks.end();}
 close(){this.phase='done';this.digits='';this.nonce='';this.clearTimer();if(this.lifetime)clearTimeout(this.lifetime);}
}
