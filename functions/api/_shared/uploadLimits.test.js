// Unit tests for uploadLimits.js (D7a — enforced post-call funnel limits).
// Run: node functions/api/_shared/uploadLimits.test.js
// Pure function, no I/O. Exit non-zero on failure.

import { enforceUploadLimits, UPLOAD_LIMITS, limitsDescription } from "./uploadLimits.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}

const MB = 1048576;
const photo = (mb, name = "p.jpg") => ({ name, sizeBytes: mb * MB, mimeType: "image/jpeg", kind: "photo" });
const video = (mb, sec, name = "v.mp4") => ({ name, sizeBytes: mb * MB, mimeType: "video/mp4", kind: "video", durationSec: sec });

// ── happy paths / boundaries ────────────────────────────────────────────────
{
  const r = enforceUploadLimits([photo(10), video(500, 300)]);
  ok(r.ok, "exact boundary values pass (10MB photo, 500MB/300s video)");
}
{
  const files = Array.from({ length: 10 }, (_, i) => photo(5, `p${i}.jpg`));
  files.push(video(100, 120), video(100, 200));
  const r = enforceUploadLimits(files);
  ok(r.ok && r.counts.photo === 10 && r.counts.video === 2, "max counts pass");
}
{
  const r = enforceUploadLimits([]);
  ok(!r.ok && r.error === "empty_batch", "empty batch rejected");
}

// ── photo limits ────────────────────────────────────────────────────────────
{
  const r = enforceUploadLimits([photo(10.5)]);
  ok(!r.ok && r.error === "file_too_large", "photo >10MB rejected");
}
{
  const r = enforceUploadLimits(Array.from({ length: 11 }, (_, i) => photo(1, `p${i}.jpg`)));
  ok(!r.ok && r.error === "too_many_files", "11th photo rejected");
}
{
  const r = enforceUploadLimits([{ name: "x.pdf", sizeBytes: 1000, mimeType: "application/pdf", kind: "photo" }]);
  ok(!r.ok && r.error === "bad_mime", "non-image mime as photo rejected");
}

// ── video limits ────────────────────────────────────────────────────────────
{
  const r = enforceUploadLimits([video(501, 100)]);
  ok(!r.ok && r.error === "file_too_large", "video >500MB rejected");
}
{
  const r = enforceUploadLimits([video(100, 301)]);
  ok(!r.ok && r.error === "video_too_long", "video >5min rejected");
}
{
  const r = enforceUploadLimits([{ name: "v.mp4", sizeBytes: 100 * MB, mimeType: "video/mp4", kind: "video" }]);
  ok(!r.ok && r.error === "duration_unmeasured", "video with unmeasured duration rejected (fail closed)");
}
{
  const r = enforceUploadLimits([video(10, 60), video(10, 60), video(10, 60), video(10, 60)]);
  ok(!r.ok && r.error === "too_many_files", "4th video rejected");
}

// ── batch total ─────────────────────────────────────────────────────────────
{
  // 3 videos at 400MB = 1.2GB > 1GB cap, each individually legal
  const r = enforceUploadLimits([video(400, 100, "a.mp4"), video(400, 100, "b.mp4"), video(400, 100, "c.mp4")]);
  ok(!r.ok && r.error === "batch_too_large", "batch >1GB rejected even when each file is legal");
}

// ── misc ────────────────────────────────────────────────────────────────────
{
  const r = enforceUploadLimits([{ name: "x", sizeBytes: 100, mimeType: "image/png", kind: "audio" }]);
  ok(!r.ok && r.error === "unknown_kind", "unknown kind rejected");
}
{
  const r = enforceUploadLimits("not-an-array");
  ok(!r.ok, "non-array input rejected");
}
{
  const d = limitsDescription();
  ok(d.includes("10 photos") && d.includes("3 videos") && d.includes("1GB"), "limits description names the numbers");
}
ok(UPLOAD_LIMITS.video.maxSeconds === 300 && UPLOAD_LIMITS.maxTotalBytes === 1073741824, "finalized numbers match Mayor's spec");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
