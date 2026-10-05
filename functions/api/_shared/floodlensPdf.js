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
  divider() {
    this.need(12);
    this.pdf.rect(MARGIN, this.y - 6, CONTENT_W, 1, 0.85, 0.87, 0.9);
    this.y -= 12;
  }
  // Tinted callout box with a colored left border.
  callout(title, body, accent) {
    const a = accent || BRAND;
    const lines = wrap(body, CONTENT_W - 28, 10.5, false);
    const h = 26 + lines.length * 15.5;
    this.need(h + 6);
    const top = this.y;
    this.pdf.rect(MARGIN, top - h, CONTENT_W, h, 0.95, 0.97, 1);
    this.pdf.rect(MARGIN, top - h, 5, h, a.r, a.g, a.b);
    this.pdf.text(title, MARGIN + 14, top - 18, 11, true, INK.r, INK.g, INK.b);
    let yy = top - 36;
    for (const ln of lines) {
      this.pdf.text(ln, MARGIN + 14, yy, 10.5, false, INK.r, INK.g, INK.b);
      yy -= 15.5;
    }
    this.y = top - h - 8;
  }
  // 2-column grid of small fact cards.
  factGrid(items) {
    const cols = 2, gw = 10, cw = (CONTENT_W - gw) / cols, ch = 44;
    const rows = Math.ceil(items.length / cols);
    this.need(rows * (ch + 8));
    items.forEach((it, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = MARGIN + c * (cw + gw);
      const top = this.y - r * (ch + 8);
      this.pdf.rect(x, top - ch, cw, ch, 0.96, 0.97, 1);
      this.pdf.text(truncate(it.label, 30), x + 10, top - 16, 8.5, true, MUTED.r, MUTED.g, MUTED.b);
      this.pdf.text(truncate(it.value, 34), x + 10, top - 32, 10.5, true, INK.r, INK.g, INK.b);
    });
    this.y -= rows * (ch + 8) + 4;
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
    pageCover(f, p, meta, multi, idx, props.length);        // 1 verdict cover
    f.pageBreak(); pageZoneDecoded(f, p, multi, idx, props.length);   // 2 zone decoded
    f.pageBreak(); pageNarration(f, p, multi, idx, props.length);      // 3 what it means
    f.pageBreak(); pageRequirements(f, p, multi, idx, props.length);  // 4 insurance requirements
    f.pageBreak(); pageCost(f, p, multi, idx, props.length);           // 5 cost + how estimated
    f.pageBreak(); pageQuestions(f, p, multi, idx, props.length);     // 6 questions
    f.pageBreak(); pageMapHistory(f, p, multi, idx, props.length);    // 7 map history
    f.pageBreak(); pageChecklist(f, p, multi, idx, props.length);     // 8 checklist
    f.pageBreak(); pageMethodology(f, p, multi, idx, props.length);   // 9 methodology
    f.pageBreak(); pageDisclaimer(f, p, meta, multi, idx, props.length); // 10 disclaimer
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

// ── Page 1: cover — verdict header ──
function pageCover(f, p, meta, multi, idx, n) {
  f.pdf.text("FLOODLENS", MARGIN, PAGE_H - 110, 26, true, BRAND.r, BRAND.g, BRAND.b);
  f.pdf.text(
    multi ? "Multi-Property Flood Zone Report" : "Flood Zone Report",
    MARGIN, PAGE_H - 140, 15, false, MUTED.r, MUTED.g, MUTED.b
  );
  if (multi) {
    f.pdf.text(`Property ${idx + 1} of ${n}`, MARGIN, PAGE_H - 162, 11, true, INK.r, INK.g, INK.b);
  }
  const badge = BADGE[p.risk] || BADGE.unknown;
  const vtop = PAGE_H - 220;
  // Verdict card
  f.pdf.rect(MARGIN, vtop - 96, CONTENT_W, 96, 0.95, 0.97, 1);
  f.pdf.rect(MARGIN, vtop - 96, 6, 96, badge.r, badge.g, badge.b);
  f.pdf.text(truncate(p.address, 58), MARGIN + 18, vtop - 28, 13, true, INK.r, INK.g, INK.b);
  const zl = `ZONE ${p.zone}`;
  const bw = Math.max(textWidth(zl, 14, true) + 24, 120);
  f.pdf.rect(MARGIN + 18, vtop - 62, bw, 28, badge.r, badge.g, badge.b);
  f.pdf.text(zl, MARGIN + 30, vtop - 55, 14, true, 1, 1, 1);
  f.pdf.text(truncate(p.risk_plain, 95), MARGIN + 18, vtop - 76, 10.5, true, badge.r, badge.g, badge.b);
  f.pdf.text(
    p.sfha
      ? "Inside the Special Flood Hazard Area — insurance will likely be required."
      : "Outside the Special Flood Hazard Area — no lender can require insurance.",
    MARGIN + 18, vtop - 91, 10, false, MUTED.r, MUTED.g, MUTED.b
  );
  f.y = vtop - 110; // flow cursor starts below the verdict card
  // Key facts grid
  f.factGrid([
    { label: "SPECIAL FLOOD HAZARD AREA", value: p.sfha ? "YES — high risk" : "No" },
    { label: "ZONE SUBTYPE", value: truncate(p.zone_subtype || "—", 34) },
    { label: "BASE FLOOD ELEVATION", value: p.bfe != null ? `${p.bfe} ft` : "—" },
    { label: "MAP EFFECTIVE DATE", value: p.map_effective || "—" },
  ]);
  f.divider();
  // Next 3 moves
  f.pdf.text("Your next 3 moves", MARGIN, f.y - 14, 13, true, BRAND.r, BRAND.g, BRAND.b);
  f.y -= 26;
  const moves = nextMoves(p);
  moves.forEach((m, i) => {
    const lines = wrap(`${i + 1}. ${m}`, CONTENT_W - 16, 10.5, false);
    lines.forEach((ln, li) => {
      f.pdf.text(ln, MARGIN + 4, f.y - 10.5, 10.5, false, INK.r, INK.g, INK.b);
      f.y -= 15.5;
    });
    f.y -= 4;
  });
  f.y -= 6;
  f.pdf.text(
    `Report generated ${fmtDate(meta.generated_at)} · FEMA data checked ${meta.data_checked_at || "—"}`,
    MARGIN, 92, 9.5, false, MUTED.r, MUTED.g, MUTED.b
  );
  if (meta.degraded) {
    f.pdf.text("Served from cached data — FEMA was unreachable at generation time.", MARGIN, 78, 9.5, true, 0.7, 0.35, 0.05);
  }
  f.pdf.text(
    "Informational only — not an official flood determination. See the disclaimer on the last page.",
    MARGIN, 62, 9, true, 0.7, 0.16, 0.16
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
  const ex = zoneExplainer(p);
  f.callout(ex.title, ex.body, badge);
  f.h2("FEMA identifiers for this property");
  f.kv("Special Flood Hazard Area (SFHA)", p.sfha ? "YES — high-risk area" : "No");
  f.kv("Zone subtype", p.zone_subtype || "—");
  if (p.bfe != null) f.kv("Base Flood Elevation (BFE)", `${p.bfe} ft — the level water is expected to reach in a base flood`);
  if (p.depth != null) f.kv("Flood depth", `${p.depth} ft`);
  f.kv("FIRM panel", p.firm_pan || "—");
  f.kv("DFIRM ID", p.dfirm_id || "—");
  f.kv("Map effective date", p.map_effective || "—");
  f.gap(6);
  f.divider();
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

// ── Page 4: insurance requirements ──
function pageRequirements(f, p, multi, idx, n) {
  f.h1("Do you have to buy flood insurance?");
  propTag(f, p, multi, idx, n);
  if (p.sfha) {
    f.callout(
      "YES — almost certainly, if you finance the purchase",
      "When a property sits in the Special Flood Hazard Area and the mortgage is federally backed (FHA, VA, USDA, Fannie Mae, or Freddie Mac), the lender is legally required to make you carry flood insurance for the life of the loan. This is the cost surprise that hits buyers at the closing table — put the premium in your monthly payment math now.",
      BADGE.high
    );
  } else {
    f.callout(
      "NO — no lender can require it for this property",
      "Outside the Special Flood Hazard Area, flood insurance is entirely your choice. No lender requirement attaches to this zone. The question is whether the risk justifies an optional policy — and in this zone, preferred-risk pricing is usually a few hundred dollars a year.",
      BADGE.minimal
    );
  }
  f.h2("What 'required' and 'optional' actually mean");
  f.bullets([
    "Required (SFHA + federally backed loan): the lender escrows the premium with your mortgage payment. Let the policy lapse and the lender force-places coverage at a much higher price.",
    "Optional (outside SFHA): you can still buy an NFIP preferred-risk policy or a private flood policy. Over 20% of NFIP claims come from outside high-risk zones.",
    "Paying cash? No lender means no requirement anywhere — but the flood risk doesn't care how you paid.",
    "Grandfathering: if a map update ever moves this property into a higher-risk zone, keeping continuous coverage can lock in the cheaper rate class. A LOMA (Letter of Map Amendment) can remove the requirement entirely if the structure is shown above the base flood level.",
  ]);
  f.gap(4);
  f.para(
    "The requirement follows the loan, not the owner: sell to a cash buyer and the requirement disappears; refinance into a federally backed loan and it comes back.",
    10, false, MUTED
  );
}

// ── Page 5: insurance cost + how it is estimated ──
function pageCost(f, p, multi, idx, n) {
  f.h1("Flood insurance: what it typically costs");
  propTag(f, p, multi, idx, n);
  if (p.premium_label) {
    f.callout(
      `Zone ${p.zone}: ${p.premium_label} / year (estimate)`,
      "Typical NFIP cost at $250,000 of building coverage. Your property's number moves with elevation, distance to water, foundation type, replacement cost, and claims history — the zone letter is no longer the main price driver under FEMA's Risk Rating 2.0.",
      BADGE[p.risk] || BADGE.unknown
    );
    f.bullets([
      "Elevation is the lever you control: a house 3 feet above the Base Flood Elevation can cost half as much to insure as the identical house at the BFE. An Elevation Certificate documents this.",
      "Replacement cost matters more than market price — $250,000 of building coverage is the benchmark used throughout this report.",
      "Claims history follows the property: a house that flooded twice prices higher than its dry neighbor in the same zone.",
      "The glidepath: most existing policyholders move toward full-risk rates at up to 18% per year — budget for the increase, not just today's number.",
    ]);
    f.para(p.premium_footnote, 9, false, MUTED);
    f.gap(2);
    f.para(
      "Estimates are scaled from published FEMA NFIP policy data (2025–2026). They are not quotes. Get a real quote at floodsmart.gov before you remove contingencies.",
      10, false, MUTED
    );
  } else {
    f.para("No premium range applies — this location has no FEMA zone classification to price against. Talk to an agent about private flood options if the property sits near water.", 10.5);
    f.bullets([
      "Private flood insurers often cover what the NFIP won't, and sometimes at better rates for low-risk properties.",
      "Ask specifically about preferred-risk pricing — outside the SFHA you may qualify for the cheapest tier.",
    ]);
  }
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
    "For insurance, lending, or building decisions, consult your local floodplain administrator, your insurance agent, or a licensed flood-determination provider. Premium ranges shown are estimates, not quotes — get a real quote at floodsmart.gov. This report is informational only and is not insurance advice or legal advice. FloodLens and MehyarSoft LLC accept no liability for decisions made using this report.",
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

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  } catch { return "—"; }
}

// Plain-language zone explanation from lookup fields only.
function zoneExplainer(p) {
  const sub = String(p.zone_subtype || "").toUpperCase();
  if (p.zone === "X" && sub.includes("MINIMAL")) {
    return {
      title: "Zone X (unshaded): FEMA's lowest-risk classification",
      body: "This property sits outside both the 1%-annual-chance (100-year) and 0.2%-annual-chance (500-year) floodplains. Lenders cannot require flood insurance here, and NFIP policies — if you want one — price at the cheapest preferred-risk tier.",
    };
  }
  if (p.zone === "X" && (sub.includes("SHADED") || sub.includes("0.2"))) {
    return {
      title: "Zone X (shaded): moderate risk",
      body: "This property sits between the 100-year and 500-year flood limits. Insurance is not lender-required, but this is the zone where 'it never floods here' gets tested — price a policy before you decide you don't need one.",
    };
  }
  if (p.sfha) {
    return {
      title: `Zone ${p.zone}: inside the Special Flood Hazard Area`,
      body: "This property sits in FEMA's high-risk flood area (1% or greater annual chance). With a federally backed mortgage, flood insurance is not optional — your lender will require it, and the premium belongs in your monthly payment math from day one.",
    };
  }
  if (p.zone === "D") {
    return {
      title: "Zone D: never studied",
      body: "FEMA has not studied flood risk for this area, so no zone — and no NFIP price — exists. Near water, talk to an agent about private flood options; the absence of a zone is not the absence of risk.",
    };
  }
  return {
    title: `FEMA Zone ${p.zone}`,
    body: p.risk_plain || "See the zone details below.",
  };
}

// The three moves that matter most, personalized by risk band.
function nextMoves(p) {
  if (p.sfha) {
    return [
      "Get a real flood insurance quote (floodsmart.gov) BEFORE removing contingencies — in the SFHA this number can move your monthly payment by hundreds.",
      "Ask the seller for the Elevation Certificate and any LOMA/LOMR on file — both can cut the premium dramatically.",
      "Pull the free FIRMette for this address at msc.fema.gov/portal to see the exact flood boundary line.",
    ];
  }
  return [
    "Get an optional flood quote anyway (floodsmart.gov) — preferred-risk pricing in Zone X is often a few hundred dollars a year.",
    "Ask the seller for any Elevation Certificate, LOMA, or flood-claim history before the inspection period ends.",
    "Pull the free FIRMette for this address at msc.fema.gov/portal to see the exact flood boundary line.",
  ];
}

