# Assessment-call avatar — approach, measurements, compliance

Owner: avatar crew · Branch: `feat/assessment-call` · 2026-10-09

## Approach chosen (and why)

**Procedural Three.js "Mayor" head + real-time audio-feature lip-sync, 100% client-side.**

The head is authored entirely in code (`client/src/lib/assessment-call/avatar-head.ts`):
stylized Pixar-like character matching the 2D Mayor avatar (salt-and-pepper swept
hair, brown eyes, graying mustache/goatee, navy suit, white shirt). The mouth is a
small bone/scale rig (jaw pivot + lip wide/round/press scaling + teeth + cavity),
driven by a 5-weight viseme blend space from `lip-sync.ts`.

Why this and not the alternatives (evaluated honestly):

| Option | Verdict |
|---|---|
| TTS service returning viseme/timing data | **Unavailable.** Our TTS backend (internal Meta `tts` CLI → MP3) emits no timing metadata. No free-tier viseme source exists in our stack. |
| Paid streaming-avatar API (D-ID / HeyGen / Tavus) | **Rejected on R2.** $0.10–$7.20/min (see cost table below), plus a new vendor, API keys, and network round-trips inside the ≤1s latency budget. |
| Ready Player Me / downloadable rigged GLB | **Rejected.** Third-party likeness pipeline, unclear commercial licensing for a brand character, low-poly game look, external service dependency. |
| Client-side phoneme alignment from text | **Rejected as primary.** No forced aligner in budget; rule-based English G2P mistimes visibly. Text is used only as a syllable-rate prior (articulation speed), never for phoneme timing. |
| **Procedural head + audio-feature lip-sync (chosen)** | $0/min, no vendors, no keys, no model downloads, full ownership, ~35 draw calls. |

## Lip-sync method (honest scope)

**Prosody-driven pseudo-lip-sync — NOT phoneme-accurate.** Per animation frame the
played TTS audio is analyzed with Web Audio (`AnalyserNode`, fftSize 2048):

- **RMS energy → jaw opening** (calibrated on real TTS: p50/p95 frame RMS → jaw ~0.36/0.80)
- **Spectral centroid → vowel shaping** (low = open "ah", high = spread "ee"/sibilant)
- **Spectral flux → plosive onsets** (adaptive to the signal's own baseline; fires a ~120ms lip-press envelope that shuts the jaw for b/p/m-like bursts)
- **Zero-crossing rate → sibilant separation** (teeth together, lips spread)

What it gets right: syllable-rate mouth pulsing, jaw tracks speech energy, mouth
closes in pauses. What it does NOT do: match exact phonemes. The state machine
adds speaking body language (emphasis nods on onsets, brow movement with energy).

Measured on a real TTS clip (Meta "Smooth" voice, closer-style line, 16 kHz):

| Metric | Value |
|---|---|
| Mean jawOpen during speech | **0.392** |
| Mean jawOpen during digital silence | **0.000** |
| Fraction of speech time visibly talking (jaw > 0.25) | **0.64** |
| Syllable-ish pulses (rising edges through 0.3) over ~11 s | **19** |
| Jaw velocity during speech | 1.92/s (sane, not flapping) |

Test: `__tests__/real-audio.test.ts` (runs the exact browser math against PCM).

## Fallback ladder

Ranked by fidelity; the build implements #1 and degrades automatically:

1. **3D head + spectral lip-sync** (full path; needs WebGL + WebAudio).
2. **3D head + state-only animation** (WebGL works, audio analysis unavailable —
   e.g. CORS-tainted `<audio>` element: `AvatarAudioError("cors")`; mouth stays
   near-neutral, body language continues — we never fake lip-sync).
3. **Null renderer** (no WebGL at all: `forceNullRenderer`, or WebGL context
   creation fails) — state machine + mouth math keep running; nothing is drawn.
   The call UI shows a graceful "avatar unavailable, audio continues" panel.

No 2D fallback was built: a flat sprite would read cheaper than the 3D head's
degraded modes and add asset weight for no gain.

## Performance (measured)

| Metric | Value | Notes |
|---|---|---|
| Draw calls / triangles | **34 / 8,696** | Trivial for any mobile GPU (fill-rate, not vertex-bound) |
| Pose+morph update cost | **24 µs/frame** | 5,000 full updates in 121 ms (Node) |
| Render FPS | 11–14 fps | **Under SwiftShader software rasterization (no GPU) — test-env artifact, not representative.** Scene is 34 draw calls; expected 60 fps on any real mobile GPU. Auto-degrader lowers pixel ratio if FPS < 28 sustained. |
| `tick()` frame budget | < 0.1 ms math | Rendering dominates, not animation |

Mid-range phone estimate: 60 fps at capped pixelRatio ≤ 2; the auto-degrader
(`onPixelRatioReduced`) sheds fill-rate load before frames drop.

## R2 — per-minute compute cost

| Approach | Server cost/min | Notes |
|---|---|---|
| **Ours (client-side Three.js)** | **$0.00** | All rendering + analysis on the user's device. No GPU servers, no per-minute API, no model inference. |
| D-ID streaming agents | ~$2.95–$5.90 | Per research 2026-10-09 (docs.d-id.com pricing via secondary research) |
| HeyGen streaming avatar | ~$0.10–$0.20 | Lite/Full mode; API video $0.60–$7.20/min |
| Tavus CVI | ~$0.32 | Overage rate |

For a 45-minute assessment call: paid APIs = **$4.50–$265.50/call** in avatar
rendering alone; ours = **$0**. At 100 calls/month that is $450–$26,550/month
avoided. Client-side cost is a few percent of one phone CPU core + GPU
compositing — no battery red flags (rendering pauses when the tab is hidden).

## D5 — latency budget contribution (measured in headless Chromium)

| Segment | Measured | Notes |
|---|---|---|
| `playSpeech()` → speaking state | **0–4 ms** | Synchronous, same frame (asserted in tests) |
| `decodeAudioData` (ArrayBuffer path) | **68–700 ms** | Irreducible for buffer input; varies with CPU load. `<audio>`-element path has no decode step. |
| Audio render start → first mouth movement | **~300 ms** | Analyser priming + viseme attack (56 ms) + frame cadence |
| `playSpeech()` → first visible mouth move (typical) | **~0.5 s** | For a small clip on a loaded CPU; dominated by decode |
| Mount → first frame (warm) | ~8 s / shader 3.3 s | **SwiftShader + vite-dev artifact.** Real hardware: shader compile is ms-scale. Warmed at mount, never on first play. |
| AudioContext creation (mount warmup) | ~0.5 s | Moved off the call path |
| `primeAvatarAudio()` (join gesture) | ~0.2 s | Warms resume + spins up the render path with 120 ms of silent audio, so first `playSpeech` never pays audio-service init (~1.5–2.5 s measured cold) |

Streaming visemes: the mouth moves within 3 animation frames of audio attach —
no full-clip buffering anywhere (asserted: `controller (D5): visemes stream`).

Infra crew: call `primeAvatarAudio()` in the Join-click handler (user gesture).
`playSpeech()` is safe to call any time after; without a prior gesture the
browser may keep audio suspended and `playSpeech` rejects with
`AvatarAudioError("autoplay")` — documented, retry on gesture.

## Model licensing provenance (compliance item 19)

Every vertex of the Mayor head is generated by `avatar-head.ts` — no downloaded,
scraped, or third-party character model. Three.js is MIT. The 2D reference
(`client/public/assets/mayor-avatar.png`) is our own asset. **No licensed-media
exposure.**

## Compliance notes (product-compliance skill, 2026-10-09)

- Items 1, 2, 16, 20: consent screen footer links the shared mehyar.us
  privacy/terms/data-deletion pages + names Mehyar Soft LLC and info@mehyar.us.
- Item 3 (refunds): N/A — no purchase in the call UI.
- Item 5/6 (consents): recording consent is an explicit unchecked-by-default
  checkbox; Join is disabled until checked. No dark pattern.
- Item 7 (data minimization): avatar audio is analyzed in-memory per frame and
  never stored; the component writes nothing to localStorage/cookies.
- Item 8 (SDK audit): one new third-party dependency — **three** (MIT, npm
  bundled, business reason: 3D avatar rendering). No analytics/pixel SDKs added
  by this crew (see tracking section in the contract doc).
- Item 9/12 — **FLAG, Mayor overrode explicitly**: his 2026-10-09 11:47 ET word
  is "NEVER mention it's AI." The call window therefore carries no AI-disclosure
  badge. This conflicts with the 11:36 "compliant" order; the parent logged the
  compliance flag and the decision is recorded in `docs/assessment-call-contract.md`.
  Implementing as ordered.
- Items 13–15 (a11y, sampled): canvas has role="img" + aria-label; state changes
  are announced via aria-live; all controls are native buttons with visible
  focus rings; 7/7 contrast assertions pass (white on #0b1220 = 18.7:1, end-call
  icon 6.5:1, join button 6.2:1 — all ≥ AA). Test: `__tests__/call-window-contrast.test.ts`.
- Item 17 (kids): N/A — B2B product for adult business owners.
- Item 19: see provenance above. Item 18: N/A (no marketing email from this surface).

## Tests

`npm run test:avatar` — **55/55 green** (2026-10-09):

| Suite | Tests |
|---|---|
| lip-sync (pure engine: mapping, smoothing, plosives, determinism) | 14 |
| avatar-head (geometry, mouth/eye/brow/pose params, budgets, dispose) | 9 |
| avatar-controller (state machine, playSpeech/abort, D5 sync state + streaming, no-fake-lip-sync, reconciled input shapes, text-mode abort) | 18 |
| real-audio (real TTS MP3 → features → mouth dynamics) | 3 |
| call-window-contrast (WCAG AA, 7 color pairs) | 7 |
| assessment-analytics (dry-run/live/gtag-absent semantics) | 4 |

Plus: `npm run check` (tsc) clean; headless-Chromium E2E (Playwright, SwiftShader):
mount → screenshots (idle/speaking/thinking/listening) → synthetic + real-MP3
playback with latency capture → FPS sampling. Screenshots QC'd by eye (see
`docs/assessment-call-contract.md` for the honest visual assessment).
