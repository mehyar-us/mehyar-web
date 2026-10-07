/** Latest complete messages only; bound the reconnect payload without splitting facts. */
export function voiceHistory(messages:Array<{role:string;content:string}>){
 const selected:Array<{role:'user'|'assistant';text:string}>=[];
 let remaining=64000;
 for(const message of messages.slice(-50).reverse()){
  if(message.role!=='user'&&message.role!=='assistant')continue;
  if(message.content.length>remaining)break;
  selected.push({role:message.role,text:message.content});remaining-=message.content.length;
 }
 return selected.reverse();
}
