#!/usr/bin/env python3
"""
mayor_debate.py — Two AI "mayors" debate how to evolve mehyar.us's admin CRM.

  • MAYOR_A = "Builder" — concrete shipper, prioritizes actionable features that
    lead directly to Mehyar earning money THIS WEEK.
  • MAYOR_B = "Auditor" — picks apart every proposal, stress-tests feasibility,
    measures effort vs ROI, calls out hand-waving.

300 turns (configurable). Output streamed to:
  - docs/MayorDebate-CRM-Improvements-2026.md
  - stdout for live monitoring

Final structured output → fed into scripts/kanban_from_debate.py to generate
a kanban project.

IMPORTANT — Context-window hygiene:
  Each mayor only sees the OPENING brief + the most recent 4 messages
  (= ~2 turns). This prevents the LLM context from being polluted by
  sycophantic agreement in earlier turns. The FULL transcript is still
  written to the markdown file for human review and kanban extraction.
"""

import os, sys, json, time, argparse, urllib.request, urllib.error
from datetime import datetime, timezone

# ─── Cloudflare Workers AI config ───────────────────────────────────────────
ACCOUNT_ID = "621600637337cc1c9ecb7095508bc732"
LLM_MODEL  = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
FAST_MODEL = "@cf/meta/llama-3.1-8b-instruct"
TINY_MODEL = "@cf/meta/llama-3.2-3b-instruct"

def get_api_token():
    """Find a Cloudflare AI-enabled API token. Prefers Hermes's known token file
    (longer, AI:Read scope) over the 37-char Pages deploy token in .hermes/.env.
    """
    for p in (
        "/c/Users/mehya/.hermes/cf_ai_token.txt",
        os.path.expanduser("~/.hermes/cf_ai_token.txt"),
        os.path.expanduser("~/AppData/Local/hermes/cf_ai_token.txt"),
    ):
        try:
            with open(p) as f:
                v = f.read().strip()
                if v and len(v) > 40:
                    return v
        except (FileNotFoundError, PermissionError):
            continue
    for var in ("CF_API_TOKEN", "CLOUDFLARE_AI_TOKEN", "CLOUDFLARE_API_TOKEN"):
        v = os.environ.get(var, "").strip()
        if v and len(v) > 40:
            return v
    return ""

def _cf_call(model, messages, max_tokens, temperature, api_token):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{model}"
    body = json.dumps({"messages": messages, "max_tokens": max_tokens, "temperature": temperature}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"http_{e.code}") from e
    if not data.get("success"):
        raise RuntimeError(f"ai_fail:{data.get('errors')}")
    resp = data.get("result", {})
    if isinstance(resp, dict):
        choices = resp.get("choices")
        if choices and isinstance(choices, list):
            msg = choices[0].get("message", {})
            return msg.get("content") or msg.get("response") or str(msg)
        return resp.get("response") or resp.get("content") or json.dumps(resp)
    return str(resp)

def cf_query(messages, max_tokens=900, temperature=0.85, model=None):
    """Call Workers AI with model fallback. Default = LLM_MODEL (70B)."""
    api_token = get_api_token()
    if not api_token:
        raise RuntimeError("Missing CF API token")
    chain = []
    if model: chain.append(model)
    chain.extend([LLM_MODEL, FAST_MODEL, TINY_MODEL])
    seen = set()
    for m in chain:
        if m in seen: continue
        seen.add(m)
        try:
            return _cf_call(m, messages, max_tokens, temperature, api_token)
        except Exception as e:
            err = str(e)[:80]
            print(f"  ({m.split('/')[-1]} failed: {err}, trying next)", flush=True)
            continue
    raise RuntimeError("All AI models failed")

# ─── Mayor system prompts ───────────────────────────────────────────────────

MAYOR_A_SYS = """You are MAYOR A — the BUILDER. Operating partner for Mehyar, the
founder of mehyar.us (Brooklyn, NY — a 1-person LLC selling software/AI/cloud
engineering SERVICES + bidding on US gov contracts + landing local business
clients + freelance gigs).

YOU ONLY SELL WHAT MEHYAR ACTUALLY SELLS:
  - Software/AI/cloud engineering services to SMBs and startups
  - US federal contracts via SAM.gov (set-aside eligible, up to $250k)
  - Local NYC/Brooklyn business clients (dental, cafe, gym, etc.)
  - Freelance gigs (when applicable)

YOU DO NOT SELL: AI marketing tools, VR experiences, mobile apps, SaaS products,
crypto, NFTs, or anything speculative. If Mayor B catches you drifting toward
those, IMMEDIATELY course-correct back to reality.

Your ONLY job: push toward concrete, ship-this-week features that make
MONEY FAST. Think like a scrappy founder with limited time.

Shippable action categories (use ONLY these):
  - Cold outreach automation that actually SENDS real emails
  - Affiliate/referral funnels on mehyar.us that earn commission
  - Service-page funnels that pre-qualify leads and book calls
  - Gig-platform scanners (Upwork, Toptal, Freelancer)
  - One-click "send bid" buttons for SAM.gov opps
  - Portfolio case studies from won deals
  - Pricing widgets that quote clients instantly
  - Personal-brand content drafts (LinkedIn, X, blog)
  - Reactivation campaigns for cold leads
  - Calendar booking + auto-pay for small engagements

Style: punchy, decisive. Short sentences, bullets, dollar amounts, delivery
timelines. Cite ROI estimates but stay BELIEVABLE ($5k-$30k/month realistic
in 90 days, not $1M). REJECT any idea that takes >1 week to ship if a faster
version exists. Every turn must include 1-3 SHIPPABLE actions for THIS WEEK
with expected $ impact and hours.

Format:
  - Start with bullets — NO '### Turn N', NO 'Mayor A says'.
  - ≤ 250 words per turn."""

MAYOR_B_SYS = """You are MAYOR B — the AUDITOR. Operating partner for Mehyar, the
founder of mehyar.us (Brooklyn, NY — a 1-person LLC).

YOUR PRIME DIRECTIVE: NEVER AGREE WITH MAYOR A WITHOUT PUSHBACK.

If Mayor A proposes something Mehyar doesn't actually sell (AI marketing tools,
VR experiences, mobile apps, SaaS, speculative products), IMMEDIATELY call it
out: "STOP — Mehyar is a services shop, not a SaaS startup. Repurpose this."

If Mayor A's ROI estimate is implausible (>5x in 30 days for any feature,
>$100k/month without a proven channel), call out the math: "$80k-$160k in 30
days requires 50+ closed deals at $1.6k each — what's the close rate?"

You favor:
  - Calling out hand-waving ROI numbers
  - Demanding actual hour-cost analysis: feature build hours vs expected revenue
  - Identifying compliance/legal risk (CAN-SPAM, GDPR, SAM.gov rules, LLC
    licensing, state solicitation laws, ITAR, CMMC if relevant)
  - Pointing out where existing code already does what A proposes
  - Quoting real shipping metrics from the audit report (8 BROKEN admin pages)
  - Forcing prioritization: which ONE ships first
  - Demanding kill criteria: what would make us ABANDON this idea

The system prompt contains anti-sycophancy directives. You MUST reject any
flattery, any sycophancy, any agreement without substance.

If Mayor A's prior turn was bad (hallucinated products, inflated numbers,
repeat content), START YOUR REPLY by calling this out: "Last turn was
[specific failure]. Restart with…"

Format:
  - Start with bullets — NO '### Turn N', NO 'Mayor B says'.
  - End with: VERDICT: SHIP / REFINE / KILL + next concrete step.
  - ≤ 250 words per turn."""

OPENING_PROMPT = """CONTEXT: Mehyar (1-person LLC, Brooklyn NY) runs mehyar.us. He sells:
  - Software/AI/cloud engineering SERVICES to SMBs and startups
  - US federal contracts via SAM.gov (set-aside eligible, up to $250k)
  - Local NYC/Brooklyn business clients (dental, cafe, gym, retail)
  - Freelance gigs (when applicable)

He does NOT sell AI marketing tools, VR experiences, mobile apps, SaaS products,
or speculative products. Stay grounded in services + gov contracts + local
business outreach.

CURRENT STATE OF THE ADMIN CRM (July 2026):
  - 4-tab admin: NOW (triage), CRM (leads+SAM), MONEY (pipeline), SYSTEM (ops)
  - 8 legacy admin pages still wired up but mostly broken (audit report)
  - Working features: AI deep-evaluate, AI deep-analyze with 2026 c2c pricing,
    Jarvis chat refiner, BusinessScanner, EUScouter, FindJobsPanel
    (RemoteOK/ArbeitNow/Remotive/Himalayas)
  - AI Insight card on NOW tab, KPI strip, Ops footer (cron + AI spend)
  - Lead drawer with stage mover, deep eval, deep analyze, outreach actions
  - Public site has /services, /portfolio, /blog, /contact, /book, /quote,
    pricing tiers ($3.5k-$80k c2c)

REVENUE CHANNELS available (not all exploited):
  1. Direct services (web/AI/cloud dev) — needs lead → call → close funnel
  2. SAM.gov federal contracts — pipeline already in CRM
  3. NYC/Brooklyn local businesses — scanner exists, outreach not automated
  4. Cold outreach (email + LinkedIn) — drafts auto-generated, no sending
  5. Affiliate programs (no affiliate funnel yet)
  6. Gig platforms: Upwork, Toptal, Freelancer, Contra — no scanning
  7. Open-source / content marketing — blog exists, no distribution
  8. Productized services ($X for Y deliverable, e.g. $500 AI audit,
     $1500 landing page)

CONSTRAINTS:
  - 1 person. Max 50 hrs/week on revenue work.
  - Limited LLM budget (~$5/day).
  - All infra is Cloudflare Pages + Workers AI + D1.
  - Can deploy daily.
  - LLC can sign contracts up to $250k federal set-aside.

BELIEVABLE TARGETS:
  - First $1: achievable in 30 days via productized services or small gig
  - $10k MRR: achievable in month 6 with 5-10 retainer clients
  - $100k/quarter: achievable by month 9 with mix of services + 1-2 gov wins
  - Anything faster is fantasy.

YOUR GOAL AS A PAIR: generate a sequenced, prioritized ROADMAP that maximizes
Mehyar's chance of earning $1 in the next 30 days and $10k MRR by month 6.
Be ruthless, concrete, dollar-quantified, AND GROUNDED in reality.

Begin Turn 1: Mayor A — propose the TOP 3 features to build THIS WEEK.
Mayor B — counter / refine / quantify / kill hallucinated ideas."""

# ─── Debate runner ──────────────────────────────────────────────────────────

def is_drift(text):
    """Detect when a mayor's reply has lost the plot (hallucinated products,
    pure sycophancy, marketing fluff). Returns (is_drift, reason).
    """
    ll = text.lower()
    bad_signals = [
        ("virtual reality", "hallucinated VR product"),
        ("ai marketing tool", "hallucinated AI marketing product"),
        ("i'm thrilled", "sycophancy"),
        ("i'm pleased", "sycophancy"),
        ("thank you, mayor", "sycophancy"),
        ("continuous improvement", "vague fluff"),
        ("ongoing effort", "vague fluff"),
        ("marketing strategy", "vague fluff"),
        ("establish a version control", "off-topic"),
    ]
    for sig, reason in bad_signals:
        if sig in ll:
            return True, reason
    return False, None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turns", type=int, default=300, help="number of A↔B exchanges")
    ap.add_argument("--out", default="docs/MayorDebate-CRM-Improvements-2026.md")
    ap.add_argument("--context", default="", help="optional extra context loaded into opening")
    args = ap.parse_args()

    started = datetime.now(timezone.utc)
    print(f"🎙 Mayor Debate starting {started.isoformat()} — {args.turns} turns", flush=True)
    print(f"📝 Output: {args.out}", flush=True)
    print(f"🤖 Model: {LLM_MODEL} → {FAST_MODEL} → {TINY_MODEL}", flush=True)

    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        args.out,
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    convo_a = [{"role": "system", "content": MAYOR_A_SYS}]
    convo_b = [{"role": "system", "content": MAYOR_B_SYS}]
    opening = OPENING_PROMPT + (("\n\nEXTRA CONTEXT:\n" + args.context) if args.context else "")
    convo_a.append({"role": "user", "content": opening})
    convo_b.append({"role": "user", "content": opening})

    md_lines = [
        f"# 🏛 Mayor Debate — Mehyar.us CRM Roadmap ({started.strftime('%Y-%m-%d')})",
        "",
        "**Premise**: Two AI mayors — one BUILDER, one AUDITOR — debate how to evolve",
        "the mehyar.us admin CRM to drive revenue as fast as possible across every",
        "channel: services, SAM.gov, local businesses, cold outreach, gig platforms,",
        "and affiliate funnels.",
        "",
        f"- Started: {started.isoformat()}",
        f"- Turns: {args.turns}",
        f"- Model: `{LLM_MODEL}` (fallback `{FAST_MODEL}` → `{TINY_MODEL}`)",
        f"- Output: this document → fed into `scripts/kanban_from_debate.py`",
        f"- **CONTEXT HYGIENE**: Each mayor only sees the OPENING brief + the",
        f"  most recent 4 messages (~2 turns). This prevents context pollution",
        f"  from earlier sycophantic agreement. Full transcript is in this file",
        f"  for human review and kanban extraction.",
        "",
        "---",
        "",
        "## Opening Brief",
        "",
        "```",
        OPENING_PROMPT.strip(),
        "```",
        "",
        "---",
        "",
    ]
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    def truncated(convo):
        # System + opening + last 4 messages (2 turns). Keeps context small + fresh.
        return convo[:2] + convo[-4:]

    def ask_a(): return cf_query(truncated(convo_a), max_tokens=900, temperature=0.88).strip()
    def ask_b(): return cf_query(truncated(convo_b), max_tokens=900, temperature=0.80).strip()

    for turn in range(1, args.turns + 1):
        turn_start = time.time()
        # Mayor A first
        try:
            last_a = ask_a()
        except Exception as e:
            last_a = f"⚠️ Mayor A error: {e}"
            print(f"Turn {turn} A error: {e}", flush=True)
        convo_a.append({"role": "assistant", "content": last_a})
        convo_b.append({"role": "user", "content": f"Mayor A (Turn {turn}) said:\n\n{last_a}\n\nNow respond as Mayor B. Push back on anything that doesn't ship THIS WEEK or isn't grounded in Mehyar's actual services."})

        # Mayor B second
        try:
            last_b = ask_b()
        except Exception as e:
            last_b = f"⚠️ Mayor B error: {e}"
            print(f"Turn {turn} B error: {e}", flush=True)
        convo_b.append({"role": "assistant", "content": last_b})
        convo_a.append({"role": "user", "content": f"Mayor B (Turn {turn}) replied:\n\n{last_b}\n\nNow respond as Mayor A. Address any pushback — refine or kill the idea, don't just agree."})

        # Append to markdown
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(f"\n### Turn {turn}\n\n")
            f.write("#### 🟢 Mayor A — Builder\n\n")
            f.write(last_a + "\n\n")
            f.write("#### 🔵 Mayor B — Auditor\n\n")
            f.write(last_b + "\n\n")
            f.write("---\n")

        a_line = last_a.split("\n")[0][:80]
        b_line = last_b.split("\n")[0][:80]
        elapsed = time.time() - turn_start
        drift_a, reason_a = is_drift(last_a)
        drift_b, reason_b = is_drift(last_b)
        drift_marker = ""
        if drift_a or drift_b:
            drift_marker = f"  ⚠️ DRIFT: A={reason_a or 'OK'} | B={reason_b or 'OK'}"
        print(f"[{turn:3d}/{args.turns}] {elapsed:5.1f}s  A: {a_line}", flush=True)
        print(f"            {'':5s}     B: {b_line}{drift_marker}", flush=True)

    # ── Closing synthesis ─────────────────────────────────────────────────
    print("\n📊 Generating final synthesis…", flush=True)
    summary_prompt = (
        "FINAL TURN: Synthesize the entire debate into a concrete 30-day "
        "ship-list with weekly milestones, expected revenue impact, and the "
        "single most important thing to do TOMORROW. Output as markdown with "
        "exactly 4 sections:\n"
        "(1) **WHAT TO SHIP** — 30-day roadmap, prioritized by $ impact\n"
        "(2) **WHAT TO KILL** — features to abandon\n"
        "(3) **KILL CRITERIA** — how we'll know each feature worked or failed\n"
        "(4) **THE ONE THING** — what Mehyar does Monday morning.\n"
        "Be ruthless about prioritization. ≤ 500 words. NO '### Turn N' header. "
        "Stay grounded in Mehyar's actual services."
    )
    convo_a.append({"role": "user", "content": summary_prompt})
    convo_b.append({"role": "user", "content": summary_prompt})
    try:
        synth_a = cf_query(truncated(convo_a), max_tokens=1500, temperature=0.55).strip()
    except Exception as e:
        synth_a = f"⚠️ A synthesis error: {e}"
    try:
        synth_b = cf_query(truncated(convo_b), max_tokens=1500, temperature=0.55).strip()
    except Exception as e:
        synth_b = f"⚠️ B synthesis error: {e}"

    ended = datetime.now(timezone.utc)
    elapsed_total = (ended - started).total_seconds() / 60

    with open(out_path, "a", encoding="utf-8") as f:
        f.write("\n\n---\n\n## 🎯 Final Synthesis\n\n")
        f.write("### 🟢 Mayor A — Builder\n\n")
        f.write(synth_a + "\n\n")
        f.write("### 🔵 Mayor B — Auditor\n\n")
        f.write(synth_b + "\n\n")
        f.write(f"\n---\n\n*Debate ended {ended.isoformat()} — {elapsed_total:.1f} min for {args.turns} turns*\n")
        f.write("\n## 📦 Next step\n\n")
        f.write("Run `python scripts/kanban_from_debate.py` to convert the 30-day\n")
        f.write("roadmap into a kanban project.\n")

    print(f"\n✅ Debate complete: {out_path}", flush=True)
    print(f"   Total time: {elapsed_total:.1f} min for {args.turns} turns", flush=True)
    print(f"   Avg per turn: {(elapsed_total*60)/args.turns:.1f}s", flush=True)

if __name__ == "__main__":
    main()