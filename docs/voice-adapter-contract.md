# Voice Adapter Contract — assessment call

**From:** infra crew (session layer, this branch `feat/assessment-call`)
**To:** voice team (fb19eba4 — WebRTC transport, ≤1s latency budget, STT/TTS)
**Status:** request — please confirm each item or propose an alternative.

Our adapter (`assessment-call/voice-adapter.js`, built against the stub in
`assessment-call/stubs.js`) wires your transport → the brain crew's
`POST /api/assessment/turn` → the avatar crew's avatar API. This document is
the exact interface we program against. Anything marked **[NEED]** is blocking
for integration.

---

## NEEDS-FROM-VOICE-TEAM

1. **[NEED] Transport JS API.** Confirm (or rename) the 7-method surface our
   adapter calls:
   - `init({ brainSessionId, sessionId }) → Promise`
   - `startListening() / stopListening() → Promise`
   - `on('transcript' | 'bargein' | 'error' | 'ended', handler)`
   - `speak(text, { onFirstAudio, onEnd }) → Promise` (resolves when speech ends)
   - `cancelSpeech()`, `dispose()`
   If your SDK differs, send us the exact method names + signatures and we
   will adapt (and document the mapping here).
2. **[NEED] Transcript event schema.** We expect
   `{ text, isFinal, timing: { sttMs } }`. Confirm `sttMs` = speech-end →
   final transcript in ms, and whether interim (`isFinal: false`) events fire.
3. **[NEED] TTS timing.** We expect `onFirstAudio` to fire at the first
   audible sample of `speak()`. Confirm, and confirm `speak()`'s promise
   resolves at speech end (not at enqueue).
4. **[NEED] Barge-in event.** We expect a `bargein` event when the caller
   starts speaking over our speech; we then call `cancelSpeech()` and POST
   `/api/assessment-call/interrupt`. Confirm the event name and that
   `cancelSpeech()` stops audio within ~200ms.
5. **[NEED] Per-turn timing fields.** We log per turn: `stt_ms` (you),
   `ttt_ms` (adapter-measured: transcript-final → first reply byte),
   `brain_ms` (optional, from the brain route), `tts_ms` (you: first reply
   byte → first audible). Confirm you can supply `sttMs` on the transcript
   event and fire `onFirstAudio` (item 3). If you measure additional fields,
   tell us the names and we will store them.
6. **[NEED] Session/auth model — ANSWERED (voice-adapter-answers.md §1, §6).**
   Our adapter calls your `init({ brainSessionId, sessionId })` at call start:
   `brainSessionId` authorizes the brain route; `sessionId` (our 128-bit
   opaque infra-session secret) authorizes the voice WebSocket
   (`wss://<voice-host>/voice?session=<sessionId>`). No extra token endpoint.
   Session mismatch/unknown → server closes 4401 → transport surfaces
   `error { code:'auth' }`.
7. **[NEED] Error/ended events.** Confirm `error` payload shape
   (`{ message, code? }`) and the `ended` reasons you emit
   (e.g. `remote`, `network`, `timeout`).
8. **[NEED] Browser support + fallback.** Which browsers get the full
   experience, and what happens where WebRTC/mic is unavailable (error event?
   silent no-op?). Our consent UI needs to know what to promise.
9. **[NEED] Audio privacy.** Confirm the media path: does any audio or
   transcript leave Cloudflare's network for a third party (beyond the
   documented Workers AI models)? Our privacy posture depends on the answer.
10. **[NEED] ≤1s budget split.** Our adapter's in-process overhead is measured
    < 50ms (see § Latency budget). Confirm your measured end-of-speech →
    first-audio number on a real call, and that our two measurement points
    (`transcript` event time, `onFirstAudio`) are the right ones for the
    shared budget.
11. **[NEED] STT/TTS usage + pricing for unit economics — ANSWERED (frozen in
    voice-adapter-answers.md §11).** The voice team reports per-turn usage in
    the frozen shape via our `POST /api/assessment-call/turn-complete`
    `usage` passthrough:
    `{ stt: { model, audioMinutes, neurons }, tts: { model, chars, neurons },
       turn: { model, audioMinutes, neurons } }`.
    Our cost rollup passes these actuals through verbatim — no list-price
    estimation. Confirmed rates: flux WS STT 700 neurons/audio-min
    ($0.0077/min), aura-1 TTS 1363.64 neurons/1k chars ($0.015/1k),
    smart-turn-v2 0.51 neurons/audio-min; USD = neurons × $0.011/1k.
    If aura-2-en is preferred in testing: 2727.27/1k chars ($0.030).

---

## Audio in/out

- **In (caller → us):** we never touch raw audio. Your transport delivers
  **final transcript text** via the `transcript` event. Audio format, sample
  rate, codec, VAD tuning — all yours, not specified here.
- **Out (us → caller):** our adapter hands your `speak()` **plain reply text**
  (≤ ~450 chars, no markdown, no URLs — the brain guarantees speakable text).
  Voice selection, streaming, and interruption are yours.

## Turn flow (per caller utterance)

1. Your transport emits `transcript` `{ text, isFinal: true, timing: { sttMs } }`.
2. Our adapter POSTs `POST /api/assessment/turn`
   `{ "session_id": "<brain session id>", "user_text": "<transcript>" }`.
3. Brain route responds
   `{ ok, reply_text, stage, actions, outcome }` (see
   `docs/assessment-call-contract.md` for the actions catalog — the loop must
   honor `endCall`, `captureEmail`, `bookAudit`).
4. Our adapter calls your `speak(reply_text, { onFirstAudio, onEnd })` and the
   avatar's `playSpeech({ kind: 'text', text: reply_text })` (visualization only).
5. Our adapter POSTs `POST /api/assessment-call/turn-complete`
   `{ sessionId, userText, replyText, timings: { sttMs, tttMs, brainMs, ttsMs } }`
   — the latency log (text only, never audio).

## Session lifecycle hooks

| Hook | Owner | Shape |
|---|---|---|
| Call start (after UI consent) | ours → yours | `POST /api/assessment/start` → `{ session_id, reply_text: <consent script> }`, then `POST /api/assessment-call/session { consent, adult, brainSessionId }` → `{ sessionId, … }`, then `transport.init({ brainSessionId, sessionId })` + `startListening()` |
| Heartbeat (30s) | ours | `POST /api/assessment-call/heartbeat { sessionId }` → `{ ok, secondsRemaining }`; at 0 the adapter ends the call (45-min hard cap) |
| Barge-in | yours → ours | `bargein` event → we `cancelSpeech()`, `POST /api/assessment-call/interrupt { sessionId }` (marks the latest assistant turn `interrupted=1` in our latency log) |
| End | either | `endCall` action from the brain, user hangs up, or 45-min cap → adapter `transport.stopListening()` + `POST /api/assessment-call/end { sessionId }` |
| Delete transcript | ours | `POST /api/assessment-call/delete { sessionId }` — hard-deletes our session row + turn log (compliance item 20) |
| Transport error | yours | `error`/`ended` events → adapter surfaces them in the UI; the call can be retried with the same session ids |

## Latency budget (shared)

| Segment | Owner | Budget |
|---|---|---|
| speech end → final transcript (`stt_ms`) | voice team | ≤ 400ms |
| transcript → first reply byte (`ttt_ms`) | adapter + brain route | ≤ 500ms |
| first reply byte → first audible (`tts_ms`) | voice team | ≤ 400ms |
| adapter in-process overhead (event→fetch, response→speak) | infra (us) | ≤ 50ms, measured in `scripts/test-assessment-call.mjs` |
| **End-of-speech → first agent audio** | **all** | **≤ 1.0s** |

Per-turn `stt_ms`/`ttt_ms`/`tts_ms` are stored in
`assessment_call_turns` (migration 0041) — the red-team gate reads them.

## Auth / session model

- Our infra `sessionId` is a 128-bit opaque secret; possession authorizes
  heartbeat/end/interrupt/turn-complete/delete on our endpoints.
- The brain `session_id` (UUID) authorizes `/api/assessment/turn`.
- The adapter holds both and links them (`brain_session_id` on our row).
- IP rate limiting is enforced server-side on both session-creation endpoints
  (5/day/IP each); no client token needed beyond the session ids.

## What we do NOT need from you

- Raw audio, codecs, or sample rates — your internals.
- STT/TTS model choice — yours (see our reference notes in
  `docs/assessment-call-infra.md` if useful; no obligation).
- The avatar — the avatar crew owns it; we only call its 5-method API.
