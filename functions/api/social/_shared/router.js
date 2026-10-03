// social-inbox intent router — shared by webhook.js and ingest.js.
// Input:  { account, kind, author, author_name, text }
// Output: { product_id, keyword, reply_text } or { product_id: null }
//
// D1: social_inbox_log(ref_id TEXT PRIMARY KEY, account, kind, author,
//       product_id, replied_at) — create once:
//   CREATE TABLE IF NOT EXISTS social_inbox_log (
//     ref_id TEXT PRIMARY KEY, account TEXT, kind TEXT, author TEXT,
//     product_id TEXT, replied_at TEXT);

const TAG = "mehyarus-20";

function withUtm(url, campaign) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=instagram&utm_medium=dm&utm_campaign=${campaign}`;
}

const AD_DISCLOSURE = "#ad As an Amazon Associate I earn from qualifying purchases.";

function affiliateReply(name, productName, url, keyword) {
  const link = withUtm(url.includes("tag=") ? url : `${url}?tag=${TAG}`, `${keyword}_keyword`);
  return (
    `Hey ${name}! Here's your link for the ${productName}: ${link}\n\n` +
    `Don't sleep on it — prices move on Amazon.\n\n${AD_DISCLOSURE}`
  );
}

// ACCOUNTS: slug -> keyword allowlist + product catalog.
// rizza entry is a placeholder until Mayor confirms the IG handle.
const ACCOUNTS = {
  aimechanicapp: {
    ig_id: null, // Meta IG user ID — fill when the Meta app is wired
    keywords: ["SCAN", "BOOST", "CAM", "AIR", "VAC", "MOUNT", "GEL", "BEAM", "HEAD", "FIX", "JOBS"],
    products: {
      SCAN:  { product_id: "aff-bluedriver", name: "BlueDriver Bluetooth OBD2 Scanner", url: "https://www.amazon.com/dp/B00652G4TS?tag=mehyarus-20" },
      BOOST: { product_id: "aff-noco-gb50",  name: "NOCO Boost GB50 Jump Starter",       url: "https://www.amazon.com/dp/B07MVY7K43?tag=mehyarus-20" },
      CAM:   { product_id: "aff-rove-r24k",  name: "ROVE R2-4K Dual Dash Cam",            url: "https://www.amazon.com/dp/B0D6J5B98H?tag=mehyarus-20" },
      AIR:   { product_id: "aff-astroai",    name: "AstroAI Tire Inflator",              url: "https://www.amazon.com/dp/B0CLXQBYMG?tag=mehyarus-20" },
      VAC:   { product_id: "aff-thisworx",   name: "ThisWorx Car Vacuum",                url: "https://www.amazon.com/dp/B06ZY896ZM?tag=mehyarus-20" },
      MOUNT: { product_id: "aff-vanmass",    name: "VANMASS Car Phone Mount",            url: "https://www.amazon.com/dp/B08DKHHTFX?tag=mehyarus-20" },
      GEL:   { product_id: "aff-pulidiki",   name: "PULIDIKI Car Cleaning Gel",           url: "https://www.amazon.com/dp/B081T7N948?tag=mehyarus-20" },
      BEAM:  { product_id: "aff-sealight",   name: "SEALIGHT H11 LED Headlight Bulbs",    url: "https://www.amazon.com/dp/B0B93LN8YY?tag=mehyarus-20" },
      HEAD:  { product_id: "aff-3m-39195",   name: "3M Headlight Restoration Kit 39195", url: "https://www.amazon.com/dp/B08745K56G?tag=mehyarus-20" },
      FIX:   { product_id: "aimech-app",     special: "fix" },
      JOBS:  { product_id: "mehyar-jobs",    special: "jobs" },
    },
  },
  mehyar_us: {
    ig_id: null,
    keywords: ["LIGHT", "MOUSE", "COFFEE", "FLOOD", "LEGIT", "CREDIT", "DESIGN", "HUSTLE", "JOBS"],
    products: {
      LIGHT:  { product_id: "aff-benq-screenbar", name: "BenQ ScreenBar Monitor Light Bar",   url: "https://www.amazon.com/dp/B076VNFZJG?tag=mehyarus-20" },
      MOUSE:  { product_id: "aff-mx-master-3s",  name: "Logitech MX Master 3S Wireless Mouse", url: "https://www.amazon.com/dp/B0B11LJ69K?tag=mehyarus-20" },
      COFFEE: { product_id: "aff-ember-mug",     name: "Ember Temperature Control Smart Mug 2", url: "https://www.amazon.com/dp/B0H2BHDDSV?tag=mehyarus-20" },
      FLOOD:  { product_id: "floodlens-report", name: "FloodLens Texas Flood Zone Report", url: "https://floodlens.mehyar.us/storm-october-2026.html",
                blurb: "FEMA flood zone report for any Texas address — $9, down from $19 through Oct 8." },
      LEGIT:  { product_id: "legit-launch-kit", name: "Legit Launch Kit", url: "https://legit.mehyar.us",
                blurb: "Start your LLC the right way — $39 guided launch kit." },
      CREDIT: { product_id: "creditfix-kit", name: "CreditFixKit", url: "https://creditfixkit.mehyar.us",
                blurb: "Dispute-letter kit to clean up your credit report — $47." },
      DESIGN: { product_id: "designful", name: "Designful", url: "https://designful.mehyar.us",
                blurb: "Conversion-focused design for your business." },
      HUSTLE: { product_id: "hustlekit", name: "HustleKit", url: "https://hustlekit.mehyar.us",
                blurb: "Side-hustle launch kit." },
      JOBS:   { product_id: "mehyar-jobs", special: "jobs" },
    },
  },
  rizza: {
    ig_username: "rizza.app",
    ig_id: null, // Meta IG user ID — fill when the Meta app is wired
    keywords: ["RIZZ", "REPLY"],
    products: {
      RIZZ:  { product_id: "rizza-app", special: "rizz" },
      REPLY: { product_id: "rizza-app", special: "rizz" },
    },
  },
};

function specialReply(name, kind) {
  if (kind === "rizz") {
    const link = withUtm("https://rizza.app/", "rizz_keyword");
    return { product_id: "rizza-app", keyword: "RIZZ",
      reply_text: `Hey ${name}! Here's RIZZA, your AI dating wingman: ${link}\n\nUpload any chat screenshot — Tinder, Hinge, Bumble — and get replies that actually land. Try it free.` };
  }
  if (kind === "fix") {
    const link = withUtm("https://aimech.app/", "fix_keyword");
    return { product_id: "aimech-app", keyword: "FIX",
      reply_text: `Hey ${name}! Here's your free AI Mechanic link: ${link}\n\nDescribe any symptom, light, or code — it'll tell you what's wrong, how urgent it is, and what the repair should cost. Free account, no card.` };
  }
  if (kind === "jobs") {
    const link = withUtm("https://jobs.mehyar.us/", "jobs_keyword");
    return { product_id: "mehyar-jobs", keyword: "JOBS",
      reply_text: `Hey ${name}! Here's the free job-search tool: ${link}\n\nFree daily job alerts matched to you, ~7,000 real jobs fit-scored. No spam, one-click unsubscribe.` };
  }
  return null;
}

// Own products (not affiliate): blurb + UTM-tagged link, no #ad needed.
function productReply(name, p, keyword) {
  const link = withUtm(p.url, `${keyword}_keyword`);
  return (
    `Hey ${name}! ${p.blurb} Here's your link: ${link}`
  );
}

export function route({ account, text, author_name }) {
  const cfg = ACCOUNTS[account];
  if (!cfg) return { product_id: null };
  const name = (author_name || "there").split(" ")[0];
  const upper = ` ${String(text || "").toUpperCase()} `;
  for (const kw of cfg.keywords) {
    if (!upper.includes(` ${kw} `)) continue;
    const p = cfg.products[kw];
    if (!p) continue;
    if (p.special === "win") return { product_id: null }; // giveaway closed
    if (p.special) return specialReply(name, p.special);
    if (p.blurb) return { product_id: p.product_id, keyword: kw,
      reply_text: productReply(name, p, kw) };
    return { product_id: p.product_id, keyword: kw,
      reply_text: affiliateReply(name, p.name, p.url, kw) };
  }
  return { product_id: null };
}

export function accountIgId(account) {
  return ACCOUNTS[account]?.ig_id || null;
}

export function accountForIgId(igsid) {
  for (const [slug, cfg] of Object.entries(ACCOUNTS)) {
    if (cfg.ig_id && String(cfg.ig_id) === String(igsid)) return slug;
  }
  return "unknown";
}
