// functions/api/_shared/uploadLimits.js
//
// Server-side upload enforcement for the post-call funnel (D7a).
// Mayor's finalized numbers (his proposal, adopted verbatim):
//   photos: ≤10 files, ≤10MB each
//   videos: ≤3 files, ≤500MB each, ≤5 min each
//   total:  ≤1GB per upload batch
//
// This module is PURE (no I/O) so both crews can unit-test it. The audit-tab
// crew calls enforceUploadLimits() at the top of their
// functions/api/audit/business/upload.js BEFORE writing anything to R2 —
// see docs/assessment-call-handoff.md for the exact integration contract.
// Limits are ENFORCED (reject with 413), never suggested.
//
// Video duration: the caller passes durationSec measured client-side AND the
// server re-checks via parseMp4Duration (audit-tab crew already has
// parseMp4Duration in their auditBusinessShared.js). If durationSec is absent,
// the file is rejected — don't accept a video you can't measure.

export const UPLOAD_LIMITS = {
  photo: { maxFiles: 10, maxBytes: 10 * 1024 * 1024, mimePrefix: "image/" },
  video: { maxFiles: 3, maxBytes: 500 * 1024 * 1024, maxSeconds: 300, mimePrefix: "video/" },
  maxTotalBytes: 1024 * 1024 * 1024, // 1GB per batch
};

// files: [{ name, sizeBytes, mimeType, kind: "photo"|"video", durationSec? }]
// Returns { ok:true, counts, totalBytes } or { ok:false, error, detail }.
export function enforceUploadLimits(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return { ok: false, error: "empty_batch", detail: "No files in upload batch." };
  const counts = { photo: 0, video: 0 };
  let totalBytes = 0;
  for (const f of list) {
    const kind = f?.kind;
    const lim = UPLOAD_LIMITS[kind];
    if (!lim) {
      return { ok: false, error: "unknown_kind", detail: `File "${f?.name || "?"}": kind must be "photo" or "video".` };
    }
    counts[kind]++;
    const size = Number(f.sizeBytes);
    if (!Number.isFinite(size) || size <= 0) {
      return { ok: false, error: "bad_size", detail: `File "${f.name}": unreadable size.` };
    }
    if (size > lim.maxBytes) {
      return { ok: false, error: "file_too_large",
        detail: `File "${f.name}" is ${Math.round(size / 1048576)}MB — ${kind}s are capped at ${Math.round(lim.maxBytes / 1048576)}MB each.` };
    }
    if (typeof f.mimeType === "string" && f.mimeType && !f.mimeType.toLowerCase().startsWith(lim.mimePrefix)) {
      return { ok: false, error: "bad_mime",
        detail: `File "${f.name}": expected ${lim.mimePrefix}*, got "${f.mimeType}".` };
    }
    if (kind === "video") {
      const dur = Number(f.durationSec);
      if (!Number.isFinite(dur) || dur <= 0) {
        return { ok: false, error: "duration_unmeasured",
          detail: `Video "${f.name}": duration could not be measured — rejected.` };
      }
      if (dur > lim.maxSeconds) {
        return { ok: false, error: "video_too_long",
          detail: `Video "${f.name}" is ${Math.round(dur)}s — videos are capped at ${lim.maxSeconds}s (5 min) each.` };
      }
    }
    totalBytes += size;
  }
  for (const kind of ["photo", "video"]) {
    if (counts[kind] > UPLOAD_LIMITS[kind].maxFiles) {
      return { ok: false, error: "too_many_files",
        detail: `Too many ${kind}s: ${counts[kind]} — capped at ${UPLOAD_LIMITS[kind].maxFiles}.` };
    }
  }
  if (totalBytes > UPLOAD_LIMITS.maxTotalBytes) {
    return { ok: false, error: "batch_too_large",
      detail: `Batch is ${Math.round(totalBytes / 1073741824 * 10) / 10}GB — capped at 1GB total.` };
  }
  return { ok: true, counts, totalBytes };
}

// Human-readable summary of the limits (for the upload UI copy + API errors).
export function limitsDescription() {
  const L = UPLOAD_LIMITS;
  return `Up to ${L.photo.maxFiles} photos (${L.photo.maxBytes / 1048576}MB each), ` +
    `up to ${L.video.maxFiles} videos (${L.video.maxBytes / 1048576}MB / ${L.video.maxSeconds / 60} min each), ` +
    `${L.maxTotalBytes / 1073741824}GB total per upload.`;
}
