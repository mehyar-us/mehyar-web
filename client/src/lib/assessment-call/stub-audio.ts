/**
 * Stub audio feed for avatar tests and the demo page.
 *
 * Synthesizes speech-LIKE audio (voiced pulse train through formant-ish
 * bandpass filters, amplitude-modulated at syllable rate with pauses) and
 * encodes it to a 16-bit WAV ArrayBuffer. This exercises the REAL
 * playSpeech(ArrayBuffer) path — decodeAudioData, the analyser graph, and
 * the lip-sync engine — with no network and no TTS service.
 *
 * It is explicitly NOT real speech: the demo page labels it as synthetic.
 * For true end-to-end lip-sync measurement we use a real TTS MP3 in the
 * Node test suite (see __tests__/real-audio.test.ts).
 */

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const wstr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Deterministic PRNG so the stub is reproducible. */
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
 * Render `seconds` of speech-like audio at 22050 Hz and return it as a
 * WAV ArrayBuffer ready for playSpeech().
 */
export function synthesizeSpeechLikeWav(seconds = 8, seed = 7): ArrayBuffer {
  const sr = 22050;
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const rand = mulberry32(seed);

  // Syllable pattern: 0.32s voiced bursts at ~4.2 syllables/sec with pauses.
  let f0 = 118; // base pitch, drifts like a voice
  let lp1 = 0, lp2 = 0; // cheap resonant lowpass state (formant-ish)
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const cyc = t % 0.95;
    const voiced = cyc < 0.62; // 0.62s talk, 0.33s pause
    f0 = 118 + 14 * Math.sin(2 * Math.PI * 0.31 * t) + 6 * Math.sin(2 * Math.PI * 1.7 * t);
    let s = 0;
    if (voiced) {
      const ph = 2 * Math.PI * f0 * t;
      // glottal-ish pulse: fundamental + harmonics, AM at syllable rate
      const am = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.2 * t + 1);
      const exc = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph + 0.7);
      // two-pole resonator ~ 700Hz formant
      const target = exc * 0.32 * am;
      lp1 += 0.24 * (target - lp1);
      lp2 += 0.24 * (lp1 - lp2);
      s = lp2 * 2.4;
      // occasional sibilant-ish burst (highpassed noise)
      if (rand() < 0.006) s += (rand() - 0.5) * 0.5;
    }
    // gentle fade at edges to avoid clicks
    const edge = Math.min(1, i / (sr * 0.05), (n - i) / (sr * 0.05));
    out[i] = s * edge;
  }
  return encodeWav(out, sr);
}
