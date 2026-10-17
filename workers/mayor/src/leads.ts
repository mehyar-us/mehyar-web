import {z} from 'zod';
import {digest,HttpError} from './http';

/* Public email capture for the selling pages (rot136). The /sales form is
 * a native HTML form (the page ships no JavaScript), so this endpoint
 * answers with small HTML pages, not JSON. Submissions land in
 * mayor_sales_leads (migration 0067) and nowhere else. The pattern mirrors
 * the audit's public surface: zod validation, a per-IP minute rate limit
 * on the shared mayor_rate_limits table, and friendly error pages. */

export interface LeadsEnv{AGENT_DB:D1Database;MAYOR_EMAIL?:SendEmail;MAYOR_EMAIL_FROM?:string}

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
      ?'Thanks \u2014 you\u2019re on the list. Your Missed-Call Revenue Checklist is on its way to your inbox now \u2014 it should land within a few minutes. After that, one practical email a month, each with an unsubscribe link.'
      :'Thanks \u2014 you\u2019re on the list. Your Missed-Call Revenue Checklist is on its way to your inbox now \u2014 it should land within a few minutes. After that, one practical email a month, each with an unsubscribe link.'
    :'Go back and check the address, then try again. Nothing was saved.';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title} \u00b7 The Mayor</title><style>body{margin:0;background:#f4f7fb;color:#102b47;font:17px/1.7 system-ui,sans-serif}main{max-width:640px;margin:auto;padding:64px 24px 80px}a{color:#315d86}h1{font-size:2.2rem;line-height:1.2}</style></head><body><main><h1>${title}</h1><p>${body}</p><p><a href="/sales">Back to The Mayor</a></p></main></body></html>`;
  return new Response(html,{status:slowDown?429:ok?200:400,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

/* Checklist email leg (CoC ruling 2026-10-17: ON-CAPTURE delivery,
 * final). Email 1 IS the checklist — full text in-body, not a teaser —
 * carrying the launch pack \u00a74 footer line verbatim. The pack's
 * \u00a74 said Email 1's content was "unchanged"; no original ever
 * existed (verified by exhaustive search 2026-10-16), so this text
 * was authored to the pack's spec: the checklist itself + the footer
 * line of record. One deviation, flagged to the Marketing Chief:
 * the checklist page's Telnyx sentence is omitted here (telephony
 * claims stay out of inboxes until the live webhook lands).
 * Sends ride the worker's production send_email binding, the same
 * transport as the owner alert mail. A failed send never fails the
 * capture; the row tracks attempts and the cron retries. */
export const CHECKLIST_EMAIL_SUBJECT='Your Missed-Call Revenue Checklist';
export function checklistEmailText(unsubscribeUrl:string):string{
 return `Here's the checklist you asked for \u2014 ten minutes, once, in order. Every figure in it is yours to measure; nothing here is a benchmark or a made-up number.

THE MISSED-CALL REVENUE CHECKLIST

1 \u00b7 See what you are missing
- Call your own business number after hours. Write down exactly what a customer hears \u2014 and how long it takes to reach a human, a voicemail, or a dead end.
- Pull last week's call log from your phone provider or phone bill. Count the unanswered calls. That count is your leak, in plain sight.
- Check how many of those missed calls left no voicemail. Those callers are gone unless something reaches them first.

2 \u00b7 Time your rescue
- Pick three recent missed calls and time how long each waited for a callback. Write the longest one down \u2014 that is the number to beat.
- Set a same-hour rule: every missed call gets a callback or a text within the hour, while the caller still remembers your name.

3 \u00b7 Text back instantly
- Until text-back is automatic, keep a copy-paste script by the phone: who you are, that you missed them, and one clear next step.

4 \u00b7 Plug the repeat leaks
- Find your two worst windows \u2014 lunch, closing time, Monday mornings are the usual suspects \u2014 and cover them first, with people or with the text-back above.
- Check that your hours on Google match your real hours. A caller who thinks you are closed never calls at all.

5 \u00b7 Count it, monthly
- Once a month: missed calls \u00d7 your average job value = the money on the table. Your numbers, your math \u2014 watch that figure fall as the leaks close.

The same checklist lives here any time: https://mayor.mehyar.us/missed-call-checklist

The Mayor runs this loop for you \u2014 answering the calls you miss, texting back the leads, and keeping the count where you can see it.

When you're ready to stop the leak entirely: founding cohort seats for The Mayor are open \u2014 $79.20/mo for life for the first 25 businesses.

\u2014 The Mayor, by MehyarSoft LLC
You asked for this checklist at mayor.mehyar.us \u2014 this email is its delivery. After it, one practical email a month. Unsubscribe: ${unsubscribeUrl}`;
}

type LeadRow={id:string;email:string;email1_sent_at:number|null;email1_attempts:number;unsubscribed_at:number|null};
const unsubscribeUrlFor=(email:string)=>`https://mayor.mehyar.us/api/leads/unsubscribe?e=${encodeURIComponent(email)}`;

/** One delivery attempt. Returns true only when the email was sent. */
export async function deliverChecklistEmail(env:LeadsEnv,lead:LeadRow):Promise<boolean>{
 if(lead.email1_sent_at||lead.unsubscribed_at)return false;
 if(!env.MAYOR_EMAIL||!env.MAYOR_EMAIL_FROM)return false;
 try{
  await env.MAYOR_EMAIL.send({from:{email:env.MAYOR_EMAIL_FROM,name:'The Mayor'},to:lead.email,subject:CHECKLIST_EMAIL_SUBJECT,text:checklistEmailText(unsubscribeUrlFor(lead.email))});
  await env.AGENT_DB.prepare('UPDATE mayor_sales_leads SET email1_sent_at=? WHERE id=?').bind(Date.now(),lead.id).run();
  return true;
 }catch{
  await env.AGENT_DB.prepare('UPDATE mayor_sales_leads SET email1_attempts=email1_attempts+1 WHERE id=?').bind(lead.id).run().catch(()=>undefined);
  return false;
 }
}

/** Cron retry: leads captured in the last 7 days whose Email 1 has
 * not landed after up to 3 attempts. Bounded per cycle. */
export async function deliverPendingLeadEmails(env:LeadsEnv,nowMs=Date.now()):Promise<{attempted:number;sent:number}>{
 const rows=await env.AGENT_DB.prepare('SELECT id,email,email1_sent_at,email1_attempts,unsubscribed_at FROM mayor_sales_leads WHERE email1_sent_at IS NULL AND unsubscribed_at IS NULL AND email1_attempts<3 AND created_at>? ORDER BY created_at ASC LIMIT 10')
  .bind(nowMs-7*24*3600*1000).all<LeadRow>();
 let attempted=0,sent=0;
 for(const lead of rows.results){attempted++;if(await deliverChecklistEmail(env,lead))sent++;}
 return {attempted,sent};
}

function unsubscribePage(done:boolean,email:string):Response{
 const inner=done
  ?`<h1>You\u2019re unsubscribed.</h1><p>${email} will not receive the monthly follow-up emails. The checklist you already received is yours to keep.</p>`
  :`<h1>Unsubscribe?</h1><p>Stop the monthly follow-up emails to ${email}?</p><form method="POST" action="/api/leads/unsubscribe"><input type="hidden" name="email" value="${email}"><button type="submit">Unsubscribe</button></form>`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Unsubscribe \u00b7 The Mayor</title><style>body{margin:0;background:#f4f7fb;color:#102b47;font:17px/1.7 system-ui,sans-serif}main{max-width:640px;margin:auto;padding:64px 24px 80px}h1{font-size:2rem;line-height:1.2}button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#102b47;color:#fff;cursor:pointer}</style></head><body><main>${inner}<p><a href="/sales">Back to The Mayor</a></p></main></body></html>`;
 return new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

async function handleUnsubscribe(request:Request,env:LeadsEnv):Promise<Response>{
 const url=new URL(request.url);
 if(request.method==='GET'){
  const email=emailSchema.safeParse(url.searchParams.get('e')??'');
  return unsubscribePage(false,email.success?email.data:'');
 }
 const form=await request.formData();
 const email=emailSchema.safeParse(String(form.get('email')??''));
 if(email.success){
  await env.AGENT_DB.prepare('UPDATE mayor_sales_leads SET unsubscribed_at=? WHERE email=?').bind(Date.now(),email.data).run();
  return unsubscribePage(true,email.data);
 }
 return unsubscribePage(false,'');
}

export async function handleLeadsPublic(request:Request,env:LeadsEnv):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(path==='/api/leads/unsubscribe')return handleUnsubscribe(request,env);
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
    // On-capture delivery (CoC ruling 2026-10-17): Email 1 goes out
    // now — for a brand-new lead, and for an earlier lead whose send
    // never landed. A send failure never fails the capture.
    const lead=await env.AGENT_DB.prepare('SELECT id,email,email1_sent_at,email1_attempts,unsubscribed_at FROM mayor_sales_leads WHERE email=?')
      .bind(email).first<LeadRow>().catch(()=>null);
    if(lead)await deliverChecklistEmail(env,lead).catch(()=>false);
    return leadPage(true,false,source);
  }catch(error){
    if(error instanceof z.ZodError)return leadPage(false);
    if(error instanceof HttpError&&error.status===400)return leadPage(false);
    if(error instanceof HttpError&&error.status===429)return leadPage(false,true);
    if(error instanceof HttpError)throw error;
    throw new HttpError(500,'lead_failed','The signup could not be completed. Try again.');
  }
}
