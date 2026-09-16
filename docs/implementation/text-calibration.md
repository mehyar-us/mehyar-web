# Synthetic text-token calibration

On September 16, 2026, seven synthetic requests were sent to the configured Cloudflare account through the direct Workers AI REST endpoint for `@cf/openai/gpt-oss-120b`. Every request returned HTTP 200 with consistent prompt/completion/total counters. No customer data was sent, and no deployment, provider configuration, release flag, or Stripe flow changed.

The first three-case run and the expanded four-case run are recorded in [initial evidence](evidence/text-calibration-1789594156761.json) and [boundary evidence](evidence/text-calibration-1789594183303.json). A subsequent [dry run](evidence/text-calibration-1789594200633.json) performed no network calls. Reports retain request hashes, tokenizer identity, estimates, timing and usage, but no credentials, account IDs, model output or private text. The expanded report includes the calibration script hash.

| Synthetic case | Local input tokens | Provider input tokens | Difference |
| --- | ---: | ---: | ---: |
| Short text | 22 | 79 | +57 |
| Unicode and escaped JSON | 42 | 99 | +57 |
| Long ASCII | 9,619 | 9,676 | +57 |
| Credit boundary | 11,968 | 12,025 | +57 |

The observed extra 57 tokens are evidence of framing differences for these exact requests, not proof of a universal constant. At the boundary, the published formula changes from one estimated credit to two reported credits. Local estimates must not unlock larger-job charging without accounting for provider framing. These requests also have a 64-token output limit, unlike the application's 2,000-token allowance.

The tested transport was direct REST, not the production Worker binding through AI Gateway. Gateway parity, other message shapes, output/reasoning limits, model revision changes, customer cost review and settlement remain unverified. `productionCalibrationApproved` remains false, as do application release flags.

Run from `workers/business-agent`:

```powershell
node scripts/calibrate-text.mjs
node scripts/calibrate-text.mjs --live
```

The default is local-only. The explicit live option makes at most four synthetic calls, with 64 output tokens per call, stops at the first failed/unreported result, and does not automatically retry uncertain calls. It reads existing Cloudflare credentials from the environment without logging them. Each run creates a new evidence file.

Implementation references: [Cloudflare model request format and pricing](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/), [OpenAI tokenizer](https://github.com/openai/gpt-oss/blob/main/gpt_oss/tokenizer.py). Actual invoice charges were not queried; token counters alone do not establish invoice totals.
