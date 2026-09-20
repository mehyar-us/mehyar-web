// functions/api/_shared/floodlensPdf.js
// Dependency-free PDF writer for FloodLens reports (Workers runtime has no
// pdf-lib; Browser Rendering would need a browser binding the Pages project
// doesn't carry). Standard 14 fonts only (Helvetica / Helvetica-Bold,
// WinAnsiEncoding — no embedding needed). All report text is ASCII-sanitized
// before serialization.

const PAGE_W = 612; // Letter
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

function sanitizePdfText(s) {
  return String(s ?? "")
    .replace(/[—–]/g, "--")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, "-")
    .replace(/→/g, "->")
    .replace(/[^\x20-\x7E\n]/g, "");
}

function escapePdf(s) {
  return sanitizePdfText(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Rough Helvetica advance-width estimator (fraction of em) for word wrap.
function charW(ch, bold) {
  if (ch === " ") return 0.28;
  if (/[0-9]/.test(ch)) return 0.556;
  if (/[A-Z]/.test(ch)) return bold ? 0.72 : 0.67;
  if (/[a-z]/.test(ch)) return bold ? 0.55 : 0.5;
  if (",.;:!?|'\"".includes(ch)) return 0.28;
  if ("-–—".includes(ch)) return 0.55;
  return 0.5;
}
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of String(s)) w += charW(ch, bold);
  return w * size; // sum of em fractions × point size
}

class PdfBuilder {
  constructor() {
    this.pages = []; // each: { runs: [{t,x,y,size,bold,r,g,b}], rects: [{x,y,w,h,r,g,b}] }
    this.newPage();
  }
  newPage() {
    this.pages.push({ runs: [], rects: [] });
    this.page = this.pages[this.pages.length - 1];
  }
  rect(x, y, w, h, r, g, b) {
    this.page.rects.push({ x, y, w, h, r, g, b });
  }
  text(t, x, y, size = 11, bold = false, r = 0.12, g = 0.12, b = 0.12) {
    this.page.runs.push({ t: sanitizePdfText(t), x, y, size, bold, r, g, b });
  }
  serialize() {
    const objs = [];
    // 1: catalog, 2: pages, then per page: page obj, content obj; fonts at end.
    const pageObjNums = [];
    let next = 3;
    const fontRegular = next + this.pages.length * 2;
    const fontBold = fontRegular + 1;
    for (let i = 0; i < this.pages.length; i++) {
      pageObjNums.push(next);
      next += 2;
    }
    const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
    objs.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>\nendobj\n`);
    this.pages.forEach((pg, i) => {
      const pn = pageObjNums[i];
      const cn = pn + 1;
      objs.push(
        `${pn} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${cn} 0 R >>\nendobj\n`
      );
      let stream = "";
      for (const rc of pg.rects) {
        stream += `${rc.r.toFixed(3)} ${rc.g.toFixed(3)} ${rc.b.toFixed(3)} rg ${rc.x.toFixed(1)} ${rc.y.toFixed(1)} ${rc.w.toFixed(1)} ${rc.h.toFixed(1)} re f\n`;
      }
      for (const run of pg.runs) {
        stream += `BT /F${run.bold ? 2 : 1} ${run.size} Tf ${run.r.toFixed(3)} ${run.g.toFixed(3)} ${run.b.toFixed(3)} rg 1 0 0 1 ${run.x.toFixed(1)} ${run.y.toFixed(1)} Tm (${escapePdf(run.t)}) Tj ET\n`;
      }
      const len = new TextEncoder().encode(stream).length;
      objs.push(`${cn} 0 obj\n<< /Length ${len} >>\nstream\n${stream}endstream\nendobj\n`);
    });
    objs.push(`${fontRegular} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
    objs.push(`${fontBold} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);

    let out = "%PDF-1.4\n";
    const offsets = [0];
    for (const o of objs) {
      offsets.push(new TextEncoder().encode(out).length);
      out += o;
    }
    const xrefPos = new TextEncoder().encode(out).length;
    const total = objs.length + 1;
    out += `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) {
      out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    return new TextEncoder().encode(out);
  }
}

// ── Report flow writer ─────────────────────────────────────────────────────
const BRAND = { r: 0.04, g: 0.36, b: 0.65 }; // FloodLens blue
const INK = { r: 0.13, g: 0.13, b: 0.13 };
const MUTED = { r: 0.42, g: 0.45, b: 0.5 };
const BADGE = {
  high: { r: 0.75, g: 0.16, b: 0.16 },
  high_coastal: { r: 0.75, g: 0.16, b: 0.16 },
  moderate: { r: 0.85, g: 0.55, b: 0.08 },
  minimal: { r: 0.16, g: 0.5, b: 0.28 },
  undetermined: { r: 0.45, g: 0.45, b: 0.45 },
  no_data: { r: 0.45, g: 0.45, b: 0.45 },
  unknown: { r: 0.45, g: 0.45, b: 0.45 },
};

class Flow {
  constructor(pdf, footerLeft, footerRight) {
    this.pdf = pdf;
    this.footerLeft = footerLeft;
    this.footerRight = footerRight;
    this.y = PAGE_H - MARGIN - 10;
    this.pageNo = 1;
    this.paintFooter();
  }
  paintFooter() {
    const p = this.pdf;
    p.text(this.footerLeft, MARGIN, 34, 8, false, MUTED.r, MUTED.g, MUTED.b);
    const rn = `Page ${this.pageNo}`;
    p.text(rn, PAGE_W - MARGIN - textWidth(rn, 8, false), 34, 8, false, MUTED.r, MUTED.g, MUTED.b);
  }
  // Fixed-layout reports: every page is started explicitly. Content per
  // page is bounded so it always fits — need() stays only as a backstop.
  pageBreak() {
    this.pdf.newPage();
    this.pageNo++;
    this.y = PAGE_H - MARGIN - 10;
    this.paintFooter();
  }
  need(h) {
    if (this.y - h < 64) {
      this.pdf.newPage();
      this.pageNo++;
      this.y = PAGE_H - MARGIN - 10;
      this.paintFooter();
    }
  }
  gap(h) { this.y -= h; }
  h1(t) {
    this.need(46);
    this.pdf.rect(MARGIN, this.y - 24, CONTENT_W, 30, BRAND.r, BRAND.g, BRAND.b);
    this.pdf.text(t, MARGIN + 10, this.y - 17, 15, true, 1, 1, 1);
    this.y -= 40;
  }
  h2(t) {
    this.need(30);
    this.pdf.text(t, MARGIN, this.y - 12, 13, true, BRAND.r, BRAND.g, BRAND.b);
    this.y -= 24;
  }
  para(t, size = 10.5, bold = false, color = INK) {
    const lines = wrap(t, CONTENT_W, size, bold);
    this.need(lines.length * (size + 5) + 6);
    for (const ln of lines) {
      this.pdf.text(ln, MARGIN, this.y - size, size, bold, color.r, color.g, color.b);
      this.y -= size + 5;
    }
    this.y -= 6;
  }
  bullets(items, size = 10.5) {
    for (const it of items) {
      const lines = wrap(it, CONTENT_W - 16, size, false);
      this.need(lines.length * (size + 5) + 4);
      lines.forEach((ln, i) => {
        this.pdf.text(i === 0 ? "- " + ln : "  " + ln, MARGIN + 4, this.y - size, size, false, INK.r, INK.g, INK.b);
        this.y -= size + 5;
      });
      this.y -= 3;
    }
    this.y -= 4;
  }
  kv(label, value, size = 10.5) {
    const lines = wrap(`${label}: ${value}`, CONTENT_W, size, false);
    this.need(lines.length * (size + 5) + 2);
    const lw = textWidth(label + ": ", size, true);
    lines.forEach((ln, i) => {
      if (i === 0) {
        this.pdf.text(label + ": ", MARGIN, this.y - size, size, true, INK.r, INK.g, INK.b);
        this.pdf.text(ln.slice(label.length + 2), MARGIN + lw, this.y - size, size, false, INK.r, INK.g, INK.b);
      } else {
        this.pdf.text(ln, MARGIN, this.y - size, size, false, INK.r, INK.g, INK.b);
      }
      this.y -= size + 5;
    });
    this.y -= 2;
  }
}

function wrap(text, maxW, size, bold) {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (textWidth(cand, size, bold) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// ── Report content ─────────────────────────────────────────────────────────
// props: [{ address, matched, zone, zone_subtype, sfha, risk, risk_plain, band,
//           premium_label, premium_footnote, bfe, depth, dfirm_id, firm_pan,
//           map_effective, narration }]
// meta: { generated_at, data_checked_at, degraded, report_id }
// ── Report content ─────────────────────────────────────────────────────────
// FIXED LAYOUT: every property gets EXACTLY 10 pages (single report = 10,
// 3-pack = 30). Pages are started explicitly and each page's content is
// bounded to fit on one page — need() remains only as a backstop.
// props: [{ address, matched, zone, zone_subtype, sfha, risk, risk_plain, band,
//           premium_label, premium_footnote, bfe, depth, dfirm_id, firm_pan,
//           map_effective, narration }]
// meta: { generated_at, data_checked_at, degraded, report_id }
export function buildFloodReport(props, meta) {
  const pdf = new PdfBuilder();
  const f = new Flow(pdf, "FloodLens — Not an official flood determination.", "");
  const multi = props.length > 1;
  props.forEach((p, idx) => {
    if (idx > 0) f.pageBreak();
    pageCover(f, p, meta, multi, idx, props.length);   // 1
    f.pageBreak(); pageZoneDecoded(f, p, multi, idx, props.length);   // 2
    f.pageBreak(); pageNarration(f, p, multi, idx, props.length);     // 3
    f.pageBreak(); pageCost(f, p, multi, idx, props.length);          // 4
    f.pageBreak(); pagePricing(f, p, multi, idx, props.length);       // 5
    f.pageBreak(); pageQuestions(f, p, multi, idx, props.length);    // 6
    f.pageBreak(); pageMapHistory(f, p, multi, idx, props.length);   // 7
    f.pageBreak(); pageChecklist(f, p, multi, idx, props.length);    // 8
    f.pageBreak(); pageMethodology(f, p, multi, idx, props.length);  // 9
    f.pageBreak(); pageDisclaimer(f, p, meta, multi, idx, props.length); // 10
  });
  const bytes = pdf.serialize();
  return { bytes, pages: pdf.pages.length, byteLength: bytes.length };
}

function propTag(f, p, multi, idx, n) {
  if (!multi) return;
  f.pdf.text(
    `Property ${idx + 1} of ${n}: ${truncate(p.address, 64)}`,
    MARGIN, f.y - 9, 9, false, MUTED.r, MUTED.g, MUTED.b
  );
  f.y -= 16;
}

// ── Page 1: cover ──
function pageCover(f, p, meta, multi, idx, n) {
  f.pdf.text("FLOODLENS", MARGIN, PAGE_H - 120, 26, true, BRAND.r, BRAND.g, BRAND.b);
  f.pdf.text(
    multi ? "Multi-Property Flood Zone Report" : "Flood Zone Report",
    MARGIN, PAGE_H - 150, 15, false, MUTED.r, MUTED.g, MUTED.b
  );
  if (multi) {
    f.pdf.text(`Property ${idx + 1} of ${n}`, MARGIN, PAGE_H - 172, 11, true, INK.r, INK.g, INK.b);
  }
  const cy = PAGE_H - 240;
  const badge = BADGE[p.risk] || BADGE.unknown;
  const zl = `ZONE ${p.zone}`;
  f.pdf.rect(MARGIN, cy - 66, CONTENT_W, 76, 0.96, 0.97, 1);
  f.pdf.text(truncate(p.address, 60), MARGIN + 12, cy - 22, 12, true, INK.r, INK.g, INK.b);
  f.pdf.rect(MARGIN + 12, cy - 56, textWidth(zl, 13, true) + 20, 24, badge.r, badge.g, badge.b);
  f.pdf.text(zl, MARGIN + 22, cy - 50, 13, true, 1, 1, 1);
  f.pdf.text(truncate(p.risk_plain, 90), MARGIN + 12 + textWidth(zl, 13, true) + 30, cy - 50, 10, false, MUTED.r, MUTED.g, MUTED.b);
  f.pdf.text(
    "What flood zone is this address in, and what does it cost you?",
    MARGIN, cy - 96, 11, false, MUTED.r, MUTED.g, MUTED.b
  );
  f.pdf.text(
    `Generated ${meta.generated_at || "—"} · FEMA data checked ${meta.data_checked_at || "—"}`,
    MARGIN, cy - 116, 10, false, MUTED.r, MUTED.g, MUTED.b
  );
  if (meta.degraded) {
    f.pdf.text("Served from cached data — FEMA was unreachable at generation time.", MARGIN, cy - 134, 10, true, 0.7, 0.35, 0.05);
  }
  f.pdf.text(
    "Not an official flood determination. See the disclaimer on the last page.",
    MARGIN, 70, 9, true, 0.7, 0.16, 0.16
  );
}

// ── Page 2: zone decoded ──
function pageZoneDecoded(f, p, multi, idx, n) {
  f.h1("Your zone, decoded");
  propTag(f, p, multi, idx, n);
  const badge = BADGE[p.risk] || BADGE.unknown;
  f.pdf.rect(MARGIN, f.y - 58, CONTENT_W, 64, 0.96, 0.97, 1);
  f.pdf.text(`FEMA Zone ${p.zone}`, MARGIN + 12, f.y - 24, 16, true, badge.r, badge.g, badge.b);
  f.pdf.text(truncate(p.risk_plain, 100), MARGIN + 12, f.y - 42, 10.5, false, INK.r, INK.g, INK.b);
  f.y -= 76;
  f.kv("Special Flood Hazard Area (SFHA)", p.sfha ? "YES — high-risk area" : "No");
  f.kv("Zone subtype", p.zone_subtype || "—");
  if (p.bfe != null) f.kv("Base Flood Elevation (BFE)", `${p.bfe} ft`);
  if (p.depth != null) f.kv("Flood depth", `${p.depth} ft`);
  f.kv("FIRM panel", p.firm_pan || "—");
  f.kv("DFIRM ID", p.dfirm_id || "—");
  f.kv("Map effective date", p.map_effective || "—");
  f.gap(6);
  f.para(
    p.sfha
      ? "SFHA means this property sits in FEMA's high-risk flood area. If you buy with a federally backed mortgage, your lender will require flood insurance. That requirement — not the zone letter alone — is what usually surprises buyers at closing."
      : "Outside the SFHA, no lender will force flood insurance on you — but more than 20% of NFIP claims come from outside high-risk zones. The question isn't whether insurance is required; it's whether the risk is worth the premium.",
    10.5
  );
  f.gap(4);
  f.para(
    "FEMA's rule of thumb: zones starting with A or V are the high-risk Special Flood Hazard Area. Shaded X is moderate risk (between the 1% and 0.2% flood limits); unshaded X is minimal. D means the area was never studied.",
    10, false, MUTED
  );
}

// ── Page 3: what this means for you (the ONE AI narration) ──
function pageNarration(f, p, multi, idx, n) {
  f.h1("What this means for you");
  propTag(f, p, multi, idx, n);
  const raw = p.narration ? String(p.narration).slice(0, 1400) : fallbackNarration(p);
  const paras = raw.split(/\n{2,}|\n/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  for (const para of paras) f.para(para, 10.5);
  f.gap(6);
  f.para(
    "Bottom line: price the insurance before you fall in love with the house — the buyers who get hurt are the ones who first hear the premium number at the closing table.",
    10.5, true
  );
}

// ── Page 4: insurance cost ──
function pageCost(f, p, multi, idx, n) {
  f.h1("Flood insurance: what it typically costs");
  propTag(f, p, multi, idx, n);
  if (p.premium_label) {
    f.para(`For Zone ${p.zone}, NFIP policies at $250,000 of building coverage typically run ${p.premium_label} per year (estimate).`, 11, true);
    f.bullets([
      "Your actual premium is property-specific: elevation, distance to water, foundation type, replacement cost, and claims history all move the number.",
      "Under FEMA's Risk Rating 2.0, the zone letter is no longer the main price driver — two houses in the same zone can differ by thousands per year.",
      "42% of policyholders still pay below full-risk rates on a glidepath, with increases capped at about 18% per year for most policies.",
    ]);
    f.para(p.premium_footnote, 9, false, MUTED);
  } else {
    f.para("No premium range applies — this location has no FEMA zone classification to price against. Talk to an agent about private flood options if the property sits near water.", 10.5);
    f.bullets([
      "Private flood insurers often cover what the NFIP won't, and sometimes at better rates for low-risk properties.",
      "Ask specifically about preferred-risk pricing — outside the SFHA you may qualify for the cheapest tier.",
    ]);
  }
}

// ── Page 5: how premiums are estimated ──
function pagePricing(f, p, multi, idx, n) {
  f.h1("How your premium is estimated");
  propTag(f, p, multi, idx, n);
  f.para(
    "Since October 2021, FEMA prices NFIP policies under Risk Rating 2.0: your premium follows the property, not just the zone. The biggest inputs are distance to water, replacement cost, elevation relative to the Base Flood Elevation, foundation type, and the property's claims history.",
    10.5
  );
  f.bullets([
    "Elevation is the lever you control: a house 3 feet above the BFE can cost half as much to insure as the identical house at the BFE. An Elevation Certificate documents this.",
    "Replacement cost matters more than market price — a $250,000 building-coverage limit is the benchmark used throughout this report.",
    "Claims history follows the property: a house that flooded twice will price higher than its dry neighbor in the same zone.",
    "The glidepath: most existing policyholders move toward full-risk rates at up to 18% per year — budget for the increase, not just today's number.",
  ]);
  f.para(
    "Estimates in this report are scaled from published FEMA NFIP policy data (2025–2026). They are not quotes. Get a real quote at floodsmart.gov before you remove contingencies.",
    10, false, MUTED
  );
}

// ── Page 6: questions ──
function pageQuestions(f, p, multi, idx, n) {
  f.h1("5 questions for your agent and insurer");
  propTag(f, p, multi, idx, n);
  f.bullets(questionsFor(p));
  f.gap(6);
  f.para(
    "Ask these before the inspection period ends — answers you get after contingencies expire are just expensive trivia.",
    10, false, MUTED
  );
}

// ── Page 7: map history ──
function pageMapHistory(f, p, multi, idx, n) {
  f.h1("How your zone changed over time");
  propTag(f, p, multi, idx, n);
  f.para(
    `The map covering this property took effect ${p.map_effective || "on an unknown date"} (FIRM panel ${p.firm_pan || "unknown"}, DFIRM ${p.dfirm_id || "unknown"}). FEMA updates maps continuously as new studies finish — a zone can get better or worse between map versions.`,
    10.5
  );
  f.bullets([
    "Ask the seller for any Elevation Certificate on file — it can lower premiums substantially.",
    "Check for Letters of Map Amendment (LOMA) or Revision (LOMR) on the property: an approved LOMA can remove the insurance requirement entirely.",
    "Pull the free FIRMette for this address at msc.fema.gov/portal to see the exact boundary line.",
    "If a map update is in progress for your county, find out which direction the preliminary maps move your zone — lenders price on the effective map, but you'll live with the next one.",
  ]);
}

// ── Page 8: checklist ──
function pageChecklist(f, p, multi, idx, n) {
  f.h1("Before you close: checklist");
  propTag(f, p, multi, idx, n);
  f.bullets([
    "Get a real flood insurance quote (floodsmart.gov) before removing contingencies — not after.",
    "Confirm whether the seller's policy is assumable; a grandfathered rate can be worth thousands.",
    "Verify the community participates in the NFIP — without participation, federal flood insurance isn't available.",
    "Budget the premium into your monthly payment math, not as an afterthought at closing.",
    "If the zone is AE or VE, price an Elevation Certificate into your inspection period.",
    "Walk the property after heavy rain if you can — maps are models, water is the truth.",
  ]);
}

// ── Page 9: methodology ──
function pageMethodology(f, p, multi, idx, n) {
  f.h1("Methodology and data sources");
  propTag(f, p, multi, idx, n);
  f.bullets([
    "Zone lookup: FEMA National Flood Hazard Layer (NFHL) ArcGIS REST service, layer S_Fld_Haz_Ar, point query at the geocoded address.",
    "Geocoding: U.S. Census Bureau geocoder (keyless, public).",
    "Map vintage: FIRM panel effective date (EFF_DATE) from the NFHL FIRM panel layer.",
    "Premium ranges: scaled from FEMA NFIP policy data (2025–2026) for $250,000 building coverage — estimates, never quotes.",
    "Zone interpretations: FEMA's official flood zone glossary.",
    "Narrative sections are generated with AI from the facts above; all zone, price, and map data is deterministic.",
  ]);
}

// ── Page 10: disclaimer ──
function pageDisclaimer(f, p, meta, multi, idx, n) {
  f.h1("Disclaimer");
  propTag(f, p, multi, idx, n);
  f.para(
    "NOT AN OFFICIAL FLOOD DETERMINATION. This report reads FEMA's National Flood Hazard Layer for informational purposes only. It is not a certified flood zone determination and does not replace the Standard Flood Hazard Determination Form (SFHDF) your lender or insurer requires. Flood-zone boundaries are approximate, maps are updated over time, and recent Letters of Map Change may not yet be reflected.",
    10.5, true
  );
  f.para(
    "For insurance, lending, or building decisions, consult your local floodplain administrator, your insurance agent, or a licensed flood-determination provider. Premium ranges shown are estimates, not quotes — get a real quote at floodsmart.gov. FloodLens and MehyarSoft LLC accept no liability for decisions made using this report.",
    10.5
  );
  f.gap(10);
  f.kv("Report ID", meta.report_id || "—");
  f.kv("Property", truncate(p.address, 60));
  f.kv("Generated", meta.generated_at || "—");
  f.kv("FEMA data checked", meta.data_checked_at || "—");
  if (meta.degraded) f.kv("Data quality", "CACHED — FEMA was unreachable; values are the last known good");
}

function fallbackNarration(p) {
  return (
    `This property sits in FEMA Zone ${p.zone} (${p.risk_plain}). ` +
    (p.sfha
      ? "That puts it inside the Special Flood Hazard Area, which means flood insurance will almost certainly be part of your monthly cost if you finance the purchase. "
      : "It sits outside the Special Flood Hazard Area, so insurance won't be forced on you — the decision is yours, based on risk tolerance. ") +
    (p.premium_label
      ? `Comparable NFIP policies typically run ${p.premium_label} a year at $250,000 of building coverage, but your property's elevation, foundation, and distance to water move that number more than the zone letter does. `
      : "") +
    "Use the questions on the next page with your agent before you commit — the buyers who get hurt are the ones who first hear the premium number at the closing table."
  );
}

function questionsFor(p) {
  const base = [
    `What would flood insurance actually cost for THIS house — not the zone average, but a quote with its elevation and foundation?`,
    "Is there an Elevation Certificate on file, and can I see it before the inspection period ends?",
    "Has this property ever had a LOMA or LOMR, or any flood claim I should know about?",
    "Is the seller's flood policy assumable, and at what rate?",
    `When did the current flood map take effect here (${p.map_effective || "unknown"}), and is a map update in progress?`,
  ];
  if (p.risk === "high_coastal" || p.risk === "high") {
    base.push("What would it cost to elevate or mitigate to bring this premium down — and who pays for that?");
  }
  return base.slice(0, 6);
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

