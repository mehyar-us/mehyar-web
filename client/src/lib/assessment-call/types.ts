/**
 * Assessment-call avatar contract.
 *
 * Implemented by `mountAvatar` in ./mayor-avatar.ts. The infra crew builds
 * against exactly this surface. Optional fields are extensions that never
 * break the required calls.
 */

/** Call-state machine states the avatar can be in. */
export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

/** Latency metrics reported via AvatarMountOpts.onReady. */
export interface AvatarReadyMetrics {
  /** ms from mountAvatar() entry to the first rendered frame (warm). */
  mountToFirstFrameMs: number;
  /** ms spent compiling shaders + first render during mount warmup. */
  shaderWarmupMs: number;
  /** ms spent creating the shared AudioContext at mount (-1 if unavailable). */
  audioWarmupMs: number;
}

export interface AvatarMountOpts {
  /**
   * Optional transcript of the audio that will be played. Used ONLY as a
   * syllable-rate prior to adapt articulation speed (see lip-sync.ts).
   * It is NOT used for phoneme timing — we do not claim phoneme accuracy.
   */
  textHint?: string;
  /**
   * Force a null (no-WebGL) renderer. The avatar still runs its full
   * state machine and mouth/pose math so logic can be tested headless;
   * nothing is drawn. Also used as the graceful-degradation path when
   * WebGL is unavailable in a browser.
   */
  forceNullRenderer?: boolean;
  /** Reduce motion (honors prefers-reduced-motion; also a battery saver). */
  reduceMotion?: boolean;
  /** Called ~1/sec with the render-loop FPS (perf telemetry). */
  onFps?: (fps: number) => void;
  /** Called when the auto-degrader lowers the pixel ratio (perf telemetry). */
  onPixelRatioReduced?: (pixelRatio: number) => void;
  /**
   * Called once after mount with latency metrics (D5 budget telemetry).
   * mountToFirstFrameMs covers head build + shader warmup + first render.
   */
  onReady?: (metrics: AvatarReadyMetrics) => void;
  /**
   * Test seam / advanced override: how playSpeech attaches audio.
   * Defaults to the real WebAudio path. Documented for tests.
   */
  audioEngineFactory?: (
    audio: ArrayBuffer | HTMLAudioElement,
    opts?: import("./audio-engine.js").AttachOpts,
  ) => Promise<import("./audio-engine.js").AttachedAudio>;
  /**
   * Observability (tests/telemetry): called every animation tick with the
   * mouth weights actually applied to the head.
   */
  onViseme?: (w: import("./lip-sync.js").VisemeWeights) => void;
  /**
   * Observability (tests/telemetry): called when audio attaches, with the
   * measured decode cost (D5 budget accounting).
   */
  onAudioAttached?: (info: { decodeMs: number }) => void;
  /**
   * Pixel-ratio cap. Defaults to min(devicePixelRatio, 2). Lower it on
   * low-end devices if the auto-degrader is disabled.
   */
  maxPixelRatio?: number;
}

/** Options for playSpeech. */
export interface PlaySpeechOpts {
  /**
   * Optional transcript of THIS audio clip. Same semantics as
   * AvatarMountOpts.textHint but scoped to this utterance; overrides it.
   */
  text?: string;
  /**
   * When false, the audio is analyzed at zero gain (inaudible) — for the
   * integration where the voice transport plays the audible copy and the
   * avatar analyzes a second copy for lip-sync. Default true.
   */
  audible?: boolean;
}

/**
 * Reconciled playSpeech input (avatar crew + infra crew contracts).
 *
 * - `ArrayBuffer | HTMLAudioElement`: raw audio → real lip-sync (preferred).
 * - `{ kind: "audio", src }`: same, in the infra crew's envelope form.
 * - `{ kind: "text", text }`: text-only → deterministic syllable-rhythm
 *   visualization (speaking state + body language + rhythmic mouth). This is
 *   NOT synced to any audio — use it only when the audio is unavailable.
 *   Mayor ordered tight lip-sync (R2): prefer passing the audio.
 */
export type PlaySpeechInput =
  | ArrayBuffer
  | HTMLAudioElement
  | { kind: "text"; text: string }
  | { kind: "audio"; src: ArrayBuffer | HTMLAudioElement };

/** Handle returned by mountAvatar. */
export interface AvatarHandle {
  /**
   * Signal that the avatar is (or is not) speaking. This sets the state
   * machine to 'speaking' (or back to 'idle') and enables speaking-state
   * body language. NOTE: without playSpeech() there is no audio to
   * analyze, so the mouth stays near-neutral — we never fake lip-sync.
   */
  setSpeaking(speaking: boolean): void;
  /** Set the avatar's call state explicitly. */
  setState(state: AvatarState): void;
  /**
   * Play TTS audio through the avatar with lip-sync. Accepts raw audio
   * (ArrayBuffer | HTMLAudioElement, or { kind:"audio", src }) for real
   * audio-driven lip-sync, or { kind:"text", text } for text-rhythm
   * visualization when audio is unavailable (unsynced — documented).
   * Resolves when playback/visualization ends; rejects on
   * decode/autoplay/CORS errors.
   */
  playSpeech(audio: PlaySpeechInput, opts?: PlaySpeechOpts): Promise<void>;
  /** Stop everything, release WebGL + audio resources. Idempotent. */
  dispose(): void;
}

export type MountAvatar = (container: HTMLElement, opts?: AvatarMountOpts) => AvatarHandle;

/** Errors thrown/rejected by the avatar audio path. */
export class AvatarAudioError extends Error {
  readonly code: "decode" | "autoplay" | "cors" | "unsupported" | "aborted";
  constructor(code: AvatarAudioError["code"], message: string) {
    super(message);
    this.name = "AvatarAudioError";
    this.code = code;
  }
}
