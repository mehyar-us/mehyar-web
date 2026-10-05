import draft from "../../../shared/mayor-automatic-audit.json" with {type:"json"};

const auditReference = /\bmayor(?:['’]s)?\b.{0,100}\b(?:automatic|automated)\b.{0,40}\baudit\b|\b(?:automatic|automated)\s+(?:business\s+)?audit\b.{0,100}\bmayor\b|\bmayor(?:['’]s)?\b.{0,60}\bbusiness\s+audit\b|\bmayor(?:['’]s)?\s+\$330\s+(?:business\s+)?audit\b/i;
const proposedBuild = /\b(?:build|design|develop|implement|code|hypothetical|proposed)\b/i;
const auditFollowUp = question => question.length <= 400 &&
  /^(?:and\b|what\b|how\b|when\b|where\b|can\b|could\b|does\b|do\b|is\b|are\b)/i.test(question) &&
  /\b(?:it|its|this|that|the (?:(?:automatic|automated) )?(?:business )?audit)\b/i.test(question) &&
  /\b(?:costs?|prices?|buy|pay|payment|purchase|available|launched|ready|include[ds]?|reports?|scope|roadmap|delivery|deliver|human|screenshots?)\b/i.test(question) &&
  !/\b(?:founder|\$5|Business agent|OpenClaw|Hermes|another|other|new)\b/i.test(question);

export function isMayorAutomaticAuditQuestion(messages) {
  const current = messages.at(-1)?.content?.trim() || "";
  if (proposedBuild.test(current)) return false;
  if (auditReference.test(current) || current.includes(draft.href)) return true;
  if (!auditFollowUp(current)) return false;
  for (let index=messages.length-2; index>=0; index--) {
    if (messages[index].role !== "user") continue;
    const prior = messages[index].content.trim();
    if (proposedBuild.test(prior)) return false;
    if (auditReference.test(prior) || prior.includes(draft.href)) return true;
    if (!auditFollowUp(prior)) return false;
  }
  return false;
}

// Publishing the shared draft alone cannot offer a route the client/server do
// not yet allow. Activation requires the coordinated exact audit destination.
export function mayorAutomaticAuditReady(navigationPaths, product=draft) {
  return product.publication === "published" &&
    product.id === "mayor-automatic-business-audit" && product.priceUsd === 330 &&
    product.payment === "one-time" && product.href === "https://mayor.mehyar.us/business-audit" &&
    navigationPaths.includes(product.href);
}

export function mayorAutomaticAuditKnowledge(navigationPaths, product=draft) {
  if (!mayorAutomaticAuditReady(navigationPaths,product))
    return "AUTOMATIC BUSINESS AUDIT STATUS: The Mayor automatic business audit is not publicly available. Do not describe its draft scope, offer it for purchase or link to a private audit route. It is separate from existing Business agent planning reviews, the published $330 founder-led Website Audit and the $5 automated website report. A planning review is not a paid automatic business audit. Never use those website-review prices as the price of a Business agent planning run.";
  return `Separate published product: ${product.name}, $${product.priceUsd} USD ${product.payment}. ${product.summary} Scope: ${product.scope.map(item=>`${item.name}: ${item.detail}`).join("; ")}. Roadmap: ${product.roadmap.map(item=>`${item.period}: ${item.detail}`).join("; ")}. ${product.delivery} ${product.boundaries} ${product.separateOffers} Exact product destination: ${product.href}. Public discovery does not buy, start or access an audit.`;
}

export function mayorAutomaticAuditGuide(navigationPaths, product=draft) {
  if (!mayorAutomaticAuditReady(navigationPaths,product))
    return {
      title:"Automatic business audit status",
      answer:"The Mayor automatic business audit is not publicly available yet. It is separate from the Mayor Business agent's planning reviews and MehyarSoft's existing $330 founder-led Website Audit and $5 automated website report. This public helper cannot start an audit, take payment or read private reports.",
      blocks:[{type:"navigation",title:"Published product information",links:[
        {label:"Website-review options",detail:"The existing founder-led Website Audit and automated website report have separate scopes.",path:"/pricing"},
        {label:"The Mayor",detail:"Learn about the existing signed-in business workspace and its planning reviews.",path:"/mayor"},
      ]}],
      followUps:["Explain the founder-led Website Audit", "How do Mayor Business agent planning reviews work?"],
      sources:["/mayor","/pricing"],
    };
  return {
    title:product.name,
    answer:`${product.name} is a separate $${product.priceUsd} USD ${product.payment} product. ${product.summary} ${product.delivery} ${product.boundaries.replace("results and delivery dates are not guaranteed", "results and delivery dates remain uncertain")} ${product.separateOffers}`,
    blocks:[
      {type:"checklist",title:"Audit scope",items:product.scope.map(item=>`${item.name}: ${item.detail}`)},
      {type:"workflow",title:"A proposed 30/60/90-day roadmap",steps:product.roadmap.map(item=>({title:item.period,detail:item.detail}))},
      {type:"navigation",title:"Separate automatic audit",links:[{label:product.cta,detail:"Review the current scope and purchase terms. Public discovery cannot buy or start this audit.",path:product.href}]},
    ],
    followUps:[], sources:["/mayor","/pricing"],
  };
}

// Guard model output as well as direct questions, including hidden blocks and
// per-column comparisons. An inactive product cannot be sold by generated copy.
export function verifyMayorAutomaticAuditClaims(value, navigationPaths, context="") {
  if (mayorAutomaticAuditReady(navigationPaths)) return;
  if (typeof value === "string") {
    if (/https:\/\/mayor\.mehyar\.us\/(?:business-audit|audit)(?:\b|[/?#])/i.test(value)) throw new Error("unverified_automatic_audit");
    const productField = auditReference.test(`${context} ${value}`);
    for (const claim of value.split(/[;\n]|[.!?](?=\s|$)|\b(?:but|however)\b/)) {
      if (!productField) continue;
      if (!auditReference.test(claim) && /\bfounder[- ]led(?:\s+Website)?\s+Audit\b|\bautomated website report\b|\$5\s+(?:automated\s+)?(?:website\s+)?report|\bMayor (?:Free|Pro|Business agent)\b|\busage packs?\b/i.test(claim)) continue;
      const activeClaim = claim.replace(/\b(?:not (?:publicly )?(?:available|launched|live|released|published|ready)(?: (?:for purchase|to (?:buy|purchase|order)))?|unavailable(?: for purchase)?|unpublished|unreleased|not for sale|not purchasable|do not (?:buy|purchase|pay|order)|cannot (?:buy|purchase|pay|start))\b/gi, "");
      if (/\b(?:available|launched|live|released|published|ready|buy|purchase|checkout|pay|order|includes|offers|costs|priced|delivers|provides|uses|covers|contains|roadmap|analyzes|analyses)\b|\$\s*330|\b330\s*(?:USD|dollars?)\b/i.test(activeClaim))
        throw new Error("unverified_automatic_audit");
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach(item=>verifyMayorAutomaticAuditClaims(item,navigationPaths,context));
  for (const [key, field] of Object.entries(value)) {
    if (value.type === "comparison" && key === "rows" && Array.isArray(field)) {
      for (const row of field) {
        verifyMayorAutomaticAuditClaims(row.left,navigationPaths,value.leftLabel || "");
        verifyMayorAutomaticAuditClaims(row.right,navigationPaths,value.rightLabel || "");
        verifyMayorAutomaticAuditClaims(row.label,navigationPaths);
      }
    } else {
      const ownLabel = typeof value.title === "string" ? value.title : typeof value.label === "string" ? value.label : context;
      const label = auditReference.test(context) && !auditReference.test(ownLabel) ? `${context} ${ownLabel}` : ownLabel;
      verifyMayorAutomaticAuditClaims(field,navigationPaths,key === "answer" || key === "detail" || key === "items" || key === "blocks" || key === "steps" ? label : context);
    }
  }
}
