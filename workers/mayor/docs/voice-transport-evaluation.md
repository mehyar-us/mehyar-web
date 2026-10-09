# Voice transport evaluation — Mayor PWA owner↔assistant (workstream 6i, 2026-10-09)

## Question

For tap-to-talk in the PWA (owner ↔ assistant, one peer each side): should media
ride (a) the incumbent WebSocket path via `@cloudflare/voice` + the `MayorVoice`
agent, (b) Cloudflare Realtime / Calls (SFU), or (c) a worker-terminated WebRTC
peer connection?

## Decision: (a) keep the WebSocket path. No new transport.

## Current pipeline (kept)

```
PWA mic (16 kHz PCM, AudioWorklet)
  → VoiceClient (agents/voice/client) over WebSocket
  → MayorVoice agent (Durable Object, workers/mayor/src/voice.ts)
  → audioStartTranscriber(WorkersAIFluxSTT) → onTurn (reused, not forked)
  → guardedSpeech(WorkersAITTS) → WebSocket → PWA playback
Barge-in: client-side speech detection during playback
  (interruptThreshold / interruptChunks) → server onInterrupt clears proposals
  and stops TTS.
```

## Why not worker-terminated WebRTC

A Worker cannot terminate a WebRTC peer connection. The Workers runtime exposes
no `RTCPeerConnection` API, so DTLS-SRTP cannot be terminated inside a Worker or
Durable Object. The established pattern is Workers as *signaling* servers for
browser↔browser P2P — media never touches the Worker. There is no code path by
which a Worker receives an Opus/RTP audio track directly. This option is not
implementable on the current platform.

## Why not Cloudflare Realtime / Calls (SFU)

1. **An SFU adds a hop without shortening the path to the brain.** Realtime/Calls
   terminates the peer connection at Cloudflare's edge; the assistant's audio
   still has to be bridged into the `MayorVoice` agent pipeline. The voice SDK
   itself documents this shape as an "SFU WebSocket adapter" delivering audio to
   the agent over WebSocket — the same socket we already use.
2. **Codec mismatch.** Workers AI STT (`WorkersAIFluxSTT`) consumes 16 kHz PCM
   frames — exactly what the current client sends. An SFU delivers Opus/RTP,
   which a Worker cannot decode natively; bridging would need an external media
   process (new infrastructure, new failure modes, new cost).
3. **1:1 needs none of what an SFU is for.** SFUs earn their keep on fan-out
   (multi-party, simulcast, bandwidth adaptation). Owner↔assistant is one peer
   each side.
4. **Mobile networks.** WebSocket-over-443 traverses the same path as the page
   itself; WebRTC adds ICE/TURN negotiation that is brittle on symmetric NATs
   and captive portals common on phones. The current stack already carries
   iOS-specific guards (secure-context check, 16 kHz sample-rate check,
   permission teaching).
5. **Maturity.** RealtimeKit is in closed beta; the incumbent path is the one
   with passing tests and shipped behavior.

## What the choice does NOT close off

The SDK's `VoiceTransport` interface is explicitly pluggable
("Implement this interface to use WebRTC, SFU, or other transports"). Keeping
WebSocket today does not lock the door: a future transport can be slotted in
client-side without touching the agent's turn pipeline (`onTurn`, proposals,
metering, consent) — the part that carries the product's compliance posture.

## Revisit triggers (none apply to owner↔assistant)

- Multi-party calls (owner + staff + assistant in one session).
- PSTN bridging where an SFU/edge media node is required.
- A future Realtime API that exposes worker-side media (PCM) directly.

Outbound customer calls are explicitly out of scope for 6i (bigger regulatory
surface); any future work there re-opens the transport question on its own
merits.
