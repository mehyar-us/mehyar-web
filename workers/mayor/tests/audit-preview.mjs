// Explicitly synthetic browser QA. No provider APIs, payments, or real orders are used.
// Run after npm run build:web: node tests/audit-preview.mjs
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditFixtureDraft,auditFixtureEvidence,auditFixtureReview} from './fixtures/business-audit.ts';
import {recordedAuditPreviewEnvelope} from './audit-preview-evidence.mjs';

const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const port=Number(argument('port')??5186),previewToken='a'.repeat(64),recordedPath=argument('audit-evidence'),requestedReceiptState=argument('receipt-state');
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use --port=1024..65535.');
if(recordedPath&&requestedReceiptState!==undefined)throw new Error('Recorded audit evidence cannot override its receipt state.');
if(requestedReceiptState!==undefined&&!['report_ready','needs_review'].includes(requestedReceiptState))throw new Error('Use --receipt-state=report_ready or needs_review for synthetic previews only.');
const receiptState=requestedReceiptState??'report_ready';
const recordedArtifact=recordedPath?JSON.parse(await readFile(resolve(recordedPath),'utf8')):null;
const recordedEnvelope=recordedArtifact?recordedAuditPreviewEnvelope(recordedArtifact):null;
const orderId=recordedEnvelope?.orderId??'synthetic-audit-preview-order';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const evidence=auditFixtureEvidence();
// Example.com is reserved for examples; these observations are test data, not a performed audit.
const sources=evidence.sources.map(source=>({...source,url:'https://example.com/synthetic-bike-service'}));
const envelope=recordedEnvelope??{orderId,createdAt:'2026-10-03T16:00:00.000Z',report:{...auditFixtureDraft(),schemaVersion:1,orderId,businessName:'Cedar Bike Service · synthetic preview',website:'https://example.com/synthetic-bike-service',generatedAt:'2026-10-03T15:00:00.000Z',analysisModel:'synthetic-analysis-model · no model invoked',reviewModel:'synthetic-review-model · no model invoked',scope:{method:'Synthetic fixture for report interface verification. No website was fetched, no business was audited, and no model was invoked.',limitations:['All report content and observations are explicitly synthetic QA data.',...evidence.limitations],pagesChecked:sources.length},sources},review:{...auditFixtureReview(),model:'synthetic-review-model · no model invoked',reviewedAt:'2026-10-03T15:30:00.000Z'}};
const receipt={orderId,mode:'test',paymentStatus:'paid',fulfillmentStatus:receiptState,priceCents:33000,currency:'USD',paidAt:recordedEnvelope?null:'2026-10-03T14:00:00.000Z',reportAvailable:receiptState==='report_ready'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
function json(response,data,status=200){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});response.end(JSON.stringify(data));}
const server=http.createServer(async(request,response)=>{try{
 const url=new URL(request.url,`http://127.0.0.1:${port}`),path=url.pathname.replace(/\/$/,'')||'/';
 if(path==='/api/business-audit/offer')return json(response,{offer:{name:recordedEnvelope?'Recorded business audit preview':'Synthetic business audit preview',priceCents:33000,currency:'USD',payment:'one_time'},available:false,mode:'test',message:recordedEnvelope?'Recorded Workers AI preview. Checkout and new audit generation are disabled.':'Synthetic preview. Checkout is disabled; no payment or audit generation can occur.'});
 if(path==='/api/business-audit/checkout')return json(response,{message:'Synthetic preview cannot create payments.'},503);
 if(path==='/api/business-audit/status'||path==='/api/business-audit/report'){
  if(request.headers.authorization!==`Bearer ${previewToken}`)return json(response,{message:'Use the explicit synthetic preview receipt link.'},404);
  if(path.endsWith('/report')&&receiptState==='needs_review')return json(response,{message:'This synthetic request needs attention. No reviewed report is available.'},409);
  return json(response,path.endsWith('/report')?envelope:receipt);
 }
 if(path.startsWith('/api/'))return json(response,{message:'Only synthetic audit status/report routes are available in this preview.'},503);
 const staticPath=['/business-audit','/business-audit/report'].includes(path)?'/business-audit.html':path==='/'?'/index.html':decodeURIComponent(path);
 const filename=resolve(root,'.'+staticPath);
 if(!filename.startsWith(root.endsWith(sep)?root:root+sep))return json(response,{message:'Preview file unavailable.'},404);
 let bytes=await readFile(filename);
 if(extname(filename)==='.html')bytes=Buffer.from(bytes.toString().replace('<body>',`<body><div role="status" style="position:fixed;bottom:5px;left:5px;z-index:1000;max-width:260px;padding:8px 11px;border:1px solid #9cb6c9;border-radius:6px;background:#edf4f8;color:#183a53;font:9px/1.5 sans-serif;pointer-events:none">${recordedEnvelope?'RECORDED WORKERS AI · SYNTHETIC INPUTS<br>Test receipt. No Stripe charge.':'SYNTHETIC AUDIT PREVIEW<br>No purchase. No real business analysis.'}</div>`));
 response.writeHead(200,{'content-type':types[extname(filename)]??'application/octet-stream','cache-control':'no-store','referrer-policy':'no-referrer'});response.end(bytes);
}catch{json(response,{message:'Preview file unavailable.'},404);}});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`${recordedEnvelope?'Recorded Workers AI on synthetic inputs':'Synthetic audit'} preview http://127.0.0.1:${port}/business-audit\n${receiptState==='needs_review'?`Synthetic needs-review receipt http://127.0.0.1:${port}/business-audit?receipt=${previewToken}`:`${recordedEnvelope?'Recorded':'Synthetic'} report http://127.0.0.1:${port}/business-audit/report#receipt=${previewToken}`}\n`));
