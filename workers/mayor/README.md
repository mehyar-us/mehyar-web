# The Mayor

Isolated Cloudflare Worker, D1 and voice Durable Objects. This implementation is
in progress; passing foundation tests does not establish working phone scheduling.
Scope and release evidence: ../../docs/mayor/release-plan.md.
Business workspace, service knowledge and pilot usage policy: ../../docs/mayor/business-assistant.md.

Conversation inference uses Cloudflare-hosted Qwen3-30B-A3B-FP8 with thinking
disabled, selected after remote read-only and tool-call checks. The current
text-only timing evidence is in ../../docs/mayor/evidence/; it is not acoustic
voice latency or a production percentile benchmark. The synthetic comparison
probe runs with `npx wrangler dev --remote --config
tests/remote/wrangler.conversation-probe.jsonc --port 8795`; request `/?qwen=1`,
`/confirmation`, and `/availability`. It has no database or provider credentials.

## Development

Node 24. `npm ci`, `npm run db:local`, `npm run build`, then `npm run dev`.
For a Vite development frontend run `npx vite --host 127.0.0.1` in another terminal.
Use http://127.0.0.1:5175 consistently for OAuth and cookies. Workers AI bindings
use real Cloudflare inference and require configured Cloudflare access.

Ignored `.dev.vars` accepts BETTER_AUTH_SECRET (random >=32 characters),
TOKEN_ENCRYPTION_KEY (base64 random 32 bytes), GOOGLE_CLIENT_ID/SECRET,
MICROSOFT_CLIENT_ID/SECRET. Production values belong in Worker secrets only.
Register `/api/auth/callback/google` and `/api/auth/callback/microsoft` on the
configured APP_ORIGIN. Calendar permission enablement uses
GOOGLE_ENABLED_CAPABILITIES=calendar_manage and the Microsoft equivalent, after
provider setup. Sign-in, Calendar and Mayor attention emails need no mailbox
permissions. The gated Gmail reader requires separate consent and rollout review.

## Checks and deployment

`npm run check`; `npx tsc -p web/tsconfig.json`; `npm test`;
`npm run test:integration`; `npm run build`.

`pwsh -File scripts/deploy.ps1` validates protected shared code, builds, migrates
the dedicated database, deploys only mehyar-mayor, and checks the custom domain.
Bootstrap production auth/encryption secrets separately before accepting sign-ins.
Google/Microsoft client secrets cannot be recovered from Cloudflare secret lists.

## Recovery

Run `./scripts/restore-drill.ps1` with Node 24+ and the existing CF_ACCOUNT_ID,
CF_API_EMAIL and CF_API_KEY environment variables. It exports production into a
Windows directory restricted to the current user under LOCALAPPDATA/TheMayor/recovery,
restores into a newly created isolated D1 database, exports that copy, and compares
the complete schema and row contents using SQLite integrity/foreign-key checks and
hashes. It deletes only its newly created remote database after checking its identity.
Private exports/logs remain outside Git; manage their retention as sensitive backups.
`-SourceExport <path>` drills an existing trusted SQL snapshot without reading production.
If cleanup fails, use temporary-resource.json in the private run directory to identify
the leftover database. Never delete the production ID recorded alongside it.

Record deployment version IDs with each release. Use
`./scripts/rollback.ps1 -VersionId <known-good-version> -ExpectedCurrentVersion <live-version>`
to restore a previously fully deployed version from recent history. `-PlanOnly`
checks the proposed switch without changing production. The script rejects a stale
current version, verifies the result, and runs public smoke checks. Run during an
exclusive deployment window; the provider switch is not a cross-client compare-and-swap.
Review D1/DO schema compatibility first: Worker rollback does not undo data migrations.
Migrations must remain additive/backward compatible. A failed post-rollback smoke test
requires investigation; the script does not guess another version automatically.

Remote D1 restore comparison and an actual application version rollback drill passed
on 2026-09-22; see the release ledger for scope. The D1 drill on 2026-09-26
restored the production snapshot after migration 0027 into a new isolated database:
all 32 tables and 94 rows matched, including schema/content hashes, integrity and foreign keys.
The temporary database was deleted and its absence verified with HTTP 404. This
verifies that snapshot, not ongoing backup retention or recovery from every failure.
The production conversation recovery and caller registration tables were empty.
A synthetic registration snapshot restored all 31 application tables and nine rows,
including linked call, verification, contact, permission and registration records.
Generate this fixture with `node tests/recovery/registration-snapshot.mjs <new.sql>`
and pass it to the restore script's `-SourceExport` option. It reads no production data.
The comparison loads the complete dump before checking foreign keys, because D1
exports may recreate referenced unique indexes after table data; invalid references
and changed contents still fail. Both temporary remote databases were deleted.
An earlier separate synthetic-only
snapshot restored all 29 application tables and three fixture rows, including a
nonempty conversation copy with Unicode, quotes and line breaks. Both comparisons
passed and both temporary remote databases were deleted with absence verified.
D1 exports taken after migration 0025 include the bounded conversation recovery
copies described below, but not full Durable Object storage or Worker secrets.
Restoring encrypted credentials requires the original encryption key; without it,
reconnect providers and invalidate old sessions. Complete secret escrow, full DO
recovery, retention scheduling and full disaster recovery remain outstanding.

### Conversation recovery copies

After an authenticated app conversation saves a message, a serialized background
write copies its latest 50 complete user/assistant messages (at most 64,000 text
characters) to D1, scoped to the business and user. Audio is not copied. Existing
conversations gain a recovery copy after their next message; old snapshots are
replaced, not accumulated. D1 snapshot exports then include these copies.

An authenticated connection with empty conversation storage restores that user's
validated copy. Nonempty local history is preserved. Proposal state and confirmation
readiness are never restored: a historical “say yes” requires a fresh proposal.
Current session, membership and tenant permissions gate recovery and copy writes.
Removing a membership deletes its copy through the foreign key; revocation denies
access without deleting retained data. This is not a complete retention policy.

The background write does not delay audio, so abrupt failures can lose recent
messages that have not reached D1. Monitor the fixed log event
`mayor_conversation_recovery_failed`; it contains no transcript. Writes use revision
checks and do not blindly overwrite a newer copy after a conflict. Inspect such a
failure before resetting storage. A failed or malformed recovery read closes the
connection; investigate the database rather than deleting either copy.

Run `./scripts/run-voice-memory-probe.ps1 -Scenario recovery -TextOnly` for an
isolated Cloudflare test of exact restoration into fresh Durable Objects, rejected
stale confirmation, background copy of the next turn, and a second restoration.
This does not test total account loss, full historical retention, or acoustic latency.

## Scheduling release status

Confirmed structured policies and owner/manager booking proposals are implemented.
The next explicit voice/text confirmation validates the live calendar and dispatches
once. Rules are visible in Account. Google identity OAuth is configured and real sign-in has been verified. Calendar
consent remains pending, Microsoft credentials are not configured, and no real
appointment or call has been verified.

Jobs marked `running` or `uncertain` retain the reserved time. Do not manually retry
or remove that reservation without inspecting provider state: an event may exist.
Ask The Mayor to check an uncertain booking. Recovery reads the original Google
event ID or searches Microsoft event pages for the original transaction ID. It
never sends another create request. Matching times, title, attendees, active status
and provider identity are required before the stored request becomes confirmed.
Missing/changed events remain uncertain for human review. Background reconciliation
and recovery of uncertain changes are implemented as described below; live provider
recovery and external-edit synchronization remain unverified or unfinished.
Signed-in owners/managers can now ask The Mayor to list recorded appointments,
reschedule or cancel one, then confirm the read-back in a separate turn. The
executor verifies current event contents/version, policy and authorization.
Only one change can run per appointment. Rescheduling retains the old/new time
reservation until confirmed; an uncertain change requires human review and is
never automatically retried. Cancellation releases the reservation only after
the provider confirms deletion. Caller-based access is not enabled yet.
All fixture calendar requests run locally; they are not production readiness evidence.

## Phone account connection

Account now supports Twilio restricted API keys. Create a key with incoming phone
number list/fetch permissions, then supply Account SID, Key SID and Key Secret in
the secure Account form. Never put credentials into the conversation. The server
verifies the directory and encrypts credentials with tenant/account/user binding.
Choose an owned voice-capable number by conversation or Account. This saves a
selection only: routing is unchanged and `callsReady` remains false. Disconnect
removes stored credentials locally; revoke the key in Twilio separately.

Twilio signature verification and the designated media pilot are implemented below.
Real provider credentials, call setup and test calls remain outstanding; Telnyx
account connection is implemented, while its inbound calling is not. Newly created provider accounts use the same
connection flow after signup/verification and obtaining a number. No purchase is
performed by this release.

Recovery for uncertain reschedules checks exact intended provider contents without
another write. Cancellation recovery requires a positive cancelled event record;
404 alone remains uncertain. Provider deletion responses already confirmed at the
time of the original request do not need this recovery step.

## Designated Twilio call pilot

The server-side adapter is implemented behind `PHONE_TEST_ENABLED=true`, which is
NOT enabled in production. The Account connection form has optional Auth Token and
designated caller fields. These are encrypted with the API key. The restricted key
needs incoming-number list/fetch and call-read permissions. The Auth Token verifies
Twilio webhook signatures; it is not used for broad API writes.

After the pilot is deliberately enabled and a selected owned number is configured,
the Twilio incoming voice webhook is `POST /api/phone/twilio/incoming/<tenant-id>`.
Do not switch a customer number's routing before a designated test succeeds.
The webhook checks its signature, account, selected destination, allowlisted caller
and live provider call state. It returns an AI/test disclosure and a signed,
one-use, short-lived media endpoint. Owner chat/session headers are never forwarded
to the per-call agent. Calls use PCM16 at 16 kHz and enforce time/turn limits.

The current pilot demonstrates conversation only. Customer identity verification,
calendar access from calls, callback/transfer tools and Telnyx server-side audio
remain to be implemented. Do not represent this as customer-ready calling.

## Avatar source

`web/public/mayor-avatar.png` was generated with the built-in image tool. Prompt:
Original warm, confident, approachable fictional AI business assistant, stylized
3D head-and-shoulders portrait, deep navy jacket, expressive eyes, subtle smile,
soft blue background, square composition readable at 48px; no text, crown, flag,
badge, or UI. The image is an assistant illustration, not a customer/person claim.

### Telnyx setup

Account now supports a secure Telnyx API-key form alongside Twilio. Use a key with the minimum permissions needed to read phone numbers and their voice settings; never enter keys in chat. Account verifies number-list access, permits selecting an active owned number after checking its voice settings, and supports disconnect. A newly created provider account with no numbers can connect, then obtain a number through the provider and refresh. Selection does not change routing or enable calls. Disconnect clears the local encrypted key; revoke the key in the provider portal separately when appropriate. Telnyx inbound calling and real account verification remain pending.

### Website onboarding

Tell The Mayor your website address or use the confirmed business website. It reads one public HTTPS page, proposes facts with supporting excerpts, and asks for confirmation before saving them. Account shows the source of confirmed website facts. Correct details aloud to replace them. Businesses without a site can provide all details conversationally. JavaScript is not executed; a JavaScript-rendered site may supply only its page metadata. If the page is inaccessible, too large, or lacks readable content, use another public About/Services page or describe the business. Do not provide private/login URLs or sensitive data. Website fetches use Cloudflare public global fetch only; never replace that transport with a private network binding.

### Spoken confirmations

The Mayor reads back proposed changes from server-held values and accepts a short explicit confirmation on the following turn. Interrupting, ending the call, or a response/audio failure invalidates the pending proposal; review it again before confirming. Large sets of changes must be proposed in smaller conversational steps. Actual audible playback and mobile interruption behavior remain unverified. The app includes a Workers AI stream compatibility adapter because the current provider otherwise consumes duplicate native/compatible deltas from the same event.

### Automatic appointment recovery

A Cloudflare schedule runs every five minutes. It considers bookings and appointment changes that have remained running or uncertain for at least three minutes. Each run takes at most eight requests, uses a durable lease to tolerate overlapping deliveries, and only observes the original provider request. It never repeats a calendar write or releases an uncertain reservation. Provider observation has a 45-second network deadline per request.

Checks use the original operator's current business permissions and calendar authorization. Inconclusive checks back off (5, 10, 20, 40, then up to 60 minutes); after six attempts the request is marked for human review. Ask The Mayor to list booking requests or appointments to see recovery status. A person must inspect the original provider event before deciding what to do; do not create a replacement just because recovery is uncertain. Manual provider-confirmed resolution hides the stale review marker from booking responses.

Cloudflare logs contain appointment_recovery aggregate counts or appointment_recovery_failed, not customer/provider payloads. The application audit records checks per request. The registered production schedule is verified; real scheduled execution and live provider recovery still require observation with designated accounts. A rollback does not inherently remove the Cloudflare schedule, so review trigger configuration when rolling back across this feature.

### Callback requests during the Twilio pilot

On an enabled, designated test call, ask for scheduling help or a person. The Mayor can propose a callback using the number calling the business. A separate explicit yes after its readback saves one request per call, with only a general scheduling/human-assistance reason. It does not place a call, transfer the caller, notify staff externally, promise a response time, or change an appointment. Do not provide clinical details. Caller ID is a return contact, not identity verification; staff must verify the person before discussing appointments.

An owner or manager can ask in app chat, "List pending callbacks." Requests show oldest first, up to 50; handle those to retrieve the next group if more remain. After contacting the person, say which request you handled and confirm the readback to mark it handled. The request and handling actions are audited without phone numbers in audit payloads. Pending requests remain available after disconnecting the phone provider. There is no external alert delivery yet, so an operator must check chat; this is not a live monitored call center.

The callback feature remains behind PHONE_TEST_ENABLED with the existing owned-number/designated-caller restrictions. The production gate remains disabled until a provider and real call test are available. Migration 0018 adds callback records and the admitted caller number; older call rows have no number and cannot create callbacks. Rolling back application code leaves the additive tables intact. Synthetic workerd/model-stream tests do not establish actual phone latency, audio confirmation, caller identity, or customer scheduling readiness.

### Finding appointment openings

After confirming scheduling rules and selecting a calendar, an owner or manager can ask The Mayor for openings for an appointment type within a date/time range. Specify a staff member when staff are configured. The assistant should ask about ambiguous dates or time zones. Each search spans at most seven days and returns up to ten suggestions (five by default), with absolute timestamps and business-local labels including UTC offsets for repeated daylight-saving hours.

Starts follow a 15-minute grid anchored to the requested window start; an empty result does not rule out an off-grid opening. Search applies the same policy validator as booking, including duration, buffers, hours, closures, staff and notice. It reads complete provider availability and combines it with active app reservations, including uncertain operations. Incomplete/malformed responses, changed permissions/policy/calendar selection, or excessive result sizes fail closed. Searches have a fifteen-second total provider deadline. No provider event titles or customer identities are returned by the tool.

Suggested times are never holds. Select one and confirm a booking for a fresh live check. Independent edits in a provider calendar can still race between reads and writes; real-provider concurrency and full phone scheduling remain release requirements. The isolated remote probe at tests/remote/wrangler.availability-probe.jsonc validates model/tool arguments against fixed synthetic data only, without a database or provider credentials.

### Revoking access

Only an active tenant and an active, unexpired membership authorize business access. Paused, suspended, offboarding, deleted and unknown tenant states fail closed. Existing app voice connections recheck the database session, tenant and chat role at turn/tool/speech boundaries, plus every fifteen seconds while connected. Each background check has a five-second timeout and does not overlap another check. Failure ends the call and closes the socket; runtime scheduling and already-delivered audio mean this is not an instantaneous revocation guarantee.

The designated phone pilot also checks its call expiry, connection revision and originating operator access while idle. Closing a connection cancels its watcher. Authenticated voice checks combine session and membership validation in one database read. This adds periodic reads while a voice socket is open. Browser reconnection may still require signing in again or restoring workspace access. Real cross-device logout and microphone-stop timing remain unverified until Google login and designated call accounts are connected.

### Collecting voice timing evidence

Signed-in chat-capable members can open Account → Optional voice timing check → Start a new check, return to Chat, and speak normally. Stop the check and download the JSON report when finished. Collection is off by default and stays only in page memory, capped at the latest 200 turns. Reload/Clear removes it. Download is a user action; there is no automatic telemetry upload, localStorage or IndexedDB persistence. Only allowlisted source/outcome enums and finite bounded durations are exported, not transcripts, audio, user/tenant/turn IDs or credentials.

Speech and text samples are summarized separately. Failure/aborted/skipped outcomes remain counted; nearest-rank p50/p95 timings use only completed retained turns with the respective timing present. Missing timing is null, not zero. The report counts discarded old samples and rejected records, so use a fresh check for each device/network profile and retain at least 30 speech turns per required profile. Record actual device, region, network conditions and any applied shaping separately; the app does not apply network shaping.

These SDK measurements share a server clock and overlap. Do not add them or call them acoustic latency. In particular, finalInputToFirstAudioMs starts after speech finalization and ends when the server sends audio; it omits end-of-speech detection, network delivery and browser playback. Actual end-of-speech-to-first-audible-sample and interruption-to-stop acceptance still require synchronized microphone/playback observation on designated real devices. Server metrics help locate delays but cannot satisfy those acceptance targets alone.

### Customer contacts

Owners and managers can ask The Mayor to find a customer by name, email or international phone number, then add or correct contact information by conversation. A customer needs a name and at least one email or phone number. The server reads back the complete proposed contact, and a separate yes saves it. Omitted update fields are preserved; explicitly removing a field requires confirming the resulting record. Search returns at most ten matches and indicates when the operator should narrow the query. Multiple people may share a family or business number; the assistant must ask which record is intended.

Customer records are isolated per business and protected by revision checks and atomic permission checks. Exact duplicates are rejected, and audit records identify the operation and record without repeating contact details. There are no clinical-note fields. These are owner-confirmed contact records, not verified identities. Creating or correcting a record sends no email/SMS and grants no caller appointment access. Live caller verification remains untested; matching contact data alone never grants authority. The separate SMS and customer-permission flow below is required for phone appointment-time lookup.

### Linking customers to appointments

Search for the customer, resolve any ambiguous matches, then ask The Mayor to book for that customer. The booking readback includes the selected customer contact as well as the explicit calendar invitees. Linking does not automatically add an attendee, send the customer's phone number to the provider, or verify a caller. The customer link is internal and preserved through rescheduling, cancellation and provider reconciliation. Existing unlinked appointments remain supported and are not automatically matched by name or email.

Ask for appointments for a specific customer to filter the list. The authenticated appointments API also accepts a customerId query parameter and checks the record belongs to the current business. Composite database foreign keys prevent a cross-business link. If the contact record changes after a booking or change proposal, confirmation fails before dispatch and requires a fresh readback. Provider reads are followed by another contact revision check. A contact correction after a completed booking does not prevent later changes once the operator reviews the current record. Customer-scoped phone access additionally requires the verification and explicit permissions described below; linking a contact never grants that access by itself.

## Remote spoken onboarding checks

Run `./scripts/run-voice-memory-probe.ps1 -Scenario name` or `-Scenario hours`.
Each run creates its own temporary Worker/D1, uses actual MayorVoice with synthetic
speech and a seeded authenticated owner, checks proposal/confirmation/correction/
reconnect/recall against persisted records, and deletes the temporary resources.
The hours scenario stores descriptive business hours; it does not configure a
complete structured scheduling policy or exercise a real calendar.
Evidence is written under docs/mayor/evidence. Preserve prior failed evidence before
rerunning when investigating a defect. These checks do not measure acoustic end of
speech, browser playback, real mobile networks, interruption latency or phone calls.

Conversational output now comes from executed proposal/reply tools. Unstructured
model prose is discarded. A single read-only reply fallback can use confirmed
memory and actual tool receipts; it has no mutation tools. Separate confirmation
handlers still own business writes. This reduces the reproduced unsupported-save
failure; it does not prove that all generated replies are factually correct.

### Resumable scheduling setup

Start with "Let's set up appointment scheduling" and give the details you know.
The Mayor can save partial time zone, hours, appointment types, staff and notice
rules after a separate confirmation. Missing buffers or staff settings remain
unknown; they do not silently become zero or no staff. Familiar city names are
translated into time-zone identifiers by the assistant; clarify ambiguous places.

Ask to continue scheduling setup after reconnecting. Account shows saved progress
under "Scheduling setup · not active" and the next question. Once all required
fields are collected, ask to review and activate the booking rules and confirm the
full readback. A complete setup alone does not activate scheduling or book anything.
After activation, changes use the existing full-policy review flow. Setup history
is retained in its own memory field and hidden from the active-policy view.

Lists are replaced in full when confirmed; review all appointment types or staff
in a list readback. Concurrent or stale confirmations are rejected. An interrupted
readback cannot save progress. No new migration is needed for this memory field.
The remote probe accepts `-Scenario setup -TextOnly` for the text fallback and
`-Scenario setup` for synthetic speech. A passing text run does not verify speech.

Scheduling tools accept weekday names and explicit local clock times (for example,
Monday, 9 AM to 5 PM); the server converts these to day indexes and minutes.
Ambiguous AM/PM values require clarification. Explicit no-staff/no-closure answers
are distinct from unanswered questions. Repeating saved details does not create
another write. Full setup review reads confirmed storage directly and rejects
activation if that setup changes before confirmation. Active policy edits preserve
omitted fields, while supplied lists still replace their whole list.

Use `-Scenario setup-complete` to test synthetic spoken collection, separate
confirmations, reconnect, complete policy review, activation and saved-rule recall.
Add `-TextOnly` for the text transport. These isolated fixtures never activate
rules in the production customer's workspace.

### Optional Twilio number verification

Under Account → Twilio connection → Optional designated call test, an owner can
supply a Verify Service SID alongside the existing call-test credentials. The
service must belong to that Twilio account. The API key needs Verify service read,
verification create and verification check permissions in addition to the existing
number/call read permissions. Creating a provider service, paying for it, buying
numbers and enabling/rerouting live calls remain separate operator actions.

When configured and phone testing is enabled, an incoming designated caller hears
an AI disclosure and can press 1 to request a verification SMS or 2 to decline.
Codes are entered on the keypad followed by # before the AI media stream starts;
never speak codes to the assistant. Digit collection is DTMF-only. No OTP is stored
in D1, conversation history or application logs. Provider processing/retention is
separate. SMS consent does not grant appointment access.

Verification is bound to the tenant, live call, provider connection revision,
server-issued step nonce and exact provider verification SID. A call can request
one SMS, with a three-per-number/per-business fixed-hour budget across calls; code
checks are limited to five. Challenge lifetime is five minutes. Duplicate/uncertain
sends are not automatically retried. Failed or declined verification allows the
existing callback-only assistant, with no appointment disclosure. Number possession
alone is not proof of a particular customer, especially for shared phone numbers;
the separate customer permission below is required for appointment-time lookup.
Phone booking and changes require the separate permissions described below. First-time caller onboarding remains unfinished. Telnyx verification and inbound parity remain unfinished.

Reference: [Twilio Verify](https://www.twilio.com/docs/verify/api),
[verification checks](https://www.twilio.com/docs/verify/api/verification-check),
[DTMF Gather](https://www.twilio.com/docs/voice/twiml/gather).

### Customer permission for phone appointment-time lookup

In owner/manager chat, search for a customer, then explicitly ask to allow phone
appointment-time access for that customer. The Mayor reads back the name and
registered number and asks you to confirm that the number belongs to that customer
and is not shared. Say yes separately to enable. Ordinary contact creation never
grants this permission. Ask to disable that customer's phone access to revoke it.

The permission is pinned to the reviewed contact revision. Any contact edit,
revoked grantor membership, inactive business, expired verification, changed phone
connection or duplicate customer with that phone number denies access. Shared
numbers require human assistance. This is number-possession authentication to a
business-approved contact, not high-assurance personal identity verification or a
healthcare compliance certification.

On a designated verified call, ask "When is my appointment?" The server resolves
the caller internally, reads up to five upcoming linked appointments from the live
Google/Microsoft provider and compares them with the recorded booking. It reads
back times and the business time zone only; titles, invitees and contact details
are never put into the phone model's context. Unlinked/external appointments are
not automatically associated with a caller. Pending changes, provider discrepancies
or revoked permissions stop the readback and offer a callback. Permission is checked
again before speech; it remains bound to this call, not a reusable owner session.
New bookings and moving/cancelling require the additional permissions below. These paths have mocked provider integration coverage; actual SMS/keypad/calendar call testing is pending.

### Phone rescheduling and cancellation

An owner/manager can explicitly ask to allow phone rescheduling and cancellation
for a customer, then confirm the expanded permission readback. Existing lookup-only
permissions stay lookup-only; migration 0023 defaults change permission to off.
Disabling phone access or editing the contact invalidates pending caller actions.

The verified caller first asks for their appointment times, identifies one of those
appointments, and requests a cancellation or an unambiguous new date/time. The
server reads back the exact old/new times without titles or invitees. A separate
"yes" is required. Interrupted, unread or expired proposals cannot execute.

Each proposed change is persisted with its originating call and customer permission
snapshot. The shared calendar executor checks that binding again immediately before
the provider write, even if called from a different application path. A proposal
cannot transfer to another call. Existing ETag, live availability, cancellation,
notice, duration, buffer and conflict checks remain in force. Audit results identify
the phone call, not the business operator whose delegated permission was used.

An uncertain provider result is not announced as success and is never automatically
replayed. Existing read-only reconciliation can establish the final provider state;
the business can inspect recovery status. Live phone tests remain disabled until a
provider account, designated numbers and real calendar/call verification are ready.
Current automated evidence uses synthetic model streams and mocked provider HTTP;
it does not prove actual speech recognition, audio confirmation or physical calls.
New bookings and optional first-time caller registration are described below.

### New phone bookings for approved customers

An owner/manager must explicitly allow new phone bookings for the customer and
confirm the permission readback. Migration 0024 defaults this permission to off;
lookup/change permission alone does not authorize creating appointments. Omitted
permission flags preserve existing grants only for the same unchanged contact;
a contact correction requires fresh review and does not inherit those flags.

The caller verifies their registered number, asks about available appointment types
and staff if needed, then supplies an unambiguous date range. The Mayor offers up
to three live options using the business's duration, hours, buffers and notice rules.
Those options are not reservations. Choose an option, review the server's exact
appointment details and say yes separately. Offers and proposals expire after two
minutes. The provider calendar and app reservations are checked again before create.

The call cannot supply an arbitrary customer ID, event title, invitee or clinical
note. Bookings use a generic calendar title, no email invitees and the internal
verified customer link. Persisted call/permission binding is checked by the shared
booking executor immediately before dispatch. Audit events identify the call.
Unknown provider results keep reservations and use read-only reconciliation; they
are never automatically submitted again.

Existing contacts require the explicit grants above. First-time callers may use
the opt-in registration flow below; unapproved existing contacts and shared-number
callers use the callback path. All phone functions remain behind the
production test gate. Automated booking tests use simulated providers/model streams;
real SMS, calls, calendar operations and acoustic latency are still unverified.

Selecting a Twilio number advances the connection revision, including when the
same number is selected again. Existing call verification and pending call-bound
actions must then be re-established in a new call. A delayed selection cannot
overwrite a selection saved after its provider check began. Number selection
does not modify provider routing.

### First-time caller registration

Registration defaults off. An owner/manager can tell The Mayor to allow new callers
to register by phone, review the permission readback, and confirm in a separate
turn. This setting does not connect a provider, enable routing or turn on the
production phone test gate. It grants registration and access only to appointments
linked to the newly created contact, with separate confirmation of each action.

The caller must first verify their calling number by SMS. After agreeing to register,
they supply their name and separately confirm the contact readback, including that
the verified number is their own and not shared. No email, alternate number,
existing contact identifier or clinical information is accepted by the registration
tool. Number possession is not proof of personal identity; this is not sufficient
authorization for disclosing sensitive patient or financial records.

An existing contact with that number prevents self-registration, without revealing
whether a matching record exists. Atomic database checks prevent duplicate contacts
and recheck the live call, verification, connection, business policy and grantor.
Interrupted, unread, expired or superseded proposals cannot be confirmed. Saving
the contact does not book an appointment; the normal booking readback follows.

Disabling or changing the registration policy invalidates access derived from its
previous revision, including pending operations. Re-enabling does not silently
restore those grants. An operator can separately review and grant an individual
customer access; that explicit grant then follows the ordinary customer access
rules independently of the registration setting. Contact changes and shared-number
ambiguity still invalidate access. Audit attribution records the originating call.

Automated evidence covers registration followed by booking, rescheduling and
cancellation through both calendar adapters using simulated HTTP/model streams.
Real first-time caller SMS, speech and provider behavior still require acceptance
testing on designated accounts and numbers.

## Attention notifications and recurring account checks

Owners/managers can ask The Mayor to check profile completeness and live access to
their selected calendar daily or on weekdays. A separate completed readback and
confirmation stores the schedule. Account shows next/last attempt and Pause.
The five-minute cron uses durable leases, bounded retries, and revision checks.
It does not monitor Gmail, reviews, or calendar-event content.

Email alerts default off. Enable/disable them in Account or ask The Mayor and
confirm its readback. Conversational proposals expire after two minutes and are
invalidated by interruption, account/email changes, or newer preference edits.
The destination is the verified sign-in email; custom recipients are unsupported.
Changing a recurring schedule does not change email preferences.

Production uses the native `MAYOR_EMAIL` binding and `MAYOR_EMAIL_FROM` restricted
to `mayor@mehyar.us`. The sender domain must be enabled in Cloudflare Email Service.
This is a recipient-restricted pilot: verify recipient eligibility before customer
rollout. Google sign-in verification does not establish Cloudflare destination
eligibility. No Gmail-read permission is needed to receive these notifications.

The cron groups unread open issues and rechecks membership, verified recipient,
and opt-in before sending. It sends at most one accepted/uncertain notification
per business/user per 24 hours. Resolving/reading alerts or opting out cancels
pending messages; already-dispatched mail cannot be recalled. Email content is a
generic link to the authenticated inbox, without business details.

Delivery states in Account and `mayor_email_outbox`:
- `pending` / `sending`: queued or being submitted.
- `accepted`: provider returned a receipt; inbox delivery is not confirmed.
- `uncertain`: no reliable receipt; automatic replay is prohibited.
- `failed`: explicit rejection or preflight failure. Only explicit rate/day-limit
  rejection retries, at five-minute intervals up to three attempts.
- `cancelled`: pending message is no longer eligible.

Investigate an uncertain message with Cloudflare email logs before taking any
manual action; do not reset it to pending or infer non-delivery. Outbox rows have
recipient addresses/provider IDs and are private. Aggregate diagnostics should
omit these and conversation data. Preference changes have audit records.
Current external gaps: real mail acceptance/inbox delivery, general customer
recipient eligibility, and Google offline reconnection remain unverified.

## Gmail rollout gate

Gmail is a separate `gmail_read` capability using the Gmail read-only scope. It is
not part of identity-only Google sign-in or Mayor notification delivery. Production
`GOOGLE_ENABLED_CAPABILITIES` intentionally excludes it. Do not enable it until the
Google OAuth configuration, restricted-scope verification/security assessment and
user-facing data-use requirements are satisfied, and the owner approves consent.
Official requirements: https://developers.google.com/workspace/gmail/api/auth/scopes

The implemented first operation reads at most ten unread inbox message headers
(five by default). Voice reads at most three and uses a bounded server readback;
email text is not supplied to an action-planning model. No bodies, attachments,
replies, sending, marking-read, or scheduled mailbox monitoring are implemented.
The read operation returns subjects/from/date to the requesting owner only and
does not persist mailbox data itself. If read through conversation, its quoted
readback becomes private conversation history under the existing retention model.
Resolve retention/disclosure requirements before enabling restricted-scope data.

Gmail requires the grant to belong to the requesting user, not merely the same
business. It checks active owner/manager status, explicit selected capability,
provider scopes, authorization revision and revocation before/after provider reads.
Calendar permissions do not authorize Gmail. Each request is GET-only, bounded,
and directed to the fixed Gmail API origin; redirects are not followed.

Calendar and Gmail share a Google grant. Connection controls explicitly request
currently selected/enabled permissions together when adding or reconnecting a
service. Disconnect Google services revokes both locally. OAuth renewal still
requires a calendar re-selection when its authorization revision changes. Never
claim a successful Gmail connection from configuration alone; verify real consent,
renewal and owned-mailbox reads before changing rollout status.

### Latest notification recovery drill (2026-09-28)

The current production snapshot through migration 0030 restored all 37 tables and
172 rows into an isolated remote D1 database. Schema, contents, integrity and foreign
keys matched. A separate synthetic fixture restored 36 application tables and 37
rows, covering recurring checks, notification occurrences, preferences and all six
email delivery states. Both temporary databases were deleted and absence verified.
Generate the synthetic snapshot with
`node tests/recovery/notification-snapshot.mjs <new.sql>`, then run
`./scripts/restore-drill.ps1 -SourceExport <new.sql>`.
No real email is sent: recipients use example.invalid and no Worker is attached.
This is data recovery verification, not restored-service activation or delivery replay
verification. Sign-in and Calendar require no mailbox access; the separately gated
Gmail feature requires additional consent and rollout review.

### Before activating a restored notification service

Keep the restored database detached from Workers, cron, queue consumers and provider
credentials. A snapshot can show an email as pending even if it was sent later.
After comparing the original restored contents, apply
`scripts/quarantine-restored-database.sql` to the isolated restored database using
its dedicated Wrangler config (never wrangler.production.jsonc):

```powershell
npx wrangler d1 execute AGENT_DB --remote --config <restored-only-config> --file scripts/quarantine-restored-database.sql --yes
```

Verify the config database ID is the intended restored ID before execution. The SQL
marks pending/sending emails uncertain while retaining their fingerprints, pauses
email preferences and recurring checks, clears leases and increments active setting
revisions. Re-running it makes no additional changes. Require zero enabled email
preferences, zero enabled/due/leased recurring checks, and zero pending/sending
outbox rows before activation. If execution fails partway, keep the database detached,
rerun and verify; do not activate an incompletely quarantined restore.

Reconcile the backup with provider receipts and post-backup activity before resuming.
Do not bulk-reset uncertain deliveries to pending. Have owners review their settings
and explicitly opt in again. The same quarantined fingerprint stays suppressed even
after renewed opt-in; genuinely new notification occurrences may send. No snapshot
can prove what occurred after it was taken. Other appointment/provider jobs and
Durable Object state still require their own reconciliation before full activation.

Run `node --test tests/recovery/notification-quarantine.test.mjs` to verify the exact
SQL against all delivery states, revisions, receipt preservation and repeat execution.

### Resuming conversational onboarding

Ask The Mayor to start or resume business onboarding. The read-only
resumeBusinessOnboarding tool reads confirmed profile data and asks one missing
basic question (name, industry, services, location/service area, hours, timezone,
then staff). Website and phone-provider connections are optional. New answers still
use the existing proposal/readback/separate-confirmation path before saving.
Basic profile completion does not activate appointment rules or connect services.

### Voice startup and delayed microphone access

Browser calls now open Flux only after the first PCM frame arrives. The UI remains
in startup until both local audio and the speech provider are ready. Startup allows
25 seconds for first audio, then at most 5 seconds for provider connection, with a
160,000-byte / 512-frame buffer. Cancellation and failures discard queued audio;
there is no generated-silence keepalive or automatic replay into another call.
This addresses the reproduced five-second provider timeout before capture starts;
it does not by itself fix microphone availability or browser AudioContext policy.

Reproduce the isolated delayed speech loop with
`./scripts/run-voice-loop-probe.ps1 -StartupDelayMs 12000 -EvidenceName 2026-09-28-delayed-voice-loop`.
The script uses fixed synthetic speech, verifies returned audio can be decoded,
and deletes its temporary authenticated test Worker. It is not a physical-microphone
or end-of-speech-to-audible-response benchmark. Use a new evidence name for new runs.

To check cancellation before capture and a subsequent fresh call, add
`-CancelRestart` and use a distinct evidence name. The probe requires an idle
acknowledgement after cancellation, sends a late silent frame, observes no call
activity for one second, then verifies a new speech turn. It does not mutate
production sessions or establish instantaneous permission revocation.

### Conversation access ends

If the server closes a conversation for access policy (1008), the app stops voice
and reconnection and shows **Reload account**. Reload rechecks sign-in and current
business membership. If permissions were removed, contact the workspace owner.
Transient network failures continue using normal reconnect behavior. This UI
recovery does not override server authorization or grant any new access.

Native D1 Time Travel is separately tested with a disposable synthetic database:
`./scripts/time-travel-drill.ps1 -EvidenceName <new-run-name>`.
See [native recovery limits and incident procedure](../../docs/mayor/native-recovery.md).
This command cannot target the live database and does not validate full service recovery.

AI Gateway was evaluated and is not enabled for the current MVP. The direct
Workers AI binding remains in use; cron and D1 own recurring checks. See the
[decision and adoption criteria](../../docs/mayor/ai-gateway-decision.md).
