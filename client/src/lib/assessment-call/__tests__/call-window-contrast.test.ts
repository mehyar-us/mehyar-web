/**
 * WCAG AA contrast checks for the assessment-call UI (compliance items 13-15,
 * sampled). Colors are the exact values used in AssessmentCallWindow.tsx and
 * AssessmentCallConsent.tsx. Run: npx tsx this-file
 */
import { test, ok, contrastRatio, report } from "./assert.js";

function mix(hexBg: string, hexFg: string, alpha: number): string {
  const c = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16));
  const [br, bg, bb] = c(hexBg);
  const [fr, fg, fb] = c(hexFg);
  const m = (b: number, f: number) => Math.round(alpha * f + (1 - alpha) * b);
  const hx = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hx(m(br, fr))}${hx(m(bg, fg))}${hx(m(bb, fb))}`;
}

const PAGE_BG = "#0b1220"; // bg-[#0b1220]
const WHITE = "#ffffff";

test("body text: white on page bg passes AA", () => {
  const r = contrastRatio(WHITE, PAGE_BG);
  console.log(`    white on ${PAGE_BG}: ${r.toFixed(2)}:1`);
  ok(r >= 4.5, `body text ${r}`);
});

test("end-call button: white icon on red-700 passes AA for UI components", () => {
  const r = contrastRatio(WHITE, "#b91c1c"); // bg-red-700
  console.log(`    white on #b91c1c: ${r.toFixed(2)}:1`);
  ok(r >= 3.0, `end-call icon ${r}`);
});

test("join button: dark text on emerald-500 passes AA", () => {
  const r = contrastRatio("#06281c", "#10b981"); // text on bg-emerald-500
  console.log(`    #06281c on #10b981: ${r.toFixed(2)}:1`);
  ok(r >= 4.5, `join button ${r}`);
});

test("mute/captions buttons: white icon on white/10-over-bg passes 3:1", () => {
  const eff = mix(PAGE_BG, WHITE, 0.1); // bg-white/10 over page bg
  const r = contrastRatio(WHITE, eff);
  console.log(`    white on ${eff}: ${r.toFixed(2)}:1`);
  ok(r >= 3.0, `control icon ${r}`);
});

test("captions overlay: white on black/60 over tile passes AA", () => {
  const eff = mix("#16233d", "#000000", 0.6); // bg-black/60 over tile gradient mid
  const r = contrastRatio(WHITE, eff);
  console.log(`    white on ${eff}: ${r.toFixed(2)}:1`);
  ok(r >= 4.5, `captions ${r}`);
});

test("status text: zinc-300 on page bg passes AA", () => {
  const r = contrastRatio("#d4d4d8", PAGE_BG); // text-zinc-300
  console.log(`    #d4d4d8 on ${PAGE_BG}: ${r.toFixed(2)}:1`);
  ok(r >= 4.5, `status text ${r}`);
});

test("REC pill: zinc-200 on white/10-over-bg passes AA", () => {
  const eff = mix(PAGE_BG, WHITE, 0.1);
  const r = contrastRatio("#e4e4e7", eff); // text-zinc-200
  console.log(`    #e4e4e7 on ${eff}: ${r.toFixed(2)}:1`);
  ok(r >= 4.5, `REC pill ${r}`);
});

await report("call-window-contrast");
