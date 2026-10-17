// WhatsApp chat-lane reply engine — MehyarSoft WABA (+1 747-777-2687).
// Scripts are DATA transcribed from ~/workspace/ads-chief-of-staff/reply-pack.md
// (2026-10-16 pack; keep the two in sync — the pack is the source of truth).
// Flow per product: free-thing delivery -> qualifiers -> close -> follow-up.
// Closes carry a [PAYMENT LINK] slot in the pack; until Stripe links mint,
// compose() substitutes the product's interim SITE checkout URL (the pack's
// labeled INTERIM path) and strips the INTERIM annotation lines.
// Guardrail: the engine never invents prices/claims beyond these scripts.
// Anything off-script gets a safe fallback + review=1 in social_inbox_log.

export const WA_ACCOUNT = "whatsapp";

const CHECKLIST = "https://mehyar.us/free-checklist/";

export const WA_SCRIPTS = {
  audit: {
    product_id: "audit",
    name: "Audit",
    checkout: "https://mehyar.us/audit/",
    referral_hints: ["missed", "calls last month", "missed-call"],
    keywords: ["missed call", "missed-call", "checklist", "audit"],
    free:
`Hey, glad you tapped in 👋 Here's your free Missed-Call Checklist — it
shows the 8 places shops leak calls, customers, and follow-ups:
${CHECKLIST}

Quick favor so I send you the right stuff next: what kind of business
are you running?`,
    qualify:
`Three quick ones:
1) Roughly how many calls does the shop get on a busy day?
2) When nobody picks up, what happens — voicemail, a text back, or
   nothing?
3) Who answers the phone when you're under a car / with a customer?`,
    close:
`So here's what the full Audit does: we go through your calls, website,
follow-ups, and tools, and hand you a written report of every leak +
what each one is costing you + the fix order. One-time, $330 — no
subscription, and the report is yours whether you hire us for anything
after or not.

Grab it here: [PAYMENT LINK]

Want me to walk you through what the report covers first? Happy to.`,
    follow:
`Still thinking about it? Totally fine. Quick freebie either way: take
your average job value and multiply it by the calls you miss in a week.
That number is what the checklist — and the Audit — is really about.
Want me to run the estimate with your numbers?`,
    follow2:
`Closing the loop on my end — the Audit offer from the ad is still open
if you want the full leak report for your shop: [PAYMENT LINK]
No pressure either way, the checklist is yours to keep 👍`,
  },

  mayor: {
    product_id: "mayor",
    name: "The Mayor",
    checkout: "https://mayor.mehyar.us",
    referral_hints: ["mayor of your business", "meet the mayor"],
    keywords: ["mayor", "chief of staff", "busywork"],
    free:
`Welcome in 👋 The Mayor is the AI that runs your business's busywork —
messages, follow-ups, invoices, scheduling — from one chat.

Here's the free Business AI Checklist from the ad, shows where owners
lose hours every week: ${CHECKLIST}

So I point you at the right demo: what kind of business is it?`,
    qualify:
`Quick three:
1) What's the most annoying recurring task in your week?
2) How do customers mostly reach you — calls, texts, Instagram, email?
3) Anyone helping you with admin right now, or is it all you?`,
    // PRICE NOTE (updated 2026-10-16 evening): $99/mo list is LIVE
    // (price_1URJfc4NaXpNyV6yLTlj5PyF); founding cohort — first 25
    // businesses — locks $79.20/mo (price_1URJfc4NaXpNyV6yDJQ8UcFu).
    // Verified on served bytes by the Chief of Chiefs 18:42 ET. The
    // chat payment link mints at the $79.20 founding price once the
    // API lane is live; until then [PAYMENT LINK] = the site URL.
    close:
`Here's the deal: The Mayor is $99/mo. It answers, follows up, and keeps
your day moving like a chief of staff who never sleeps. Right now the
founding cohort is open — the first 25 businesses lock $79.20/mo.
First month is the test — if it doesn't save you real hours, cancel,
no hard feelings.

Start here: [PAYMENT LINK]`,
    follow:
`No rush — one thought: every day without a follow-up system, warm leads
go cold quietly. The checklist shows the leak; The Mayor plugs it —
$99/mo, founding cohort $79.20/mo: [PAYMENT LINK]
Want a 2-minute demo with your kind of business instead? Say the word.`,
  },

  coach: {
    product_id: "coach",
    name: "Coach Pro",
    checkout: "https://coach.mehyar.us",
    referral_hints: ["interview question", "candidacies"],
    keywords: ["interview", "star answer", "coach"],
    free:
`Hey! Here's your free STAR answer sample — for the killer question
"Tell me about a challenge you overcame":

S — "Our team's release slipped two weeks right before launch."
T — "I owned getting us back on schedule without cutting quality."
A — "I split the work into must-ship vs later, ran 15-min daily
check-ins, and flagged risks to leadership early."
R — "We launched on the new date with zero critical bugs."

See the shape? Situation → Task → Action → Result, 60 seconds spoken.
Coach turns YOUR stories into answers like that.

What role are you interviewing for?`,
    qualify:
`Three quick ones:
1) What job / level are you going for?
2) When's the interview (or are you still applying)?
3) Which question do you dread most?`,
    close:
`Coach Pro is $19/mo: mock interviews in chat, your real stories
rebuilt as STAR answers, and feedback after every round — so you walk
in sounding like the person they already decided to hire.

Start here: [PAYMENT LINK]
Interview coming up fast? Tell me the date and we'll prioritize.`,
    follow:
`Still prepping? Free tip either way: record yourself answering "tell me
about yourself" and play it back — if it runs past 90 seconds or starts
with your childhood, that's the leak Coach fixes first.
$19/mo when you're ready: [PAYMENT LINK]`,
  },

  designful: {
    product_id: "designful",
    name: "Designful",
    checkout: "https://mehyar.us/apps",
    referral_hints: ["flyer"],
    keywords: ["designful", "flyer", "teardown", "homepage", "logo", "design"],
    free:
`Hey, welcome 👋 Send me the flyer / post / logo you're not happy with
(or just tell me what you need designed) and I'll give you a straight,
free critique + the direction I'd take it. No obligation, no fluff.

What are we designing?`,
    qualify:
`Quick three:
1) What do you need — flyer, social posts, logo, a full kit?
2) What's it for (a promo, an event, everyday marketing)?
3) When do you need it by?`,
    close:
`Here's the flagship: the Designful "Homepage Teardown — AI Audit",
$49 one-time. Your homepage, torn down and rebuilt as finished,
ready-to-post design — not templates you have to wrestle with. Send
the brief, get design you can actually use.

Order here: [PAYMENT LINK]
Want to see what the $49 version looks like vs the free critique? I'll
show you a sample.`,
    follow:
`Still sitting on that design? The free critique stands whenever — send
the file and I'll tell you honestly what I'd fix first. And if you want
it just DONE, the $49 Homepage Teardown is here: [PAYMENT LINK]`,
  },

  legit: {
    product_id: "legit",
    name: "Legit",
    checkout: "https://legit.mehyar.us",
    referral_hints: ["forming an llc", "3 questions people get wrong"],
    keywords: ["legit", "llc", "s-corp", "scorp", "operating agreement", "forming"],
    free:
`Hey 👋 Here are the 3 LLC questions almost everyone gets wrong:

1) "An LLC protects me from everything, right?" — No. It separates
   business liability, but you can still be personally on the hook
   (personal guarantees, your own actions, mixing money).
2) "S-corp or LLC — which saves tax?" — Depends on your profit. Under
   ~$40–60k it's often a wash; above it, the election can matter a lot.
3) "Do I need an operating agreement if it's just me?" — In several
   states, effectively yes — and banks/courts take you more seriously
   with one.

Which state are you forming in? That changes half the answers.`,
    qualify:
`Three quick ones:
1) What state are you forming (or formed) in?
2) Just you, or co-founders/partners?
3) Already selling, or still pre-launch?`,
    close:
`Legit takes your exact situation — state, partners, what you're
selling — and gives you the full, straight answer set: formation
steps, the tax-election call, and the paperwork checklist, in plain
English. $29 one-time.

Get it here: [PAYMENT LINK]
Not legal advice from a lawyer — it's the map so you stop guessing
(and know what to ask a lawyer if you hire one).`,
    follow:
`Forming move still on? One free heads-up: the most expensive LLC
mistake is mixing personal + business money from day one — separate
account, even before the paperwork lands.
When you're ready for the full walkthrough, it's $29: [PAYMENT LINK]`,
  },

  moonroom: {
    product_id: "moonroom",
    name: "Moonroom",
    checkout: "https://moonroom.mehyar.us",
    referral_hints: ["selfie", "portrait"],
    keywords: ["moonroom", "portrait", "selfie", "headshot", "glam"],
    // The free portrait is made by a human (pack note) — every Moonroom
    // conversation past the free step flags review=1 for pickup.
    human_step: true,
    free:
`Hi!! ✨ Send me one selfie you like (front-facing, decent light works
best) and your first Moonroom portrait is on me — pick a vibe:
professional headshot, golden-hour glow, or full glam.

Which vibe are we starting with?`,
    qualify:
`While I work on it, quick two:
1) What's the portrait for — profile pic, dating apps, work, gifts?
2) Want to keep it natural-you, or go full styled-shoot?`,
    close:
`Okay that came out GOOD, right? 😍 The full Moonroom top pack is $24:
the whole set of styles — headshots, product shots, themed portraits —
from your selfies, no photographer, no $300 shoot.

Get the pack here: [PAYMENT LINK]`,
    follow:
`Your free portrait is still waiting whenever you are — one selfie is
all it takes. And the full $24 pack (every style) is here when you want
the whole set: [PAYMENT LINK]`,
    holding:
`Your portrait is in the works ✨ — a human on our team finishes the
free one by hand, so it lands here in this chat shortly. The full $24
pack (every style) is here whenever you want the whole set: [PAYMENT LINK]`,
  },

  promptvault: {
    product_id: "promptvault",
    name: "PromptPack Pro",
    checkout: "https://mehyar.us/apps",
    referral_hints: ["paste"],
    keywords: ["promptpack", "prompt vault", "promptpack pro", "prompts", "vault"],
    free:
`Hey! Skip the blank page — here's the deal from the ad: send me ONE
rough thing you're working on (a listing draft, an email you need, a
post idea) and I'll send back the finished version, free, so you can
see exactly what the Vault does.

What are you working on — and which hat: realtor, teacher, creator,
or business owner?`,
    qualify:
`Quick three:
1) What do you write most — listings, parent emails, posts, client emails?
2) How many of those do you produce in a week?
3) Want the finished pieces done-for-you style, or templates you remix?`,
    close:
`PromptPack Pro is $19 one-time: the full pack, built to hand you
FINISHED output — listing copy, emails, posts, lesson material — not
homework. The prompts ride along as a bonus.

Grab it here: [PAYMENT LINK]
You already saw one finished piece free — imagine your whole week of
them.`,
    follow:
`The free finished piece offer stands — send me one rough draft
anytime, judge the output yourself. PromptPack Pro ($19):
[PAYMENT LINK]`,
  },
};

export const WA_MENU =
`Hey, welcome to MehyarSoft 👋 Tell me which one you came for and I'll
send the free starter right away:

1) Audit — free Missed-Call Checklist for shops that lose calls
2) The Mayor — the AI that runs your business busywork
3) Coach — interview prep with STAR answers
4) Designful — design, done for you
5) Legit — LLC answers in plain English
6) Moonroom — studio portraits from a selfie
7) PromptPack Pro — finished listings, emails & posts

Just reply with the name (or the number).`;

const MENU_ORDER = ["audit", "mayor", "coach", "designful", "legit", "moonroom", "promptvault"];

const BUY_INTENT = ["price", "how much", "buy", "order", "sign up", "signup",
  "sign-up", "purchase", "get it", "checkout", "pay", "cost"];

function compose(script, step) {
  const raw = script[step] || "";
  return raw.split("[PAYMENT LINK]").join(script.checkout);
}

function fallbackText(script) {
  if (!script) return WA_MENU;
  return (
    `Good question — that one's beyond my script, so I've flagged it for ` +
    `a human on our team to answer properly rather than guess. Meanwhile, ` +
    `everything about ${script.name} is here: ${script.checkout} — and the ` +
    `free starter from the ad is yours either way.`
  );
}

function hintMatch(haystack, hints) {
  const h = String(haystack || "").toLowerCase();
  return hints.some((x) => h.includes(x));
}

// Decide the product: CTWA referral first (what the ad promised), then
// keywords in the message, then the number-menu digit, then the product
// of the existing conversation with this sender.
export function detectWhatsAppProduct({ referral, text, priorProductId }) {
  const refText = [referral?.headline, referral?.body, referral?.source_url]
    .filter(Boolean).join(" ");
  if (refText) {
    for (const s of Object.values(WA_SCRIPTS)) {
      if (hintMatch(refText, s.referral_hints)) return s.product_id;
    }
  }
  const t = ` ${String(text || "").toLowerCase()} `;
  for (const s of Object.values(WA_SCRIPTS)) {
    if (s.keywords.some((k) => t.includes(k))) return s.product_id;
  }
  const digit = String(text || "").trim();
  if (/^[1-7]$/.test(digit)) return MENU_ORDER[Number(digit) - 1];
  return priorProductId || null;
}

// history: prior INBOUND log rows for this sender (kind 'wa'), oldest first.
// Returns { product_id, step, reply_text, needs_review }.
export function decideWhatsAppReply({ text, type, referral, history }) {
  const prior = Array.isArray(history) ? history : [];
  const priorProductId = prior.length ? prior[prior.length - 1].product_id : null;
  const productId = detectWhatsAppProduct({ referral, text, priorProductId });

  if (!productId) {
    return { product_id: null, step: "menu", reply_text: WA_MENU, needs_review: false };
  }
  const script = WA_SCRIPTS[productId];
  // Steps already taken in THIS product's thread (product switches restart).
  const taken = prior.filter((r) => r.product_id === productId).length;
  const lower = String(text || "").toLowerCase();
  const buyIntent = BUY_INTENT.some((k) => lower.includes(k));

  // Non-text inbound (image/file/etc.): a human artifact in most flows
  // (Moonroom selfie, Designful file) — advance with the free step if new,
  // otherwise a holding reply; always flag for human pickup.
  if (type && type !== "text") {
    if (taken === 0) {
      return { product_id: productId, step: "free", reply_text: compose(script, "free"), needs_review: true };
    }
    const hold = script.holding || fallbackText(script);
    return { product_id: productId, step: "holding", reply_text: hold.split("[PAYMENT LINK]").join(script.checkout), needs_review: true };
  }

  if (taken === 0) {
    return { product_id: productId, step: "free", reply_text: compose(script, "free"), needs_review: false };
  }
  if (taken === 1) {
    return { product_id: productId, step: "qualify", reply_text: compose(script, "qualify"), needs_review: !!script.human_step };
  }
  if (taken === 2) {
    if (script.human_step) {
      return { product_id: productId, step: "holding", reply_text: script.holding.split("[PAYMENT LINK]").join(script.checkout), needs_review: true };
    }
    return { product_id: productId, step: "close", reply_text: compose(script, "close"), needs_review: false };
  }
  // Past the close: buying intent re-sends the close; anything else is
  // off-script — safe fallback + human review, never an invented answer.
  if (buyIntent) {
    return { product_id: productId, step: "close", reply_text: compose(script, "close"), needs_review: false };
  }
  return { product_id: productId, step: "fallback", reply_text: fallbackText(script), needs_review: true };
}
