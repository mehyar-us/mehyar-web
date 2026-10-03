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
    ig_id: "17841427856386597", // Meta IG user ID for @aimechanicapp
    keywords: ["SCAN", "BOOST", "CAM", "AIR", "VAC", "MOUNT", "GEL", "BEAM", "HEAD",
               "CRACK", "TRUNK", "TRASH", "SPOT", "GAUGE", "ROAD", "ICE", "SHADE", "CHARGE",
               "FIX", "JOBS"],
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
      CRACK: { product_id: "aff-rainx-crack", name: "Rain-X 600001 Windshield Repair Kit", url: "https://www.amazon.com/dp/B00IPS4APU?tag=mehyarus-20" },
      TRUNK: { product_id: "aff-drive-trunk", name: "Drive Auto Products Car Trunk Organizer", url: "https://www.amazon.com/dp/B071F82CYJ?tag=mehyarus-20" },
      TRASH: { product_id: "aff-hotor-trash", name: "HOTOR Car Trash Can with Lid, 2 Gallon", url: "https://www.amazon.com/dp/B07VGRVKSN?tag=mehyarus-20" },
      SPOT:  { product_id: "aff-livtee-spot", name: "LivTee Blind Spot Mirrors, HD Frameless 2-Pac", url: "https://www.amazon.com/dp/B0F3CBS7JQ?tag=mehyarus-20" },
      GAUGE: { product_id: "aff-jaco-gauge", name: "JACO ElitePro Digital Tire Pressure Gauge", url: "https://www.amazon.com/dp/B07VV78RZ1?tag=mehyarus-20" },
      ROAD:  { product_id: "aff-thrive-road", name: "Thrive 104-Piece Roadside Emergency Car Kit", url: "https://www.amazon.com/dp/B01K9F184M?tag=mehyarus-20" },
      ICE:   { product_id: "aff-astroai-ice", name: "AstroAI 27in Snow Brush and Ice Scraper", url: "https://www.amazon.com/dp/B07V37GVY9?tag=mehyarus-20" },
      SHADE: { product_id: "aff-econour-shade", name: "EcoNour Foldable Windshield Sun Shade", url: "https://www.amazon.com/dp/B06XYH2WXT?tag=mehyarus-20" },
      CHARGE:{ product_id: "aff-anker-charge", name: "Anker 535 USB-C Car Charger, 67W 3-Port", url: "https://www.amazon.com/dp/B0BSVB93DK?tag=mehyarus-20" },
      FIX:   { product_id: "aimech-app",     special: "fix" },
      JOBS:  { product_id: "mehyar-jobs",    special: "jobs" },
    },
  },
  mehyar_us: {
    ig_id: "17841422855668581", // Meta IG user ID for @mehyar.us
    keywords: ["LIGHT", "MOUSE", "COFFEE", "RISE", "PORTS", "TIDY", "GLOW", "WRIST",
               "LIFT", "DESK", "DOCK", "HANG", "FLOOD", "LEGIT", "CREDIT", "DESIGN",
               "HUSTLE", "TAP", "ROAST", "BABY", "REALTOR", "SPA", "DENTAL", "PLUMBER", "AUTO", "JOBS"],
    products: {
      LIGHT:  { product_id: "aff-benq-screenbar", name: "BenQ ScreenBar Monitor Light Bar",   url: "https://www.amazon.com/dp/B076VNFZJG?tag=mehyarus-20" },
      MOUSE:  { product_id: "aff-mx-master-3s",  name: "Logitech MX Master 3S Wireless Mouse", url: "https://www.amazon.com/dp/B0B11LJ69K?tag=mehyarus-20" },
      COFFEE: { product_id: "aff-ember-mug",     name: "Ember Temperature Control Smart Mug 2", url: "https://www.amazon.com/dp/B0H2BHDDSV?tag=mehyarus-20" },
      RISE:   { product_id: "aff-soundance-rise", name: "SOUNDANCE LS1 Aluminum Laptop Stand", url: "https://www.amazon.com/dp/B07X5ZH53L?tag=mehyarus-20" },
      PORTS:  { product_id: "aff-anker-ports",  name: "Anker A83D2 7-in-1 USB-C Hub",          url: "https://www.amazon.com/dp/B0DXJQT19B?tag=mehyarus-20" },
      TIDY:   { product_id: "aff-dline-tidy",   name: "D-Line Small Cable Management Box, Black", url: "https://www.amazon.com/dp/B00846FO0I?tag=mehyarus-20" },
      GLOW:   { product_id: "aff-sailstar-glow", name: "Sailstar LED Desk Lamp with 10W Wireless Charger", url: "https://www.amazon.com/dp/B09PDBNXGD?tag=mehyarus-20" },
      WRIST:  { product_id: "aff-gimars-wrist", name: "Gimars Gel Memory Foam Wrist Rest Set", url: "https://www.amazon.com/dp/B01M11FLUJ?tag=mehyarus-20" },
      LIFT:   { product_id: "aff-gianotter-lift", name: "gianotter Dual Monitor Stand Riser", url: "https://www.amazon.com/dp/B0DJKSMV2T?tag=mehyarus-20" },
      DESK:   { product_id: "aff-aothia-desk",  name: "Aothia Dual-Sided PU Leather Desk Pad", url: "https://www.amazon.com/dp/B08N9W3889?tag=mehyarus-20" },
      DOCK:   { product_id: "aff-lamicall-dock", name: "Lamicall DP13 Folding Desk Phone Stand", url: "https://www.amazon.com/dp/B09MCKK9NX?tag=mehyarus-20" },
      HANG:   { product_id: "aff-newbee-hang",  name: "New Bee Aluminum Headphone Stand, Black", url: "https://www.amazon.com/dp/B01GJQ7N94?tag=mehyarus-20" },
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
      TAP:    { product_id: "puretap-report", name: "PureTap Water Report", url: "https://puretap.mehyar.us",
                blurb: "Decoded tap-water report for your ZIP — $19." },
      ROAST:  { product_id: "roastme-card", name: "RoastMe", url: "https://roast.mehyar.us",
                blurb: "Upload any photo — the AI roasts it. First lines free, full roast card $5." },
      BABY:   { product_id: "babypeek-portrait", name: "BabyPeek", url: "https://baby.mehyar.us",
                blurb: "AI baby portrait from two parent photos — $5, one time." },
      REALTOR:{ product_id: "mehyarsoft-mayor-ai", name: "Mayor AI for Realtors", url: "https://mehyar.us",
                blurb: "For realtors, Mayor AI texts every new listing inquiry back in seconds and books the showing into your calendar. Start with the Tech Audit." },
      SPA:    { product_id: "mehyarsoft-mayor-ai", name: "Mayor AI for Spas", url: "https://mehyar.us",
                blurb: "For spas & med spas, the AI front desk handles booking, reminders, and cancellation rescue. Start with the Tech Audit." },
      DENTAL: { product_id: "mehyarsoft-mayor-ai", name: "Mayor AI for Dental", url: "https://mehyar.us",
                blurb: "For dental clinics, Mayor AI answers the front desk phone instantly and books appointments. Start with the Tech Audit." },
      PLUMBER:{ product_id: "mehyarsoft-mayor-ai", name: "Mayor AI for Plumbers", url: "https://mehyar.us",
                blurb: "For plumbers, Mayor AI texts every missed emergency caller an instant SMS quote request. Start with the Tech Audit." },
      AUTO:   { product_id: "mehyarsoft-mayor-ai", name: "Mayor AI for Auto Shops", url: "https://mehyar.us",
                blurb: "For auto repair shops, Mayor AI follows up every unsent estimate by text until it books the bay. Start with the Tech Audit." },
      JOBS:   { product_id: "mehyar-jobs", special: "jobs" },
    },
  },
  rizza: {
    ig_username: "rizza.app",
    ig_id: "17841442562086872", // Meta IG user ID for @rizza.app
    keywords: ["RIZZ", "RIZZA", "REPLY"],
    products: {
      RIZZ:  { product_id: "rizza-app", special: "rizz" },
      RIZZA: { product_id: "rizza-app", special: "rizz" },
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
