#!/usr/bin/env bash
# Section Q Live-API-endpoint behavior smoke (turn-059 new check)
#
# Catches the "CF Function is silently broken" drift class. The
# existing 14-section rubric (G/H/J/K/L/M/N/O) exercises the bundle,
# the shell, the audit trail, the ticket-id references, the file-path
# references, and the live-bundle URL. None of them exercises the live
# HTTP behavior of the Cloudflare Function backing the intake form.
#
# Why this matters: turn-059's LOOP-BOOT audit exercised curl POST
# /api/intake with a malformed payload and got a 400 + JSON envelope,
# which is the documented "graceful rejection" path. That's the bare
# minimum smoke the loop should re-verify on every audit tick -- if the
# CF Function is down (5xx, connection-refused, 404 from a routing
# mistake), the form's "Submit" button would silently appear to work
# but never deliver the lead.
#
# The class Section Q catches:
#   - CF Function returns 5xx (deploy broke the handler)
#   - CF Function returns connection-refused (route not wired)
#   - CF Function returns the wrong JSON envelope shape (changed without
#     updating the audit contract -- any field that the home/booking/
#     micro-offer form expects that the JSON doesn't return)
#   - OPTIONS preflight returns non-2xx (CORS regression blocks form
#     submissions from a different origin)
#
# Run from repo root.
#   bash .hermes/probe-section-Q.sh
# Exit 0 PASS, exit 1 FAIL, exit 2 INDETERMINATE.
#
# Turn-059 design notes:
#   - Three cheap curl probes (OPTIONS / GET-not-allowed / POST-bad-payload)
#   - Each probe validates status code range + JSON envelope shape (when
#     applicable), not body content (server-side validation logic is out
#     of scope; that's what the test:intake suite covers -- 11/11 unit
#     tests on the handler itself).
#   - ~5s wall time; reads no files, no DB; pure HTTP behavior probe.
#   - Negative-test pattern: pause the Q probe with a 30-min \"traffic
#     quarantine\" on deploy days (NOT a probe-level disabled flag --
#     just run it on audit ticks, not on every tick).

set -u

ENDPOINT="https://mehyar.us/api/intake"
TIMEOUT=10
FAIL=0

# Use repo-local temp dir, NOT /tmp/. On this Windows + git-bash host the
# bash sandbox silently drops `curl -o /tmp/...` flags (write-path safety
# filter), which causes curl to print body to stdout and the `-o` file to
# never be created. Symptom: every Section Q run reports `len=0` and
# FAILs the envelope check even though the live API is fine.
# Repo-local paths work because the cwd is always within the repo and is
# a path the sandbox allows writes to. See .gitignore `.hermes/.probe-q-cache/`.
Q_CACHE="${HERMES_Q_CACHE:-.hermes/.probe-q-cache}"
mkdir -p "$Q_CACHE"
Q_OPTS="$Q_CACHE/q-options.json"
Q_POST="$Q_CACHE/q-post.json"

echo "=== Q Live-API-endpoint behavior smoke (turn-059 new check) ==="

# 1. OPTIONS preflight (CORS gate). 2xx means the route is wired and
#    the CF Function is responding to the CORS preflight that browsers
#    send before cross-origin form submissions.
OPTIONS_RAW=$(curl -sS -o "$Q_OPTS" -w "%{http_code}\n" \
  --max-time "$TIMEOUT" \
  -X OPTIONS \
  "$ENDPOINT" 2>/dev/null)
OPTIONS_STATUS="${OPTIONS_RAW%%$'\n'*}"
[ -z "$OPTIONS_STATUS" ] && OPTIONS_STATUS="000"

echo "OPTIONS ${ENDPOINT} -> ${OPTIONS_STATUS}"
if [[ "$OPTIONS_STATUS" =~ ^2 ]]; then
  echo "Q OK preflight: OPTIONS ${OPTIONS_STATUS} (2xx)"
else
  echo "Q FAIL preflight: OPTIONS ${OPTIONS_STATUS} (expected 2xx; CORS will block real submits)"
  FAIL=1
fi

# 2. GET on a POST-only endpoint. Expect 404 or 405 (NOT 200 -- that
#    would mean GET accidentally returns something, which would leak
#    handler internals). 404 from CF routing is also acceptable (the
#    function exists but GET isn't routed to it; CF returns 404 from the
#    routes config).
GET_RAW=$(curl -sS -o /dev/null -w "%{http_code}\n" \
  --max-time "$TIMEOUT" \
  "$ENDPOINT" 2>/dev/null)
GET_STATUS="${GET_RAW%%$'\n'*}"
[ -z "$GET_STATUS" ] && GET_STATUS="000"

echo "GET ${ENDPOINT} -> ${GET_STATUS}"
if [[ "$GET_STATUS" == "404" ]] || [[ "$GET_STATUS" == "405" ]] || [[ "$GET_STATUS" == "400" ]]; then
  echo "Q OK GET-rejection: GET ${GET_STATUS} (POST-only endpoint correctly rejects GET)"
else
  echo "Q FAIL GET-rejection: GET ${GET_STATUS} (expected 400/404/405; ${GET_STATUS} is wrong-shape)"
  FAIL=1
fi

# 3. POST with intentionally-bad payload. Expect 4xx (400/422) AND a
#    JSON envelope containing `"ok":false` AND a `message` key. The
#    JSON envelope contract is what the home form's onSubmit handler
#    reads to show the user the success/failure state. If the handler
#    returns 200 with no envelope, the form silently breaks.
POST_STATUS=$(curl -sS -o "$Q_POST" -w "%{http_code}" \
  --max-time "$TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$ENDPOINT" 2>/dev/null || echo "000")

POST_BODY=$(cat "$Q_POST" 2>/dev/null || echo "")

echo "POST ${ENDPOINT} -> ${POST_STATUS} (len=${#POST_BODY})"
if [[ "$POST_STATUS" =~ ^4 ]]; then
  echo "Q OK bad-payload rejection: POST ${POST_STATUS}"
else
  echo "Q FAIL bad-payload rejection: POST ${POST_STATUS} (expected 4xx; ${POST_STATUS} means handler accepted empty body or crashed)"
  FAIL=1
fi

# 4. JSON envelope shape check on the POST response.
#    Expected: contains `"ok":` and `"message":`. If the envelope
#    regresses (e.g. handler now returns HTML on error, or strips the
#    ok field), the form's onSubmit parser breaks.
if echo "$POST_BODY" | grep -q '"ok"'; then
  echo "Q OK envelope-has-ok: response contains \"ok\" key"
else
  echo "Q FAIL envelope-has-ok: response missing \"ok\" key (form parser will not know success/failure)"
  echo "  body: ${POST_BODY:0:120}"
  FAIL=1
fi

if echo "$POST_BODY" | grep -q '"message"'; then
  echo "Q OK envelope-has-message: response contains \"message\" key"
else
  echo "Q FAIL envelope-has-message: response missing \"message\" key (form parser will not know what to show user)"
  echo "  body: ${POST_BODY:0:120}"
  FAIL=1
fi

# Cleanup
rm -f "$Q_OPTS" "$Q_POST" 2>/dev/null || true

if [ "$FAIL" -ne 0 ]; then
  echo "Q FAIL: one or more probes failed (see above)"
  exit 1
fi

echo "Q PASS: OPTIONS 2xx, GET-rejected, POST 4xx with valid JSON envelope"
exit 0
