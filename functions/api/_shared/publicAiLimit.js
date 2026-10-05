// Best-effort short-lived KV counters shared by public text and voice requests.
// Never persist raw IPs, questions, transcripts or audio.
export async function publicAiLimit(request, env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('cf-connecting-ip') || 'local'));
  const hash = Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
  const key=`explore:minute:${Math.floor(Date.now()/60000)}:${hash}`, budgetKey=`explore:day:${Math.floor(Date.now()/86400000)}`;
  const count=Number(await env.INTAKE_KV.get(key)||0), budget=Number(await env.INTAKE_KV.get(budgetKey)||0);
  if(count>=6||budget>=Number(env.PUBLIC_AI_DAILY_LIMIT||150))return false;
  await env.INTAKE_KV.put(key,String(count+1),{expirationTtl:120});
  await env.INTAKE_KV.put(budgetKey,String(budget+1),{expirationTtl:172800});
  return true;
}
