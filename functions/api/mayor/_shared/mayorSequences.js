// /api/mayor/_shared/mayorSequences.js
// Default 3-step outreach sequence. Pure template logic — no LLM needed.
// Each function returns { subject, body_text, send_after_days }.

const FIRST_NAME_FALLBACK = "there";

function pickName(prospect) {
  const raw = prospect?.first_name || prospect?.owner_name || "";
  if (!raw) return FIRST_NAME_FALLBACK;
  return raw.split(/\s+/)[0] || FIRST_NAME_FALLBACK;
}

function segmentHint(prospect) {
  const vertical = String(prospect?.vertical || "local service").toLowerCase();
  const city = prospect?.city || "your area";
  return `${vertical} businesses in ${city}`;
}

function painHint(prospect) {
  return prospect?.top_pain || "missed calls, abandoned forms, or manual follow-up";
}

function optOutFooter() {
  return "Unsubscribe: https://mehyar.us/unsubscribe";
}

// ── Step 1 (day 0) — initial cold outreach ───────────────────────────────

export function step1(prospect) {
  const name  = pickName(prospect);
  const biz   = prospect?.business_name || "your business";
  const hint  = segmentHint(prospect);
  const pain  = painHint(prospect);

  return {
    subject: `Possible lead leak at ${biz}`,
    body_text:
`Hi ${name},

I noticed ${biz} while reviewing ${hint} and saw a likely revenue leak: ${pain}.

I run MehyarSoft, a founder-led software and automation shop. The smallest useful next step is a $150 leak audit: I map the issue, show the first fix, and only quote a $250 diagnosis, $1.5k-$7.5k quick fix, or retainer if there is a real business case.

Should I send the audit scope? If it fits, I confirm scope first and invoice manually by email.

— Mehyar
mehyar@mehyar.us · mehyar.us
${optOutFooter()}`,
    send_after_days: 0,
  };
}

// ── Step 2 (day 3) — bump ────────────────────────────────────────────────

export function step2(prospect) {
  const name = pickName(prospect);
  const biz  = prospect?.business_name || "your business";

  return {
    subject: `Re: possible lead leak at ${biz}`,
    body_text:
`Hi ${name} —

Quick follow-up on my note about ${biz}. I am not selling a big rebuild first; I am trying to confirm whether there is a small paid fix worth scoping.

For most local businesses, the first paid step should be narrow: a $150 audit or $250 written diagnosis, then a fixed-scope quick fix only if the evidence supports it.

Should I send the audit scope, or is someone else the right person?

— Mehyar
${optOutFooter()}`,
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

I will close this out unless a paid leak audit or written diagnosis would be useful. The goal would be simple: identify whether your site, intake, CRM, or follow-up is losing leads before quoting any larger work.

Worth revisiting, or should I leave it alone?

— Mehyar
${optOutFooter()}`,
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
      send_after_days: tpl.send_after_days,
      scheduled_for: due.toISOString(),
      status: "queued",
    });
  }
  return steps;
}
