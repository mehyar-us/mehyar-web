#!/usr/bin/env python3
"""
deploy_pages_direct.py — Deploy mehyar-web to Cloudflare Pages via Direct Upload
(API: POST /accounts/{acct}/pages/projects/mehyar-web/deployments).

This bypasses GitHub Actions. Build the client + zip dist/public/ + functions/
together and POST via multipart/form-data with the manifest.

Auth: X-Auth-Email + X-Auth-Key (verified 2026-07-13 works against the Pages
deployments endpoint). No Cloudflare API Token required.

Usage:
  python scripts/deploy_pages_direct.py
  python scripts/deploy_pages_direct.py --dry-run
  python scripts/deploy_pages_direct.py --no-build      # skip npm build
  python scripts/deploy_pages_direct.py --branch=main   # default 'main' = production
"""
import os, sys, json, zipfile, subprocess, urllib.request, urllib.error, argparse, shutil, hashlib

ACCT  = "621600637337cc1c9ecb7095508bc732"
EMAIL = "mrswelim@gmail.com"
KEY   = os.environ.get("CLOUDFLARE_API_KEY") or os.environ.get("CLOUDFLARE_API_TOKEN") or ""
PROJECT = "mehyar-web"
DIST = "dist"
ZIP_OUT = os.path.join(DIST, "pages_deploy.zip")

def sh(cmd, **kw):
    print(f"  $ {cmd}")
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)

def build():
    print("== npm run build:client ==")
    r = sh("npm run build:client")
    print(r.stdout[-500:] if r.stdout else "")
    if r.returncode != 0:
        print(r.stderr[-1500:])
        sys.exit(1)
    if not os.path.isdir(os.path.join(DIST, "public")):
        print(f"ERROR: {DIST}/public missing after build")
        sys.exit(1)

def make_zip():
    print(f"== packaging {ZIP_OUT} ==")
    # Pages Direct Upload expects deployable content at the *root* of the zip:
    #   public/ + functions/ + manifest
    # NOT nested under dist/public. We strip the leading dist/ prefix from
    # dist/public paths so they land at public/ in the zip.
    if os.path.exists(ZIP_OUT):
        os.remove(ZIP_OUT)
    os.makedirs(DIST, exist_ok=True)
    file_list = []
    # Source roots and how to map them into the zip
    src_dirs = [
        (os.path.join(DIST, "public"), "public"),
        ("functions", "functions"),
    ]
    for src_root, zip_prefix in src_dirs:
        if not os.path.isdir(src_root):
            print(f"  warn: {src_root} not found, skipping")
            continue
        for root, dirs, files in os.walk(src_root):
            for f in files:
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, src_root).replace("\\", "/")
                zip_path = f"{zip_prefix}/{rel}"
                file_list.append((fp, zip_path))
    manifest = {}
    with zipfile.ZipFile(ZIP_OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for fp, zip_path in file_list:
            data = open(fp, "rb").read()
            sha = hashlib.sha256(data).hexdigest()
            manifest[zip_path] = {"contentType": "application/octet-stream", "size": len(data), "sha256": sha}
            zf.write(fp, zip_path)
        # Pages Direct Upload REQUIRES a manifest.json in the zip itself too
        manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        zf.writestr("__cf_manifest.json", manifest_bytes)
    print(f"  zip size: {os.path.getsize(ZIP_OUT)} bytes, files: {len(file_list)}")

def multipart_post(url, fields, manifest_dict, file_field, file_path):
    """Pages Direct Upload expects 3 distinct multipart parts:
       1. 'branch' (text)
       2. 'manifest' (JSON object as a separate part, NOT a file)
       3. 'file' (the zip)
    Per CF docs + verified 2026-07-13.
    """
    boundary = "----deploy_boundary_mehyarsoft"
    body = []
    def add_part(name, content, content_type="text/plain", filename=None):
        body.append(f"--{boundary}\r\n".encode())
        if filename:
            body.append(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
        else:
            body.append(f'Content-Disposition: form-data; name="{name}"\r\n'.encode())
        body.append(f"Content-Type: {content_type}\r\n\r\n".encode())
        body.append(content if isinstance(content, bytes) else content.encode())
        body.append(b"\r\n")
    # 1. branch
    add_part("branch", fields["branch"])
    # 2. manifest (the JSON object — NOT a file)
    add_part("manifest", json.dumps(manifest_dict), content_type="application/json")
    # 3. zip file
    body.append(f"--{boundary}\r\n".encode())
    body.append(f'Content-Disposition: form-data; name="{file_field}"; filename="{os.path.basename(file_path)}"\r\n'.encode())
    body.append(b"Content-Type: application/zip\r\n\r\n")
    body.append(open(file_path, "rb").read())
    body.append(b"\r\n")
    body.append(f"--{boundary}--\r\n".encode())
    payload = b"".join(body)
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "X-Auth-Email": EMAIL, "X-Auth-Key": KEY,
        "Content-Length": str(len(payload)),
    })
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status, r.read().decode("utf-8", "replace")

def deploy(branch="main", dry_run=False):
    if not KEY:
        print("ERROR: CLOUDFLARE_API_KEY not in env", file=sys.stderr); sys.exit(1)
    # The manifest must be the inline JSON. Read it from the zip we built.
    manifest = {}
    with zipfile.ZipFile(ZIP_OUT) as zf:
        if "__cf_manifest.json" in zf.namelist():
            manifest = json.loads(zf.read("__cf_manifest.json").decode("utf-8"))
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/pages/projects/{PROJECT}/deployments"
    print(f"== POST {url} ==")
    print(f"   manifest entries: {len(manifest)}, branch: {branch}")
    if dry_run:
        print(f"  dry-run: would upload {ZIP_OUT} ({os.path.getsize(ZIP_OUT)} bytes)")
        return
    try:
        status, body = multipart_post(url, {"branch": branch}, manifest, "file", ZIP_OUT)
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read().decode("utf-8", "replace")
    print(f"  HTTP {status}")
    try:
        j = json.loads(body)
        if j.get("success"):
            r = j["result"]
            print(f"\n✅ deployed {r['id']}")
            print(f"   trigger:  {r.get('deployment_trigger', {}).get('type', '?')}")
            print(f"   url:      {r.get('url', '?')}")
            print(f"   env:      {r.get('environment', '?')}")
            return r["id"]
        else:
            print(f"\n❌ deploy failed: {j.get('errors', [])[:3]}")
            sys.exit(2)
    except Exception as e:
        print(f"  parse error: {e}")
        print(body[:500])
        sys.exit(2)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-build", action="store_true", help="skip npm run build:client")
    ap.add_argument("--branch", default="main", help="deployment branch (main=production)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.no_build:
        build()
    make_zip()
    deploy(args.branch, args.dry_run)

if __name__ == "__main__":
    main()