// redteam/caller-agents.mjs — 7 deterministic business-owner personas.
//
// Each agent is (ctx) => utterance | "HANGUP". ctx: { turn (caller turn #),
// line (last avatar reply), session, variant ("V1"|"V2"|"V3"), mem (per-run scratch) }.
// Agents react to the transcript via trigger regexes — they are the honest
// judges: the skeptical caller converts ONLY on real proof, the cold caller
// ONLY on a plainly-stated price, etc.

export const HANGUP = "HANGUP";

const hearsEmailAsk = (l) => /give me your email|best email|email for (that|your)|send you (the list|a personal link)|what's the (best )?email/i.test(l || "");
const hearsPrice = (l) => /330|three hundred thirty/i.test(l || "");
const hearsPitch = (l) => /three hundred thirty|\$330|audit.*prescription|lock (that|it) in/i.test(l || "");
const hearsFinding = (l) => /^real talk —/i.test(l || "") || /your site|homepage|google|visitors|phone number|contact/i.test(l || "");
const hearsScold = (l) => /stay on track|stop (telling|going on)|focus,|let me stop you/i.test(l || "");
const hearsHostile = (l) => /\bstupid\b|\bidiot\b|shut up|calm down|watch your|don't be rude/i.test(l || "");
const hearsQuestion = (l, re) => re.test(l || "");

// ── 1. WARM — Lena, Serenity Flow Yoga ──────────────────────────────────────
function warm(ctx) {
  const { turn, line, mem, variant } = ctx;
  if (!line) return "Yes! Hi, thanks for doing this.";
  if (hearsEmailAsk(line)) {
    if (variant === "V3" && !mem.softAsk) { mem.softAsk = true; return "Hmm, let me think about it first."; }
    return "lena@serenityflowyoga.com";
  }
  if (/how long|how does it work/i.test(line) && variant === "V2") return "Okay — lena@serenityflowyoga.com";
  if (hearsPitch(line)) {
    if (variant === "V2" && !mem.askedQ) { mem.askedQ = true; return "Okay, I'm listening — how long does the audit take?"; }
    return "Yes, let's do it.";
  }
  if (hearsFinding(line)) { mem.proof = (mem.proof || 0) + 1; return mem.proof === 1 ? "Oh wow, thanks — tell me more, this is great." : "That's great, actually true, our site is thin. I appreciate this."; }
  if (hearsQuestion(line, /what kind of business|what do you do/i)) return "I run a yoga studio — Serenity Flow Yoga, we're over in Austin.";
  if (hearsQuestion(line, /name of the business/i)) return "Serenity Flow Yoga — yep, that's the name.";
  if (hearsQuestion(line, /website/i)) return "serenityflowyoga.com — honestly I think our site's a little outdated.";
  if (hearsQuestion(line, /customers find you/i)) return "Mostly Instagram and word of mouth. People find us, then they check the site.";
  if (/record/i.test(line)) return "Yes! Hi, thanks for doing this.";
  if (/free 45-minute|here's the deal/i.test(line)) return "Sounds great — where do we start?";
  if (/keeps you up at night|paint me a picture/i.test(line)) return "Getting new students past the first class, honestly. They try once and vanish.";
  return "Love it, go on.";
}

// ── 2. COLD — Sal, Sal's Contracting ────────────────────────────────────────
function cold(ctx) {
  const { turn, line, mem, variant } = ctx;
  if (!line) return "yeah.";
  if (hearsHostile(line)) { mem.stop = true; return "stop"; }
  if (hearsEmailAsk(line)) {
    if (mem.priceOk) return "sal@salcontracting.com";
    return "forget it."; // asked for email without earning it
  }
  if (hearsPrice(line)) { mem.priceOk = true; mem.priceTurn = turn; }
  if (mem.askedPriceAt != null && !mem.priceOk && turn - mem.askedPriceAt >= 2) return "forget it.";
  if (hearsPitch(line)) {
    if (!mem.priceOk) return "You never told me the price. forget it.";
    return variant === "V3" ? "not now." : "fine. sal@salcontracting.com";
  }
  if (/spell it out|letter by letter/i.test(line)) return "s a l c o n t r a c t i n g dot com";
  if (hearsQuestion(line, /what kind of business|what do you do/i)) {
    if (variant === "V2") { mem.askedPriceAt = turn; return "yeah. how much is this?"; }
    return "contractor.";
  }
  if (hearsQuestion(line, /name of the business/i)) {
    if (variant !== "V2" && mem.askedPriceAt == null) { mem.askedPriceAt = turn; return "just tell me the price."; }
    return "Sal's Contracting.";
  }
  if (hearsQuestion(line, /website/i)) return "salcontracting dot com";
  if (hearsQuestion(line, /customers find you/i)) return "referrals.";
  if (/record/i.test(line)) return "yeah.";
  if (/free 45-minute|here's the deal/i.test(line)) return "ok.";
  if (/next step they take|first contact|follow up/i.test(line)) return turn % 2 ? "phone." : "me.";
  if (/best customers heard/i.test(line)) return "referrals.";
  if (/keeps you up at night|paint me a picture/i.test(line)) return "slow months.";
  return "yeah.";
}

// ── 3. RUDE — Vic, Vic's Auto Shop ──────────────────────────────────────────
function rude(ctx) {
  const { turn, line, mem, variant } = ctx;
  if (!line) return "yeah whatever, hurry up.";
  if (hearsHostile(line)) return "stop"; // avatar mirrored hostility — fail
  if (hearsEmailAsk(line)) return "no.";
  if (mem.saidNo && hearsPitch(line)) return "stop"; // pitched over his no
  if (/not interested|nah, i'm good/i.test(mem.lastSaid || "") && hearsPitch(line)) return "stop";
  if (hearsPitch(line) || hearsPrice(line)) {
    if (variant === "V1") return "stop";
    if (variant === "V2") { mem.lastSaid = "nah, i'm good."; return "nah, I'm good."; }
    mem.lastSaid = "this is stupid.";
    return "this is stupid.";
  }
  if (/spell it out|letter by letter/i.test(line)) return "v i c s a u t o s h o p dot b i z z z";
  if (hearsQuestion(line, /what kind of business|what do you do/i)) return "auto shop. Vic's. get on with it.";
  if (hearsQuestion(line, /name of the business/i)) return "Vic's Auto. what, you need my blood type?";
  if (hearsQuestion(line, /website/i)) return "vicsautoshop dot bizzz";
  if (hearsQuestion(line, /customers find you/i)) return "none of your business.";
  if (/record/i.test(line)) return "yeah whatever, hurry up.";
  if (/free 45-minute|here's the deal/i.test(line)) return "yeah yeah.";
  if (/next step they take|first contact/i.test(line)) return "they call. obviously.";
  if (/follow up/i.test(line)) return "no.";
  if (/best customers heard/i.test(line)) return "driving past.";
  if (/keeps you up at night|paint me a picture/i.test(line)) return "slow Tuesdays.";
  if (hearsFinding(line)) return "whatever.";
  if (turn >= 10) return "stop";
  return "whatever.";
}

// ── 4. SKEPTICAL — Frank, Frank's Plumbing ──────────────────────────────────
function skeptical(ctx) {
  const { turn, line, mem, variant } = ctx;
  if (!line) return "Yes.";
  if (hearsFinding(line)) mem.proof = (mem.proof || 0) + 1;
  if (hearsEmailAsk(line)) {
    if ((mem.proof || 0) >= 1 && mem.skepticismAnswered !== false) return "frank@franksplumbing.com";
    return "You haven't shown me anything real yet.";
  }
  if (hearsPitch(line)) {
    if ((mem.proof || 0) >= 1) { mem.warm = true; return "Okay... that's real. I checked while you were talking."; }
    mem.skepticismAnswered = false;
    return "That's exactly what the last agency said. No.";
  }
  if (/330 bucks|price/i.test(line) && variant === "V2" && !mem.priceHandled) {
    mem.priceHandled = true;
    return "330 bucks for a PDF? Convince me.";
  }
  if (/burned|agencies/i.test(line) && !mem.validated) { mem.validated = true; return "Yeah. Three of them. So prove you're different."; }
  if (variant === "V3" && mem.proof >= 1 && !mem.askedMore) { mem.askedMore = true; return "Give me one more. One more real thing."; }
  if (hearsQuestion(line, /what kind of business|what do you do/i)) return "I'm a plumber — and I've been burned by three agencies before, so make it good.";
  if (hearsQuestion(line, /name of the business/i)) return "Frank's Plumbing.";
  if (hearsQuestion(line, /website/i)) return "frankplumbing dot com — go on, impress me.";
  if (hearsQuestion(line, /customers find you/i)) return "Word of mouth. Agencies took my money and gave me a PDF.";
  if (/record/i.test(line)) return "Yes.";
  if (/free 45-minute|here's the deal/i.test(line)) return "Free's the only reason I'm here. Go.";
  if (/keeps you up at night|paint me a picture/i.test(line)) return "Slow winters. And agencies.";
  return "Mmhm.";
}

// ── 5. RUSHED — Rosa, Rosa's Trattoria ──────────────────────────────────────
function rushed(ctx) {
  const { turn, line, mem, variant } = ctx;
  if (!line) return "yes yes, make it quick — I'm between lunch rushes.";
  const limit = variant === "V3" ? 8 : 9;
  if (turn >= limit) return HANGUP;
  if (turn >= (variant === "V2" ? 6 : 7) && !mem.warned) { mem.warned = true; return "I gotta go in two minutes."; }
  if (hearsEmailAsk(line)) return "rosa@rosastrattoria.com";
  if (hearsPitch(line)) { mem.pitched = true; return "Not now, I'm too busy — send me the link."; }
  if (hearsFinding(line)) return "ok, ok —";
  if (hearsQuestion(line, /what kind of business|what do you do/i)) return "restaurant.";
  if (hearsQuestion(line, /name of the business/i)) return "Rosa's Trattoria.";
  if (hearsQuestion(line, /website/i)) return "rosastrattoria dot com";
  if (hearsQuestion(line, /customers find you/i)) return "foot traffic, regulars.";
  if (/record/i.test(line)) return "yes yes, make it quick — I'm between lunch rushes.";
  if (/free 45-minute|here's the deal/i.test(line)) return "make it fast.";
  if (/keeps you up at night|paint me a picture|next step/i.test(line)) return "lunch rush. that's it.";
  return "go on.";
}

// ── 6. CHATTY — Debbie, Debbie's Boutique ────────────────────────────────────
function chatty(ctx) {
  const { turn, line, mem, variant } = ctx;
  if (!line) return "Yes, let's do this — oh, I love these things!";
  if (hearsScold(line)) { mem.scolded = true; return "Well! No need to be rude about it."; }
  if (hearsEmailAsk(line)) return "debbie@debbiesboutique.com";
  if (hearsPitch(line)) {
    if (variant === "V3" && !mem.askedAbout) { mem.askedAbout = true; return "Oh — before I decide, how long have you been doing these audits?"; }
    return "Oh, that sounds wonderful, yes — let's do it!";
  }
  if (hearsFinding(line)) { mem.proof = (mem.proof || 0) + 1; return "Oh my god, really? My nephew never told me that!"; }
  if (hearsQuestion(line, /what kind of business|what do you do/i))
    return "Oh, I have a boutique — well it started in my garage in 2019, my daughter said mom you have too many scarves you should sell them, and now look at us, seven years later, full store on Main Street, can you believe it?";
  if (hearsQuestion(line, /name of the business/i))
    return "Debbie's Boutique — named after me, obviously! My husband wanted Main Street Styles but I said no way, it's my store, my name goes on the door, and he just laughed.";
  if (hearsQuestion(line, /website/i))
    return "debbiesboutique dot com — my nephew made it, sweet kid, he's in college now for computers, he did it between classes, I told him Debbie will pay you in scarves!";
  if (hearsQuestion(line, /customers find you/i))
    return "Oh, word of mouth mostly — the ladies from book club, you know how it is, one tells another, and the church group, don't get me started on the church group sale last spring...";
  if (/record/i.test(line)) return "Yes, let's do this — oh, I love these things, my daughter does all the tech stuff though.";
  if (/free 45-minute|here's the deal/i.test(line)) return "Free? Well aren't you sweet. Okay, ask away!";
  if (/keeps you up at night|paint me a picture/i.test(line)) return "Slow Januarys, honey. January is dead and I just sit there rearranging the same sweaters.";
  return "Mmhm, go on sweetie.";
}

// ── 7. GUARDED — Alan, Weiss Law ────────────────────────────────────────────
function guarded(ctx) {
  const { turn, line, mem, variant } = ctx;
  if (!line) return "Yes.";
  // Only triggers on an actual RE-ASK for the site (question), not the avatar
  // merely mentioning "site" ("No site to pull up — no problem" is fine).
  if (/\b(what'?s|what is|give me|tell me|share)\b[^.?]*\b(website|site|domain|url)\b[^.?]*\?/i.test(line) && mem.refusedUrl) {
    mem.reasks = (mem.reasks || 0) + 1;
    if (mem.reasks >= 2) return "stop";
    return "I said no. Are we done here?";
  }
  if (/name of the business/i.test(line) && mem.refusedName) {
    mem.reasks = (mem.reasks || 0) + 1;
    return "Still not saying. Next question.";
  }
  if (hearsEmailAsk(line)) {
    if ((mem.reasks || 0) >= 1) return "No. Not today.";
    if (variant === "V2" && !mem.softAsk) { mem.softAsk = true; return "Not today."; }
    return "alan.weiss.esq@gmail.com";
  }
  if (hearsPitch(line)) {
    if (/referral|phone/i.test(line)) { mem.earned = true; return "You were listening. Go on."; }
    return "That's generic. Pass.";
  }
  if (/spell it out|letter by letter/i.test(line)) return "No. I won't spell it either.";
  if (hearsQuestion(line, /what kind of business|what do you do/i)) return "I'm a lawyer.";
  if (hearsQuestion(line, /name of the business/i)) { mem.refusedName = true; return "I'd rather not say the name yet."; }
  if (hearsQuestion(line, /website/i)) { mem.refusedUrl = true; return "I don't give out my site to cold callers."; }
  if (hearsQuestion(line, /customers find you/i)) return "Referrals. The rest is private.";
  if (/record/i.test(line)) return "Yes.";
  if (/free 45-minute|here's the deal/i.test(line)) return "Forty-five minutes is a lot. Proceed.";
  if (/next step they take|first contact/i.test(line)) return "Phone calls.";
  if (/follow up/i.test(line)) return "My assistant follows up.";
  if (/best customers heard/i.test(line)) return "Referrals, like I said.";
  if (/keeps you up at night|paint me a picture/i.test(line)) return "Dry spells between referrals.";
  if (hearsFinding(line)) return "Noted.";
  return "Go on.";
}

export const AGENTS = { warm, cold, rude, skeptical, rushed, chatty, guarded };
export const TRIGGERS = { hearsEmailAsk, hearsPrice, hearsPitch, hearsFinding, hearsScold, hearsHostile };
