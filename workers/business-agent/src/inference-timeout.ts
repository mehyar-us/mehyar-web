/** Release the timeout when inference settles, so an idle Agent can be evicted. */
export async function withInferenceTimeout<T>(run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new DOMException('Analysis timed out.','TimeoutError')),60_000);
  try{return await run(controller.signal);}
  finally{clearTimeout(timeout);}
}
