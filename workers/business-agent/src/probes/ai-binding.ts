import {estimateStandardText} from '../billing/text-meter';
import {parseTextUsageReceipt} from '../billing/text-receipt';
import {mailTriageRequest,parseMailTriage,type MailTriageSource} from '../connectors/mail-triage';

// Separate local-only synthetic probe; not imported by the customer Worker.
// Repeated requests reuse the first promise, including failure, until restarted.
let run:Promise<unknown>|undefined;
async function probe(ai:Ai){
  const source:MailTriageSource={streamId:'binding-probe',messageId:'synthetic-email',receipt:'11111111-1111-4111-8111-111111111111',provider:'google',observedAt:'2026-09-16T12:00:00.000Z',sourceMode:'incremental',
    projection:{version:1,text:'Can you tell me the available haircut appointments on Monday afternoon and the price? Please do not book anything yet.',omissions:[],trustedForInstructions:false}};
  const request=mailTriageRequest(source),estimate=estimateStandardText(request),started=Date.now();
  const response=await ai.run('@cf/openai/gpt-oss-120b',request,{gateway:{id:'mehyar-business-agent-dev',skipCache:true,collectLog:false,
    metadata:{tenant_id:'synthetic-binding-probe',billing_domain:'business_agent',workload:'mailbox_triage'}},signal:AbortSignal.timeout(60000)});
  const receipt=parseTextUsageReceipt(response),raw=typeof response==='object'&&response&&'choices' in response?response.choices?.[0]?.message?.content:null;
  if(typeof raw!=='string')throw new Error('The binding did not return text choices.');
  const result=parseMailTriage(raw,source);
  return {version:1,checkedAt:new Date().toISOString(),transport:'local-workerd-remote-ai-binding',gateway:'mehyar-business-agent-dev',syntheticOnly:true,
    elapsedMs:Date.now()-started,estimate,receipt,...(receipt.state==='reported'?{inputTokenDifference:receipt.inputTokens-estimate.inputTokens}:{}),result,productionAcceptanceApproved:false};
}
export default {
  async fetch(request:Request,env:{AI:Ai}){
    const url=new URL(request.url);
    if(url.hostname!=='127.0.0.1'||url.pathname!=='/probe'||request.method!=='POST'||request.headers.has('origin')||request.headers.get('x-probe-intent')!=='synthetic-only')
      return new Response('Not found',{status:404});
    run??=probe(env.AI);
    try{return Response.json(await run,{headers:{'cache-control':'no-store'}});}
    catch{return Response.json({error:'Synthetic binding probe failed; no automatic retry.'},{status:502,headers:{'cache-control':'no-store'}});}
  },
} satisfies ExportedHandler<{AI:Ai}>;
