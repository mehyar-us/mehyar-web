import type { BrandMeta } from "../lib/types";

export const BRANDS: BrandMeta[] = [
  { id: "mehyarsoft", name: "MehyarSoft", domain: "mehyar.us", url: "https://mehyar.us", kind: "agency", instagram: "@mehyar.us", status: "live" },
  { id: "aimech", name: "AI Mechanic", domain: "aimech.app", url: "https://aimech.app", kind: "app", instagram: "@aimechanicapp", status: "live" },
  { id: "babypeek", name: "BabyPeek", domain: "baby.mehyar.us", url: "https://baby.mehyar.us", kind: "digital-product", price: "$5 portrait", status: "live" },
  { id: "roastme", name: "RoastMe", domain: "roast.mehyar.us", url: "https://roast.mehyar.us", kind: "digital-product", price: "$5 roast card", instagram: "@roastme", status: "live" },
  { id: "crayonkid", name: "Crayon Kid", domain: "crayonkid.mehyar.us", url: "https://crayonkid.mehyar.us", kind: "digital-product", price: "$6 coloring book", status: "live" },
  { id: "mehyarjobs", name: "mehyar.jobs", domain: "jobs.mehyar.us", url: "https://jobs.mehyar.us", kind: "tool", status: "live" },
  { id: "spg", name: "Stuff Pretty Good", domain: "stuffprettygood.com", url: "https://stuffprettygood.com", kind: "digital-product", price: "$7–9 guides", status: "live" },
  { id: "rizza", name: "Rizza", domain: "rizza.app", url: "https://rizza.app", kind: "app", status: "parked" },
  { id: "designful", name: "Designful", domain: "designful.mehyar.us", url: "https://designful.mehyar.us", kind: "tool", status: "building" },
  { id: "truesketch", name: "TrueSketch", domain: "truesketch.mehyar.us", url: "https://truesketch.mehyar.us", kind: "tool", status: "building" },
  { id: "hustlekit", name: "HustleKit", domain: "hustlekit.mehyar.us", url: "https://hustlekit.mehyar.us", kind: "digital-product", price: "$27 kit", status: "live" },
  { id: "plrvault", name: "PLR Vault", domain: "plrvault.mehyar.us", url: "https://plrvault.mehyar.us", kind: "digital-product", status: "live" },
  { id: "prepguide", name: "PrepGuide", domain: "prepguide.mehyar.us", url: "https://prepguide.mehyar.us", kind: "digital-product", status: "live" },
  { id: "sprint30", name: "Sprint30", domain: "sprint30.mehyar.us", url: "https://sprint30.mehyar.us", kind: "digital-product", status: "live" },
  { id: "tiktokgrowth", name: "TikTokGrowth", domain: "tiktokgrowth.mehyar.us", url: "https://tiktokgrowth.mehyar.us", kind: "digital-product", status: "live" },
  { id: "bizbuilder", name: "BizBuilder", domain: "bizbuilder.mehyar.us", url: "https://bizbuilder.mehyar.us", kind: "digital-product", status: "live" },
  { id: "creditfix", name: "CreditFix Kit", domain: "creditfix.mehyar.us", url: "https://creditfix.mehyar.us", kind: "digital-product", status: "live" },
  { id: "freelanceros", name: "FreelancerOS", domain: "freelanceros.mehyar.us", url: "https://freelanceros.mehyar.us", kind: "digital-product", status: "live" },
  { id: "lib", name: "Link in Bio", domain: "lib.mehyar.us", url: "https://lib.mehyar.us", kind: "hub", status: "live" },
];

export const BRAND_BY_ID: Record<string, BrandMeta> = Object.fromEntries(
  BRANDS.map((b) => [b.id, b]),
);
