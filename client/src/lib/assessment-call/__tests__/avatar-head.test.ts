/** Headless tests for the procedural Mayor head (avatar-head.ts). Run: npx tsx this-file */
import { buildMayorHead } from "../avatar-head.js";
import { test, ok, approx, report } from "./assert.js";

test("builds without a DOM/WebGL and reports sane stats", () => {
  const head = buildMayorHead();
  ok(!!head.group, "group exists");
  const { drawCalls, triangles } = head.getStats();
  ok(drawCalls > 10 && drawCalls < 60, `drawCalls ${drawCalls} in budget`);
  ok(triangles > 3000 && triangles < 60000, `triangles ${triangles} in budget`);
  head.dispose();
});

test("setMouth: jaw opens proportionally and clamps", () => {
  const head = buildMayorHead();
  const { jawGroup } = head.parts;
  head.setMouth({ jawOpen: 0, mouthWide: 0, mouthRound: 0, lipPress: 0, smile: 0 });
  approx(jawGroup.rotation.x, 0, 1e-6, "closed");
  head.setMouth({ jawOpen: 1, mouthWide: 0, mouthRound: 0, lipPress: 0, smile: 0 });
  approx(jawGroup.rotation.x, 0.55, 1e-6, "fully open");
  head.setMouth({ jawOpen: 0.5, mouthWide: 0, mouthRound: 0, lipPress: 0, smile: 0 });
  approx(jawGroup.rotation.x, 0.275, 1e-6, "half open");
  head.setMouth({ jawOpen: 5, mouthWide: 0, mouthRound: 0, lipPress: 0, smile: 0 });
  approx(jawGroup.rotation.x, 0.55, 1e-6, "clamped");
  head.dispose();
});

test("setMouth: lip press shuts the jaw, teeth hide when closed", () => {
  const head = buildMayorHead();
  const { jawGroup, teeth } = head.parts;
  head.setMouth({ jawOpen: 0.8, mouthWide: 0, mouthRound: 0, lipPress: 1, smile: 0 });
  ok(jawGroup.rotation.x < 0.55 * 0.8 * 0.5, `press suppresses jaw ${jawGroup.rotation.x}`);
  head.setMouth({ jawOpen: 0, mouthWide: 0, mouthRound: 0, lipPress: 0, smile: 0 });
  ok(teeth.visible === false, "teeth hidden when closed");
  head.setMouth({ jawOpen: 0.6, mouthWide: 0, mouthRound: 0, lipPress: 0, smile: 0 });
  ok(teeth.visible === true, "teeth visible when open");
  head.dispose();
});

test("setMouth: wide spreads, round protrudes", () => {
  const head = buildMayorHead();
  const { mouthGroup } = head.parts;
  head.setMouth({ jawOpen: 0.3, mouthWide: 1, mouthRound: 0, lipPress: 0, smile: 0 });
  ok(mouthGroup.scale.x > 1.15, `wide spreads ${mouthGroup.scale.x}`);
  head.setMouth({ jawOpen: 0.3, mouthWide: 0, mouthRound: 1, lipPress: 0, smile: 0 });
  ok(mouthGroup.position.z > 0.88, `round protrudes ${mouthGroup.position.z}`);
  ok(mouthGroup.scale.x < 1.0, `round narrows ${mouthGroup.scale.x}`);
  head.dispose();
});

test("setEyes: blink closes lids, look moves pupils", () => {
  const head = buildMayorHead();
  const { eyeL, ballL } = head.parts;
  head.setEyes({ blink: 0, lookX: 0, lookY: 0 });
  approx(eyeL.scale.y, 1, 1e-6, "open");
  head.setEyes({ blink: 1, lookX: 0, lookY: 0 });
  ok(eyeL.scale.y < 0.1, `blink ${eyeL.scale.y}`);
  head.setEyes({ blink: 0, lookX: 1, lookY: -0.5 });
  ok(ballL.rotation.y > 0.2, `look right ${ballL.rotation.y}`);
  head.dispose();
});

test("setBrows: raise lifts, furrow angles", () => {
  const head = buildMayorHead();
  const { browL, browR } = head.parts;
  const y0 = browL.position.y;
  head.setBrows({ raise: 1, furrow: 0 });
  ok(browL.position.y > y0 + 0.1, "raise lifts");
  head.setBrows({ raise: 0, furrow: 1 });
  ok(Math.abs(browL.rotation.z) > 0.3 && Math.abs(browR.rotation.z) > 0.3, "furrow angles");
  ok(browL.rotation.z > 0 && browR.rotation.z < 0, "furrow mirrors");
  head.dispose();
});

test("setPose applies yaw/pitch/roll/lift", () => {
  const head = buildMayorHead();
  const { headGroup } = head.parts;
  head.setPose({ yaw: 0.3, pitch: -0.2, roll: 0.1, lift: 0.05 });
  approx(headGroup.rotation.y, 0.3, 1e-6, "yaw");
  approx(headGroup.rotation.x, -0.2, 1e-6, "pitch");
  approx(headGroup.rotation.z, 0.1, 1e-6, "roll");
  approx(headGroup.position.y, 0.05, 1e-6, "lift");
  head.dispose();
});

test("two builds are identical (deterministic)", () => {
  const a = buildMayorHead().getStats();
  const b = buildMayorHead().getStats();
  ok(a.triangles === b.triangles && a.drawCalls === b.drawCalls, "deterministic");
});

test("dispose is idempotent", () => {
  const head = buildMayorHead();
  head.dispose();
  head.dispose();
  ok(true, "no throw");
});

await report("avatar-head");
