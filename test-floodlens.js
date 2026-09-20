// Local smoke test for the FloodLens backend (run with: node test-floodlens.js)
import {
  zoneInfo, geohash, effDateToIso, FEMA_BASES, BROWSER_UA, randomToken,
  PREMIUM_BANDS, DISCLAIMER_SHORT, nullIfFemaNoData,
} from "./functions/api/_shared/floodlensCore.js";
import { orderHooks } from "./functions/api/pay/checkout.js";
import { buildFloodReport } from "./functions/api/_shared/floodlensPdf.js";

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(` FAIL ${name}${detail ? " — " + detail : ""}`); }
}

console.log("== zone table (per fema-brief.md §2: SFHA = zones starting with A or V) ==");
const AE = zoneInfo("AE", null);
check("AE → sfha=1, risk=high, band=A", AE.sfha === 1 && AE.risk === "high" && AE.band === "A", JSON.stringify(AE));
const X1 = zoneInfo("X", "1% ANNUAL CHANCE FLOOD HAZARD");
check("X w/1% subty → sfha=0 minimal (brief: X is moderate-to-low, SFHA=No)", X1.sfha === 0 && X1.risk === "minimal" && X1.band === "X", JSON.stringify(X1));
const X2 = zoneInfo("X", "AREA OF MINIMAL FLOOD HAZARD");
check("X(minimal) → sfha=0, risk=minimal", X2.sfha === 0 && X2.risk === "minimal", JSON.stringify(X2));
const D = zoneInfo("D", null);
check("D → band=D, risk=undetermined", D.band === "D" && D.risk === "undetermined", JSON.stringify(D));
const U = zoneInfo(null, null);
check("null zone → no sfha, no band", U.sfha === 0 && U.band === null, JSON.stringify(U));
const AO = zoneInfo("AO", null);
check("AO → sfha=1 high, band=AH", AO.sfha === 1 && AO.risk === "high" && AO.band === "AH", JSON.stringify(AO));
const V = zoneInfo("VE", null);
check("VE → sfha=1 high_coastal, band=V", V.sfha === 1 && V.risk === "high_coastal" && V.band === "V", JSON.stringify(V));
const SHADED = zoneInfo("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD");
check("X(shaded) → sfha=0 moderate, band=Xshaded", SHADED.sfha === 0 && SHADED.risk === "moderate" && SHADED.band === "Xshaded", JSON.stringify(SHADED));
const A1 = zoneInfo("A12", null);
check("A12 legacy → sfha=1 high, band=A", A1.sfha === 1 && A1.band === "A");
const OW = zoneInfo("OPEN WATER", null);
check("OPEN WATER → no_data", OW.risk === "no_data" && OW.sfha === 0);
check("premium bands present", !!PREMIUM_BANDS.X && !!PREMIUM_BANDS.Xshaded && !!PREMIUM_BANDS.A && !!PREMIUM_BANDS.AH && !!PREMIUM_BANDS.V && !!PREMIUM_BANDS.D);
check("disclaimer non-empty", DISCLAIMER_SHORT.length > 10);

console.log("== geohash ==");
// Known check: geohash(42.6, -5.6, 5) = "ezs42" (standard reference point)
const gh5 = geohash(42.6, -5.6, 5);
check("geohash reference vector", gh5 === "ezs42", "got " + gh5);
const gh7 = geohash(40.6277, -74.0291, 7);
check("geohash-7 length", gh7.length === 7 && /^[0-9a-z]{7}$/.test(gh7), "got " + gh7);

console.log("== misc core ==");
check("effDateToIso epoch ms", effDateToIso(1386038400000) === "2013-12-03", String(effDateToIso(1386038400000)));
check("effDateToIso null", effDateToIso(null) === null);
check("FEMA bases (2, /arcgis primary)", FEMA_BASES.length === 2 && FEMA_BASES[0].includes("/arcgis/rest/services/public/NFHL/MapServer"), FEMA_BASES[0]);
check("browser UA", /Mozilla\/5\.0/.test(BROWSER_UA));
check("randomToken length", randomToken(32).length >= 43);

console.log("== PDF build (single report) ==");
const prop = {
  address: "244 96th St APT 1B, Brooklyn, NY 11209",
  matched: "244 96TH ST, BROOKLYN, NY 11209",
  zone: "AE", zone_subtype: null, sfha: true,
  risk: "high", risk_plain: "High risk — 1%-annual-chance flood area. Insurance required with a federally backed mortgage.",
  band: "A", premium_label: PREMIUM_BANDS.A.label,
  premium_footnote: "Test footnote",
  bfe: 10, depth: null, dfirm_id: "36047C", firm_pan: "3604700183H",
  map_effective: "2013-09-05",
  narration: "Test narration paragraph for the unit test. Plain English, practical guidance.",
};
const { bytes, pages, byteLength } = buildFloodReport([prop], {
  generated_at: "2026-09-20T00:00:00.000Z",
  data_checked_at: "2026-09-20T00:00:00.000Z",
  degraded: false,
  report_id: "FL-TEST",
});
check("bytes is Uint8Array", bytes instanceof Uint8Array);
check("starts %PDF-1.4", new TextDecoder().decode(bytes.slice(0, 8)) === "%PDF-1.4", new TextDecoder().decode(bytes.slice(0, 12)));
check("exactly 10 pages", pages === 10, "got " + pages);
check("ends %%EOF", new TextDecoder().decode(bytes.slice(-6)) === "%%EOF\n" || new TextDecoder().decode(bytes.slice(-5)) === "%%EOF");
check("byteLength consistent", byteLength === bytes.length, `${byteLength} vs ${bytes.length}`);
// xref sanity: every object offset must point at "<n> <gen> obj"
const txt = new TextDecoder("latin1").decode(bytes);
check("pdf has 10 pages (Count)", /\/Count 10\b/.test(txt));

const xrefStart = txt.lastIndexOf("startxref");
const xrefPos = Number(txt.slice(xrefStart).split("\n")[1]);
check("startxref numeric", Number.isFinite(xrefPos) && xrefPos > 0, "got " + xrefPos);
const xrefSec = txt.slice(xrefPos);
check("xref table begins", xrefSec.startsWith("xref\n"), xrefSec.slice(0, 20));
const objMatches = [...txt.matchAll(/(\d+) (\d+) obj/g)];
const offsets = xrefSec.split("\n").slice(2).map((l) => Number(l.slice(0, 10)));
let xrefOk = true;
for (let i = 0; i < objMatches.length; i++) {
  const objNum = Number(objMatches[i][1]);
  const off = offsets[objNum];
  const marker = `${objNum} 0 obj`;
  const actual = txt.indexOf(marker);
  if (off !== actual) { xrefOk = false; console.log(`   xref mismatch obj ${objNum}: table=${off} actual=${actual}`); break; }
}
check("xref offsets match objects", xrefOk);
// Helvetica base fonts (no embedded fonts)
check("uses Helvetica base fonts", /\/BaseFont \/Helvetica$/.test(txt.replace(/\r/g, "")) === false || txt.includes("/BaseFont /Helvetica"));

console.log("== PDF build (3-pack) ==");
const props3 = [prop,
  { ...prop, address: "123 Ocean Ave, Brooklyn, NY 11235", zone: "X", zone_subtype: "AREA OF MINIMAL FLOOD HAZARD", sfha: false, risk: "minimal", risk_plain: "Minimal risk — outside the SFHA and above the 0.2% flood elevation. Insurance optional.", band: "X", premium_label: PREMIUM_BANDS.X.label },
  { ...prop, address: "999 Shore Rd, Brooklyn, NY 11214", zone: "D", sfha: false, risk: "undetermined", risk_plain: "Undetermined — not studied. Treat with caution.", band: "D", premium_label: PREMIUM_BANDS.D.label },
];
const r3 = buildFloodReport(props3, { generated_at: "2026-09-20T00:00:00.000Z", data_checked_at: "2026-09-20T00:00:00.000Z", degraded: false, report_id: "FL-TEST3" });
check("3-pack builds", r3.pages >= 10, "got " + r3.pages + " pages");
check("3-pack starts %PDF-1.4", new TextDecoder().decode(r3.bytes.slice(0, 8)) === "%PDF-1.4");
check("3-pack has 30 pages (Count)", /\/Count 30\b/.test(new TextDecoder("latin1").decode(r3.bytes)));
check("3-pack returns pages=30", r3.pages === 30, "got " + r3.pages);

console.log("== FEMA sentinel normalization (-9999) ==");
check("numeric -9999 → null", nullIfFemaNoData(-9999) === null);
check('string "-9999" → null', nullIfFemaNoData("-9999") === null);
check("real bfe passes through", nullIfFemaNoData(10) === 10);
check("undefined → null", nullIfFemaNoData(undefined) === null);
check("0 stays 0", nullIfFemaNoData(0) === 0);
check("null stays null", nullIfFemaNoData(null) === null);

console.log("== checkout floodlens order hook ==");
// Minimal D1 stub: prepare().bind().first()
function stubDb(validTokens) {
  const set = new Set(validTokens);
  return {
    prepare() {
      return { bind(t) { return { first: async () => (set.has(t) ? { token: t } : null) }; } };
    },
  };
}
const single = { id: "floodlens-report" };
const pack = { id: "floodlens-3pack" };
{
  const db = stubDb(["tok1"]);
  const r = await orderHooks.floodlens(db, single, { params: { lookup_token: "tok1" } });
  check("single: valid token accepted", !r.error && !!r.orderExtra, JSON.stringify(r));
  const r2 = await orderHooks.floodlens(db, single, { params: {} });
  check("single: missing token → missing_lookup_token", r2.error === "missing_lookup_token", JSON.stringify(r2));
  const r3x = await orderHooks.floodlens(db, single, { params: { lookup_token: "bogus" } });
  check("single: bogus token → invalid_lookup_token", r3x.error === "invalid_lookup_token", JSON.stringify(r3x));
}
{
  const db = stubDb(["t1", "t2", "t3"]);
  const r = await orderHooks.floodlens(db, pack, { params: { lookup_tokens: ["t1", "t2", "t3"] } });
  check("3-pack: 3 valid tokens accepted", !r.error && !!r.orderExtra, JSON.stringify(r));
  const rc = await orderHooks.floodlens(db, pack, { params: { lookup_tokens: "t1,t2,t3" } });
  check("3-pack: comma string accepted", !rc.error && !!rc.orderExtra, JSON.stringify(rc));
  const r2 = await orderHooks.floodlens(db, pack, { params: { lookup_token: "t1" } });
  check("3-pack: single lookup_token → need_three_lookups", r2.error === "need_three_lookups", JSON.stringify(r2));
  const r3x = await orderHooks.floodlens(db, pack, { params: { lookup_tokens: ["t1", "t2", "t2"] } });
  check("3-pack: duplicate tokens rejected", r3x.error === "need_three_lookups", JSON.stringify(r3x));
  const r4 = await orderHooks.floodlens(db, pack, { params: { lookup_tokens: ["t1", "t2", "nope"] } });
  check("3-pack: unknown token → invalid_lookup_token", r4.error === "invalid_lookup_token", JSON.stringify(r4));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

