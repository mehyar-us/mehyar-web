/**
 * Minimal test helper — no test framework dependency (repo convention: tsx scripts).
 * Supports async test fns: report() awaits every test before printing.
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];
const pending: Promise<void>[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await fn();
      passed++;
    } catch (e) {
      failed++;
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  pending.push(run());
}

export function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`expected truthy: ${msg}`);
}

export function approx(actual: number, expected: number, tol: number, msg: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error(`${msg}: expected ${expected}±${tol}, got ${actual}`);
  }
}

/** Contrast ratio of two sRGB hex colors (WCAG 2.x relative luminance). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const c = hex.replace("#", "");
    const rgb = [0, 2, 4].map((i) => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const [l1, l2] = [lum(hexA), lum(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

export async function report(suite: string): Promise<void> {
  await Promise.all(pending);
  console.log(`\n${suite}: ${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failed > 0) process.exitCode = 1;
}
