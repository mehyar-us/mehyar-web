/** Unit tests for the pure lip-sync engine (lip-sync.ts). Run: npx tsx this-file */
import {
  computeTimeFeatures,
  computeSpectralFeatures,
  featuresToViseme,
  VisemeEngine,
  estimateSyllableRate,
  fftMagnitudes,
  extractFeaturesFromPCM,
  type AudioFeatures,
} from "../lip-sync.js";
import { test, ok, approx, report } from "./assert.js";

function sine(freq: number, seconds: number, sampleRate: number, amp = 0.5): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

function whiteNoise(seconds: number, sampleRate: number, amp = 0.4): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = amp * (seed / 0x7fffffff - 0.5) * 2;
  }
  return out;
}

test("time features: digital silence -> zero", () => {
  const { rms, zcr } = computeTimeFeatures(new Float32Array(1024));
  ok(rms === 0, "rms should be 0");
  ok(zcr === 0, "zcr should be 0");
});

test("time features: sine has energy, low zcr; noise has high zcr", () => {
  const s = computeTimeFeatures(sine(440, 0.05, 48000));
  const nz = computeTimeFeatures(whiteNoise(0.05, 48000));
  ok(s.rms > 0.5, `sine rms ${s.rms}`);
  ok(nz.zcr > s.zcr * 3, `noise zcr ${nz.zcr} vs sine ${s.zcr}`);
});

test("fft: 1kHz sine peaks at the right bin", () => {
  const mags = fftMagnitudes(sine(1000, 0.05, 48000), 1024);
  let argmax = 0;
  for (let k = 1; k < mags.length; k++) if (mags[k] > mags[argmax]) argmax = k;
  ok(argmax >= 19 && argmax <= 24, `peak bin ${argmax}, expected ~21`);
});

test("spectral features: low sine -> low centroid + low band; 8kHz -> high", () => {
  const sr = 48000;
  const low = computeSpectralFeatures(fftMagnitudes(sine(200, 0.05, sr), 1024), sr, 1024);
  const high = computeSpectralFeatures(fftMagnitudes(sine(8000, 0.05, sr), 1024), sr, 1024);
  ok(low.centroid < 0.1, `low centroid ${low.centroid}`);
  ok(low.low > low.high, "low band dominates for 200Hz");
  ok(high.centroid > low.centroid * 4, `high centroid ${high.centroid}`);
  ok(high.high > high.low, "high band dominates for 8kHz");
});

const LOUD_LOW: AudioFeatures = {
  rms: 0.35, centroid: 0.15, flux: 0.1, zcr: 0.1, low: 0.8, mid: 0.5, high: 0.05, silent: false,
};
const SIBILANT: AudioFeatures = {
  rms: 0.22, centroid: 0.72, flux: 0.15, zcr: 0.85, low: 0.05, mid: 0.3, high: 0.9, silent: false,
};

test("featuresToViseme: silence -> closed mouth", () => {
  const v = featuresToViseme({ ...LOUD_LOW, silent: true, rms: 0 });
  ok(v.jawOpen === 0 && v.mouthWide === 0 && v.mouthRound === 0 && v.lipPress === 0, "all zero");
});

test("featuresToViseme: loud low vowel -> jaw opens, rounds a little", () => {
  const v = featuresToViseme(LOUD_LOW);
  ok(v.jawOpen > 0.5, `jawOpen ${v.jawOpen}`);
  ok(v.mouthRound > 0.1, `mouthRound ${v.mouthRound}`);
  ok(v.mouthWide < 0.3, `mouthWide ${v.mouthWide}`);
});

test("featuresToViseme: sibilant -> spread mouth, jaw mostly shut", () => {
  const v = featuresToViseme(SIBILANT);
  ok(v.mouthWide > 0.3, `mouthWide ${v.mouthWide}`);
  ok(v.jawOpen < 0.45, `jawOpen ${v.jawOpen}`);
});

test("featuresToViseme: onset burst -> lip press trigger", () => {
  const v = featuresToViseme({ ...LOUD_LOW, flux: 1, rms: 0.12 });
  ok(v.lipPress > 0.4, `lipPress ${v.lipPress}`);
});

test("VisemeEngine: smoothing converges and is asymmetric", () => {
  const e = new VisemeEngine();
  const first = e.update(LOUD_LOW, 16);
  ok(first.jawOpen > 0 && first.jawOpen < 0.9, `first step partial ${first.jawOpen}`);
  let v = first;
  for (let i = 0; i < 60; i++) v = e.update(LOUD_LOW, 16);
  ok(v.jawOpen > 0.6, `converged ${v.jawOpen}`);
  // release is slower than attack: one silent frame barely moves it
  const afterOne = e.update({ ...LOUD_LOW, silent: true, rms: 0 }, 16);
  ok(afterOne.jawOpen > v.jawOpen * 0.8, `slow release ${afterOne.jawOpen}`);
  // but it does decay to closed
  let d = afterOne;
  for (let i = 0; i < 60; i++) d = e.update({ ...LOUD_LOW, silent: true, rms: 0 }, 16);
  ok(d.jawOpen < 0.05, `decayed ${d.jawOpen}`);
});

test("VisemeEngine: plosive envelope shuts the jaw over ~100ms", () => {
  const e = new VisemeEngine();
  for (let i = 0; i < 30; i++) e.update(LOUD_LOW, 16);
  const spike = e.update({ ...LOUD_LOW, flux: 0.9, rms: 0.15 }, 16);
  ok(spike.lipPress > 0.25, `lipPress ${spike.lipPress}`);
  ok(spike.jawOpen < 0.35, `closure visible ${spike.jawOpen}`);
  // Closure holds briefly, then the vowel reopens the jaw (correct: b -> vowel).
  let v = spike;
  for (let i = 0; i < 3; i++) v = e.update({ ...LOUD_LOW, flux: 0.2, rms: 0.3 }, 16);
  ok(v.jawOpen > spike.jawOpen, `jaw reopens for the vowel ${v.jawOpen}`);
  // And silence rests it closed.
  for (let i = 0; i < 30; i++) v = e.update({ ...LOUD_LOW, flux: 0, rms: 0, silent: true }, 16);
  ok(v.jawOpen < 0.1, `jaw rests closed ${v.jawOpen}`);
});

test("VisemeEngine: syllable rate adapts time constants", () => {
  const slow = new VisemeEngine({ syllableRate: 2.5 });
  const fast = new VisemeEngine({ syllableRate: 8 });
  ok(fast.timeConstantsMs.attackMs < slow.timeConstantsMs.attackMs, "faster speech -> snappier");
});

test("estimateSyllableRate: sane English estimate, null on junk", () => {
  const r = estimateSyllableRate("Hello world this is a spoken test");
  ok(r !== null && r > 2 && r < 5, `rate ${r}`);
  ok(estimateSyllableRate("") === null, "empty -> null");
  ok(estimateSyllableRate("hi") === null, "single word -> null");
});

test("extractFeaturesFromPCM: burst/pause synthetic speech -> mouth follows energy", () => {
  const sr = 16000;
  // 3s: 0.4s voiced burst (220Hz + harmonics, AM at 5Hz) alternating with 0.4s silence
  const n = sr * 3;
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const inBurst = t % 0.8 < 0.4;
    if (inBurst) {
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 5 * t);
      pcm[i] =
        0.4 * am * Math.sin(2 * Math.PI * 180 * t) +
        0.15 * am * Math.sin(2 * Math.PI * 540 * t);
    }
  }
  const frames = extractFeaturesFromPCM(pcm, sr);
  const engine = new VisemeEngine();
  const jaws: number[] = [];
  const dt = (512 / sr) * 1000;
  for (const f of frames) jaws.push(engine.update(f, dt).jawOpen);
  const burstJaw = jaws.filter((_, i) => (i * 512) / sr % 0.8 < 0.3);
  const pauseJaw = jaws.filter((_, i) => (i * 512) / sr % 0.8 > 0.5);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  ok(mean(burstJaw) > mean(pauseJaw) * 3, `burst ${mean(burstJaw)} vs pause ${mean(pauseJaw)}`);
  // Deep-pause frames (middle of the 0.4s pause, away from boundaries) rest closed.
  const deepPause = jaws.filter((_, i) => {
    const m = ((i * 512) / sr) % 0.8;
    return m > 0.58 && m < 0.72;
  });
  ok(mean(deepPause) < 0.13, `deep pauses close mouth ${mean(deepPause)}`);
});

test("featuresToViseme is deterministic", () => {
  const a = featuresToViseme(LOUD_LOW);
  const b = featuresToViseme({ ...LOUD_LOW });
  ok(JSON.stringify(a) === JSON.stringify(b), "identical outputs");
});

await report("lip-sync");
