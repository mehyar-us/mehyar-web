/**
 * End-to-end lip-sync measurement on REAL TTS speech (no mocks).
 *
 * Fixture: fixtures/mayor-line-padded.wav — a real `tts` CLI synthesis of a
 * Mayor closer line (Meta "Smooth" voice), padded with 1s of digital silence
 * at head and tail, 16kHz mono float32.
 *
 * Pipeline under test: WAV bytes -> extractFeaturesFromPCM -> VisemeEngine ->
 * jawOpen trajectory. This is the exact math the browser runs per animation
 * frame (the browser reads the same features from an AnalyserNode).
 *
 * The printed numbers are the honest lip-sync quality report:
 *   - speech/silence jaw ratio (does the mouth open for speech, close for pauses)
 *   - open fraction during speech (is it visibly talking, not frozen)
 *   - mouth-movement rate (syllable-rate pulsing?)
 *
 * Run: npx tsx this-file
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFeaturesFromPCM, VisemeEngine } from "../lip-sync.js";
import { test, ok, report } from "./assert.js";

const here = dirname(fileURLToPath(import.meta.url));
const WAV = join(here, "fixtures", "mayor-line-padded.wav");

function readWavFloat32(path: string): { samples: Float32Array; sampleRate: number } {
  const d = readFileSync(path);
  const dataIdx = d.indexOf(Buffer.from("data"));
  if (dataIdx < 0) throw new Error("no data chunk");
  const sr = d.readUInt32LE(24);
  const fmt = d.readUInt16LE(20);
  if (fmt !== 3) throw new Error(`expected IEEE float wav, got format ${fmt}`);
  const bytes = d.subarray(dataIdx + 8);
  const n = Math.floor(bytes.length / 4);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = bytes.readFloatLE(i * 4);
  return { samples, sampleRate: sr };
}

const SKIP = !existsSync(WAV);

test("real TTS: fixture parses", () => {
  if (SKIP) return;
  const { samples, sampleRate } = readWavFloat32(WAV);
  ok(sampleRate === 16000, `sr ${sampleRate}`);
  ok(samples.length > 16000 * 10, `length ${samples.length}`);
});

test("real TTS: mouth opens for speech, closes for silence", () => {
  if (SKIP) return;
  const { samples, sampleRate } = readWavFloat32(WAV);
  const frames = extractFeaturesFromPCM(samples, sampleRate);
  const engine = new VisemeEngine();
  const hopSec = 512 / sampleRate;
  const jaws = frames.map((f) => engine.update(f, hopSec * 1000).jawOpen);

  for (const j of jaws) {
    ok(Number.isFinite(j) && j >= 0 && j <= 1, `jaw in range ${j}`);
  }

  const tOf = (i: number) => (i * 512) / sampleRate;
  const meanIn = (a: number, b: number) => {
    const sel = jaws.filter((_, i) => tOf(i) >= a && tOf(i) < b);
    return sel.reduce((x, y) => x + y, 0) / Math.max(1, sel.length);
  };
  const silenceJaw = meanIn(0.1, 0.9); // leading pad: digital silence
  const speechJaw = meanIn(1.3, 12.0); // the spoken line
  const tailJaw = meanIn(13.6, 14.4); // trailing pad
  const ratio = speechJaw / Math.max(1e-6, silenceJaw);

  console.log(`    speech jaw ${speechJaw.toFixed(3)} | lead-silence jaw ${silenceJaw.toFixed(3)} | tail jaw ${tailJaw.toFixed(3)} | ratio ${ratio.toFixed(1)}x`);

  ok(silenceJaw < 0.08, `silence keeps mouth shut (${silenceJaw})`);
  ok(tailJaw < 0.12, `trailing silence closes mouth (${tailJaw})`);
  ok(ratio > 4, `speech/silence ratio ${ratio}`);
  ok(speechJaw > 0.25, `speech opens mouth on average (${speechJaw})`);
});

test("real TTS: visibly talking (open fraction) with syllable-rate pulsing", () => {
  if (SKIP) return;
  const { samples, sampleRate } = readWavFloat32(WAV);
  const frames = extractFeaturesFromPCM(samples, sampleRate);
  const engine = new VisemeEngine();
  const hopSec = 512 / sampleRate;
  const jaws = frames.map((f) => engine.update(f, hopSec * 1000).jawOpen);
  const tOf = (i: number) => (i * 512) / sampleRate;
  const speech = jaws.filter((_, i) => tOf(i) >= 1.3 && tOf(i) < 12.0);

  const openFrac = speech.filter((j) => j > 0.25).length / speech.length;
  // rising edges through 0.3 = syllable-ish pulses
  let pulses = 0;
  for (let i = 1; i < speech.length; i++) {
    if (speech[i - 1] <= 0.3 && speech[i] > 0.3) pulses++;
  }
  // mean absolute jaw velocity during speech (mouth "busyness")
  let vel = 0;
  for (let i = 1; i < speech.length; i++) vel += Math.abs(speech[i] - speech[i - 1]);
  vel /= (speech.length * hopSec);

  console.log(`    open fraction ${openFrac.toFixed(2)} | pulses ${pulses} | jaw velocity ${vel.toFixed(2)}/s`);

  ok(openFrac > 0.35, `talking, not frozen (${openFrac})`);
  ok(pulses >= 8, `syllable-rate pulsing (${pulses} pulses)`);
  ok(vel > 0.8 && vel < 12, `mouth busyness in sane range (${vel})`);
});

await report("real-audio");
