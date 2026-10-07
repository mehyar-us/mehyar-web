type Stage='checks'|'queue'|'delivery';
/** Preserve check -> queue -> delivery order, without starving later stages on failure. */
export async function runAttentionCycle(
 stages:Record<Stage,()=>Promise<unknown>>,
 report:(stage:Stage,result:{ok:true;summary:unknown}|{ok:false})=>void,
){
 const failed:Stage[]=[];
 for(const stage of ['checks','queue','delivery'] as const){
  try{report(stage,{ok:true,summary:await stages[stage]()});}
  catch{failed.push(stage);report(stage,{ok:false});}
 }
 // Never expose provider/database errors, credentials or customer content in logs.
 if(failed.length)throw new Error(`Attention cycle failed: ${failed.join(', ')}.`);
}
