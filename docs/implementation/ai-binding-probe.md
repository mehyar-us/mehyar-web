# Live Workers AI binding probe

On September 16, 2026, a separate local `workerd` instance successfully called the real model using `env.AI.run()` and the development Gateway. The [sanitized result](evidence/ai-binding-1789594668363.json) passed the application's mailbox parser and exact evidence checks.

The synthetic request asked about Monday haircut availability and price while explicitly prohibiting booking. The returned summary retained that prohibition. Local input estimation was 240 tokens; the provider reported 297 input and 313 output tokens, again showing +57 input tokens. The measured binding call took 2,704 ms. This single observation is not a latency benchmark.

The call used the application's model identifier, `max_tokens: 2000`, Gateway `skipCache: true` and `collectLog: false`, synthetic tenant/workload metadata and a 60-second timeout. The probe has only an AI binding: no tenant database, mailbox credential, customer billing, Stripe integration or production route.

## Credential and process lifecycle

Wrangler remote bindings rejected the existing global-key authentication in noninteractive mode. The helper therefore created a 30-minute user API token scoped to the configured account with only Workers Scripts Write, Workers AI Read and AI Gateway Run. The token value stayed in process memory and the child environment; it was not printed or written to a repository file. A temporary cleanup marker contained only its identifier and expiry.

Two initial token-creation requests failed before issuing a token because the expiry contained milliseconds. [The detailed failed attempt](evidence/ai-binding-1789594654266.json) records that validation error; [the earlier attempt](evidence/ai-binding-1789594640316.json) recorded only its HTTP status. The helper now uses the API's whole-second timestamp format.

After the successful probe, the helper terminated its own Wrangler process tree and received successful token-deletion acknowledgement. The result records `tokenRevoked: true`. A local follow-up found no listener on port 8799 and no pending cleanup marker. No permanent API token was created.

## Reproduction and bounds

From `workers/business-agent`:

```powershell
node scripts/probe-ai-binding.mjs --live
```

Without `--live`, the helper prints usage and does nothing. Live mode requires credential-bootstrap access, creates a bounded token, starts the separate `wrangler.binding-probe.jsonc` configuration on loopback, requests one fixed synthetic analysis, saves sanitized evidence and revokes the token. It never runs a deployment command. If revocation fails, the report identifies required cleanup and the ignored `.wrangler/binding-probe-token.json` marker retains the token identifier; the token also expires automatically.

The probe endpoint rejects browser-origin requests and requests without its explicit intent header. Repeated accepted requests reuse the first promise, including a failed one, so they do not issue another model call until the local process restarts. The development configuration has `workers_dev` and preview URLs disabled.

TypeScript, probe dry-run bundling and the 503-file legacy protection check passed. This demonstrates a local Worker binding with a live remote resource, as supported by [Cloudflare remote bindings](https://developers.cloudflare.com/workers/local-development/). It does not establish a deployed production Worker, complete tenant orchestration, customer billing approval, performance acceptance or pilot readiness. Application release flags remain false and Stripe is unchanged.
