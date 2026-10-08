# The Mayor — Push Server Notes (APNs)

The iOS app registers for APNs and hands its device token to the PWA via the
`MayorNative` bridge (`getPushToken()` + the `mayorPushToken` DOM event).
The **worker** (`workers/mayor/`) must store tokens and send pushes. This doc is
the contract between the app and the server.

## Payload format (what the app expects)

```json
{
  "aps": {
    "alert": { "title": "The Mayor", "body": "3 missed calls recovered while you were away" },
    "badge": 3,
    "sound": "default"
  },
  "url": "https://mayor.mehyar.us/feed#briefing",
  "business_id": "<agent_tenant id>"
}
```

- `url` (custom key, required for deep-linking): the app loads it in the PWA webview
  when the user taps the notification. Must be `https://mayor.mehyar.us/...` —
  anything else opens in the in-app Safari sheet.
- `business_id`: lets the PWA switch to the right business context on open.
- Foreground pushes still show a banner (proactive alerts must be seen).
- Keep `alert.body` ≤ ~150 chars; never put PII beyond what's needed.

Suggested `url` values per proactive event:
| Event | url |
|---|---|
| Morning briefing | `https://mayor.mehyar.us/feed#briefing` |
| Missed-call recovered | `https://mayor.mehyar.us/?business=<id>#activity` |
| Suggestion awaiting approval | `https://mayor.mehyar.us/?business=<id>#suggestions` |
| Booking confirmed | `https://mayor.mehyar.us/?business=<id>#bookings` |

## Device token storage (worker side)

Suggested D1 table (additive migration):

```sql
CREATE TABLE IF NOT EXISTS mayor_push_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,          -- agent_tenants.id (the business)
  user_id TEXT NOT NULL,           -- owner user id
  platform TEXT NOT NULL DEFAULT 'ios',
  device_token TEXT NOT NULL,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT,
  UNIQUE (tenant_id, device_token)
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_tenant ON mayor_push_tokens(tenant_id);
```

Endpoints for the worker to add (membership-gated, same auth as the rest):
- `POST /api/push/tokens` `{device_token, platform:"ios", app_version}` — upsert.
- `DELETE /api/push/tokens` `{device_token}` — revoke on logout.
- `POST /api/push/test` — owner-only; sends "The Mayor push is working" to the
  caller's devices. (Invaluable for verifying the whole chain.)

## Sending (provider)

- **Auth:** token-based with the APNs `.p8` key (owner action, DEPLOY_CHECKLIST step 3).
  Store as worker secrets: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (.p8).
  Never commit.
- **Endpoint:** `https://api.push.apple.com/3/device/<token>` (production;
  `api.development.push.apple.com` for sandbox builds).
- **Headers:** `authorization: bearer <JWT>` (ES256, 20-min TTL),
  `apns-topic: us.mehyar.mayor`, `apns-push-type: alert`, `apns-priority: 10`.
- **Feedback:** on `410` / `Unregistered`, mark the token `revoked_at` — stop sending.
- **Library:** any minimal HTTP/2 APNs client works; no new PWA dependency needed.
  Keep sends server-side only — the device token never leaves the worker.

## Rules (product)

- Max 3 proactive pushes/day per business, never 21:00–08:00 owner-local
  (same quiet-hours rule as the web nudges).
- Every push deep-links to the thing it announces — a push that opens the app
  home screen is a bug.
- The PWA calls `requestPushPermission()` at the first value moment
  (e.g., right after onboarding completes), never at launch.
- TestFlight builds use the **sandbox** APNs endpoint; the worker should pick
  the endpoint per token (store `environment: sandbox|production` on register —
  the app knows `DEBUG` vs Release at runtime).
