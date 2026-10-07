// Never cache authenticated APIs, voice traffic, or customer data.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
const offlinePage=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102b47"><title>The Mayor · Connection unavailable</title><style>
:root{font-family:system-ui,sans-serif;color:#142e46;background:#f4f7fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{max-width:480px;background:white;border:1px solid #dce5ee;border-radius:24px;padding:32px}small{font-weight:700;letter-spacing:.1em}h1{font-size:30px;line-height:1.2}p{line-height:1.6;color:#53697e}a{display:inline-block;margin-top:12px;background:#102b47;color:white;text-decoration:none;border-radius:12px;padding:14px 20px;font-weight:600}a:focus-visible{outline:3px solid #397cdd;outline-offset:4px}
</style></head><body><main><small>THE MAYOR · MEHYAR US</small><h1>Let’s reconnect.</h1><p>We couldn’t reach The Mayor. Check your connection, then try again.</p><p>If you were confirming a booking or saving details, check its status after reconnecting. A missing reply doesn’t tell us whether it finished.</p><a href="/">Try again</a><p>No action will be submitted automatically.</p></main></body></html>`;
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||event.request.mode!=='navigate'||url.origin!==self.location.origin||/^\/(api|agents)(\/|$)/.test(url.pathname))return;
  // Fetch the current document instead of reusing a browser-cached app shell.
  event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>new Response(offlinePage,{status:503,headers:{
    'content-type':'text/html;charset=utf-8','cache-control':'no-store',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff',
  }})));
});
