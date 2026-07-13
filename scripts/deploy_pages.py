#!/usr/bin/env python3
"""
deploy_pages.py — Cloudflare Pages Direct Upload for mehyar-web.
Builds the client + bundles dist/public/ + functions/ into a zip, then POSTs to
the Pages deployments endpoint. Auth: X-Auth-Email + X-Auth-Key.

Why this script (not wrangler): wrangler 4.108+ requires CLOUDFLARE_API_TOKEN
(scoped token), and the user only has the Global Key (X-Auth-Key). The CF HTTP
API accepts X-Auth-Key for every endpoint Pages needs (deployments, projects,
env vars, secrets, etc.). Same auth, no wrangler login.
"""
import os, sys, json, glob, shutil, zipfile, urllib.request, urllib.error, time, subprocess

ACCT  = "621600637337cc1c9ecb7095508bc732"
PROJ  = "mehyar-web"
EMAIL = "mrswelim@gmail.com"
KEY   = os.environ.get("CLOUDFLARE_API_KEY")
ROOT  = r"C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web"
DIST  = os.path.join(ROOT, "dist", "public")
FNS   = os.path.join(ROOT, "functions")
ZIP_OUT = os.path.join(ROOT, "dist", "pages_deploy.zip")

if not KEY:
    print("ERROR: CLOUDFLARE_API_KEY not in env", file=sys.stderr); sys.exit(1)

def header(s, c="="):
    print(f"\n{c*4} {s} {c*(60 - len(s))}")

def step(s): print(f"  → {s}")

# 1. Build
header("STEP 1: build client")
print("  running: npm run build:client")
res = subprocess.run(
    ["npm", "run", "build:client"], cwd=ROOT, shell=True,
    capture_output=True, text=True, timeout=300,
)
print("  stdout last 5 lines:")
for line in (res.stdout or "").splitlines()[-5:]: print(f"    {line}")
if res.returncode != 0:
    print("  STDERR last 10 lines:")
    for line in (res.stderr or "").splitlines()[-10:]: print(f"    {line}")
    print(f"  ✖ build failed (exit {res.returncode})")
    sys.exit(res.returncode)
step("build ok")
if not os.path.exists(DIST):
    print(f"  ✖ {DIST} not present after build"); sys.exit(1)
size = sum(os.path.getsize(os.path.join(r,f)) for r,_,fs in os.walk(DIST) for f in fs)
print(f"  dist/public = {size/1024:.0f} KB")

# 2. Zip dist + functions
header("STEP 2: zip dist + functions for Pages Direct Upload")
if not os.path.exists(ZIP_OUT): pass
os.makedirs(os.path.dirname(ZIP_OUT), exist_ok=True)
# Pages Direct Upload wants deployable content at the *root* of the zip.
# Our build output is at dist/public/ — flatten the prefix so index.html,
# _redirects, _headers, etc. sit at the top, and functions/ at the top.
with zipfile.ZipFile(ZIP_OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(DIST):
        for f in files:
            full = os.path.join(root, f)
            rel  = os.path.relpath(full, DIST)  # strip dist/public
            zf.write(full, rel)
            print(f"    + {rel}")
    for root, _, files in os.walk(FNS):
        for f in files:
            full = os.path.join(root, f)
            rel  = os.path.relpath(full, ROOT)  # functions/ stays at root
            zf.write(full, rel)
            print(f"    + {rel}")
zsize = os.path.getsize(ZIP_OUT)
print(f"  zip size: {zsize/1024:.0f} KB")

# 3. Deploy via Pages Direct Upload
header(f"STEP 3: POST deployment to Pages project '{PROJ}'")
url = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/pages/projects/{PROJ}/deployments"
boundary = f"----HDeploy{int(time.time())}"
def body(parts):
    crlf = b"\r\n"
    out = b""
    for name, val, fn in parts:
        out += f"--{boundary}\r\n".encode()
        if fn:
            out += f'Content-Disposition: form-data; name="{name}"; filename="{fn}"\r\n'.encode()
            out += b"Content-Type: application/octet-stream\r\n\r\n"
            out += val if isinstance(val, bytes) else val.encode()
        else:
            out += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
            out += val.encode() if isinstance(val, str) else val
        out += crlf
    out += f"--{boundary}--\r\n".encode()
    return out
manifest = json.dumps({
    "deployment": {
        "trigger": "api",
        "description": "Prospect pipeline + admin gating",
    }
})
parts = [
    ("manifest", manifest, None),
    (ZIP_OUT, open(ZIP_OUT, "rb").read(), os.path.basename(ZIP_OUT)),
]
data = body(parts)
req = urllib.request.Request(url, data=data, method="POST", headers={
    "Content-Type": f"multipart/form-data; boundary={boundary}",
    "X-Auth-Email": EMAIL, "X-Auth-Key": KEY,
})
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        body_txt = resp.read().decode("utf-8", "replace")
        result = json.loads(body_txt)
        print(f"  HTTP {resp.status}")
        print(f"  success={result.get('success')}")
        if result.get("errors"):
            print(f"  errors: {result['errors']}")
        dep = result.get("result", {})
        print(f"  deployment.id   = {dep.get('id')}")
        print(f"  deployment.url  = {dep.get('url')}")
        print(f"  project         = {dep.get('project_name')}")
        print(f"  environment     = {dep.get('environment')}")
        print(f"  build           = {dep.get('build_config')}")
        print(f"  modified        = {dep.get('modified_on') or dep.get('created_on')}")
except urllib.error.HTTPError as e:
    print(f"  ✖ HTTP {e.code}: {e.reason}")
    print(f"  body: {e.read().decode('utf-8','replace')[:2000]}")
    sys.exit(1)
except Exception as e:
    print(f"  ✖ {type(e).__name__}: {e}")
    sys.exit(1)

header("DONE")
print(f"  → https://{PROJ}.pages.dev updated")
print(f"  → custom domain: https://mehyar.us (live in <60s)")
