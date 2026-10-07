// Consume Wrangler's JSON stream without displaying request metadata or tokens.
import {createInterface} from 'node:readline';
let buffer='';
for await(const line of createInterface({input:process.stdin})){
 if(line.startsWith('{'))buffer=line;
 else if(buffer)buffer+='\n'+line;
 if(buffer&&line.trim()==='}'){
  try{
   const event=JSON.parse(buffer);buffer='';
   for(const log of event.logs??[])for(const message of log.message??[]){
    if(typeof message!=='string')continue;
    let data;try{data=JSON.parse(message);}catch{continue;}
    if(data.event==='calendar_provider_failure'&&/^(google|microsoft)\.calendar\.[a-z_]+$/.test(data.operation)&&/^[a-z_]+$/.test(data.kind))
     console.log(JSON.stringify({event:data.event,operation:data.operation,kind:data.kind,status:Number.isInteger(data.status)?data.status:null}));
   }
  }catch{}
 }
 if(buffer.length>1000000)buffer='';
}
