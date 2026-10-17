// Walkthrough-video retention (Mayor's ruling, 2026-10-17): the video
// and its extracted audio under the `audit-videos/` R2 prefix are
// deleted once a report has been delivered for 90 days. The transcript
// and the report itself are KEPT with the audit record (report
// re-sends rely on them; only the media files expire).
//
// Called by the fulfillment sweep (PASS 3) on its existing schedule.
// Safety shape:
//   - only records with a delivered_at stamp are ever considered —
//     the stamp is written when a build first reaches 'ready', so
//     undelivered / in-flight audits are untouchable;
//   - only the exact keys stored on the record are deleted, and only
//     when they sit under the audit-videos/ prefix;
//   - a record is marked (keys nulled + video_deleted_at stamped)
//     only after every stored key's delete succeeded, so a partial
//     failure retries on the next sweep instead of orphaning a file;
//   - R2 delete is idempotent (a missing key is a no-op success).
export async function runVideoRetention(db, bucket, limit = 25) {
  const out = { records: 0, objects_deleted: 0 };
  if (!db || !bucket) return out;
  const due = await db.prepare(
    "SELECT id, video_r2_key, audio_r2_key FROM audit_business_reports " +
    "WHERE delivered_at IS NOT NULL " +
    "AND delivered_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days') " +
    "AND video_deleted_at IS NULL " +
    "AND (video_r2_key IS NOT NULL OR audio_r2_key IS NOT NULL) " +
    "ORDER BY delivered_at ASC LIMIT ?"
  ).bind(limit).all();
  for (const row of (due && due.results) || []) {
    let allGone = true;
    for (const key of [row.video_r2_key, row.audio_r2_key]) {
      if (!key) continue;
      if (!String(key).startsWith("audit-videos/")) { allGone = false; continue; }
      try {
        await bucket.delete(key);
        out.objects_deleted++;
      } catch (e) {
        allGone = false;
        console.error("video retention delete failed", key, e && e.message);
      }
    }
    if (allGone) {
      await db.prepare(
        "UPDATE audit_business_reports SET video_r2_key=NULL, audio_r2_key=NULL, " +
        "video_deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
      ).bind(row.id).run();
      out.records++;
    }
  }
  return out;
}
