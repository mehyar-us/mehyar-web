// workers/voice-transport/src/index.js — entry point.
//
// Routes:
//   GET  /voice?session=<id>   -> VoiceSession DO WebSocket upgrade
//   POST /probe                -> {model, params, send:[...], listenMs} runs
//                                env.AI.run(model, params, {websocket:true})
//                                INSIDE the DO; returns the handshake report.
//   POST /admin/precache       -> {texts:[...]} pre-synthesize static lines
//                                into the TTS KV cache (ADMIN_TOKEN guarded).

import { VoiceSession } from "./voice-session.js";

export { VoiceSession };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/probe" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400);
      }
      const id = env.VOICE_SESSION.idFromName("probe");
      const stub = env.VOICE_SESSION.get(id);
      const res = await stub.fetch(
        new Request("https://do/probe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      );
      return res;
    }

    // Debug/validation helper: synthesize speech via aura-1 REST and return
    // raw PCM16 16kHz mono bytes. Used to generate test utterances for the
    // STT probe and end-to-end validation calls.
    if (url.pathname === "/tts-rest" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400);
      }
      const text = String(body.text || "").slice(0, 500);
      if (!text) return json({ ok: false, error: "text required" }, 400);
      try {
        const resp = await env.AI.run(
          env.TTS_MODEL || "@cf/deepgram/aura-1",
          {
            text,
            speaker: env.TTS_VOICE || "asteria",
            encoding: "linear16",
            sample_rate: 16000,
            container: "none",
          },
          { returnRawResponse: true }
        );
        const buf = await resp.arrayBuffer();
        return new Response(buf, {
          headers: {
            "content-type": "audio/pcm;rate=16000",
            "x-audio-bytes": String(buf.byteLength),
          },
        });
      } catch (e) {
        return json({ ok: false, error: `aura-1 REST: ${e.message}` }, 502);
      }
    }

    // Debug/validation helper: plain (non-WS) env.AI.run from inside the DO.
    // POST /rest-probe { model, params:{...audioB64?} } -> the model's JSON.
    if (url.pathname === "/rest-probe" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400);
      }
      if (!body.model) return json({ ok: false, error: "model required" }, 400);
      try {
        const params = { ...(body.params || {}) };
        if (params.audioB64) {
          const bin = Uint8Array.from(Buffer.from(params.audioB64, "base64"));
          params.audio = Array.from(bin);
          delete params.audioB64;
        }
        if (params.audioWavB64) {
          // Binary-stream shape: { audio: { body: ReadableStream, contentType } }
          const bin = Uint8Array.from(Buffer.from(params.audioWavB64, "base64"));
          params.audio = {
            body: new ReadableStream({
              start(c) { c.enqueue(bin); c.close(); },
            }),
            contentType: params.audioContentType || "audio/wav",
          };
          delete params.audioWavB64;
          delete params.audioContentType;
        }
        const out = await env.AI.run(body.model, params);
        return json({ ok: true, out });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 502);
      }
    }

    if (url.pathname === "/admin/precache" && request.method === "POST") {
      const token = request.headers.get("x-admin-token") || "";
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
        return json({ ok: false, error: "unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400);
      }
      const texts = Array.isArray(body.texts) ? body.texts.slice(0, 50) : [];
      if (!texts.length) return json({ ok: false, error: "texts[] required" }, 400);
      const id = env.VOICE_SESSION.idFromName("precache");
      const stub = env.VOICE_SESSION.get(id);
      const res = await stub.fetch(
        new Request("https://do/admin-precache", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ texts }),
        })
      );
      return res;
    }

    if (url.pathname === "/voice") {
      const sessionId = url.searchParams.get("session") || "";
      const id = env.VOICE_SESSION.idFromName(`s:${sessionId.slice(0, 64)}`);
      const stub = env.VOICE_SESSION.get(id);
      // Forward the original URL (with ?session=) so the DO can validate.
      return stub.fetch(
        new Request(`https://do/voice?session=${encodeURIComponent(sessionId)}`, {
          method: request.method,
          headers: request.headers,
        })
      );
    }

    return json({ ok: true, service: "voice-transport", routes: ["/voice", "/probe", "/admin/precache"] });
  },
};
