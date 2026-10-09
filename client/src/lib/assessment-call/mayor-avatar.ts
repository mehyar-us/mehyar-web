/**
 * mountAvatar(container, opts): AvatarHandle — the assessment-call contract.
 *
 * Renders the procedural 3D Mayor head (./avatar-head.ts) with Three.js,
 * drives the mouth from real-time TTS audio analysis (./audio-engine.ts +
 * ./lip-sync.ts), and animates call-state body language (idle / listening /
 * thinking / speaking).
 *
 * Fidelity note (honest): lip-sync is prosody-driven, not phoneme-accurate —
 * see lip-sync.ts and docs/assessment-call-avatar.md.
 */
import * as THREE from "three";
import { buildMayorHead, type MayorHead } from "./avatar-head.js";
import {
  VisemeEngine,
  estimateSyllableRate,
  SILENCE_VISENE,
  type AudioFeatures,
  type VisemeWeights,
} from "./lip-sync.js";
import {
  defaultAudioFactory,
  warmupAudio,
  closeSharedAudio,
  primeAvatarAudio,
  type AttachedAudio,
  type AttachOpts,
  type AudioEngine,
} from "./audio-engine.js";
import {
  AvatarAudioError,
  type AvatarHandle,
  type AvatarMountOpts,
  type AvatarState,
  type MountAvatar,
  type PlaySpeechInput,
  type PlaySpeechOpts,
} from "./types.js";

export interface AvatarControllerOpts extends AvatarMountOpts {
  // All options live on AvatarMountOpts (test/telemetry seams included).
}

/**
 * Headless-capable controller: owns the head, the state machine and the
 * animation math. mountAvatar() adds DOM rendering on top. Exported for
 * tests (they drive tick() directly with fake time).
 */
export class AvatarController {
  readonly head: MayorHead;
  private opts: AvatarControllerOpts;
  private state: AvatarState = "idle";
  private speakingIntent = false;
  private viseme: VisemeEngine;
  private attached: AttachedAudio | null = null;
  private priorState: AvatarState = "idle";
  private timeMs = 0;
  private disposed = false;

  // animation state
  private pose = { yaw: 0, pitch: 0, roll: 0, lift: 0 };
  private look = { x: 0, y: 0 };
  private brow = { raise: 0, furrow: 0 };
  private smile = 0.3;
  private blinkAt = 2500;
  private blinkPhase = -1;
  private nodImpulse = 0;
  private prevFlux = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private lowFpsStreak = 0;
  reducedPixelRatio = 1;

  constructor(head: MayorHead, opts: AvatarControllerOpts = {}) {
    this.head = head;
    this.opts = opts;
    this.viseme = new VisemeEngine({ syllableRate: estimateSyllableRate(opts.textHint) });
  }

  get currentState(): AvatarState {
    return this.state;
  }

  setState(state: AvatarState): void {
    this.state = state;
  }

  setSpeaking(speaking: boolean): void {
    this.speakingIntent = speaking;
    this.setState(speaking ? "speaking" : "idle");
  }

  /** Advance the animation by dtMs. Called by the render loop (or tests). */
  tick(dtMs: number): void {
    if (this.disposed) return;
    const dt = Math.min(100, Math.max(0.1, dtMs));
    this.timeMs += dt;
    const t = this.timeMs / 1000;
    const reduceMotion = !!this.opts.reduceMotion;

    // ---- FPS telemetry + auto-degrade -------------------------------------
    this.fpsFrames++;
    if (this.timeMs - this.fpsSince >= 1000) {
      const fps = (this.fpsFrames * 1000) / Math.max(1, this.timeMs - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = this.timeMs;
      this.opts.onFps?.(Math.round(fps));
      if (fps < 28) {
        this.lowFpsStreak++;
        if (this.lowFpsStreak >= 3 && this.reducedPixelRatio > 1) {
          this.reducedPixelRatio = Math.max(1, this.reducedPixelRatio - 0.5);
          this.lowFpsStreak = 0;
          this.opts.onPixelRatioReduced?.(this.reducedPixelRatio);
        }
      } else {
        this.lowFpsStreak = 0;
      }
    }

    // ---- audio -> visemes --------------------------------------------------
    let features = null as null | ReturnType<AudioEngine["getFeatures"]>;
    if (this.attached) {
      try {
        features = this.attached.engine.getFeatures();
      } catch {
        features = null;
      }
    }
    let mouth: VisemeWeights;
    if (features) {
      // Emphasis nods on speech onsets.
      const fluxRise = features.flux - this.prevFlux;
      if (!reduceMotion && fluxRise > 0.3 && features.rms > 0.08) {
        this.nodImpulse = Math.min(1, this.nodImpulse + 0.55);
      }
      this.prevFlux = features.flux;
      mouth = this.viseme.update(features, dt);
    } else if (this.state === "speaking" && this.speakingIntent) {
      // Speaking intent but no audio attached (e.g. setSpeaking(true) alone):
      // near-neutral mouth with soft motion. We NEVER fake lip-sync flapping.
      const jaw = 0.06 + (reduceMotion ? 0 : 0.025 * Math.sin(t * 2.1));
      mouth = { ...SILENCE_VISENE, jawOpen: jaw };
      this.viseme.reset();
    } else {
      mouth = { ...SILENCE_VISENE };
      this.viseme.reset();
      this.prevFlux = 0;
    }
    this.nodImpulse = Math.max(0, this.nodImpulse - dt / 320);

    // ---- state targets ------------------------------------------------------
    let tYaw = 0, tPitch = 0, tRoll = 0, tLift = 0;
    let tLookX = 0, tLookY = 0;
    let tRaise = 0, tFurrow = 0, tSmile = 0.3;
    const energy = features && !features.silent ? Math.min(1, features.rms * 2) : 0;

    switch (this.state) {
      case "idle":
        tYaw = reduceMotion ? 0 : 0.09 * Math.sin(t * 0.3);
        tPitch = reduceMotion ? 0 : 0.03 * Math.sin(t * 0.23 + 1);
        tLookX = reduceMotion ? 0 : 0.18 * Math.sin(t * 0.17 + 2);
        tLookY = reduceMotion ? 0 : 0.1 * Math.sin(t * 0.11);
        tSmile = 0.32;
        break;
      case "listening":
        tPitch = 0.07; // lean in
        tLift = -0.02;
        if (!reduceMotion) tPitch += 0.045 * Math.sin(t * 1.15); // slow engaged nod
        tLookX = 0; tLookY = 0; // eye contact
        tSmile = 0.36;
        break;
      case "thinking":
        tYaw = 0.3;
        tPitch = -0.13; // glance up-side
        tLookX = 0.55; tLookY = 0.45;
        tRaise = 0.75;
        tSmile = 0.18;
        break;
      case "speaking":
        tYaw = reduceMotion ? 0 : 0.1 * Math.sin(t * 0.5);
        tPitch = this.nodImpulse * 0.14;
        tLookX = reduceMotion ? 0 : 0.08 * Math.sin(t * 0.4);
        tFurrow = 0.3 * energy;
        tRaise = 0.18 * energy;
        tSmile = 0.38;
        break;
    }

    // ---- ease pose/look/brows toward targets --------------------------------
    const k = 1 - Math.exp(-dt / 160);
    this.pose.yaw += (tYaw - this.pose.yaw) * k;
    this.pose.pitch += (tPitch - this.pose.pitch) * k;
    this.pose.roll += (tRoll - this.pose.roll) * k;
    this.pose.lift += (tLift - this.pose.lift) * k;
    this.look.x += (tLookX - this.look.x) * k;
    this.look.y += (tLookY - this.look.y) * k;
    this.brow.raise += (tRaise - this.brow.raise) * k;
    this.brow.furrow += (tFurrow - this.brow.furrow) * k;
    this.smile += (tSmile - this.smile) * k;

    // ---- blink ----------------------------------------------------------------
    if (this.blinkPhase < 0 && this.timeMs >= this.blinkAt) this.blinkPhase = 0;
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      const d = this.blinkPhase;
      blink = d < 70 ? d / 70 : d < 140 ? 1 - (d - 70) / 70 : 0;
      if (d >= 140) {
        this.blinkPhase = -1;
        const base = this.state === "thinking" ? 4200 : 3000;
        this.blinkAt = this.timeMs + base + Math.random() * 2200;
      }
    }

    // ---- apply ------------------------------------------------------------------
    this.head.setPose(this.pose);
    this.head.setEyes({ blink, lookX: this.look.x, lookY: this.look.y });
    this.head.setBrows(this.brow);
    const appliedMouth = { ...mouth, smile: this.smile };
    this.head.setMouth(appliedMouth);
    this.opts.onViseme?.(appliedMouth);
    this.head.setBreath(Math.sin(t * Math.PI * 2 * 0.22)); // ~13 breaths/min
  }

  /**
   * Text-only visualization for { kind: "text", text } input.
   *
   * HONEST SCOPE: there is no audio here, so this is NOT lip-sync — it is a
   * deterministic syllable-rhythm animation (seeded by the text) driving the
   * same viseme pipeline, for the same estimated duration as the spoken
   * text. Speaking state + body language are real; mouth shapes are rhythmic
   * visualization. Prefer passing audio (R2: Mayor ordered tight sync).
   */
  private startTextVisualization(text: string): AttachedAudio {
    const durMs = estimateTextDurationMs(text);
    const rand = mulberry32(hashString(text));
    // Syllable centers spread across the duration, with jitter.
    const nSyl = Math.max(3, Math.round(text.length / 4.5));
    const centers: { t: number; timbre: number }[] = [];
    for (let i = 0; i < nSyl; i++) {
      centers.push({
        t: (durMs * (i + 0.5)) / nSyl + (rand() - 0.5) * (durMs / nSyl) * 0.6,
        timbre: rand(),
      });
    }
    const t0 = nowMs();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (e: Error) => void = () => undefined;
    const stopAll = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      onAbort(new AvatarAudioError("aborted", "Playback was superseded by a newer playSpeech call."));
    };
    const engine: AudioEngine = {
      getFeatures: (): AudioFeatures => {
        const t = nowMs() - t0;
        // Sum of gaussian syllable bumps (sigma 90ms).
        let rms = 0;
        let centroid = 0.2;
        let flux = 0;
        for (const c of centers) {
          const dt = (t - c.t) / 90;
          if (dt > -3 && dt < 3) {
            const g = Math.exp(-dt * dt);
            if (g * 0.34 > rms) {
              rms = g * 0.34;
              centroid = 0.16 + 0.3 * c.timbre * g;
            }
            if (dt > -0.5 && dt < 0.5 && g > flux) flux = g;
          }
        }
        const silent = rms < 0.012;
        return { rms, centroid, flux, zcr: 0.15, low: 0.6, mid: 0.5, high: 0.1, silent };
      },
      stop: () => stopAll(),
      dispose: () => stopAll(),
    };
    const done = new Promise<void>((resolve, reject) => {
      // Note: stopAll() is the only caller of onAbort and already guards
      // `settled`, so this rejects exactly once — no double-settle.
      onAbort = (e) => reject(e);
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, durMs);
    });
    done.catch(() => undefined);
    return { engine, done, decodeMs: 0 };
  }

  async playSpeech(input: PlaySpeechInput, opts: PlaySpeechOpts = {}): Promise<void> {
    if (this.disposed) throw new AvatarAudioError("aborted", "Avatar is disposed.");
    this.stopAudio();
    // D5 latency: the speaking state takes effect SYNCHRONOUSLY in the same
    // frame playSpeech is called — we never wait for decode/attach before
    // reacting. Audio starts as soon as the (irreducible) decode finishes.
    this.priorState = this.state === "speaking" ? this.priorState : this.state;
    const normalized = normalizePlayInput(input);
    const textForRate =
      opts.text ?? this.opts.textHint ?? (normalized.type === "text" ? normalized.text : undefined);
    this.viseme = new VisemeEngine({ syllableRate: estimateSyllableRate(textForRate) });
    this.setState("speaking");
    let attached: AttachedAudio;
    if (normalized.type === "text") {
      attached = this.startTextVisualization(normalized.text);
    } else {
      const factory = this.opts.audioEngineFactory ?? defaultAudioFactory;
      const attachOpts: AttachOpts = { audible: opts.audible };
      try {
        attached = await factory(normalized.data, attachOpts);
      } catch (e) {
        if (this.state === "speaking") this.setState(this.speakingIntent ? "speaking" : "idle");
        throw e;
      }
    }
    if (this.disposed) {
      attached.engine.dispose();
      throw new AvatarAudioError("aborted", "Avatar is disposed.");
    }
    this.attached = attached;
    this.opts.onAudioAttached?.({ decodeMs: attached.decodeMs ?? -1 });
    try {
      await attached.done;
    } finally {
      if (this.attached === attached) {
        this.attached = null;
        attached.engine.dispose();
        if (this.state === "speaking") this.setState(this.speakingIntent ? "speaking" : "idle");
      }
    }
  }

  /** Stop current audio without disposing the avatar. Public for call teardown. */
  stopAudio(): void {
    const a = this.attached;
    this.attached = null;
    if (a) {
      try {
        a.engine.stop();
      } catch {
        /* noop */
      }
      // Swallow the abort rejection — supersede is a normal control flow.
      a.done.catch(() => undefined);
      try {
        a.engine.dispose();
      } catch {
        /* noop */
      }
    }
    this.viseme.reset();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAudio();
    this.head.dispose();
  }
}

export { primeAvatarAudio };

// ---------------------------------------------------------------------------
// playSpeech input normalization (reconciled avatar-crew + infra-crew contract)
// ---------------------------------------------------------------------------

const isAudioElement = (v: unknown): v is HTMLAudioElement =>
  typeof HTMLAudioElement !== "undefined" && v instanceof HTMLAudioElement;

export type NormalizedPlayInput =
  | { type: "audio"; data: ArrayBuffer | HTMLAudioElement }
  | { type: "text"; text: string };

/** Normalize every accepted playSpeech input shape. Exported for tests. */
export function normalizePlayInput(input: PlaySpeechInput): NormalizedPlayInput {
  if (input instanceof ArrayBuffer || isAudioElement(input)) {
    return { type: "audio", data: input };
  }
  if (input.kind === "text") return { type: "text", text: input.text };
  return { type: "audio", data: input.src };
}

/** Deterministic hash for seeded text visualization. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Estimated spoken duration for text (chars ÷ 15/sec, clamped 1.5s–120s).
 * Exported for tests.
 */
export function estimateTextDurationMs(text: string): number {
  return Math.min(120000, Math.max(1500, (text.length / 15) * 1000));
}

const nowMs = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export const mountAvatar: MountAvatar = (container, opts = {}) => {
  const mountT0 = nowMs();
  // D5: warm the shared AudioContext at mount (creation needs no gesture).
  const audioWarmupMs = (() => {
    try {
      return warmupAudio();
    } catch {
      return -1;
    }
  })();
  const head = buildMayorHead();
  const controller = new AvatarController(head, opts);
  const reduceMotion =
    opts.reduceMotion ??
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Rebuild the controller with the resolved reduceMotion without touching state.
  (controller as unknown as { opts: AvatarControllerOpts }).opts = { ...opts, reduceMotion };

  let renderer: THREE.WebGLRenderer | null = null;
  let rafId = 0;
  let disposed = false;

  const canWebGL = !opts.forceNullRenderer && typeof document !== "undefined";
  if (canWebGL) {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      renderer = null; // graceful degradation: state machine still runs
    }
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, -0.02, 5.6);
  camera.lookAt(0, -0.55, 0);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a2f28, 1.15));
  const key = new THREE.DirectionalLight(0xfff1e0, 1.5);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff4e8, 0.4);
  fill.position.set(0, 0.8, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.75);
  rim.position.set(-3, 1.5, -2.5);
  scene.add(rim);
  scene.add(head.group);
  head.group.position.y = 0.42;

  const applySize = () => {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 300;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (renderer) {
      const pr = Math.min(
        opts.maxPixelRatio ?? 2,
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      );
      controller.reducedPixelRatio = pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
    }
  };

  let canvas: HTMLCanvasElement | null = null;
  if (renderer) {
    canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "3D avatar of the Mayor on the assessment call");
    container.appendChild(canvas);
    applySize();
    // D5 latency: warm up ALL shader compilation at mount time, never on
    // first playSpeech. The first frame is rendered here, so
    // mountToFirstFrame includes the full warm cost up front.
    const w0 = nowMs();
    renderer.compile(scene, camera);
    controller.tick(16.7);
    renderer.render(scene, camera);
    const shaderWarmupMs = nowMs() - w0;
    opts.onReady?.({
      mountToFirstFrameMs: nowMs() - mountT0,
      shaderWarmupMs,
      audioWarmupMs,
    });
  } else {
    opts.onReady?.({ mountToFirstFrameMs: nowMs() - mountT0, shaderWarmupMs: 0, audioWarmupMs });
  }

  const ro =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(applySize) : null;
  ro?.observe(container);

  let last = typeof performance !== "undefined" ? performance.now() : Date.now();
  const raf =
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame
      : (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  const caf =
    typeof cancelAnimationFrame !== "undefined"
      ? cancelAnimationFrame
      : (id: number) => clearTimeout(id);

  const loop = (now: number) => {
    if (disposed) return;
    const dt = now - last;
    last = now;
    controller.tick(dt);
    if (renderer) {
      const pr = controller.reducedPixelRatio;
      if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
      renderer.render(scene, camera);
    }
    rafId = raf(loop);
  };
  rafId = raf(loop);

  // Pause rendering when the tab is hidden (battery); state machine resumes.
  const onVis = () => {
    last = typeof performance !== "undefined" ? performance.now() : Date.now();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);

  const handle: AvatarHandle = {
    setSpeaking: (speaking: boolean) => controller.setSpeaking(speaking),
    setState: (state: AvatarState) => controller.setState(state),
    playSpeech: (audio: ArrayBuffer | HTMLAudioElement, popts?: PlaySpeechOpts) =>
      controller.playSpeech(audio, popts),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      caf(rafId);
      ro?.disconnect();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      controller.dispose();
      renderer?.dispose();
      closeSharedAudio();
      if (canvas && canvas.parentElement === container) container.removeChild(canvas);
      // Release GPU geometries/materials of scene-level objects.
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    },
  };
  return handle;
};
