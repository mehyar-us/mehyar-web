#!/usr/bin/env python3
"""Apply D1 migrations to mehyar-web prod DB via Cloudflare HTTP API.
Auth: X-Auth-Email + X-Auth-Key (CLOUDFLARE_API_KEY as the key) — verified to work.
"""
import os, re, json, urllib.request, urllib.parse, sys, time

ACCT  = "621600637337cc1c9ecb7095508bc732"
DB    = "e4f22065-e3e8-4772-87a8-51d4976be042"
EMAIL = "mrswelim@gmail.com"
KEY   = os.environ.get("CLOUDFLARE_API_KEY")
MIG_DIR = r"C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web/migrations"

if not KEY:
    print("ERROR: CLOUDFLARE_API_KEY not in env", file=sys.stderr)
    sys.exit(1)
print(f"Auth: X-Auth-Email={EMAIL} X-Auth-Key length={len(KEY)}")

def split_statements(sql_text):
    if "--> statement-breakpoint" in sql_text:
        return [s.strip() for s in sql_text.split("--> statement-breakpoint") if s.strip()]
    # Strip leading comment-only lines, then split on ;
    cleaned = []
    for line in sql_text.splitlines():
        if line.strip().startswith("--"):
            continue
        cleaned.append(line)
    blob = "\n".join(cleaned)
    parts = re.split(r";\s*\n", blob)
    return [p.strip() for p in parts if p.strip() and not p.strip().startswith("--")]

def run(stmt):
    body = json.dumps({"sql": stmt}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{DB}/query",
        data=body, method="POST",
        headers={"Content-Type": "application/json", "X-Auth-Email": EMAIL, "X-Auth-Key": KEY},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

# Apply 0004, 0005, 0006 only (0001-0003 already applied)
TARGETS = ["0004_gov_opportunities.sql", "0005_gov_opportunity_drafting.sql", "0006_prospect_pipeline.sql"]

results = []
for fn in TARGETS:
    path = os.path.join(MIG_DIR, fn)
    with open(path, "r", encoding="utf-8") as f:
        sql = f.read()
    stmts = split_statements(sql)
    print(f"\n=== {fn} — {len(stmts)} statements ===")
    for i, stmt in enumerate(stmts):
        head = stmt[:70].replace("\n", " ")
        try:
            data = run(stmt)
            ok = data.get("success")
            err = data.get("errors", [])
            print(f"  [{i+1:2d}/{len(stmts)}] {'OK ' if ok else 'ERR'} | {head}")
            if err:
                print(f"         errors: {err}")
            results.append({"file": fn, "i": i, "ok": bool(ok), "err": err})
        except Exception as e:
            print(f"  [{i+1:2d}/{len(stmts)}] EXC {type(e).__name__}: {e} | {head}")
            results.append({"file": fn, "i": i, "ok": False, "err": str(e)})
        time.sleep(0.05)  # gentle

# Verify
print("\n=== Tables after migration ===")
data = run("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r["name"] for r in data["result"][0]["results"]]
new_tables = {"prospects","prospect_signals","prospect_drafts","prospect_sends","prospect_replies",
              "gov_opportunities","gov_opportunity_documents","gov_opportunity_ingest_runs",
              "gov_agency_watchlist","gov_capability_blocks","gov_application_drafts",
              "gov_application_workspaces","gov_opportunity_events"}
for t in tables:
    print(f"  {t}{'  ← NEW' if t in new_tables else ''}")

ok_count = sum(1 for r in results if r["ok"])
fail = len(results) - ok_count
print(f"\n=== {ok_count} OK / {fail} failed across {len(set(r['file'] for r in results))} files ===")
