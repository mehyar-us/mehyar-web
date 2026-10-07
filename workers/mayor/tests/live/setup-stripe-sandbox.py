"""Create this run's tagged Stripe test objects and local-only secrets. Never prints keys."""
import json, os, secrets, urllib.request, urllib.parse
from pathlib import Path
root=Path(__file__).resolve().parent
if (root/'.dev.vars').exists() or (root/'.sandbox-objects.json').exists():
 raise SystemExit('Existing sandbox run found; inspect or clean its owned objects first.')
values={}
for line in Path(r'C:\Users\mehya\.env').read_text(encoding='utf-8-sig').splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);values[k.strip()]=v.strip().strip('\"').strip("'")
key=values.get('STRIPE_MEHYARUS_SECRET_KEY_SANDBOX','')
if not key.startswith('sk_test_'):raise SystemExit('Stripe sandbox key unavailable.')
run=secrets.token_hex(6)
def stripe(path,data=None):
 req=urllib.request.Request('https://api.stripe.com/v1/'+path,data=urllib.parse.urlencode(data).encode() if data else None,headers={'Authorization':'Bearer '+key,'Stripe-Version':'2026-09-30.endive'},method='POST' if data else 'GET')
 with urllib.request.urlopen(req,timeout=30) as result:return json.load(result)
account=stripe('account')
pro=stripe('products',{'name':'Mayor Pro sandbox '+run,'metadata[domain]':'mayor_pwa','metadata[verification_run]':run})
proprice=stripe('prices',{'product':pro['id'],'unit_amount':1400,'currency':'usd','recurring[interval]':'month','metadata[verification_run]':run})
audit=stripe('products',{'name':'Mayor extensive business audit sandbox '+run,'metadata[domain]':'mayor_business_audit','metadata[verification_run]':run})
auditprice=stripe('prices',{'product':audit['id'],'unit_amount':33000,'currency':'usd','metadata[verification_run]':run})
portal=stripe('billing_portal/configurations',{'business_profile[headline]':'Mayor sandbox verification','features[subscription_cancel][enabled]':'true','features[subscription_cancel][mode]':'at_period_end','features[subscription_update][enabled]':'false','metadata[verification_run]':run})
objects={'run':run,'account':account['id'],'proProduct':pro['id'],'proPrice':proprice['id'],'auditProduct':audit['id'],'auditPrice':auditprice['id'],'portal':portal['id']}
env={'BETTER_AUTH_SECRET':secrets.token_hex(32),'TOKEN_ENCRYPTION_KEY':secrets.token_hex(32),'MAYOR_STRIPE_MODE':'test','MAYOR_STRIPE_SECRET_KEY':key,'MAYOR_STRIPE_WEBHOOK_SECRET':'whsec_'+secrets.token_hex(32),'MAYOR_STRIPE_ACCOUNT_ID':account['id'],'MAYOR_STRIPE_PRICE_ID':proprice['id'],'MAYOR_STRIPE_AUDIT_PRICE_ID':auditprice['id'],'MAYOR_STRIPE_PORTAL_CONFIGURATION':portal['id'],'MAYOR_AUDIT_STATUS_SECRET':secrets.token_hex(32),'MAYOR_AUDIT_FULFILLMENT_READY':'false'}
(root/'.dev.vars').write_text('\n'.join(f'{k}={json.dumps(v)}' for k,v in env.items())+'\n',encoding='utf-8')
(root/'.sandbox-objects.json').write_text(json.dumps(objects,indent=2),encoding='utf-8')
print(json.dumps({'sandboxObjectsCreated':True,'run':run,'proUsd':14,'auditUsd':330,'testMode':True}))
