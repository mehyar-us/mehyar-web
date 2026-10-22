/** HTTP and socket conversations share the same authorized business tools. */
export async function collectTextTurn(source:Promise<string|AsyncIterable<string>>,signal:AbortSignal){
 const value=await source;let reply='';
 if(signal.aborted)throw new Error('Conversation timed out');
 if(typeof value==='string'){if(value.length>12000)throw new Error('Response too large');return value;}
 for await(const part of value){
  if(signal.aborted)throw new Error('Conversation timed out');
  reply+=part;if(reply.length>12000)throw new Error('Response too large');
 }
 if(signal.aborted)throw new Error('Conversation timed out');
 return reply;
}
