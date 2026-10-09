# Assessment Call — Infrastructure Architecture

**Crew:** infra (session layer) · **Branch:** `feat/assessment-call` · **Updated:** 2026-10-09

## The pivot (2026-10-09)

Three crews share one worktree/branch by contract, not by code:

| Concern | Owner | Delivers |
|---|---|---|
| WebRTC transport, STT/TTS, ≤1s latency budget, turn-taking, VAD | voice team (fb19eba4) | transport JS API + media path |
| Conversation: persona, stages, decide() scoring, `/api/assessment/*`, `assessment_sessions` | brain crew | `assessmentBrain.js`, `assessmentStore.js`, routes |
| 3D avatar | avatar crew | `client/src/lib/assessment-call/*`, 5-method API |
| **Session layer: infra record, 45-min cap, heartbeat, IP rate limits, latency log, consent UI, voice adapter** | **infra crew (us)** | **`functions/api/assessment-call/*`, `assessment-call/voice-adapter.js`, this doc** |

Earlier this session the infra crew built its own voice stack (chunked HTTP
turn loop: client WAV → Whisper → brain → MeloTTS/SpeechSynthesis, with VAD
and barge-in). That work is **superseded** — the voice team owns the media
path and we do not duplicate it. The verified findings below are kept as
reference for the voice team; the code was removed.

## System diagram

```
  caller ──WebRTC──▶ voice transport ──transcript event──▶ VoiceAdapter
        (voice team)                                          (ours)
                                                                │
                     ┌──────────────────────────────────────────┼──────────────────┐
                     │ POST /api/assessment/turn                │ POST /turn-complete│
                     │ {session_id, user_text}                  │ {sessionId, timings}│
                     ▼                                          ▼                   │
              brain crew route ──▶ reply_text ──▶ adapter ──▶ transport.speak()      │
                     │                              │         avatar.playSpeech()    │
                     │ saves assessment_sessions    │                              │
                     └──────────────────────────────┘         infra latency log ◀──┘
                                                              (assessment_call_turns)
```

Session pairing: UI consent → `POST /api/assessment/start` (brain session) →
`POST /api/assessment-call/session {consent, adult, brainSessionId}` (infra
session, linked via `brain_session_id`). Heartbeat every 30s enforces the
45-min hard cap behind the brain's wrap stage.

## Contracts

- `docs/voice-adapter-contract.md` — the exact interface we require from the
  voice team (transport API, event schema, timing fields, lifecycle hooks).
  The NEEDS-FROM-VOICE-TEAM list is at the top.
- `docs/assessment-call-contract.md` — brain contract + appended infra section
  (session pairing, latency log, lifecycle endpoints).
- Avatar API (avatar crew): `mountAvatar(container, opts)`,
  `setSpeaking(bool)`, `setState('idle'|'listening'|'thinking'|'speaking')`,
  `playSpeech({kind:'text'|'audio', text|src})`, `dispose()`.

## Latency budget (shared, ≤1.0s end-of-speech → first audio)

| Segment | Owner | Budget |
|---|---|---|
| speech end → final transcript (`stt_ms`) | voice team | ≤ 400ms |
| transcript → first reply byte (`ttt_ms`) | adapter + brain route | ≤ 500ms |
| first reply byte → first audible (`tts_ms`) | voice team | ≤ 400ms |
| adapter in-process overhead | us — **measured < 50ms** (`scripts/test-assessment-call.mjs`) | ≤ 50ms |

Per-turn `stt_ms`/`ttt_ms`/`brain_ms`/`tts_ms` land in `assessment_call_turns`
via `POST /turn-complete` — the red-team gate reads them.

## Rate limits

- `POST /api/assessment-call/session`: ≤ 5 sessions/day/IP (KV, hash-only);
  consent + 18+ gate; daily neuron guard (8,000 of the 10,000/day free tier)
  on admission. The brain's `/start` has its own 5/day/IP.
- `POST /turn-complete`: ≤ 120 logged turns/session (sanity cap).
- Heartbeat misses don't kill the call; the 45-min cap is enforced on
  heartbeat response and client-side clock.

## Cost (free-tier math, verified 2026-10-09)

Official Workers AI pricing (developers.cloudflare.com/workers-ai/platform/pricing):

| Model | Price |
|---|---|
| `@cf/openai/whisper-large-v3-turbo` (STT) | 46.63 neurons / audio min |
| `@cf/myshell-ai/melotts` (TTS) | 18.63 neurons / audio min |
| `@cf/deepgram/aura-2-en` (TTS) | 2727.27 neurons / 1k chars |
| `@cf/deepgram/nova-3` (WebSocket STT) | 836.36 neurons / audio min |
| `@cf/cloudflare/clef-flash` (decide/brain) | 8182 neurons / M input tokens |
| Free tier | **10,000 neurons/day, hard cap** |

Our session layer's AI cost is brain-only: ~60 turns × ~600 input tokens ×
8182/1M ≈ **~300 neurons per 45-min call** → ~25+ calls/day inside the free
tier before the 8,000 guard trips. STT/TTS neurons (if any) are the voice
team's budget — note nova-3 WS alone would cost ~37,600 neurons per 45-min
call and cannot fit the free tier; aura-2-en TTS ~46,000 neurons per call.
The ≤1s budget must therefore be met without per-minute server audio models,
or calls must be neuron-capped accordingly — the voice team's call, documented
here so the trade-off is explicit.

## Unit economics (Mayor's pricing rethink, 2026-10-09)

Every session row carries a cost rollup: `usage_json` + `cost_usd_est`
(migration 0041). `POST /turn-complete` accepts an optional `usage` object;
the adapter passes through the brain route's `usage` (field names frozen in
`docs/assessment-call-contract.md`); STT/TTS fields come from the voice team
(NEEDS list item 11). `costNeurons()`/`rollupUsage()` in `callShared.js`
compute neurons → USD at $0.011/1k neurons.

| Component | Source | Status |
|---|---|---|
| Brain LLM tokens (gpt-oss-120b: 31818 in / 68182 out per M) | brain crew `usage` | **REAL once they report; estimated from text lengths until then** (`estimated: true`) |
| decide()/Clef calls (8182/M input) | brain crew `usage.decideCalls` | same as above |
| STT (Whisper 46.63/min default) | voice team `usage` | **estimate at list price** until they confirm models/rates |
| TTS (Aura-2 2727.27/kchar default) | voice team `usage` | **estimate at list price** until they confirm |
| Infra compute (~40 Worker requests/call vs 100k/day free) | — | **≈ $0, estimate** |

Measured anchor (2026-10-09, live): a 45-min call's brain cost ≈ 300 neurons
≈ **$0.0033** — three orders of magnitude under the $330 ticket. The pricing
call needs the voice team's real STT/TTS numbers + red-team conversion rates;
everything we can't measure is labeled `estimated` in the rollup, never
presented as fact.

## Verified live 2026-10-09 (reference for the voice team)

- **Whisper** `@cf/openai/whisper-large-v3-turbo` via
  `POST /accounts/621600637337cc1c9ecb7095508bc732/ai/run/<model>`
  (legacy `X-Auth-Email`/`X-Auth-Key`; bearer tokens don't work for Workers AI):
  6.7s of 16kHz mono PCM16 → perfect transcript, **6.9s latency**. Batch STT
  cannot meet the ≤1s bar — streaming or client-side STT required.
- **MeloTTS** `@cf/myshell-ai/melotts` `{prompt, language:"EN"}` →
  `{result:{audio: base64 wav}}`, **5.07s** for ~130 chars. Cheap
  (18.63 neurons/audio-min) but batch-only.
- **Aura-2-en** `@cf/deepgram/aura-2-en` `{text}` → raw `audio/mpeg` MP3,
  **3.43s** for ~80 chars. Best quality, but 2727 neurons/1k chars.
- **Cloudflare Calls/Realtime** is enabled on the account
  (`/accounts/{id}/calls/apps` lists `connectree`, `delicate-base-324e`);
  SFU+TURN: first 1,000 GB egress/month free, then $0.05/GB — a 45-min
  audio-only call is ~81 MB, i.e. ~12,600 calls/month inside free.
- Workers AI realtime STT goes through AI Gateway WebSockets
  (`wss://gateway.ai.cloudflare.com/v1/<acct>/<gw>/workers-ai?model=…`) or
  `env.AI.run(model, params, { websocket: true })` from a Worker. Not verified
  from a Worker in this session (no deploy until the red-team gate); the
  architecture does not depend on it.

## Reference notes (superseded infra voice-stack build)

- WAV contract used by the old loop (matches `explore-voice.js`):
  PCM16 mono 16kHz, 44-byte header, ≤ 30s — the voice team may reuse or ignore.
- Client VAD that drove turn-taking: energy-based, 50ms frames, threshold
  0.02 RMS, 300ms min-speech, 800ms hangover, 28s max utterance.
- Barge-in: mic energy during playback → cancel local playback → server
  interrupt marker (`interrupted=1` on the latest assistant turn — kept).
- Old per-turn latency (measured): STT ~6.9s + brain ~1–3s + TTS ~5s —
  documented here as the reason the batch path was retired.

## Compliance checklist (20-point, this scope)

1. Privacy — shared mehyar.us pages linked in call UI footer. No raw IPs/audio stored; hashes only.
2. Terms — linked in footer.
3. Refunds — N/A (free call; the $330 audit is the audit-tab crew's scope, all-sales-final per standing order).
4. Cookies — our code sets none.
5. Cookie consent — N/A (no non-essential cookies from our code).
6. Form consents — recording/transcription + 18+ checkboxes, **unchecked by default**, required to start; consent timestamp persisted.
7. Data minimization — we store: session id, brain link, ip/ua hashes, consent time, turn texts + timings. No names/emails/audio.
8. Third-party SDKs — none in our code (avatar/transport are the other crews').
9. Dark patterns — no; End call + Delete transcript always available.
10. Hidden fees — start screen states "free assessment — no charge".
11. Fake reviews — N/A.
12. Claims — start screen: "AI assistant", "not professional advice" wording; persona copy is the brain crew's (their reply safety net scans for "as an AI"/guarantees).
13–15. Accessibility — sampled: buttons keyboard-operable, visible focus outlines, aria-live captions, contrast-checked palette.
16. Business details — footer: Mehyar Soft LLC · info@mehyar.us.
17. Kids — 18+ gate on the start screen.
18. Unsubscribe — N/A (we send no marketing email).
19. Licensed media — none used.
20. Data deletion — `POST /api/assessment-call/delete` (possession of the opaque session id authorizes); UI offers "Delete my transcript"; `info@mehyar.us` fallback in footer.

**Compliance flag (Mayor's spec 2 vs 11:36 "compliant" order):** the spec says
never mention it's AI. Implemented as ordered for the *persona* (the brain's
safety net already forbids "as an AI" phrasing and speaks as the mayor), but
the *call UI* still discloses recording/transcription and identifies the
other party as an AI assistant — that disclosure is a legal requirement, not
a persona choice. If directly asked "are you AI?", the persona must answer
honestly (deception on direct identity questions would breach the compliance
order). Brain crew owns the exact persona wording.

## R1: post-payment human booking (2026-10-09) — WITHDRAWN, brain crew's system

The $330 follow-up is with Mayor himself (human-in-the-loop). The infra crew
built a full booking system (5 endpoints + `assessment_call_booking_requests`
+ migration 0042) during ~12:35–13:00 ET, then **withdrew it before commit**:
the brain crew had meanwhile shipped the real R1 system on this branch
(commit `01c155e`): `book-followup` with `slot_start`, `booking-availability`,
`booking-confirm`/`booking-decline` (Mayor's one-click email links),
`booking-status`, `assessment_bookings` table (migration
`0042_assessment_bookings.sql`), manual approval, office hours, Google
Calendar template-link seam. Keeping ours would have been the parallel
booking system R1 explicitly forbade. The withdrawal is recorded in the
contract doc § R1 and in `callShared.js`. No infra booking endpoints exist.

## Tracking checklist (Mayor's standing ship-checklist)

| Item | Status on our surfaces (`assessment-call/index.html`) |
|---|---|
| Google tag / GA4 | ✅ gtag `G-25N8E18944` mirrors `client/index.html`; `page_view` fires on config; `cta_click` fires on the start button (`data-analytics-cta`) |
| Meta Pixel | ⚠️ **GAP — absent from the repo** (no `fbq` anywhere); not invented. Needed before ship if ads attribution is wanted. |
| GTM container | ⚠️ **GAP — absent from the repo** (no `gtm.js`/container ID); gtag is loaded directly. Flagged, not invented. |
| SEO | ✅ title, meta description, canonical, OG + Twitter tags in the static page head (SeoManager is SPA-only; the call page is static HTML) |
| Dry-run verification | Static tag presence asserted in `scripts/test-assessment-call.mjs`; live firing (`MEHYAR_PUBLIC_ANALYTICS_DRY_RUN=true` equivalent) is a ship-gate step for the parent — no browser available in this session |

When the call UI moves into the React SPA (audit-tab crew's tab or a `/call`
route), register the route in `SeoManager.tsx` `staticMeta` and rely on
`GoogleAnalytics.tsx` (page_view auto-fires on wouter change; add
`data-analytics-cta` to the call button).
