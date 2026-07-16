#!/usr/bin/env python3
"""
kanban_from_debate.py — Convert the Mayor Debate markdown into a structured
kanban board JSON ready to import into a project tracker.

Reads:  docs/MayorDebate-CRM-Improvements-2026.md
Writes: docs/kanban-CRM-Improvements-2026.json
        docs/kanban-CRM-Improvements-2026.md  (human-readable)

Strategy: Heuristic extraction of the synthesis section (Mayor A + Mayor B
final turns). Pattern-matches "ship", "kill", "milestone", numbered lists.
Outputs tasks with:
  - id (slug from title)
  - title
  - description
  - priority (P0 / P1 / P2 derived from keywords)
  - lane (Now / Next / Later / Kill)
  - estimate_hours
  - revenue_impact_usd (best-effort from $ amounts mentioned)
  - deps (titles of tasks that block this one)
  - acceptance (the kill criterion)
  - source ("mayor_a" | "mayor_b" | "consensus")
"""

import os, re, sys, json, argparse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:60] or "task"

def extract_synthesis(text):
    """Pull the final synthesis out of the markdown debate log."""
    # Find the "Final Synthesis" heading
    m = re.search(r"## 🎯 Final Synthesis\s*(.+?)$", text, re.DOTALL)
    return m.group(1) if m else ""

def parse_dollar_amount(s):
    """Extract first $ amount in string. Returns int or None."""
    m = re.search(r"\$\s?(\d[\d,]*)\s*(k|K|m|M)?", s)
    if not m: return None
    n = int(m.group(1).replace(",", ""))
    suf = (m.group(2) or "").lower()
    return n * 1000 if suf == "k" else n * 1_000_000 if suf == "m" else n

def parse_hours(s):
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)\b", s, re.IGNORECASE)
    return float(m.group(1)) if m else None

def detect_lane(title, desc):
    t = (title + " " + desc).lower()
    if any(w in t for w in ["kill", "abandon", "drop", "stop doing"]):
        return "kill"
    if any(w in t for w in ["monday", "tomorrow", "this week", "p0", "ship now"]):
        return "now"
    if any(w in t for w in ["next", "week 2", "month 1", "p1"]):
        return "next"
    return "later"

def detect_priority(title, desc, lane):
    if lane == "kill": return "P3"
    if lane == "now":  return "P0"
    t = (title + " " + desc).lower()
    if any(w in t for w in ["p0", "critical", "revenue blocker"]): return "P0"
    if any(w in t for w in ["p1", "important"]): return "P1"
    if any(w in t for w in ["nice", "later", "maybe"]): return "P2"
    return "P1"

def extract_tasks_from_section(text, source_label):
    """Given a chunk of the mayor's synthesis, pull out tasks.

    Looks for:
      - numbered/bulleted lines starting with action verbs
      - sections with headers
    Returns list of {title, description}.
    """
    tasks = []
    # Try numbered list patterns
    bullet_pat = re.compile(
        r"^\s*(?:\d+[\.\)]\s+|[-*+]\s+|\*\*[^*]+\*\*[:\-])\s*(.+?)$",
        re.MULTILINE,
    )
    for m in bullet_pat.finditer(text):
        line = m.group(1).strip()
        # Heuristic: must look like a ship-able task — start with an action verb
        # OR contain a $/hour/day/week/month estimate OR be ≤ 90 chars
        action_verbs = (
            "ship", "build", "create", "add", "implement", "launch",
            "send", "write", "deploy", "fix", "kill", "drop", "abandon",
            "automate", "scan", "draft", "set up",
            "setup", "wire", "integrate", "enable", "publish", "post",
            "test", "measure", "track", "call", "email", "message",
            "buy", "invest", "hire", "delegate", "follow", "prioritize",
            "remove", "delete", "migrate", "consolidate", "simplify",
            "verify", "validate", "confirm", "schedule",
            "promote", "reach", "review", "refine", "adjust", "analyze",
            "make", "spend", "use", "complete", "start", "begin",
            "follow", "resume", "pause", "monitor",
        )
        # Reject obvious non-tasks (fragments, criteria, fluff)
        reject_patterns = (
            "expected revenue impact",
            "expected $ impact",
            "lead conversion rate",
            "phone call conversion rate",
            "if any of the above",
            "roi estimate",
            "conversion rate:",
            "lead drawer",
            "public site has",
            "audit report",
            "4-tab admin",
            "what is the plan",
            "how will we",
            "what's the plan",
        )
        ll = line.lower()
        looks_like_task = (
            len(line) > 8
            and len(line) < 220
            and not line.startswith(("#", "```", "|", "http"))
            and not any(p in ll for p in reject_patterns)
            and (
                any(ll.startswith(v) for v in action_verbs)
                or any(f" {v} " in ll for v in action_verbs if v[0] != " ")
                or bool(re.search(r"\$\d", line))
                or bool(re.search(r"\d+\s*(h|hr|hrs|hour|hours|day|week|month|min)s?", ll))
            )
        )
        if not looks_like_task:
            continue
        # First sentence is title, rest is description
        parts = re.split(r"(?<=[.!?])\s+", line, maxsplit=1)
        title = parts[0][:120].strip()
        desc  = parts[1] if len(parts) > 1 else ""
        tasks.append({"title": title, "description": desc.strip(), "source": source_label})
    return tasks

def parse_debate(path):
    text = open(path, encoding="utf-8").read()
    synth = extract_synthesis(text)

    a_match = re.search(r"### 🟢 Mayor A — Builder\s*(.+?)(?=### 🔵 Mayor B — Auditor|$)",
                        synth, re.DOTALL)
    b_match = re.search(r"### 🔵 Mayor B — Auditor\s*(.+?)$", synth, re.DOTALL)
    a_text = a_match.group(1).strip() if a_match else ""
    b_text = b_match.group(1).strip() if b_match else ""

    tasks = []

    # First, extract from the synthesis (highest signal — these are the
    # distilled, final conclusions)
    if a_text or b_text:
        tasks += extract_tasks_from_section(a_text, "mayor_a_synthesis")
        tasks += extract_tasks_from_section(b_text, "mayor_b_synthesis")

    # Then, supplement with high-signal tasks from the FIRST 30 turns of the
    # debate (where debate quality is highest; later turns get repetitive)
    turn_blocks = re.findall(r"### Turn (\d+)\s*\n\n#### 🟢 Mayor A — Builder\s*\n\n(.+?)\n\n#### 🔵 Mayor B — Auditor", text, re.DOTALL)
    early_turns_text = ""
    for turn_num, content in turn_blocks[:30]:
        early_turns_text += "\n" + content
    if early_turns_text:
        tasks += extract_tasks_from_section(early_turns_text, "mayor_a_early")

    # Deduplicate by title (case-insensitive, first 80 chars)
    seen = set()
    deduped = []
    for t in tasks:
        k = t["title"][:80].lower().strip()
        if k in seen: continue
        seen.add(k)
        deduped.append(t)
    return deduped

def build_kanban(tasks):
    out = []
    for t in tasks:
        title = t["title"]
        desc = t["description"]
        combined = f"{title}. {desc}"
        lane = detect_lane(title, desc)
        pri = detect_priority(title, desc, lane)
        rev = parse_dollar_amount(combined)
        hrs = parse_hours(combined)
        # Pull a likely acceptance criterion
        kill_match = re.search(r"(?:kill if|abandon if|stop if)[^.]+[.:]", combined, re.IGNORECASE)
        accept = kill_match.group(0).strip() if kill_match else None
        out.append({
            "id": slug(title),
            "title": title,
            "description": desc[:600],
            "lane": lane,
            "priority": pri,
            "estimate_hours": hrs,
            "expected_revenue_usd": rev,
            "acceptance": accept,
            "source": t["source"],
            "deps": [],
        })
    return out

def render_kanban_md(kanban):
    lanes = {"now": [], "next": [], "later": [], "kill": []}
    for t in kanban:
        lanes[t["lane"]].append(t)
    out = [f"# 📋 Kanban — Mehyar.us CRM Improvements",
           f"_Generated {datetime.now(timezone.utc).isoformat()}_",
           f"_Source: Mayor Debate output_",
           ""]
    for lane, items in lanes.items():
        emoji = {"now":"🔥","next":"📅","later":"🌤","kill":"💀"}[lane]
        out.append(f"## {emoji} {lane.upper()} ({len(items)} tasks)")
        out.append("")
        for t in items:
            rev = f" → ${t['expected_revenue_usd']:,}" if t['expected_revenue_usd'] else ""
            hrs = f" ({t['estimate_hours']}h)" if t['estimate_hours'] else ""
            out.append(f"### [{t['priority']}] {t['title']}{rev}{hrs}")
            out.append(f"- **Source**: {t['source']}")
            if t['description']: out.append(f"- **Description**: {t['description']}")
            if t['acceptance']:  out.append(f"- **Kill criterion**: {t['acceptance']}")
            out.append("")
    out.append("---")
    out.append("")
    out.append("## 🟢 Now (P0) — what to ship this week")
    out.append("## 🟡 Next (P1) — week 2-3")
    out.append("## 🌤 Later (P2) — month 2-3")
    out.append("## 💀 Kill — features to abandon")
    out.append("")
    out.append("_Generated by `scripts/kanban_from_debate.py`_")
    return "\n".join(out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="docs/MayorDebate-CRM-Improvements-2026.md",
                    help="debate markdown input")
    ap.add_argument("--json-out", default="docs/kanban-CRM-Improvements-2026.json")
    ap.add_argument("--md-out",   default="docs/kanban-CRM-Improvements-2026.md")
    args = ap.parse_args()

    src = os.path.join(ROOT, args.inp)
    if not os.path.exists(src):
        print(f"ERROR: {src} not found. Run scripts/mayor_debate.py first.")
        sys.exit(1)

    tasks = parse_debate(src)
    kanban = build_kanban(tasks)
    print(f"📊 Extracted {len(kanban)} tasks from {src}")

    json_path = os.path.join(ROOT, args.json_out)
    md_path   = os.path.join(ROOT, args.md_out)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": args.inp,
            "task_count": len(kanban),
            "tasks": kanban,
        }, f, indent=2)

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(render_kanban_md(kanban))

    print(f"✅ Wrote {json_path}")
    print(f"✅ Wrote {md_path}")

    # Summary by lane
    by_lane = {}
    for t in kanban:
        by_lane[t["lane"]] = by_lane.get(t["lane"], 0) + 1
    print("\n📋 Distribution:")
    for lane, n in sorted(by_lane.items()):
        print(f"   {lane:7s} : {n}")

if __name__ == "__main__":
    main()