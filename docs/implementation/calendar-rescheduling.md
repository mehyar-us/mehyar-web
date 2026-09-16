# Calendar rescheduling implementation checkpoint

The Google and Microsoft adapters now expose `rescheduleAppointment` separately from their existing general event update method. It validates an absolute start/end window and an approved event ETag, reads that exact event, and patches only its start and end. This avoids rebuilding attendee arrays, descriptions, online meeting information, titles, locations or recurrence definitions when only the time should change.

Provider contracts checked September 16, 2026:

- [Google event PATCH](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch): omitted fields remain unchanged; supplied arrays replace existing arrays. Notifications use `sendUpdates=all`.
- [Microsoft event update](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0): omitted properties retain their values or are recalculated; replacing an online meeting body can remove its meeting information. The new method never supplies the body.

Both adapters require write scopes before reading, explicit organizer evidence, the exact requested event identity and matching version. They reject cancelled events, all-day events and recurring events. Google also rejects locked and non-default event types. Missing required classification fields fail closed. These exclusions describe the currently implemented single timed-event operation; series and occurrence editing remain required future work under separately defined policies.

The PATCH retains the approved ETag as `If-Match` to detect changes after the preflight read. Microsoft writes and requests UTC timestamps to distinguish the two instances of a repeated daylight-saving hour. Successful receipts require the same event identity, a nonempty version, active event status and returned start/end instants matching the requested move. Lost responses, mismatched times and incomplete success responses are uncertain writes; they are never automatically retried. The request ID is a local receipt reference, not a claim of provider idempotency for PATCH.

Tests use synthetic provider responses, not live calendars. They cover exact time-only payloads, UTC/DST behavior, scope denial, malformed input, stale versions, attendee copies, cancelled/recurring/all-day events, missing metadata, a 412 after the read, and lost or unusable write responses.

Still required before customer availability: bind the operation to owner policies and a source snapshot in the durable approval workflow; verify customer and selected calendar; reserve destination resources; check availability without counting the appointment being moved as a new conflict; recheck authorization at dispatch; persist/reconcile uncertain moves; update reminder schedules; expose review/results in the PWA; test concurrent moves and external edits; obtain live provider acceptance. No new public route, execution permission or production flag is enabled by this checkpoint. Existing Stripe flows are unchanged.
