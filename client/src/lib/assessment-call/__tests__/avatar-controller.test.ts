/**
 * Integration tests for AvatarController + mountAvatar (mayor-avatar.ts).
 * Headless: forceNullRenderer, fake container, stub audio factory.
 * Run: npx tsx this-file
 */
import { buildMayorHead } from "../avatar-head.js";
import { AvatarController, mountAvatar } from "../mayor-avatar.js";
import type { AudioFeatures } from "../lip-sync.js";
import type { AttachedAudio } from "../audio-engine.js";
import { test, ok, approx, report } from "./assert.js";

const SPEECH: AudioFeatures = {
  rms: 0.35, centroid: 0.15, flux: 0.1, zcr: 0.1,
  low: 0.8, mid: 0.5, high: 0.05, silent: false,
};
const QUIET: AudioFeatures = {
  rms: 0, centroid: 0, flux: 0, zcr: 0,
  low: 0, mid: 0, high: 0, silent: true,
};

function stubFactory(pattern: AudioFeatures[]) {
  let i = 0;
  let resolveDone!: () => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  done.catch(() => undefined);
  const attached: AttachedAudio = {
    engine: {
      getFeatures: () => pattern[Math.min(i++, pattern.length - 1)],
      stop: () => rejectDone(new Error("aborted")),
      dispose: () => undefined,
    },
    done,
  };
  return {
    factory: async () => attached,
    finish: resolveDone,
  };
}

function speechPattern(frames = 120): AudioFeatures[] {
  const out: AudioFeatures[] = [];
  for (let i = 0; i < frames; i++) out.push(i % 12 < 7 ? SPEECH : QUIET);
  return out;
}

test("controller: initial state idle, mouth closed", () => {
  const c = new AvatarController(buildMayorHead(), {});
  ok(c.currentState === "idle", "idle");
  c.tick(16);
  approx(c.head.parts.jawGroup.rotation.x, 0, 1e-6, "mouth closed");
  c.dispose();
});

test("controller: thinking raises brows and glances aside", () => {
  const c = new AvatarController(buildMayorHead(), {});
  const y0 = c.head.parts.browL.position.y;
  c.setState("thinking");
  for (let i = 0; i < 40; i++) c.tick(16);
  ok(c.head.parts.browL.position.y > y0 + 0.08, "brows raised");
  ok(Math.abs(c.head.parts.headGroup.rotation.y) > 0.15, "glance aside");
  c.dispose();
});

test("controller: listening leans in with eye contact", () => {
  const c = new AvatarController(buildMayorHead(), {});
  c.setState("listening");
  for (let i = 0; i < 40; i++) c.tick(16);
  ok(c.head.parts.headGroup.rotation.x > 0.02, "lean-in pitch");
  c.dispose();
});

test("controller: playSpeech drives mouth from audio, restores idle after", async () => {
  const stub = stubFactory(speechPattern());
  const c2 = new AvatarController(buildMayorHead(), { audioEngineFactory: stub.factory });
  let maxJaw = 0;
  const p2 = c2.playSpeech(new ArrayBuffer(8));
  ok(c2.currentState === "speaking", "speaking during playback");
  await new Promise((r) => setTimeout(r, 10)); // let the async attach land
  for (let i = 0; i < 120; i++) {
    c2.tick(16);
    maxJaw = Math.max(maxJaw, c2.head.parts.jawGroup.rotation.x);
  }
  ok(maxJaw > 0.2, `mouth opened on speech ${maxJaw}`);
  stub.finish();
  await p2;
  ok(c2.currentState === "idle", "back to idle after playback");
  // mouth settles closed
  for (let i = 0; i < 60; i++) c2.tick(16);
  ok(c2.head.parts.jawGroup.rotation.x < 0.05, "mouth rests closed");
  c2.dispose();
});

test("controller (D5): playSpeech sets speaking state synchronously, before attach", async () => {
  let releaseFactory!: () => void;
  const gate = new Promise<void>((r) => { releaseFactory = r; });
  const stub = stubFactory(speechPattern());
  const c = new AvatarController(buildMayorHead(), {
    audioEngineFactory: async () => {
      await gate; // attach hangs until we release it
      return stub.factory();
    },
  });
  ok(c.currentState === "idle", "starts idle");
  const p = c.playSpeech(new ArrayBuffer(8));
  ok(c.currentState === "speaking", "speaking takes effect in the same frame (sync)");
  releaseFactory();
  stub.finish();
  await p;
  ok(c.currentState === "idle", "restores idle after");
  c.dispose();
});

test("controller (D5): visemes stream — mouth moves on first ticks, no full-clip wait", async () => {
  const stub = stubFactory(speechPattern(400));
  const c = new AvatarController(buildMayorHead(), { audioEngineFactory: stub.factory });
  const p = c.playSpeech(new ArrayBuffer(8));
  await new Promise((r) => setTimeout(r, 10)); // attach lands
  // Only 3 ticks: if we needed complete timing data first, the mouth would
  // still be shut. Streaming => it already moves.
  for (let i = 0; i < 3; i++) c.tick(16);
  ok(c.head.parts.jawGroup.rotation.x > 0.05, "mouth moving within 3 frames of attach");
  stub.finish();
  await p;
  c.dispose();
});

test("controller: second playSpeech aborts the first", async () => {
  const s1 = stubFactory(speechPattern());
  const s2 = stubFactory(speechPattern());
  let calls = 0;
  const c = new AvatarController(buildMayorHead(), {
    audioEngineFactory: async () => (calls++ === 0 ? s1.factory() : s2.factory()),
  });
  const p1 = c.playSpeech(new ArrayBuffer(8));
  await new Promise((r) => setTimeout(r, 10)); // p1 attaches first
  const p2 = c.playSpeech(new ArrayBuffer(8));
  let p1Rejected = false;
  await p1.catch(() => { p1Rejected = true; });
  ok(p1Rejected, "first playSpeech rejected on supersede");
  s2.finish();
  await p2;
  c.dispose();
});

test("controller: setSpeaking(true) without audio does NOT fake lip-sync", () => {
  const c = new AvatarController(buildMayorHead(), {});
  c.setSpeaking(true);
  ok(c.currentState === "speaking", "state speaking");
  let maxJaw = 0;
  for (let i = 0; i < 120; i++) {
    c.tick(16);
    maxJaw = Math.max(maxJaw, c.head.parts.jawGroup.rotation.x);
  }
  ok(maxJaw < 0.15, `no fake flapping ${maxJaw}`);
  c.setSpeaking(false);
  ok(c.currentState === "idle", "back to idle");
  c.dispose();
});

test("controller: text hint adapts articulation speed", () => {
  const fast = new AvatarController(buildMayorHead(), {
    // 12 syllables per 3 words -> ~10 syllables/sec at 0.4s/word: fast speech
    textHint: "beautiful extraordinary conversation ".repeat(10),
  });
  const slow = new AvatarController(buildMayorHead(), {});
  const fTc = (fast as unknown as { viseme: { timeConstantsMs: { attackMs: number } } }).viseme.timeConstantsMs;
  const sTc = (slow as unknown as { viseme: { timeConstantsMs: { attackMs: number } } }).viseme.timeConstantsMs;
  ok(fTc.attackMs <= sTc.attackMs, `fast ${fTc.attackMs} <= slow ${sTc.attackMs}`);
  fast.dispose();
  slow.dispose();
});

test("controller: dispose is idempotent; playSpeech after dispose rejects", async () => {
  const c = new AvatarController(buildMayorHead(), {});
  c.dispose();
  c.dispose();
  c.tick(16); // no throw
  let rejected = false;
  await c.playSpeech(new ArrayBuffer(8)).catch(() => { rejected = true; });
  ok(rejected, "rejects after dispose");
});

function fakeContainer() {
  return {
    clientWidth: 320,
    clientHeight: 480,
    appendChild: () => undefined,
    removeChild: () => undefined,
  } as unknown as HTMLElement;
}

test("mountAvatar: returns the contract handle headless", async () => {
  const fps: number[] = [];
  const handle = mountAvatar(fakeContainer(), {
    forceNullRenderer: true,
    onFps: (f) => fps.push(f),
  });
  ok(typeof handle.setSpeaking === "function", "setSpeaking");
  ok(typeof handle.setState === "function", "setState");
  ok(typeof handle.playSpeech === "function", "playSpeech");
  ok(typeof handle.dispose === "function", "dispose");
  handle.setState("listening");
  handle.setSpeaking(true);
  handle.setSpeaking(false);
  await new Promise((r) => setTimeout(r, 1250));
  ok(fps.length >= 1 && fps[0] > 0, `fps telemetry ${fps}`);
  handle.dispose();
  handle.dispose();
  ok(true, "double dispose ok");
});

test("mountAvatar: tick loop keeps running and is cheap", async () => {
  const head = buildMayorHead();
  const c = new AvatarController(head, {});
  const start = Date.now();
  for (let i = 0; i < 1000; i++) c.tick(16.7);
  const ms = Date.now() - start;
  ok(ms < 2000, `1000 ticks in ${ms}ms (frame budget headroom)`);
  c.dispose();
});


// (report call moved to the end of the file)


// ---------------------------------------------------------------------------
// Reconciled playSpeech input shapes (avatar crew + infra crew contract)
// ---------------------------------------------------------------------------

test("normalizePlayInput: all accepted shapes", async () => {
  const { normalizePlayInput } = await import("../mayor-avatar.js");
  const buf = new ArrayBuffer(8);
  ok(normalizePlayInput(buf).type === "audio", "ArrayBuffer");
  const t = normalizePlayInput({ kind: "text", text: "hi" });
  ok(t.type === "text" && (t as { text: string }).text === "hi", "text envelope");
  const a = normalizePlayInput({ kind: "audio", src: buf });
  ok(a.type === "audio" && (a as { data: unknown }).data === buf, "audio envelope");
});

test("estimateTextDurationMs: chars/15 clamped to 1.5s–120s", async () => {
  const { estimateTextDurationMs } = await import("../mayor-avatar.js");
  ok(estimateTextDurationMs("") === 1500, "min clamp");
  ok(estimateTextDurationMs("x".repeat(100000)) === 120000, "max clamp");
  approx(estimateTextDurationMs("x".repeat(150)), 10000, 1, "chars/15");
});

test("playSpeech: {kind:'audio', src} plays through the factory, restores idle", async () => {
  const stub = stubFactory(speechPattern());
  const c = new AvatarController(buildMayorHead(), { audioEngineFactory: stub.factory });
  const p = c.playSpeech({ kind: "audio", src: new ArrayBuffer(8) });
  ok(c.currentState === "speaking", "speaking during playback");
  stub.finish();
  await p;
  ok(c.currentState === "idle", "back to idle after playback");
  c.dispose();
});

test("playSpeech: audible:false is forwarded to the audio factory", async () => {
  const stub = stubFactory(speechPattern());
  let gotOpts: unknown = null;
  const factory = async (audio: ArrayBuffer, opts?: unknown) => {
    gotOpts = opts;
    return stub.factory();
  };
  const c = new AvatarController(buildMayorHead(), { audioEngineFactory: factory });
  const p = c.playSpeech(new ArrayBuffer(8), { audible: false });
  await new Promise((r) => setTimeout(r, 10));
  ok(
    typeof gotOpts === "object" && gotOpts !== null && (gotOpts as { audible: unknown }).audible === false,
    `audible flag forwarded ${JSON.stringify(gotOpts)}`,
  );
  stub.finish();
  await p;
  c.dispose();
});

test("playSpeech: {kind:'text'} runs rhythmic visualization (documented unsynced)", async () => {
  const c = new AvatarController(buildMayorHead(), {});
  const text = "Hello there, this is a short test of the rhythm visualization.";
  const t0 = Date.now();
  const p = c.playSpeech({ kind: "text", text });
  ok(Date.now() - t0 < 50, "speaking takes effect in the same frame (sync)");
  ok(c.currentState === "speaking", "speaking during visualization");
  let maxJaw = 0;
  const waitMs = 2200;
  while (Date.now() - t0 < waitMs) {
    c.tick(16);
    maxJaw = Math.max(maxJaw, c.head.parts.jawGroup.rotation.x);
    await new Promise((r) => setTimeout(r, 16));
  }
  ok(maxJaw > 0.15, `rhythmic mouth movement, maxJaw=${maxJaw.toFixed(3)}`);
  await p; // resolves at the estimated duration
  ok(c.currentState === "idle", "back to idle after visualization");
  c.dispose();
});

test("playSpeech: text visualization is superseded by a newer call", async () => {
  const c = new AvatarController(buildMayorHead(), {});
  const p1 = c.playSpeech({ kind: "text", text: "First utterance here." });
  p1.catch(() => undefined);
  await new Promise((r) => setTimeout(r, 50));
  const p2 = c.playSpeech({ kind: "text", text: "Second." });
  let aborted = false;
  try {
    await p1;
  } catch {
    aborted = true;
  }
  ok(aborted, "first text visualization aborted on supersede");
  await p2;
  c.dispose();
});

await report("avatar-controller");
