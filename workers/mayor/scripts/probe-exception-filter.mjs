// Pipe Wrangler JSON tail through this before displaying it. Never emit request
// headers, bodies or general logs; this probe only needs exception diagnostics.
import {createInterface} from 'node:readline';
let buffer='';
for await(const line of createInterface({input:process.stdin})){
 if(line.startsWith('{'))buffer=line;
 else if(buffer)buffer+='\n'+line;
 if(buffer&&line.trim()==='}'){
  try{
   const event=JSON.parse(buffer);buffer='';
   if(event.exceptions?.length)console.log(JSON.stringify({exceptions:event.exceptions.map(({name,message,stack})=>({name,message,stack}))}).replace(/[a-f0-9]{64}/gi,'[redacted]'));
  }catch{}
 }
 if(buffer.length>1000000)buffer='';
}
