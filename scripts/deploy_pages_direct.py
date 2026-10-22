#!/usr/bin/env python3
"""
deploy_pages_direct.py — Deploy mehyar-web to Cloudflare Pages.

Two modes:
  (a) Direct Upload (legacy multipart) — uses X-Auth-Email + X-Auth-Key.
      Works, but silently loses functions on some deploys (we observed
      uses_functions=false on 6fa63e77 / e3e1e854 on 2026-07-15).
  (b) wrangler pages deploy (recommended) — runs `wrangler pages deploy`
      under the hood with CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY env vars
      set, which actually compiles and uploads the functions bundle.
      This is what works reliably (verified 2026-07-15 with fca31385 +
      b91719ab — uses_functions=true).

Usage:
  python scripts/deploy_pages_direct.py                # mode (b), wrangler (default)
  python scripts/deploy_pages_direct.py --direct       # mode (a), raw multipart
  python scripts/deploy_pages_direct.py --no-build    # skip npm build
  python scripts/deploy_pages_direct.py --branch=main # default 'main' = production
"""
import os, sys, json, zipfile, subprocess, urllib.request, urllib.error, argparse, shutil, hashlib
from contextlib import contextmanager

# Wrangler and Vite use Unicode status symbols. Windows can otherwise default
# Python's redirected stdout/subprocess decoding to cp1252 and crash after a
# successful deployment while reading or printing those symbols.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ACCT  = "621600637337cc1c9ecb7095508bc732"
EMAIL = "mrswelim@gmail.com"
KEY   = os.environ.get("CLOUDFLARE_API_KEY") or os.environ.get("CLOUDFLARE_API_TOKEN") or ""
PROJECT = "mehyar-web"
DIST = "dist"
ZIP_OUT = os.path.join(DIST, "pages_deploy.zip")

def sh(cmd, **kw):
    print(f"  $ {cmd}")
    return subprocess.run(
        cmd,
        shell=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        **kw,
    )

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
    # Also sync functions/ → dist/public/functions/ so wrangler's pages
    # deploy picks them up (wrangler only looks inside the deploy dir).
    src_funcs = "functions"
    dst_funcs = os.path.join(DIST, "public", "functions")
    if os.path.isdir(src_funcs):
        if os.path.exists(dst_funcs):
            shutil.rmtree(dst_funcs)
        shutil.copytree(src_funcs, dst_funcs)
        print(f"  synced {src_funcs} -> {dst_funcs}")
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
    # CF Pages Direct Upload expects both __cf_manifest.json AND a top-level
    # "pages_functions" entry that explicitly declares which files are functions.
    # Without this, CF may accept the upload but skip the functions build (we
    # observed this on 2026-07-15 — direct uploads silently lost functions
    # while GH-triggered wrangler deploys correctly registered them).
    pages_functions = []
    with zipfile.ZipFile(ZIP_OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for fp, zip_path in file_list:
            data = open(fp, "rb").read()
            sha = hashlib.sha256(data).hexdigest()
            # Cloudflare Pages requires correct content types:
            #   .js under functions/ → application/javascript+module (runs as Pages Function)
            #   .js under anything else (incl. assets/) → application/javascript
            #   .html → text/html
            #   .css → text/css
            #   .json → application/json
            #   everything else → application/octet-stream
            if zip_path.startswith("functions/") and zip_path.endswith(".js"):
                content_type = "application/javascript+module"
                # Pages Function route (strip "functions" prefix + ".js" suffix)
                route = "/" + zip_path[len("functions"):-3]
                # Add dynamic-segment placeholders back from filesystem notation:
                # [id] -> :id, [[path]] -> *path, etc. — but CF Pages handles
                # the literal filenames too, so we leave them as-is here.
                pages_functions.append(route)
            elif zip_path.endswith(".js"):
                content_type = "application/javascript"
            elif zip_path.endswith(".html"):
                content_type = "text/html"
            elif zip_path.endswith(".css"):
                content_type = "text/css"
            elif zip_path.endswith(".json"):
                content_type = "application/json"
            else:
                content_type = "application/octet-stream"
            manifest[zip_path] = {
                "contentType": content_type,
                "size": len(data),
                "sha256": sha,
            }
            zf.write(fp, zip_path)
        # Pages Direct Upload REQUIRES a manifest.json in the zip itself too.
        # Also embed the pages_functions list so CF recognizes the routes
        # even on a clean direct-upload without going through wrangler's build.
        manifest["pages_functions"] = sorted(set(pages_functions))
        manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        zf.writestr("__cf_manifest.json", manifest_bytes)
    print(f"  zip size: {os.path.getsize(ZIP_OUT)} bytes, files: {len(file_list)}")
    print(f"  pages_functions declared: {len(pages_functions)}")

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

def cf_get_json(url):
    req = urllib.request.Request(url, headers={
        "X-Auth-Email": EMAIL,
        "X-Auth-Key": KEY,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read().decode("utf-8", "replace"))
    if not body.get("success"):
        raise RuntimeError(f"Cloudflare API error: {body.get('errors', [])[:3]}")
    return body

def _toml_quote(value):
    return json.dumps(str(value))

def pages_env_vars_for_branch(branch):
    env_name = "production" if branch == "main" else "preview"
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/pages/projects/{PROJECT}"
    project = cf_get_json(url)["result"]
    configs = project.get("deployment_configs", {})
    env_vars = configs.get(env_name, {}).get("env_vars", {})
    fallback_vars = configs.get("preview", {}).get("env_vars", {}) if env_name == "production" else {}
    merged = {}
    for name, meta in {**fallback_vars, **env_vars}.items():
        if not isinstance(meta, dict):
            continue
        value = meta.get("value")
        if meta.get("type") == "plain_text" and value not in (None, ""):
            merged[name] = value
    return merged

@contextmanager
def temporary_wrangler_env_overlay(branch):
    """Preserve Pages runtime vars when deploying from a scrubbed wrangler.toml.

    Wrangler treats wrangler.toml as the source of truth for Pages project
    settings. If secrets are intentionally absent from the committed file,
    a deploy can remove them from the deployment snapshot. We read the current
    Pages env config, write a temporary local overlay for this process only,
    then restore the checked-in-safe file before returning.
    """
    wrangler_path = "wrangler.toml"
    original = open(wrangler_path, "r", encoding="utf-8").read()
    try:
        env_vars = pages_env_vars_for_branch(branch)
    except Exception as e:
        print(f"  warn: could not snapshot Pages env vars before deploy: {e}")
        yield
        return

    missing = {
        k: v for k, v in env_vars.items()
        if f"{k} =" not in original and f"{k}=" not in original
    }
    if not missing:
        yield
        return

    insertion = "\n# Runtime vars injected only during deploy from Cloudflare Pages settings.\n"
    insertion += "".join(f"{k} = {_toml_quote(v)}\n" for k, v in sorted(missing.items()))
    marker = "\n[[d1_databases]]"
    if marker in original:
        patched = original.replace(marker, insertion + marker, 1)
    else:
        patched = original + insertion
    try:
        with open(wrangler_path, "w", encoding="utf-8") as f:
            f.write(patched)
        print(f"  using temporary env overlay for {len(missing)} Pages var(s)")
        yield
    finally:
        with open(wrangler_path, "w", encoding="utf-8") as f:
            f.write(original)
        print("  restored scrubbed wrangler.toml")

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
    ap.add_argument("--direct", action="store_true",
                    help="use raw multipart upload instead of wrangler (NOT recommended — "
                         "loses functions on most deploys)")
    args = ap.parse_args()
    if not args.no_build:
        build()
    make_zip()
    if args.direct:
        deploy(args.branch, args.dry_run)
    else:
        deploy_wrangler(args.branch, args.dry_run)

def deploy_wrangler(branch="main", dry_run=False):
    """Run `wrangler pages deploy dist/public --project-name=mehyar-web --branch=main`.

    This is the reliable path: wrangler compiles the functions bundle and
    uploads it via the correct CF API (which the raw multipart Direct Upload
    sometimes drops silently). Auth via CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY
    env vars (X-Auth-Email + X-Auth-Key legacy mode).
    """
    if not KEY:
        print("ERROR: CLOUDFLARE_API_KEY not in env", file=sys.stderr); sys.exit(1)
    if dry_run:
        print(f"  dry-run: would run `npx wrangler pages deploy {os.path.join(DIST, 'public')} --project-name={PROJECT} --branch={branch}`")
        return
    env = os.environ.copy()
    env["CLOUDFLARE_EMAIL"] = EMAIL
    env["CLOUDFLARE_API_KEY"] = KEY
    env["CLOUDFLARE_ACCOUNT_ID"] = ACCT
    # A legacy Global API Key is 37 characters and is invalid as a bearer token.
    # Remove both token aliases so Wrangler consistently uses X-Auth-Email +
    # X-Auth-Key from the variables above.
    env.pop("CLOUDFLARE_API_TOKEN", None)
    env.pop("CF_API_TOKEN", None)
    # On Windows the bash `npx` shell wrapper sometimes fails to be launched
    # by Python subprocess (no Win32 program association); use npx.cmd directly.
    npx_bin = "npx.cmd" if sys.platform == "win32" else "npx"
    cmd = [npx_bin, "wrangler", "pages", "deploy", os.path.join(DIST, "public"),
           "--project-name", PROJECT, "--branch", branch, "--commit-dirty=true"]
    print(f"$ {npx_bin} wrangler pages deploy dist/public --project-name={PROJECT} --branch={branch}")
    with temporary_wrangler_env_overlay(branch):
        r = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            shell=(sys.platform == "win32"),
        )
    print(r.stdout)
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        print(f"\n❌ wrangler deploy failed (exit {r.returncode})", file=sys.stderr)
        sys.exit(r.returncode)
    print("\n✅ wrangler deploy complete")

if __name__ == "__main__":
    main()
