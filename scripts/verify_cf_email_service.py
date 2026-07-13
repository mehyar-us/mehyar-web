#!/usr/bin/env python3
"""
verify_cf_email_service.py — End-to-end probe of Cloudflare Email Service on the
mehyar-web account. Sends a single real email via the REST API and prints the
result. Honest about what it actually verified (vs. what it didn't).

Usage:
    python scripts/verify_cf_email_service.py
    python scripts/verify_cf_email_service.py --to other@example.com --from info@mehyar.us

Auth: X-Auth-Email + X-Auth-Key (the user's 37-char Global Key on
CLOUDFLARE_API_KEY + mrswelim@gmail.com) — verified 2026-07-13 to work
against the Email Sending REST API. Same auth pattern as zones/D1/Pages.
"""
import os, sys, json, urllib.request, urllib.error, argparse

ACCT  = "621600637337cc1c9ecb7095508bc732"
EMAIL = "mrswelim@gmail.com"
KEY   = os.environ.get("CLOUDFLARE_API_KEY")

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST", headers={
        "Content-Type": "application/json",
        "X-Auth-Email": EMAIL, "X-Auth-Key": KEY,
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")
def get(url):
    req = urllib.request.Request(url, headers={"X-Auth-Email": EMAIL, "X-Auth-Key": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to",    default=EMAIL)
    ap.add_argument("--from",  dest="from_", default="info@mehyar.us")
    ap.add_argument("--subj",  default="Cloudflare Email Service — verify run from mehyar-web")
    ap.add_argument("--body",  default="If you're reading this in your inbox, Cloudflare Email Service works on the mehyar-web account.\n\nVerified 2026-07-13 via the REST API at /accounts/{acct}/email/sending/send.\n\n— MehyarSoft LLC pipeline")
    args = ap.parse_args()

    if not KEY:
        print("ERROR: CLOUDFLARE_API_KEY not in env", file=sys.stderr); sys.exit(1)

    print(f"== Cloudflare Email Service probe ==")
    print(f"  account: {ACCT}")
    print(f"  to:     {args.to}")
    print(f"  from:   {args.from_}")
    print(f"  subject:{args.subj}")
    print()

    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/email/sending/send"
    body = {
        "to": args.to,
        "from": args.from_,
        "subject": args.subj,
        "text": args.body,
        # Real-CAN-SPAM headers (the API accepts List-Unsubscribe / List-Unsubscribe-Post)
        "headers": {
            "List-Unsubscribe": f"<https://mehyar.us/unsubscribe>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    }
    try:
        status, txt = post(url, body)
    except urllib.error.HTTPError as e:
        status, txt = e.code, e.read().decode("utf-8", "replace")
    print(f"HTTP {status}")
    try:
        data = json.loads(txt)
    except Exception:
        print(txt); sys.exit(1)
    print(json.dumps(data, indent=2))
    if data.get("success"):
        result = data.get("result", {})
        print()
        print("== Result ==")
        print(f"  message_id:        {result.get('message_id') or result.get('messageId') or 'n/a'}")
        print(f"  delivered:         {result.get('delivered', [])}")
        print(f"  permanent_bounces: {result.get('permanent_bounces', [])}")
        print(f"  queued:            {result.get('queued', [])}")
        print()
        if args.to in (result.get("delivered") or []):
            print(f"✅ Email delivered to {args.to}. Check the inbox.")
        elif result.get("delivered") or result.get("queued"):
            print("⚠️ Email accepted but not in 'delivered' — check 'queued' or contact support.")
        else:
            print("⚠️ No recipient status returned; treat as 'sent, pending verification'.")
        sys.exit(0)
    else:
        print()
        print("== Errors ==")
        for err in data.get("errors", []):
            print(f"  {err.get('code')}: {err.get('message')}")
        sys.exit(1)

if __name__ == "__main__":
    main()
