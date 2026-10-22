# Voice Adapter — Answers to the 11 NEEDS (voice team, fb19eba4)

Date: 2026-10-09. Status: all 11 answered. These answers are the build spec
for the voice transport; a build crew is implementing against them now.

## The core decision (frames everything below)

**Paid Workers AI streaming. ~$0.38 per 45-min call. The ≤1s budget is met;
the 10k/day free-tier neuron guard must become a spend guard.**

The triangle doesn't close any other way: batch STT/TTS (whisper-turbo,
MeloTTS, aura-2 REST) measured 3.4–6.9s per turn — physically incompatible
with the ≤1s bar Mayor set as a hard requirement. Streaming server models
are the only path to ≤1s, and they cost paid neurons.

The math, worst case 45-min call (caller speaks ~20 min, agent ~15k chars):
- STT `@cf/deepgram/flux` WebSocket: 20 min × 700 neurons/min = 14,000 ≈ $0.154
- TTS `@cf/deepgram/aura-1` WebSocket: 15k chars × 1.36364 neurons/char ≈ 20,455 ≈ $0.225
- Turn detection `@cf/pipecat-ai/smart-turn-v2`: 45 min × 0.51 ≈ 23 neurons ≈ $0.0003
- **Total ≈ 34,500 neurons ≈ $0.38/call.** Typical 25-min call ≈ $0.20.
- Static lines (consent script, common openers) pre-synthesized once and
  cached by text hash — TTS cost $0 on repeats.

Against the $330 ticket at the red-team's 29% booking rate ($95.70 expected
revenue/call), voice is 0.4% of expected revenue. **Price on value, not on
voice cost.** Recommendation for the infra admission guard: replace the
8,000-neuron/day tripwire with a spend guard (suggest $20/day default ≈ 50
calls, configurable) — the neuron guard trips on the first real call otherwise.

## Answers

### 1. Transport JS API — CONFIRMED with one signature change

`init({ brainSessionId, sessionId })` — we need BOTH ids: `brainSessionId`
authorizes the brain route (unchanged), `sessionId` (your 128-bit opaque
secret) authorizes the voice WebSocket (`wss://<voice-host>/voice?session=<sessionId>`).
Everything else confirmed as specced:
- `startListening() / stopListening() → Promise`
- `on('transcript'|'bargein'|'error'|'ended', handler)`
- `speak(text, { onFirstAudio, onEnd }) → Promise` (resolves at speech end)
- `cancelSpeech()`, `dispose()`

Class name: `VoiceTransport` (your adapter already programs against this
surface; only the `init` signature gains `sessionId`).

### 2. Transcript event schema — CONFIRMED

`{ text, isFinal, timing: { sttMs } }`.
- `sttMs` = server-measured speech-end → final transcript, in ms.
- Interim events (`isFinal: false`) DO fire — streamed from flux interim
  results. Use them for live captions only; never POST them to `/turn`.

### 3. TTS timing — CONFIRMED

`onFirstAudio` fires on arrival of the first audible audio chunk at the
browser (measured browser-side: `speak()` call → first chunk → callback).
`speak()`'s promise resolves when the last chunk has finished playing
(speech end), not at enqueue.

### 4. Barge-in — CONFIRMED

Event name: `bargein` (as specced). Trigger: flux interim transcript with
speech energy while TTS audio is playing. `cancelSpeech()` stops audible
audio within ~200ms (audio buffer flushed, TTS stream aborted server-side).
You then POST `/api/assessment-call/interrupt` as specced — no change.

### 5. Per-turn timing fields — CONFIRMED, plus two extra

We supply:
- `sttMs` on the transcript event (server-measured, speech-end → final).
- `ttsMs` measured browser-side: `speak()` call → `onFirstAudio`.
- Extra: `vttMs` (voice-turnaround: `speak()` call → last-audio-end, i.e.
  full agent-talk duration) and `bargeinCount` per turn (0/1). Store them if
  cheap; ignore if not — they're diagnostic, not budget items.

Your `ttt_ms` (transcript-final → first reply byte) and our two points
(`transcript` event time, `onFirstAudio`) are exactly the right shared
measurement points. Our in-process overhead target: ≤50ms like yours.

### 6. Session/auth model — endpoint spec

`init({ brainSessionId, sessionId })` opens
`wss://<voice-host>/voice?session=<sessionId>`.
- No extra token endpoint needed: possession of your 128-bit `sessionId`
  authorizes the socket (same model as your HTTP endpoints).
- The socket is bound to one call: on `sessionId` mismatch/unknown → server
  closes with code 4401; the transport surfaces `error { code:'auth' }`.
- Heartbeat/end/delete stay on your HTTP endpoints — the voice socket carries
  only audio + transcript + speak commands + usage. On socket drop the
  transport emits `error { code:'ws-failed' }` and the adapter's existing
  retry path applies.

### 7. Error/ended events — CONFIRMED shapes

`error`: `{ message, code }`. Codes:
`mic-denied | no-mic | unsupported | ws-failed | auth | stt-failed |
tts-failed | network`.
`ended` reasons: `hangup` (user ended), `remote` (server/brain ended the
call), `timeout` (45-min cap), `network` (unrecoverable drop).
No other reasons will be emitted; if we add one, we update this doc first.

### 8. Browser support + fallback

Full experience: Chrome/Edge (desktop + Android), Firefox, Safari 14.1+
— requires getUserMedia + WebSocket + AudioContext. Where mic/WebRTC is
unavailable: transport emits `error { code:'no-mic'|'unsupported' }` at
`init()` — never a silent no-op. Your consent UI can promise: "this call
needs a microphone; it runs in your browser, nothing to install."

### 9. Audio privacy — CONFIRMED, nothing leaves Cloudflare

Media path: browser → Cloudflare Durable Object → Workers AI inference
(`@cf/deepgram/flux`, `@cf/deepgram/aura-1`, `@cf/pipecat-ai/smart-turn-v2`).
These are Cloudflare-hosted partner models — inference runs on Cloudflare's
network, billed through the Cloudflare account. Transcripts go to your
`/api/assessment/turn` (same account). **No audio or transcript is sent to
any third party.** Raw audio is never persisted — only transcript text and
timings reach your latency log, per your data-minimization posture.

### 10. ≤1s budget split — CONFIRMED points, measured validation pending

The split and the two measurement points are correct. Architectural
commitment: **no batch component in the hot path** — streaming STT (flux WS),
streaming TTS (aura-1 WS), streaming brain (your route already streams).
Budgets: `stt_ms` ≤400ms, `tts_ms` ≤400ms — both achievable on the streaming
path (interim-driven endpointing + first-chunk TTS).

Honest status: **no measured end-to-end number exists yet** — no real call
has run. I will not invent one. Validation plan (first order of business
for the build crew): place validation calls, report measured p50/p95 for
`stt_ms`/`ttt_ms`/`tts_ms` and end-of-speech→first-audio, then we sign off
the budget or tune. The red-team gate reads the same `assessment_call_turns`
rows — one shared source of truth.

### 11. STT/TTS usage + pricing — CONFIRMED models and rates

Per call, the transport reports (via your `POST /turn-complete` `usage`
passthrough — field names frozen here):
```jsonc
{ "usage": {
    "stt": { "model": "@cf/deepgram/flux", "audioMinutes": 12.4, "neurons": 8680 },
    "tts": { "model": "@cf/deepgram/aura-1", "chars": 8230, "neurons": 11224 },
    "turn": { "model": "@cf/pipecat-ai/smart-turn-v2", "audioMinutes": 45.0, "neurons": 23 }
} }
```
Official rates (workers-ai/platform/pricing):
- flux WebSocket STT: 700 neurons/audio-min ($0.0077/min)
- aura-1 TTS: 1,363.64 neurons/1k chars ($0.015/1k)
- smart-turn-v2: 0.51 neurons/audio-min ($0.00034/min)
- USD conversion: $0.011 / 1k neurons (your `costNeurons()` rate — consistent)

Stop estimating at list price for STT/TTS — use these. Fallbacks (only on
streaming failure, never in the hot path): whisper-large-v3-turbo batch
(46.63 neurons/min), aura-1 REST. If Mayor's ear prefers aura-2-en in
testing, it's a one-line model swap at 2,727.27 neurons/1k chars ($0.030) —
~$0.45 extra per 45-min call; his call.

## Media path (for reference, not for the adapter to touch)

Browser (AudioWorklet, PCM16 16kHz mono frames) ⇄ WebSocket ⇄
VoiceSession Durable Object ⇄ Workers AI realtime WebSockets
(flux STT, aura-1 TTS) + smart-turn-v2 endpointing.
Primary: `env.AI.run(model, params, { websocket: true })` from the DO
(platform-handled auth). Fallback: AI Gateway WS URL. First validation step
for the build crew: prove the DO→Workers-AI realtime handshake.
