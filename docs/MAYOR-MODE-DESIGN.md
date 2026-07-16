# Mayor Mode — Full Admin Automation Design

**Date**: 2026-07-16
**Status**: Design → Implementation
**Goal**: Mehyar touches nothing. The AI "Mayor" runs all daily ops — outreach,
follow-ups, SAM.gov monitoring, local business scanning — and emails
notifications to `info@mehyar.us` for visibility.

---

## 1. What "Mayor Mode" Means

**Mayor** is the in-product name for the AI operator that runs the admin CRM
on Mehyar's behalf. It's not a chatbot — it's an **executor** with three
loops running 24/7:

| Loop | Cadence | Job |
|---|---|---|
| **Discovery** | Daily (8 AM ET) | Scan SAM.gov, scan local business registries, pull new leads |
| **Outreach** | Daily (10 AM ET) | Send first-touch emails to all discovered leads that pass guardrails |
| **Follow-up** | Daily (2 PM ET) | Send step 2/3 of sequences to prospects who haven't replied or bounced |

All three loops are driven by **cron triggers** in Cloudflare. Each loop emits
events to a `mayor_events` table and emails a daily digest to `info@mehyar.us`.

The admin UI surfaces everything as a **read-only mission control** —
Mehyar logs in to OBSERVE and OVERRIDE, not to manually push buttons.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         MAYOR ENGINE                              │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  DISCOVERY   │  │  OUTREACH    │  │   FOLLOW-UP              │ │
│  │  LOOP        │  │  LOOP        │  │   LOOP                   │ │
│  │              │  │              │  │                          │ │
│  │ • SAM.gov    │  │ • Cold email │  │ • Step 2/3 of sequence   │ │
│  │ • Local biz  │  │   to prospect│  │ • Bump to next step if   │ │
│  │   (Brooklyn, │  │   (test_only │  │   no reply in N days     │ │
│  │   NYC)       │  │   OFF after  │  │ • Skip if replied/       │ │
│  │ • Prospects  │  │   warmup)    │  │   bounced/suppressed     │ │
│  │   registry   │  │ • Lead magnet│  │                          │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────────────┘ │
│         │                 │                   │                   │
│         ▼                 ▼                   ▼                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              MAYOR GUARDRAILS (policy engine)               │  │
│  │  • Daily cap: 25 emails (warmup), 100 after day 14          │  │
│  │  • Suppression check (D1 + KV)                              │  │
│  │  • CAN-SPAM footer + List-Unsub header                      │  │
│  │  • Per-domain throttle: ≤3/day, ≤10/week                    │  │
│  │  • LLM-cost guard: $2/day cap                               │  │
│  │  • Auto-pause on bounce rate >10%                           │  │
│  │  • Phishing/PII sanitizer on all LLM prompts                │  │
│  └────────────────────────────────────────────────────────────┘  │
│         │                 │                   │                   │
│         ▼                 ▼                   ▼                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    RESEND / CF EMAIL                        │  │
│  │         (existing send.js — minimal patches)                │  │
│  └────────────────────────────────────────────────────────────┘  │
│         │                                                         │
│         ▼                                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │             EMAIL DIGEST TO info@mehyar.us                  │  │
│  │   8 AM: discovery results • 10 AM: sends • 2 PM: follow-ups │  │
│  │   Weekly Mon: pipeline summary                              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      ADMIN UI (mission control)                    │
│                                                                   │
│  • /admin/mayor     — live mission control (single page)           │
│  • /admin/outreach  — sequence log (read-only)                    │
│  • /admin/insights  — weekly digests, replies, replies-to-act-on  │
│  • /admin/system    — kill switch, settings                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model Additions

### `mayor_events` (new)
```sql
CREATE TABLE mayor_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- 'discovery'|'outreach'|'followup'|'digest'|'error'|'pause'
  loop TEXT,                      -- 'discovery'|'outreach'|'followup'
  summary TEXT NOT NULL,
  details_json TEXT,              -- JSON blob with counts, lead IDs, etc.
  digest_sent INTEGER DEFAULT 0,  -- 1 = email already sent to info@
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_mayor_events_created ON mayor_events(created_at);
CREATE INDEX idx_mayor_events_kind    ON mayor_events(kind);
```

### `mayor_settings` (new — key/value)
```sql
CREATE TABLE mayor_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
```
Seeded with: `daily_email_cap=25`, `warmup_day=0`, `paused=0`,
`auto_send=1` (global kill switch), `discovery_caps_json`, etc.

### `prospect_sequences` (new — replaces ad-hoc outreach steps)
```sql
CREATE TABLE prospect_sequences (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  step_no INTEGER NOT NULL,       -- 1, 2, 3
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  send_after_days INTEGER,        -- delay since previous step
  status TEXT DEFAULT 'queued',   -- queued|sent|skipped|replied|failed
  send_id TEXT,                   -- FK to prospect_sends
  scheduled_for TEXT,             -- ISO timestamp when it becomes due
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_seq_prospect     ON prospect_sequences(prospect_id, step_no);
CREATE INDEX idx_seq_status_due   ON prospect_sequences(status, scheduled_for);
```

### `mayor_replies` (new — inbound reply classification)
```sql
CREATE TABLE mayor_replies (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,
  from_email TEXT,
  subject TEXT,
  body_text TEXT,
  classification TEXT,             -- 'interested'|'objection'|'unsubscribe'|'auto'|'human'
  sentiment_score REAL,
  recommended_action TEXT,        -- 'reply'|'book_call'|'add_to_pipeline'|'kill'
  suggested_reply TEXT,            -- LLM-drafted next email
  received_at TEXT,
  processed_at TEXT
);
```

---

## 4. Cron Wiring (existing pattern)

Replace the existing `admin/cron/run.js` body with a `Mayor` dispatcher.
The `/api/admin/cron/run` endpoint already exists and accepts a `job` param.

### New jobs
```
job=mayor_discover     → Discovery loop (8 AM)
job=mayor_outreach     → Outreach loop (10 AM)
job=mayor_followup     → Follow-up loop (2 PM)
job=mayor_digest       → Daily digest email (6 PM)
job=mayor_weekly       → Weekly pipeline email (Mon 9 AM)
```

Cloudflare Cron Triggers (set in wrangler.toml):
```toml
[triggers]
crons = [
  "0 13 * * *",   # 8 AM ET — discovery
  "0 15 * * *",   # 10 AM ET — outreach
  "0 19 * * *",   # 2 PM ET — followup
  "0 23 * * *",   # 6 PM ET — digest
  "0 14 * * 1",   # Mon 9 AM ET — weekly
]
```

---

## 5. Mayor UI (`/admin/mayor`)

Single-page mission control. Live polls every 30s.

**Sections:**
1. **Header bar**
   - Mayor status: `▶ RUNNING` / `⏸ PAUSED` / `⛔ KILLED`
   - Today: sent X / cap Y, replies Z, pipeline $$
   - Pause/Resume button (admin auth)

2. **Today's Mission** (timeline)
   - 8 AM  Discovery — ✅ Found 3 SAM opps, 5 local biz (NYC)
   - 10 AM Outreach — ✅ Sent 12 emails, 0 failed
   - 2 PM Follow-up — 🔄 In progress… 4 of 7 sent

3. **Live Feed** (real-time event stream)
   - `12:34:01` Mayor → `discovery` — Found 3 new SAM opps in NY/NJ
   - `12:35:14` Mayor → `outreach` — Sent to alice@bakery.com (step 1)
   - `12:36:02` Mayor → `outreach` — Skipped bob@gym.com (already contacted)

4. **Reply Inbox** (read-only view of `mayor_replies`)
   - Filter: needs action / auto-replies / unsubscribes
   - "Drafted reply ready" badge
   - "Mark as handled" → moves to done

5. **Pipeline at a glance**
   - $ total pipeline / # active deals
   - Top 5 prospects ranked by lead score + last touch

6. **Kill switch**
   - Big red button: "Pause Mayor — stop all outreach for 24h"
   - "Pause forever" → flips `mayor_settings.paused=1`

---

## 6. Mayor Engine Code Layout

```
functions/api/mayor/                    # NEW top-level namespace
  _shared/
    mayorEngine.js       # Core orchestrator (called by all 3 loops)
    mayorGuardrails.js   # Caps, throttles, suppression, PII sanitizer
    mayorDb.js           # Wraps LEADS_DB queries + mayor_events inserts
    mayorEmail.js        # Daily digest template + weekly template
    mayorSequences.js    # 3-step default outreach sequence
  discover.js            # Discovery loop entry point
  outreach.js            # Outreach loop entry point
  followup.js            # Follow-up loop entry point
  digest.js              # Daily + weekly email
  status.js              # GET /api/admin/mayor/status (live UI feed)
  settings.js            # GET/PUT /api/admin/mayor/settings
  pause.js               # POST /api/admin/mayor/pause
  replies.js             # GET /api/admin/mayor/replies
  events.js              # GET /api/admin/mayor/events (live feed)

functions/api/admin/cron/
  run.js                 # Add mayor_discover|mayor_outreach|mayor_followup|mayor_dispatch

client/src/pages/
  AdminMayor.tsx         # NEW — full mission control UI (replaces AdminNow)
  AdminShell.tsx         # Update nav: Now → Mayor (single page)
```

We KEEP the existing `AdminCRM.tsx`, `AdminMoney.tsx`, `AdminSystem.tsx` —
they become read-only dashboards. The 8 legacy broken pages get a redirect
to `/admin/mayor`.

---

## 7. Default 3-Step Outreach Sequence

Applied automatically to every new prospect/business by the Outreach loop.

**Step 1 — Day 0 (initial email)**
- Subject: `Quick question for {business_name}`
- Body: 3 sentences max. Reference their site (which we already scanned).
- Offer: "I help NYC service businesses cut 10 hrs/week with one AI tool.
  Free 15-min audit."
- CTA: `Book 15 min →` (Calendly link)

**Step 2 — Day 3 (bump)**
- Subject: `Re: {subject}`
- Body: "Hi {first_name}, did my note get buried? Sending one concrete
  example: a Brooklyn bakery I worked with cut inventory counting from
  4h/wk to 30min with a $200 tool. Worth 15 min to see if it fits?"
- CTA: `Book 15 min →`

**Step 3 — Day 8 (break-up)**
- Subject: `closing the loop`
- Body: "Last note — promise. If timing's wrong, totally fine. I've got a
  one-page '10 AI tools for Brooklyn service businesses' PDF if useful.
  Want me to send it?"
- CTA: `Send PDF →` (mailto or button)

After step 3 with no reply → mark `prospect.status = 'closed_no_reply'`,
stop emailing.

---

## 8. SAM.gov Auto-Bid Pipeline (existing `autoTenderPipeline.js`)

Already exists. Mayor Discovery loop calls it with a slightly enriched
prompt: "prioritize NY/NJ set-aside eligible contracts under $250k for
NAICS 541511/541512". Each draft becomes a `mayor_events` entry with a
"review-needed" tag — digest email asks Mehyar to click approve on the
top 3.

---

## 9. Email Digest Template

Sent to `info@mehyar.us` (which routes to `mrswelim@gmail.com`).

```
Subject: [Mayor] 2026-07-16 daily digest — 12 sent, 2 replies

Mayor ran the daily loops. Here's what happened:

DISCOVERY (8 AM)
  • 3 new SAM.gov opps matching your filters (NY/NJ, set-aside, <$250k)
    - LRSO Hardware Software Support — $80k-$250k
    - Materials Marketing System — $40k-$80k
    - Financial Crime Search Software — $25k-$50k
  • 5 new local businesses found in Brooklyn/NYC
  [Review →]  /admin/mayor?tab=discovery

OUTREACH (10 AM)
  • 12 emails sent (within 25/day cap, day 0 of warmup)
  • 0 failed, 0 suppressed
  • Top prospect: Kings County Diner (lead score 87)
  [See full log →]  /admin/mayor?tab=outreach

FOLLOW-UP (2 PM)
  • 4 step-2 bumps sent
  • 3 prospects replied — 1 interested, 2 auto-replies
  • Hot lead: brooklyn_dental@example.com wants a call Wed 3 PM
  [Reply to Mehari →]  /admin/mayor?tab=replies

PIPELINE
  $127,500 active pipeline (12 prospects across 5 stages)
  1 deal moved: "Kings County Diner" discovery → qualified

NEXT: I'll run follow-up #3 tomorrow at 2 PM unless you pause me.
[Pause Mayor]  [Open admin]

— Mayor (running on mehyar.us)
```

---

## 10. Implementation Plan (this session)

### Phase 1 — DB schema + engine core (1 hour)
1. New tables migration in `mayor_init.js` (idempotent CREATE IF NOT EXISTS)
2. `functions/api/mayor/_shared/mayorDb.js` — query helpers
3. `functions/api/mayor/_shared/mayorGuardrails.js` — caps + suppression
4. `functions/api/mayor/_shared/mayorSequences.js` — 3-step templates
5. `functions/api/mayor/_shared/mayorEngine.js` — the core loop runner

### Phase 2 — Loop endpoints (1 hour)
6. `functions/api/mayor/discover.js` — wraps SAM + local biz scanners
7. `functions/api/mayor/outreach.js` — sends step-1 emails (new prospects)
8. `functions/api/mayor/followup.js` — sends step-2/3 bumps
9. `functions/api/mayor/digest.js` — sends info@mehyar.us digest

### Phase 3 — Cron wiring (15 min)
10. Update `functions/api/admin/cron/run.js` to dispatch mayor_* jobs
11. Add Cloudflare cron triggers to `wrangler.toml`
12. Wire daily + weekly cron triggers via Cloudflare dashboard

### Phase 4 — Admin UI (1 hour)
13. `client/src/pages/AdminMayor.tsx` — single-page mission control
14. Update `AdminShell.tsx` nav: Now → Mayor
15. Add redirect from /admin/now → /admin/mayor
16. Add Mayor-specific widgets to existing pages (CRM shows mayor log,
    Money shows mayor-generated pipeline, System shows mayor settings)

### Phase 5 — Testing (30 min)
17. Seed DB with test prospects + simulate 3 days of cron
18. Verify digest email renders correctly
19. Verify kill switch works
20. Verify existing leads.js/CRM flows still work

### Phase 6 — Deploy
21. Commit everything
22. Build + deploy to Cloudflare Pages
23. Verify cron triggers registered
24. Trigger one mayor_outreach run manually to confirm end-to-end

---

## 11. What stays manual (the audit's kill list)

| Task | Why |
|---|---|
| Sign federal contracts | Requires Mehyar's signature + SAM.gov MPIN |
| Wire money to/from accounts | Bank auth |
| Negotiate deal terms over $5k | Human judgment |
| LinkedIn connection requests | Anti-spam, low ROI to automate |
| Actual delivery of client work | Irreplaceable |
| Review final SAM.gov bid text before submit | Compliance — Mayor DRAFTS only |

Everything else runs on autopilot.

---

## 12. Failure modes & recovery

| Failure | Mayor reaction |
|---|---|
| Resend API down | Pause outreach, log error, email digest says "outreach skipped today" |
| LLM provider down | Send pre-canned templated emails from canned templates |
| DB schema missing | Auto-run migration on next request |
| Daily bounce rate >10% | Auto-pause outreach 24h, alert in digest |
| Unsubscribe received | Immediate removal from sequence + suppression_list |
| info@mehyar.us reply detected | Auto-classify as mayor-reply, draft response, mark for Mehyar review |
| Discovery finds 0 leads | Log "no new opportunities" — not an error, normal quiet day |

---

## 13. Acceptance criteria

When this is done:
1. ✅ I can log in to `/admin` and see Mayor's live status with no manual buttons
2. ✅ SAM.gov opps appear in CRM without me touching anything
3. ✅ Cold emails go out to local businesses daily without me pushing send
4. ✅ Follow-up emails go out without me checking
5. ✅ I get one email per day to info@mehyar.us summarizing what happened
6. ✅ If I want to stop everything, I press ONE button and it pauses 24h
7. ✅ Reply inbox shows new replies with drafted responses I can approve
8. ✅ All the existing draw features (scanner, deep-analyze, Jarvis chat) still work
9. ✅ The audit's 8 BROKEN pages are no longer routed to — they redirect to Mayor
10. ✅ I earn $1 → $10k MRR via the pipeline Mayor feeds

---

*Document version: 1.0*
*Implementation target: this session*