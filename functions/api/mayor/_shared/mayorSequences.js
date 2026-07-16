// /api/mayor/_shared/mayorSequences.js
// Default 3-step outreach sequence. Pure template logic — no LLM needed.
// Each function returns { subject, body_text, send_after_days }.

const FIRST_NAME_FALLBACK = "there";

function pickName(prospect) {
  const raw = prospect?.first_name || prospect?.owner_name || "";
  if (!raw) return FIRST_NAME_FALLBACK;
  return raw.split(/\s+/)[0] || FIRST_NAME_FALLBACK;
}

function verticalHint(vertical) {
  if (!vertical) return "a Brooklyn service business";
  return `a ${vertical.toLowerCase()} business in Brooklyn`;
}

// ── Step 1 (day 0) — initial cold outreach ───────────────────────────────

export function step1(prospect) {
  const name  = pickName(prospect);
  const biz   = prospect?.business_name || "your business";
  const hint  = verticalHint(prospect?.vertical);
  const pain  = prospect?.top_pain || "10 hours a week lost to repetitive admin work";

  return {
    subject: `Quick question for ${biz}`,
    body_text:
`Hi ${name},

I noticed ${biz} — saw ${hint}. Most ${prospect?.vertical || "service"} owners I talk to lose ~${pain} on tasks an AI tool could handle for under $200/mo.

I run a Brooklyn-based dev shop (mehyar.us). I help ${hint}s cut that 10 hrs/week with one small automation. No pitch deck — 15 min, I show you what I'd build and what it'd cost.

Worth a quick chat?

— Mehyar
mehyar@mehyar.us · mehyar.us`,
    send_after_days: 0,
  };
}

// ── Step 2 (day 3) — bump ────────────────────────────────────────────────

export function step2(prospect) {
  const name = pickName(prospect);
  const biz  = prospect?.business_name || "your business";

  return {
    subject: `Re: Quick question for ${biz}`,
    body_text:
`Hi ${name} —

Did my note get buried? Sending one concrete example: a Brooklyn cafe I worked with cut inventory counting from 4h/wk to 30 min with a $200 tool. Took 1 week to ship, paid back in 3 weeks.

Worth 15 min to see if it fits ${biz}?

— Mehyar`,
    send_after_days: 3,
  };
}

// ── Step 3 (day 8) — break-up ────────────────────────────────────────────

export function step3(prospect) {
  const name = pickName(prospect);

  return {
    subject: `closing the loop`,
    body_text:
`Hi ${name} —

Last note — promise. If timing's off, totally fine.

I've got a one-pager: "10 AI tools Brooklyn service businesses can ship this week" — useful whether or not we ever work together. Want me to send it?

— Mehyar`,
    send_after_days: 8,
  };
}

export const SEQUENCE = { step1, step2, step3 };

// ── Schedule the full 3-step sequence for a new prospect ─────────────────

export function buildSequenceSteps(prospect, baseDate = new Date()) {
  const steps = [];
  for (let n = 1; n <= 3; n++) {
    const fn = SEQUENCE[`step${n}`];
    const tpl = fn(prospect);
    const due = new Date(baseDate.getTime() + tpl.send_after_days * 86400000);
    steps.push({
      step_no: n,
      subject: tpl.subject,
      body_text: tpl.body_text,
      scheduled_for: due.toISOString(),
      status: "queued",
    });
  }
  return steps;
}