import {z} from 'zod';
import {digest,HttpError} from './http';

/* Public email capture for the selling pages (rot136). The /sales form is
 * a native HTML form (the page ships no JavaScript), so this endpoint
 * answers with small HTML pages, not JSON. Submissions land in
 * mayor_sales_leads (migration 0067) and nowhere else. The pattern mirrors
 * the audit's public surface: zod validation, a per-IP minute rate limit
 * on the shared mayor_rate_limits table, and friendly error pages. */

export interface LeadsEnv{AGENT_DB:D1Database}

const emailSchema=z.string().trim().toLowerCase().min(3).max(254).email();
const sourceSchema=z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/);

async function leadRate(env:LeadsEnv,request:Request,max:number){
  const ip=await digest(request.headers.get('cf-connecting-ip')??'local-anonymous');
  const bucket=Math.floor(Date.now()/60000);
  const row=await env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1) ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`).bind(`mayor:leads:${ip}`,bucket,max).first();
  if(!row)throw new HttpError(429,'lead_rate_limited','Please wait a minute and try again.');
}

function leadPage(ok:boolean,slowDown=false,source='sales'):Response{
  const title=slowDown?'One moment.':ok?'You\u2019re on the list.':'That email doesn\u2019t look right.';
  const body=slowDown
    ?'Too many tries in a minute. Wait a moment, then try once more.'
    :ok
    ?source==='sales-loop'
      ?'Thanks \u2014 you\u2019re on the list. Your first email brings the Missed-Call Revenue Checklist, and it goes out with the monthly email \u2014 within 30 days. After that, one practical email a month. You can unsubscribe anytime.'
      :'Thanks \u2014 you\u2019re on the list. Your first email arrives with the monthly send \u2014 within 30 days \u2014 then one practical email a month. You can unsubscribe anytime.'
    :'Go back and check the address, then try again. Nothing was saved.';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title} \u00b7 The Mayor</title><style>body{margin:0;background:#f4f7fb;color:#102b47;font:17px/1.7 system-ui,sans-serif}main{max-width:640px;margin:auto;padding:64px 24px 80px}a{color:#315d86}h1{font-size:2.2rem;line-height:1.2}</style></head><body><main><h1>${title}</h1><p>${body}</p><p><a href="/sales">Back to The Mayor</a></p></main></body></html>`;
  return new Response(html,{status:slowDown?429:ok?200:400,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

export async function handleLeadsPublic(request:Request,env:LeadsEnv):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(path!=='/api/leads')return null;
  try{
    if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST to join the list.');
    const length=Number(request.headers.get('content-length')??'0');
    if(length>8192)throw new HttpError(413,'body_too_large','That submission was too large.');
    await leadRate(env,request,10);
    let form:FormData;
    try{form=await request.formData();}catch{throw new HttpError(400,'invalid_form','The form could not be read.');}
    // Honeypot: a field real visitors never see or fill. Bots that fill it
    // get the success page and nothing is stored.
    const rawSourceEarly=String(form.get('source')??'sales');
    const honeypot=form.get('website');
    if(typeof honeypot==='string'&&honeypot.trim()!=='')return leadPage(true,false,rawSourceEarly);
    const email=emailSchema.parse(String(form.get('email')??''));
    const rawSource=rawSourceEarly;
    const source=sourceSchema.safeParse(rawSource).success?rawSource:'sales';
    await env.AGENT_DB.prepare('INSERT OR IGNORE INTO mayor_sales_leads(id,email,source,created_at) VALUES(?1,?2,?3,?4)')
      .bind(crypto.randomUUID(),email,source,Date.now()).run();
    return leadPage(true,false,source);
  }catch(error){
    if(error instanceof z.ZodError)return leadPage(false);
    if(error instanceof HttpError&&error.status===400)return leadPage(false);
    if(error instanceof HttpError&&error.status===429)return leadPage(false,true);
    if(error instanceof HttpError)throw error;
    throw new HttpError(500,'lead_failed','The signup could not be completed. Try again.');
  }
}
