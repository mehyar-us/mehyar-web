// Only emit fixed connection-stage diagnostics; discard URLs, headers and other logs.
import {createInterface} from 'node:readline';
let buffer='';
const stages=new Set(['identity','authorize','history','profile']);
for await(const line of createInterface({input:process.stdin})){
 if(line.startsWith('{'))buffer=line;else if(buffer)buffer+='\n'+line;
 if(buffer&&line.trim()==='}'){
  try{
   const event=JSON.parse(buffer);buffer='';
   for(const log of event.logs??[]){
    const parts=log.message??[];if(parts[0]!=='mayor_voice_connect_failed')continue;
    let info=parts[1];if(typeof info==='string'){try{info=JSON.parse(info);}catch{continue;}}
    if(stages.has(info?.stage)&&[1008,1011].includes(info?.code))console.log(JSON.stringify({event:'mayor_voice_connect_failed',stage:info.stage,code:info.code}));
   }
  }catch{}
 }
 if(buffer.length>1000000)buffer='';
}
