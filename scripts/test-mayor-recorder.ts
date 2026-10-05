import assert from "node:assert/strict";
import { setImmediate as settleEventLoop } from "node:timers/promises";
import { createMayorRecorder } from "../client/src/lib/mayor-recorder";

// These are scheduling regressions, not a simulation of microphone hardware.
// The browser's permission, decoder, context shutdown and response can each
// complete after Cancel or after another recording has already started.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  await settleEventLoop();
  await settleEventLoop();
}

class FakeClock {
  now = 0;
  nextId = 1;
  pending = new Map<number, { at: number; run: () => void }>();
  setTimeout = (run: () => void, delay = 0) => {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + delay, run });
    return id;
  };
  clearTimeout = (id: number | undefined) => { if (id !== undefined) this.pending.delete(id); };
  tick(milliseconds: number) {
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.pending.entries()]
        .filter(([, event]) => event.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.pending.delete(next[0]);
      this.now = next[1].at;
      next[1].run();
    }
    this.now = target;
  }
}

class FakeStream {
  track = { stops: 0, stop() { this.stops++; } };
  getTracks() { return [this.track]; }
}

const decodedAudio = {
  duration: 1,
  length: 16000,
  sampleRate: 16000,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array(16000).fill(0.125),
};
type ContextPlan = {
  decode?: ReturnType<typeof deferred<typeof decodedAudio>>;
  close?: ReturnType<typeof deferred<void>>;
};

function setup() {
  const clock = new FakeClock();
  const states: string[] = [], transcripts: string[] = [], errors: string[] = [];
  const streams: FakeStream[] = [];
  const permissionPlans: ReturnType<typeof deferred<FakeStream>>[] = [];
  const permissionRequests: MediaStreamConstraints[] = [];
  const contextPlans: ContextPlan[] = [];
  const contexts: FakeAudioContext[] = [];
  const recorders: FakeRecorder[] = [];
  const requests: { url: string; options: RequestInit }[] = [];
  const fetchPlans: ReturnType<typeof deferred<Response>>[] = [];

  class FakeRecorder {
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void | Promise<void>;
    onerror?: () => void;
    starts = 0;
    stops = 0;
    constructor(public stream: FakeStream) { recorders.push(this); }
    start() { this.starts++; this.state = "recording"; }
    stop() {
      assert.equal(this.state, "recording", "A stopped recorder must not be stopped again");
      this.stops++;
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["recorded audio fixture"]) });
        void this.onstop?.();
      });
    }
  }

  class FakeAudioContext {
    closeCalls = 0;
    decodeCalls = 0;
    plan = contextPlans.shift() ?? {};
    constructor() { contexts.push(this); }
    decodeAudioData() {
      this.decodeCalls++;
      return this.plan.decode?.promise ?? Promise.resolve(decodedAudio);
    }
    close() {
      this.closeCalls++;
      return this.plan.close?.promise ?? Promise.resolve();
    }
  }

  const replacements: Record<string, unknown> = {
    navigator: {
      mediaDevices: {
        getUserMedia(constraints: MediaStreamConstraints) {
          permissionRequests.push(constraints);
          const planned = permissionPlans.shift();
          if (planned) return planned.promise;
          const stream = new FakeStream();
          streams.push(stream);
          return Promise.resolve(stream);
        },
      },
    },
    MediaRecorder: FakeRecorder,
    AudioContext: FakeAudioContext,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    fetch: (url: string, options: RequestInit) => {
      requests.push({ url, options });
      return fetchPlans.shift()?.promise ?? Promise.resolve(new Response(
        JSON.stringify({ text: "Show me a salon booking workflow.", reviewRequired: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    },
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(replacements)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const recorder = createMayorRecorder({
    state: value => states.push(value),
    transcript: value => transcripts.push(value),
    error: value => errors.push(value),
  });
  return {
    recorder, clock, states, transcripts, errors, streams, permissionPlans,
    permissionRequests, contextPlans, contexts, recorders, requests, fetchPlans,
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

async function test(name: string, run: (environment: ReturnType<typeof setup>) => Promise<void>) {
  const environment = setup();
  try {
    await run(environment);
    assert.equal(environment.clock.pending.size, 0, `${name}: completed capture must release its timers`);
    console.log(`Passed: ${name}`);
  } finally {
    environment.recorder.cancel();
    await flush();
    environment.restore();
  }
}

await test("cancel during AudioContext.close never uploads the cancelled audio", async env => {
  const closing = deferred<void>();
  env.contextPlans.push({ close: closing });
  await env.recorder.start();
  assert.equal(env.states.at(-1), "listening");
  env.recorder.finish();
  await flush();
  assert.equal(env.contexts[0].closeCalls, 1, "The test must reach the pending context-close boundary");
  assert.equal(env.requests.length, 0);
  env.recorder.cancel();
  closing.resolve();
  await flush();
  assert.equal(env.requests.length, 0, "Cancellation must be checked again after asynchronous context shutdown");
  assert.equal(env.transcripts.length, 0);
  assert.equal(env.states.at(-1), "idle");
  assert.equal(env.streams[0].track.stops, 1);
});

await test("a cancelled older capture cannot release a newer capture's resources", async env => {
  const oldClosing = deferred<void>();
  const newDecoding = deferred<typeof decodedAudio>();
  env.contextPlans.push({ close: oldClosing }, { decode: newDecoding });
  await env.recorder.start();
  env.recorder.finish();
  await flush();
  assert.equal(env.contexts[0].closeCalls, 1);
  env.recorder.cancel();
  await env.recorder.start();
  assert.equal(env.recorders[1].state, "recording");
  oldClosing.resolve();
  await flush();
  assert.equal(env.requests.length, 0, "Older audio must not upload after the replacement capture starts");
  assert.equal(env.recorders[1].state, "recording");
  assert.equal(env.recorders[1].stops, 0);
  assert.equal(env.streams[1].track.stops, 0, "An older completion must not stop the new microphone track");
  assert.equal(env.states.at(-1), "listening", "Older completion must not overwrite the new capture state");
  env.recorder.finish();
  await flush();
  assert.equal(env.contexts[1].closeCalls, 0, "The new context is still decoding");
  newDecoding.resolve(decodedAudio);
  await flush();
  assert.equal(env.contexts[1].closeCalls, 1);
  assert.equal(env.requests.length, 1, "Only the new capture may upload");
  assert.deepEqual(env.transcripts, ["Show me a salon booking workflow."]);
  assert.equal(env.states.at(-1), "idle");
});

await test("an older context-close completion cannot close or clear the newer decoder", async env => {
  const oldClosing = deferred<void>();
  const newDecoding = deferred<typeof decodedAudio>();
  env.contextPlans.push({ close: oldClosing }, { decode: newDecoding });
  await env.recorder.start();
  env.recorder.finish();
  await flush();
  assert.equal(env.contexts[0].closeCalls, 1);
  env.recorder.cancel();
  await env.recorder.start();
  env.recorder.finish();
  await flush();
  assert.equal(env.contexts.length, 2);
  assert.equal(env.contexts[1].decodeCalls, 1);
  assert.equal(env.contexts[1].closeCalls, 0);
  oldClosing.resolve();
  await flush();
  assert.equal(env.contexts[1].closeCalls, 0, "A stale completion must not shut down a newer context");
  assert.equal(env.requests.length, 0);
  assert.equal(env.states.at(-1), "transcribing");
  newDecoding.resolve(decodedAudio);
  await flush();
  assert.equal(env.contexts[1].closeCalls, 1, "The newer context must remain owned until its decode finishes");
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.transcripts, ["Show me a salon booking workflow."]);
  assert.deepEqual(env.errors, []);
  assert.equal(env.states.at(-1), "idle");
});

await test("unanswered microphone permission times out and releases a late-acquired stream", async env => {
  const permission = deferred<FakeStream>();
  env.permissionPlans.push(permission);
  const starting = env.recorder.start();
  assert.equal(env.states.at(-1), "starting");
  env.clock.tick(19999);
  await flush();
  assert.equal(env.states.at(-1), "starting", "Permission gets the documented 20-second opportunity");
  env.clock.tick(1);
  await flush();
  assert.equal(env.states.at(-1), "idle", "Unanswered permission must not leave the composer busy indefinitely");
  assert.equal(env.errors.length, 1);
  assert.equal(env.recorders.length, 0);
  const acquiredLate = new FakeStream();
  permission.resolve(acquiredLate);
  await starting;
  await flush();
  assert.equal(acquiredLate.track.stops, 1, "A stream granted after timeout must immediately release the microphone");
  assert.equal(env.recorders.length, 0);
  assert.equal(env.requests.length, 0);
  assert.equal(env.transcripts.length, 0);
  assert.equal(env.errors.length, 1, "Late permission must not report another failure");
  assert.equal(env.states.at(-1), "idle");
});

await test("finish uploads one WAV and offers a transcript for review without sending a chat", async env => {
  assert.equal(env.permissionRequests.length, 0, "Constructing the controller must not request a microphone");
  assert.equal(env.requests.length, 0);
  await env.recorder.start();
  assert.equal(env.permissionRequests[0].video, false);
  assert.equal(env.states.at(-1), "listening");
  env.recorder.finish();
  await flush();
  assert.equal(env.requests.length, 1);
  const request = env.requests[0];
  assert.equal(request.url, "/api/explore-voice", "Transcription must not post the question to the conversation endpoint");
  assert.equal(request.options.method, "POST");
  assert.equal(new Headers(request.options.headers).get("content-type"), "audio/wav");
  assert(request.options.body instanceof ArrayBuffer);
  const bytes = new Uint8Array(request.options.body);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.deepEqual(env.transcripts, ["Show me a salon booking workflow."]);
  assert.deepEqual(env.errors, []);
  assert.equal(env.streams[0].track.stops, 1);
  assert.equal(env.contexts[0].closeCalls, 1);
  assert.equal(env.states.at(-1), "idle");
  env.recorder.finish();
  await flush();
  assert.equal(env.requests.length, 1, "Finishing an already finished capture must not duplicate its upload");
});

await test("cancel during transcription aborts the request and ignores a late successful response", async env => {
  const response = deferred<Response>();
  env.fetchPlans.push(response);
  await env.recorder.start();
  env.recorder.finish();
  await flush();
  assert.equal(env.requests.length, 1);
  assert.equal(env.states.at(-1), "transcribing");
  assert.equal(env.requests[0].options.signal?.aborted, false);
  env.recorder.cancel();
  assert.equal(env.requests[0].options.signal?.aborted, true);
  response.resolve(new Response(JSON.stringify({ text: "Cancelled transcript must not replace the draft.", reviewRequired: true }), { status: 200 }));
  await flush();
  assert.equal(env.transcripts.length, 0, "Even a provider that responds after abort must not publish the stale transcript");
  assert.deepEqual(env.errors, []);
  assert.equal(env.states.at(-1), "idle");
});

console.log("Passed Mayor recorder permission timeout, late stream cleanup, context-shutdown cancellation, capture isolation, transcript review and response cancellation regressions. Physical microphone and live transcription are separate browser checks.");
