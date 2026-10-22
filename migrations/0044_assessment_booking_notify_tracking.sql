-- 0044_assessment_booking_notify_tracking.sql — notification outcome tracking for
-- assessment_bookings (BOOKING_NOTIFY_URL fallback: never silently drop a
-- buyer's booking request).
--
-- buyer_notified_at (existing, 0042) = buyer got notified via the webhook path.
-- mayor_notified_at  = Mayor's approve/decline email was accepted.
-- webhook_notified_at = BOOKING_NOTIFY_URL accepted the booking.requested event.
-- A booking with status='requested' AND buyer_notified_at IS NULL AND
-- webhook_notified_at IS NULL needs manual follow-up — surfaced by
-- GET /api/admin/center/bookings.

ALTER TABLE assessment_bookings ADD COLUMN mayor_notified_at TEXT;
ALTER TABLE assessment_bookings ADD COLUMN webhook_notified_at TEXT;
