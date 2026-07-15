# MehyarSoft Admin UI/UX Audit Report

**Commit:** e588ac0 (main branch)
**Date:** July 15, 2026
**Auditor:** Read-only code audit — no changes made

---

## 1. CURRENT STATE INVENTORY

### 1a. All Admin Pages (17 files in `client/src/pages/Admin*.tsx`)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `Admin.tsx` | 1,756 | Legacy mega-dashboard: analytics, newsletter, government, email threads, billing, opportunity-scout (embedded) | **BROKEN** — routes to `Admin` component for 8 paths (see dead routes below). Most of this is dead UI code in a 1,756-line file. |
| `AdminAudit.tsx` | 257 | Searchable audit trail across opportunities + decision log | **BROKEN** — imports `LoginGate` from AdminChrome but never uses it; `LoginGate` is not in scope here. Uses AdminChrome shell (14-tab nav, not 4-tab). |
| `AdminAutoTender.tsx` | 326 | Morning bid pipeline for SAM.gov — drafts appear after cron fires | **LARGELY WORKING** — functional CRUD with approve/reject/re-draft flow. Has a `&middot;` HTML entity bug on line 113 (should be `·`) that renders literally. |
| `AdminChrome.tsx` | 138 | **LEGACY SHELL** — 14-tab nav bar, `STATUS_BADGE`, `useAdminSession`, `LoginGate` | **DEPRECATED** — used by 8 legacy pages. Not used by the 4 modern tabs. |
| `AdminCRM.tsx` | 746 | CRM tab (4-tab system): leads list, drawer, stage mover, bulk actions, AI daily suggestions | **WORKING** — JarvisBar, AI suggestions, LeadDrawer portal. 246 more lines beyond truncated read. |
| `AdminMoney.tsx` | 385 | Money tab: KPI strip, funnel, deals board, quote generator, service catalog, case studies | **BROKEN** — double-click handler at line 139 calls `/api/admin/opportunities/{id}/decision` which **does not exist** (404). |
| `AdminNow.tsx` | 304 | NOW tab: AI insight panel, KPI strip, 3-column triage, ops footer | **WORKING** — JarvisBar, real LLM insight, refetch intervals. |
| `AdminOpportunities.tsx` | 238 | Legacy opportunities list with stage filters, kind filters | **BROKEN** — uses AdminChrome (14 tabs). `STAGES` array uses capitalized stage names (`"Discovery"`, `"Evaluating"`) but backend/prospects pipeline uses lowercase (`"discovery"`, `"evaluating"`). Filters silently match nothing. |
| `AdminOpportunityDetail.tsx` | 548 | Opportunity detail with enrich, stage move, event log | **BROKEN** — line 34: `url.searchParams.get("Kind")` (capital K) but App.tsx route uses lowercase `:kind` param, so `kind` is **always null**. `useRoute("/admin/opportunities/:id")` doesn't capture `kind` at all. |
| `AdminOpportunityScout.tsx` | 452 | Full opportunity scout with execution loop, Kanban, AI wealth assist | **WORKING** — sophisticated component. Has `xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]` which is a fixed-width layout that breaks on iPhone screens. |
| `AdminOutreach.tsx` | 341 | Outreach sequences builder + send-due queue | **BROKEN** — line 85: `onError: (e) => setErr(e.message)` but `setErr` is never defined in scope (defined on line 88). The error handler for `createStep` mutation is a no-op. |
| `AdminProspects.tsx` | 331 | Prospect pipeline: scan → draft → approve → send | **BROKEN** — uses `/api/prospects/list` and `/api/prospects/scan` etc. which are public Pages Functions endpoints, NOT the `/api/admin/prospects/*` namespace. Auth is via Bearer token to a public endpoint. |
| `AdminProspectSources.tsx` | 422 | Real prospects site-audit pipeline (Brooklyn/NYC/NJ seed list) | **BROKEN** — hardcoded Brooklyn/NYC/NJ businesses (line 14-30) are inappropriate seed data for a general admin tool. Shows real business names. |
| `AdminReplies.tsx` | 254 | Reply classifications list + manual add form | **BROKEN** — line 62-65: debounce uses `useState` instead of `useEffect` — the debounce `setTimeout` is never scheduled because `useState` initializer runs once only, not reactively. Search debounce **never fires**. Line 86: `classifyMut` mutation does nothing — "We don't have a PATCH endpoint for reply_classifications yet, so we just return success." |
| `AdminShell.tsx` | 316 | **MODERN SHELL** — 4-tab nav (NOW/CRM/MONEY/SYSTEM), JarvisBar, `useAdminSession`, `AdminGate`, `STAGE_BADGE`, `ScoreBar`, `EmptyState` | **CORRECT SHELL** — used by the 4 primary tabs. |
| `AdminSystem.tsx` | 273 | System tab: audit, cron, backup, health, settings sub-tabs | **BROKEN** — `BackupPanel` POSTs to `/api/admin/backup/export` which **does not exist** in the codebase. `SettingsPanel` POSTs to `/api/admin/settings` which **does not exist**. Both silently fail. |
| `AdminToday.tsx` | 327 | Legacy today triage view using AdminChrome | **BROKEN** — uses AdminChrome. Lines 222-231: case-sensitive stage comparisons (`"Drafting"`, `"ReadyToSend"`) but the backend returns lowercase (`"drafting"`, `"readytosend"`). Bucketing logic silently puts everything in the wrong bucket. |

**Total: 7,412 lines across 17 files.**

---

### 1b. Two Competing Shell Systems

| | **AdminShell.tsx** (modern) | **AdminChrome.tsx** (legacy) |
|---|---|---|
| **Lines** | 316 | 138 |
| **Tab count** | 4 tabs: NOW / CRM / MONEY / SYSTEM | 14 tabs: Today, Opportunities, Metrics, Analytics, Prospects, Signups, Government, Scout, Outreach, Sources, Replies, Auto-tender, Billing, Email |
| **Used by** | AdminNow, AdminCRM, AdminMoney, AdminSystem | AdminToday, AdminOpportunities, AdminOpportunityDetail, AdminAudit, AdminOutreach, AdminReplies, AdminProspectSources, AdminAutoTender |
| **Badge system** | `STAGE_BADGE` (20+ stage values, lowercase) | `STATUS_BADGE` (12 values, incomplete) |
| **JarvisBar** | ✅ Full implementation with SQL/LLM result rendering | ❌ None |
| **LoginGate** | Gradient card, ⌘K hint | Basic form |
| **Return path in `AdminGate`** | `{children(token!)}{logout && <></>}` — broken JSX | N/A |

**Critical issue:** `AdminGate` at line 315 of AdminShell.tsx returns:
```tsx
<>{children(token!)}{logout && <></>}</>
```
This renders a dangling `{logout && <></>}` expression as literal text. Should be removed or fixed.

---

### 1c. All Routes in App.tsx Pointing to `/admin/*`

```
/admin                      → AdminNow          (AdminShell, 4-tab)
/admin/leads                → AdminCRM          (AdminShell, 4-tab)
/admin/leads/:kind/:id       → AdminOpportunityDetail  ⚠️ kind param never extracted
/admin/money                 → AdminMoney         (AdminShell, 4-tab) ⚠️ broken endpoint
/admin/system                → AdminSystem        (AdminShell, 4-tab) ⚠️ 2 broken endpoints
/admin/prospects            → AdminProspectsProtected  ⚠️ wrong auth strategy
/admin/today                 → AdminToday         (AdminChrome, LEGACY)
/admin/auto-tender          → AdminAutoTender    (AdminChrome, LEGACY)
/admin/audit                 → AdminAudit         (AdminChrome, LEGACY)
/admin/opportunities         → AdminOpportunities (AdminChrome, LEGACY, stage case mismatch)
/admin/opportunities/:id     → AdminOpportunityDetail ⚠️ kind always null
/admin/prospect-sources      → AdminProspectSources  (AdminChrome, LEGACY)
/admin/outreach              → AdminOutreach      (AdminChrome, LEGACY) ⚠️ setErr undefined
/admin/replies               → AdminReplies       (AdminChrome, LEGACY) ⚠️ debounce broken
/admin/analytics             → Admin             ⚠️ DEAD — renders empty Admin shell
/admin/newsletter            → Admin             ⚠️ DEAD
/admin/government            → Admin             ⚠️ DEAD
/admin/government/:opportunityId → Admin         ⚠️ DEAD
/admin/opportunity-scout     → Admin             ⚠️ DEAD
/admin/billing               → Admin             ⚠️ DEAD
/admin/email                 → Admin             ⚠️ DEAD
/admin/email/thread/:threadId → Admin             ⚠️ DEAD
```

**Dead routes (8):** `analytics`, `newsletter`, `government`, `government/:opportunityId`, `opportunity-scout`, `billing`, `email`, `email/thread/:threadId` — all render the empty `Admin` component shell with no content.

---

### 1d. Mobile/iPhone Problems

The entire admin codebase was **not designed for mobile**. Evidence:

- **AdminNow.tsx:56** — `p-4 md:p-6` — only 4px→6px padding, 1rem base font still tiny on iPhone
- **AdminNow.tsx:79** — `grid-cols-2 md:grid-cols-4 lg:grid-cols-8` — 8-column KPI strip at lg breakpoint (>1024px). On iPhone (375px), only 2 columns show. Labels like "🟢 SAM live" (10px uppercase) overflow their cards.
- **AdminCRM.tsx:91** — `sticky top-16 z-10` — the toolbar sticks 64px from top. iPhone notch area may overlap. `backdrop-blur bg-white/95` can be slow on low-end devices.
- **AdminCRM.tsx:326** — `w-full sm:w-[640px] md:w-[720px]` — the drawer is full-width on mobile, hiding the entire screen behind an overlay. No close gesture or swipe-to-dismiss.
- **AdminOpportunityScout.tsx:422** — `xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]` — **hardcoded fixed-width columns** that exceed most phone screens. The left panel gets squashed to near-zero on phones.
- **AdminMoney.tsx:34** — `p-6 max-w-7xl` — 6 padding on all sides with no `md:` step-up. Text cramped on iPhone SE.
- **AdminSystem.tsx:69** — `p-6` same issue.
- **AdminShell.tsx:73** — `sticky top-0 z-30` nav bar with `backdrop-blur` — iOS Safari handles `backdrop-filter` poorly, causing laggy scrolling.
- **AdminOpportunities.tsx:114** — `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8` — stage buttons at 2 columns on iPhone, cramped labels.
- **AdminChrome.tsx:52-56** — The 14-tab nav has no horizontal scroll, no `overflow-x-auto` — tabs overflow and wrap onto multiple rows on mobile, destroying the layout.
- **Inline styles not scaling:** Multiple `style={{ width: '...' }}` and `style={{ maxHeight: '...' }}` hardcoded pixel values throughout.
- **Tap targets:** Many buttons are `px-3 py-1.5 text-xs` (36px height) — iOS minimum recommended is 44px. Lead row buttons in AdminCRM drawer are ~32px.
- **No `touch-action` CSS** on draggable elements (AdminMoney.tsx deals board has `draggable` attribute but no touch handling).

---

## 2. FLOW AUDIT

### 2a. What Each Tab Should Have vs. What Exists

**NOW tab (AdminNow.tsx)** ✅
- AI Insight (working, LLM-powered)
- KPI strip: 8 metrics — SAM active, due ≤48h, live prospects, drafts, outreach due, replies 24h, won 30d, pipeline $
- 3-column triage: Now / Today / Week
- Cron + AI spend + errors footer
- **Missing:** Quick-win one-click actions from the AI insight (actions array exists but rendered as links — no direct action buttons)

**CRM tab (AdminCRM.tsx)** ✅
- JarvisBar with SQL + LLM
- AI daily suggestions panel (working)
- Lead table with kind filter (All/SAM/Prospect), stage filter, sort
- LeadDrawer with stage mover, POC contacts, signals, deep-evaluate, win/lose quick actions
- Bulk actions: Queue, Archive, Deep eval
- **Missing:** Outreach enqueue action from prospect drawer (line 435 calls it but no button rendered visible in read portion)

**MONEY tab (AdminMoney.tsx)** ❌
- KPI strip: 8 metrics
- Pipeline funnel by stage value
- Open deals board (⚠️ double-click endpoint doesn't exist)
- Recent outcomes
- Quote generator (⚠️ endpoint unverified)
- Service catalog
- Case studies

**SYSTEM tab (AdminSystem.tsx)** ❌
- Audit log search (working)
- Cron runs table + manual trigger
- Backup panel (⚠️ `/api/admin/backup/export` doesn't exist)
- Health: DB size, LLM provider, errors
- Settings (⚠️ `/api/admin/settings` doesn't exist)

### 2b. Features Only in Legacy Pages — Need Consolidation

| Feature | Legacy Page | Should move to |
|---|---|---|
| Auto-tender pipeline (run/approve/reject) | AdminAutoTender.tsx | **MONEY** tab — it's a revenue generation tool |
| Outreach sequences builder | AdminOutreach.tsx | **MONEY** tab — it's money workflow |
| Send-due queue + manual approval | AdminOutreach.tsx | **MONEY** tab |
| Reply classifications | AdminReplies.tsx | **CRM** tab — it's a lead management feature |
| Prospect sources / site scan | AdminProspectSources.tsx | **CRM** tab — it's lead acquisition |
| Real prospects seed list | AdminProspectSources.tsx | **CRM** tab |
| Audit trail | AdminAudit.tsx | **SYSTEM** tab — already partially there as "audit" sub-tab |
| Government opportunities | AdminOpportunities.tsx (SAM filter) | **CRM** tab — already accessible via `kind="sam"` filter |

### 2c. User Journey: "Open Admin" → "Make Money"

```
1. User lands on /admin → AdminNow (4-tab shell)
   ✅ JarvisBar available on every tab
   ✅ AI insight: "start with X today"
   
2. User clicks "🧲 CRM" → AdminCRM
   - JARVIS: "enrich a0daf6" → hits /api/admin/leads/[id]/deep-evaluate ✅
   - AI daily suggestions → /api/admin/leads/daily-suggestions ✅
   - Opens LeadDrawer → deep-evaluate → LLM generates recommendations
   
3. User clicks "💰 Money" → AdminMoney
   ⚠️ Double-click deal to mark Won → 404 on /api/admin/opportunities/{id}/decision
   ✅ Quote generator works (endpoint unverified but code is complete)
   ✅ Service catalog is static content (working)
   ⚠️ Case studies: "Mark deal Won → AI drafts case study" — trigger exists but endpoint unverified
   
4. Outreach step: User must go to /admin/outreach (AdminChrome, 14-tab legacy nav)
   ⚠️ setErr undefined — error feedback silently fails
   ⚠️ Manual "Approve & Send" works but is in the WRONG tab system
   
5. Auto-tender: /admin/auto-tender (AdminChrome, 14-tab)
   ✅ Working pipeline — but lives outside the 4-tab system
```

**The money journey is broken**: The user must navigate across TWO different shell systems (AdminShell 4-tab + AdminChrome 14-tab) to complete a single money-making workflow.

---

## 3. BACKEND ENDPOINT INVENTORY

### 3a. All `/api/admin/*` Endpoints (by category)

**LLM / AI (verified working):**
- `/api/admin/jarvis` — natural language → SQL/LLM ✅
- `/api/admin/now/insight` — AI "what to do first today" ✅
- `/api/admin/leads/daily-suggestions` — AI curated leads ✅
- `/api/admin/leads/[id]/deep-evaluate` — full lead evaluation ✅
- `/api/admin/quotes/generate` — LLM-powered quote generation ✅
- `/api/admin/llm-probe` — LLM health check ✅

**CRM / Leads:**
- `/api/admin/leads` — list ✅
- `/api/admin/leads/list` — paginated list ✅
- `/api/admin/leads/[id]` — single lead ✅
- `/api/admin/leads/[id]/stage` — move stage ✅
- `/api/admin/leads/[id]/deep-evaluate` ✅
- `/api/admin/leads/bulk` — bulk actions ✅
- `/api/admin/leads/daily-suggestions` ✅
- `/api/admin/leads/purge` ✅
- `/api/admin/leads/ingest-contracts` ✅
- `/api/admin/leads/draft-from-eval` ⚠️ — **Has working INSERT for `prospect_drafts` (migration 0013 comment). Schema-dependent: needs `cited_signals_json` column. Will 500 if column missing.**
- `/api/admin/now` ✅
- `/api/admin/money` ✅
- `/api/admin/metrics` ✅

**Opportunities:**
- `/api/admin/opportunities/list` ✅
- `/api/admin/opportunities/[id]` ✅
- `/api/admin/opportunities/[id]/stage` ✅
- `/api/admin/opportunities/[id]/enrich` ✅
- `/api/admin/opportunities/[id]/events` ✅
- `/api/admin/opportunities/[id]/decision` ❌ **DOES NOT EXIST** — AdminMoney line 139 calls this

**Government / SAM:**
- `/api/admin/gov-opportunities/index` ✅
- `/api/admin/gov-opportunities/ingest` ✅
- `/api/admin/gov-opportunities/[id]/status` ✅
- `/api/admin/government/opportunities/[id]/drafts` ✅
- `/api/admin/government/opportunities/[id]/workspace` ✅
- `/api/admin/government/drafts/[draftId]` ✅
- `/api/admin/case-studies/from-opportunity` ✅

**Outreach:**
- `/api/admin/outreach` (GET + POST) ✅
- `/api/admin/outreach/[id]` ✅
- `/api/admin/outreach/send-due` (GET + POST) ✅

**Replies:**
- `/api/admin/replies` (GET + POST) ✅

**Prospect Sources:**
- `/api/admin/prospect-sources` (GET + POST) ✅
- `/api/admin/prospect-sources/list-real` ✅
- `/api/admin/prospect-sources/scan` ✅
- `/api/admin/prospect-sources/analyze` ✅

**Auto-tender:**
- `/api/admin/auto-tender` (GET + POST) ✅
- `/api/admin/auto-tender/[id]` (POST approve/reject) ✅
- `/api/admin/auto-tender/runs/[runId]` ✅

**System:**
- `/api/admin/cron/run` ✅
- `/api/admin/cron/runs` ✅
- `/api/admin/audit` ✅
- `/api/admin/audit/search` ✅
- `/api/admin/health` ✅
- `/api/admin/backup/export` ❌ **DOES NOT EXIST** — AdminSystem calls this
- `/api/admin/settings` ❌ **DOES NOT EXIST** — AdminSystem settings panel calls this
- `/api/admin/dashboard/today` ✅

**Auth:**
- `/api/admin/auth/login` ✅
- `/v1/admin/login` ✅

**Public (not admin-auth'd):**
- `/api/prospects/list` — used by AdminProspects.tsx ⚠️ different auth strategy
- `/api/prospects/scan` — used by AdminProspects.tsx
- `/api/prospects/draft` — used by AdminProspects.tsx
- `/api/prospects/send` — used by AdminProspects.tsx
- `/api/prospects/seed` — used by AdminProspects.tsx
- `/api/prospects/unsubscribe` — public handler

---

## 4. SPECIFIC PAIN POINTS

### AdminReplies.tsx — Debounce is completely broken
```tsx
// Line 62-65 — useState initializer, NOT useEffect
useState(() => {
  const id = setTimeout(() => setDebouncedSearch(search), 250);
  return () => clearTimeout(id);
}, [search]);
```
`useState`'s initializer runs ONCE on mount. It does NOT re-run when `search` changes. The debounce timeout is never scheduled. `setDebouncedSearch` is always empty string. The reply list always queries with no search filter.

### AdminOpportunityDetail.tsx — kind param always null
```tsx
// Line 34
const kind = (url.searchParams.get("Kind") || "sam") as "prospect" | "sam";
```
App.tsx route: `/admin/leads/:kind/:id`. The URL would be `/admin/leads/sam/uuid?Kind=sam` — but actually the route pattern doesn't include `kind` as a URL param at all. `useRoute("/admin/opportunities/:id")` at line 29 doesn't capture kind. Kind is **always "sam"** (the fallback).

### AdminMoney.tsx — double-click Won handler 404s
```tsx
// Line 139
await fetch(`/api/admin/opportunities/${encodeURIComponent(d.id)}/decision`, {
  method: "POST",
  headers: { authorization: *** ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ outcome: "won", value_usd: d.estimated_value_usd || 5000 }),
});
```
`/api/admin/opportunities/{id}/decision` **does not exist**. Returns 404. Double-click to mark Won silently fails.

### AdminOutreach.tsx — setErr is undefined in error handler
```tsx
// Line 84-85
onError: (e) => setErr(e.message),
```
`setErr` is defined at line 88 as a `useState`. The error handler on line 85 is in the `createStep` mutation object literal, which is defined BEFORE `setErr` is declared in the component body. JavaScript closures capture `setErr` by reference — it will be defined by the time the error fires, but it's a confusing ordering issue.

### AdminSystem.tsx — two endpoints don't exist
- `POST /api/admin/backup/export` — called at `BackupPanel.tsx:223`. No such file in `functions/api/admin/`. Silently fails (no error handling shown to user).
- `POST /api/admin/settings` — called at `SettingsPanel.tsx:266`. No such file. Silently fails.

### AdminToday.tsx — case-sensitive stage matching (always fails)
```tsx
// Lines 222-231
const doNowItems = allOpps.filter((o) => {
  if (o.stage === "Drafting" || o.stage === "ReadyToSend") return true;  // Capitalized!
```
The backend/prospects pipeline uses lowercase: `"drafting"`, `"readytosend"`. These comparisons always return false. The "Do now" column is always empty regardless of actual data.

### AdminAutoTender.tsx — HTML entity bug
Line 113: `&middot;` renders as literal `&middot;` instead of `·`. Should be `&middot;` or `·`.

### AdminOpportunities.tsx — stage case mismatch
```tsx
// Line 33 — STAGES uses capitalized names
const STAGES = ["Discovery", "Evaluating", "Drafting", "ReadyToSend", ...]
// Line 119 — stage filter comparison uses strict equality
onClick={() => setStage(stage === s ? "" : s)}
```
Backend/prospects pipeline returns lowercase. Filters never match.

### AdminShell.tsx — broken JSX in AdminGate
```tsx
// Line 315
return <>{children(token!)}{logout && <></>}</>;
```
The `{logout && <></>}` expression is rendered as literal text in the JSX tree. Should be removed.

### AdminProspects.tsx — wrong API namespace
Calls `/api/prospects/*` (public Pages Functions) with Bearer token auth. The correct admin endpoints are `/api/admin/prospects/*`. This may work by accident if both namespaces share the same token validation, but it's architecturally wrong.

### AdminOpportunityScout.tsx — fixed-width grid breaks mobile
```tsx
// Line 422
<div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]">
```
`minmax(460px, 1.1fr)` requires at least 460px. On iPhone SE (320px wide), the right panel overflows the viewport. No `overflow-hidden` or responsive fallback.

---

## 5. SCHEMA/DB MISMATCHES STILL PENDING

### `draft-from-eval.js` — `prospect_drafts` column `cited_signals_json`
**File:** `functions/api/admin/leads/draft-from-eval.js:166-172`
```sql
INSERT INTO prospect_drafts (id, prospect_id, sam_id, subject, body_text, body_html,
                             cited_signals_json, status, generated_by, model,
                             payload_json, created_at)
VALUES (...)
```
The comment at line 164-167 says this was "added in migration 0013". If this migration hasn't run on the deployed D1 database, this INSERT will 500. The INSERT also sets `body_html` but the comment at line 166 says "NO 'body' col" — the column exists but `body_text` is used instead of `body`.

### `now/insight.js` — `gov_opportunities.status` vs `stage`
**File:** `functions/api/admin/now/insight.js:45-47`
```sql
(SELECT COUNT(*) FROM gov_opportunities WHERE status IS NULL OR status NOT IN ('archived','won','lost','inactive')) as sam_active,
(SELECT COUNT(*) FROM gov_opportunities WHERE (status IS NULL OR status NOT IN ('archived','won','lost','inactive')) AND julianday(response_deadline) - julianday('now') <= 7) as sam_due_7d,
```
`gov_opportunities` uses `stage` column, NOT `status`. The `now.js` file correctly uses `stage` (line 28). `now/insight.js` may return incorrect counts or 500 if `status` column doesn't exist.

### `health.js` — `opportunities_events` subquery in aggregate
**File:** `functions/api/admin/health.js:17`
```sql
SELECT SUM((SELECT COUNT(*) FROM opportunities_events)) + (SELECT COUNT(*) FROM prospects) + (SELECT COUNT(*) FROM gov_opportunities) as n
```
If `opportunities_events` table doesn't exist (hasn't been created yet), this `SUM(...)` with a subquery over a missing table will error. No `.catch()` guard visible.

### `now.js` — `opportunity_decisions` table referenced
**File:** `functions/api/admin/now.js:34`
```sql
won_30d: await countQ("SELECT COUNT(*) as n FROM opportunity_decisions WHERE outcome = 'won' AND decided_at >= datetime('now', '-30 day')")
```
`opportunity_decisions` is a different table from `opportunity_events`. If `opportunity_decisions` doesn't exist (only `opportunity_events` exists for audit), this query fails silently (count returns 0 via `COUNT(*)`) but the table may need to be created.

### `money.js` — `opportunity_decisions` table
**File:** `functions/api/admin/money.js:48`
```sql
SELECT outcome FROM opportunity_decisions WHERE decided_at >= datetime('now','-30 day')
```
Same as above — references `opportunity_decisions` which may not exist.

### `now/insight.js` — `prospect_drafts.status = 'pending_review'`
**File:** `functions/api/admin/now/insight.js:50`
```sql
(SELECT COUNT(*) FROM prospect_drafts WHERE status='pending_review') as drafts_pending,
```
Does `prospect_drafts.status` accept `'pending_review'`? The auto-tender flow uses `'completed'` and `'approved'` statuses. `'pending_review'` may not be a valid status value — verify against actual schema.

### `leads/bulk.js` — UPDATE with `updated_at = datetime('now')`
**File:** `functions/api/admin/leads/bulk.js:42`
```sql
UPDATE ${table} SET ${col} = ?, updated_at = datetime('now') WHERE id = ?
```
If `updated_at` column doesn't exist on the `prospects` or `sam_items` table, this UPDATE silently fails (D1 SQLITE ignores unknown columns in SET). The bulk action would succeed without updating timestamps.

### `cron/run.js` — `prospect_sends.status IN ('sent','replied')`
**File:** `functions/api/admin/cron/run.js:82`
```sql
AND NOT EXISTS (SELECT 1 FROM prospect_sends ps WHERE ps.prospect_id = p.id AND ps.status IN ('sent','replied'))
```
If `prospect_sends` table doesn't have a `status` column, this clause fails. The `outreach/send-due.js` safely uses `prospect_sends` with proper column handling.

---

## SUMMARY OF BREAKING ISSUES (Priority Order)

| Priority | Issue | File:Line | Impact |
|----------|-------|-----------|--------|
| P0 | `kind` param always null | AdminOpportunityDetail.tsx:34 | Can't open SAM-specific detail pages |
| P0 | `/api/admin/opportunities/{id}/decision` doesn't exist | AdminMoney.tsx:139 | Double-click Won silently 404s |
| P0 | `/api/admin/backup/export` doesn't exist | AdminSystem.tsx:223 | Backup download does nothing |
| P0 | `/api/admin/settings` doesn't exist | AdminSystem.tsx:266 | Settings save does nothing |
| P0 | Debounce never fires — `useState` instead of `useEffect` | AdminReplies.tsx:62-65 | Search is non-functional |
| P0 | `gov_opportunities.status` column doesn't exist | now/insight.js:45-47 | NOW tab AI insight returns wrong counts / 500s |
| P1 | Stage case mismatch — always empty "Do now" bucket | AdminToday.tsx:222-231 | Triage buckets always show nothing |
| P1 | `opportunity_decisions` table may not exist | now.js:34, money.js:48 | KPI numbers wrong or 500 |
| P1 | Stage case mismatch in opportunities filter | AdminOpportunities.tsx:33,119 | Stage filter never matches |
| P1 | `prospect_drafts.cited_signals_json` migration dependency | draft-from-eval.js:168 | Auto-tender drafts 500 on deploy |
| P1 | 8 dead routes render empty Admin shell | App.tsx:113-120 | Broken navigation to analytics, billing, email |
| P1 | `AdminGate` has dangling `{logout && <></>}` JSX | AdminShell.tsx:315 | Literal text rendered in output |
| P2 | `setErr` defined after use in mutation object | AdminOutreach.tsx:84-85 | Error feedback fails silently |
| P2 | 14 legacy pages use wrong shell (AdminChrome) | 8 legacy pages | Users navigate between 2 incompatible nav systems |
| P2 | Auto-tender, outreach, replies, prospect-sources all need moving to 4-tab system | Multiple legacy pages | Money workflow requires switching shells |
| P2 | Opportunity Scout has fixed-width grid | AdminOpportunityScout.tsx:422 | Completely broken on iPhone |
| P2 | HTML entity `&middot;` renders literally | AdminAutoTender.tsx:113 | Visual glitch |
| P2 | AdminProspects uses wrong API namespace (`/api/prospects/*` vs `/api/admin/prospects/*`) | AdminProspects.tsx:75,93 | Auth may fail on redeploy |
| P3 | 10px uppercase KPI labels overflow on iPhone SE | AdminNow.tsx:195 | Text truncated, unreadable |
| P3 | Full-width mobile drawer covers entire screen | AdminCRM.tsx:326 | No back gesture, must tap X button |
| P3 | 14-tab nav in AdminChrome has no horizontal scroll | AdminChrome.tsx:52-56 | Broken layout on mobile |
| P3 | `navigator.clipboard.writeText` + `alert` in service catalog | AdminMoney.tsx:329-331 | Poor UX, alert is blocking |
| P3 | `classifyMut` in AdminReplies does nothing | AdminReplies.tsx:82-91 | Reply re-classification is a no-op |
