import { WorkflowEntrypoint } from "cloudflare:workers";

type Env = {
  DB: D1Database;
  ASSETS: R2Bucket;
  AI: Ai;
  BROWSER: Fetcher & { quickAction(action: string, options: Record<string, unknown>): Promise<Response> };
  PROPOSAL_WORKFLOW: Workflow;
  PROPOSAL_STUDIO_SERVICE_TOKEN: string;
  AI_GATEWAY_RUN_TOKEN: string;
  PUBLIC_SITE_URL: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  PRIMARY_MODEL: string;
  FALLBACK_MODEL: string;
  DEEP_REASONING_MODEL: string;
  IMAGE_MODEL: string;
};

type ProposalParams = {
  proposalId: string;
  sourceUrl: string;
  instruction: string;
  mode: "create" | "revise";
  parentRevisionId?: string | null;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_SOURCE_CHARS = 48_000;
const PRICE_GUIDE = {
  foundation: { setup: [495, 2500], monthly: [25, 99] },
  growth: { setup: [995, 4500], monthly: [149, 299] },
  concierge: { setup: [2495, 8500], monthly: [399, 899] },
  social: { setup: [500, 2500], monthly: [299, 999] },
  agentic: { setup: [1500, 8500], monthly: [349, 899], owned: [3500, 8500] },
};

export class ProposalWorkflow extends WorkflowEntrypoint<Env, ProposalParams> {
  async run(event: WorkflowEvent<ProposalParams>, step: WorkflowStep) {
    const params = event.payload;
    const proposal = await step.do("load proposal", async () => {
      await updateJob(this.env, params.proposalId, "running", "researching website", 10);
      const row = await this.env.DB.prepare("SELECT * FROM sales_proposals WHERE id = ? LIMIT 1").bind(params.proposalId).first<Record<string, unknown>>();
      if (!row) throw new Error("proposal_not_found");
      return row;
    });

    const sourceContext = await step.do("research website", async () => {
      if (params.mode === "revise" && proposal.source_snapshot_json) {
        return safeJson(String(proposal.source_snapshot_json), {});
      }
      await updateJob(this.env, params.proposalId, "running", "reading public website", 25);
      return researchWebsite(this.env, params.sourceUrl);
    });

    const priorRevision = await step.do("load prior context", async () => {
      if (!params.parentRevisionId) return null;
      const row = await this.env.DB.prepare("SELECT id, revision_number, content_json, source_context_json FROM sales_proposal_revisions WHERE id = ? AND proposal_id = ? LIMIT 1")
        .bind(params.parentRevisionId, params.proposalId).first<Record<string, unknown>>();
      return row || null;
    });

    const generation = await step.do("reason about offer and pricing", async () => {
      await updateJob(this.env, params.proposalId, "running", "building tailored offer", 50);
      return generateProposal(this.env, {
        sourceUrl: params.sourceUrl,
        sourceContext,
        instruction: params.instruction,
        priorContent: priorRevision ? safeJson(String(priorRevision.content_json), null) : null,
      });
    });

    const revision = await step.do("save revision", async () => {
      await updateJob(this.env, params.proposalId, "running", "saving proposal", 72);
      const current = await this.env.DB.prepare("SELECT COALESCE(MAX(revision_number), 0) AS value FROM sales_proposal_revisions WHERE proposal_id = ?")
        .bind(params.proposalId).first<{ value: number }>();
      const revisionNumber = Number(current?.value || 0) + 1;
      const revisionId = crypto.randomUUID();
      await this.env.DB.prepare(`INSERT INTO sales_proposal_revisions
        (id, proposal_id, parent_revision_id, revision_number, instruction, content_json, source_context_json, model, gateway_id, gateway_log_id, generation_metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(revisionId, params.proposalId, params.parentRevisionId || null, revisionNumber, params.instruction || null,
          JSON.stringify(generation.content), JSON.stringify(sourceContext), generation.model, this.env.AI_GATEWAY_ID,
          generation.gatewayLogId || null, JSON.stringify(generation.metadata)).run();
      return { revisionId, revisionNumber };
    });

    const asset = await step.do("generate hero image", async () => {
      await updateJob(this.env, params.proposalId, "running", "creating business artwork", 84);
      return generateHeroImage(this.env, params.proposalId, revision.revisionId, generation.content);
    });

    await step.do("publish unlisted client page", async () => {
      const content = generation.content;
      await this.env.DB.batch([
        this.env.DB.prepare(`UPDATE sales_proposals SET status = 'complete', updated_at = datetime('now'), completed_at = datetime('now'),
          business_name = ?, industry = ?, location = ?, title = ?, subtitle = ?, current_revision_id = ?, hero_asset_key = ?,
          source_snapshot_json = ?, generation_metadata_json = ?, error = NULL WHERE id = ?`)
          .bind(content.business?.name || "Business proposal", content.business?.industry || "Local business", content.business?.location || null,
            content.hero?.headline || `A practical growth plan for ${content.business?.name || "your business"}`,
            content.hero?.subheadline || null, revision.revisionId, asset?.key || null, JSON.stringify(sourceContext),
            JSON.stringify({ model: generation.model, gateway_id: this.env.AI_GATEWAY_ID, gateway_log_id: generation.gatewayLogId || null, image_model: asset?.model || null }), params.proposalId),
        this.env.DB.prepare("UPDATE sales_proposal_jobs SET status = 'complete', current_step = 'ready to share', progress = 100, completed_at = datetime('now'), updated_at = datetime('now') WHERE proposal_id = ? AND workflow_instance_id = ?")
          .bind(params.proposalId, event.instanceId),
      ]);
    });

    return { proposalId: params.proposalId, revisionId: revision.revisionId, status: "complete" };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (path === "/health") return json({ ok: true, service: "proposal-studio", bindings: { db: !!env.DB, r2: !!env.ASSETS, ai: !!env.AI, browser: !!env.BROWSER, workflow: !!env.PROPOSAL_WORKFLOW }, gateway_id: env.AI_GATEWAY_ID });

    const publicMatch = path.match(/^\/v1\/public\/proposals\/([^/]+)$/);
    if (request.method === "GET" && publicMatch) return publicProposal(env, decodeURIComponent(publicMatch[1]));
    const assetMatch = path.match(/^\/v1\/public\/proposals\/([^/]+)\/assets\/([^/]+)$/);
    if (request.method === "GET" && assetMatch) return publicAsset(env, decodeURIComponent(assetMatch[1]), decodeURIComponent(assetMatch[2]));
    if (request.method === "GET" && path === "/v1/public/proposals") return publicDirectory(env);

    if (!await isAuthorized(request, env)) return json({ ok: false, error: "admin_auth_required" }, 401);
    if (request.method === "GET" && path === "/v1/admin/proposals") return listProposals(env);
    if (request.method === "POST" && path === "/v1/admin/proposals") return createProposal(request, env);
    const detailMatch = path.match(/^\/v1\/admin\/proposals\/([^/]+)$/);
    if (request.method === "GET" && detailMatch) return proposalDetail(env, decodeURIComponent(detailMatch[1]));
    if (request.method === "PATCH" && detailMatch) return updateProposal(request, env, decodeURIComponent(detailMatch[1]));
    const reviseMatch = path.match(/^\/v1\/admin\/proposals\/([^/]+)\/revise$/);
    if (request.method === "POST" && reviseMatch) return reviseProposal(request, env, decodeURIComponent(reviseMatch[1]));
    const statusMatch = path.match(/^\/v1\/admin\/proposals\/([^/]+)\/status$/);
    if (request.method === "GET" && statusMatch) return proposalStatus(env, decodeURIComponent(statusMatch[1]));
    return json({ ok: false, error: "not_found" }, 404);
  },
};

async function createProposal(request: Request, env: Env) {
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const sourceUrl = normalizePublicUrl(body.url);
  if (!sourceUrl) return json({ ok: false, error: "valid_public_website_required" }, 400);
  const instruction = clean(body.instruction, 3000) || "Create the strongest truthful, plain-language proposal for this business.";
  const proposalId = crypto.randomUUID();
  const slug = `${slugify(new URL(sourceUrl).hostname.replace(/^www\./, ""))}-${proposalId.replaceAll("-", "").slice(0, 16)}`;
  const workflowId = `proposal-${proposalId}`;
  const jobId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sales_proposals (id, slug, status, workflow_instance_id, source_url, visibility) VALUES (?, ?, 'queued', ?, ?, 'unlisted')")
      .bind(proposalId, slug, workflowId, sourceUrl),
    env.DB.prepare("INSERT INTO sales_proposal_jobs (id, proposal_id, workflow_instance_id, status, current_step, progress, mode, instruction) VALUES (?, ?, ?, 'queued', 'queued', 0, 'create', ?)")
      .bind(jobId, proposalId, workflowId, instruction),
  ]);
  try {
    const instance = await env.PROPOSAL_WORKFLOW.create({ id: workflowId, params: { proposalId, sourceUrl, instruction, mode: "create" } satisfies ProposalParams });
    return json({ ok: true, proposal_id: proposalId, slug, workflow_instance_id: instance.id, status: "queued", public_url: `${env.PUBLIC_SITE_URL}/proposals/${slug}` }, 202);
  } catch (error) {
    await markFailed(env, proposalId, workflowId, error);
    return json({ ok: false, error: "workflow_start_failed", message: errorMessage(error) }, 503);
  }
}

async function reviseProposal(request: Request, env: Env, proposalId: string) {
  const proposal = await env.DB.prepare("SELECT id, source_url, current_revision_id FROM sales_proposals WHERE id = ? LIMIT 1").bind(proposalId).first<{ id: string; source_url: string; current_revision_id: string | null }>();
  if (!proposal) return json({ ok: false, error: "proposal_not_found" }, 404);
  if (!proposal.current_revision_id) return json({ ok: false, error: "proposal_not_ready" }, 409);
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const instruction = clean(body.instruction, 3000);
  if (!instruction) return json({ ok: false, error: "revision_instruction_required" }, 400);
  const workflowId = `revision-${proposalId}-${crypto.randomUUID().slice(0, 8)}`;
  const jobId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE sales_proposals SET status = 'queued', workflow_instance_id = ?, updated_at = datetime('now'), error = NULL WHERE id = ?").bind(workflowId, proposalId),
    env.DB.prepare("INSERT INTO sales_proposal_jobs (id, proposal_id, workflow_instance_id, status, current_step, progress, mode, instruction) VALUES (?, ?, ?, 'queued', 'queued', 0, 'revise', ?)")
      .bind(jobId, proposalId, workflowId, instruction),
  ]);
  try {
    const instance = await env.PROPOSAL_WORKFLOW.create({ id: workflowId, params: { proposalId, sourceUrl: proposal.source_url, instruction, mode: "revise", parentRevisionId: proposal.current_revision_id } satisfies ProposalParams });
    return json({ ok: true, proposal_id: proposalId, workflow_instance_id: instance.id, status: "queued" }, 202);
  } catch (error) {
    await markFailed(env, proposalId, workflowId, error);
    return json({ ok: false, error: "workflow_start_failed", message: errorMessage(error) }, 503);
  }
}

async function listProposals(env: Env) {
  const rows = await env.DB.prepare(`SELECT p.*, j.current_step, j.progress, j.error AS job_error,
    (SELECT COUNT(*) FROM sales_proposal_revisions r WHERE r.proposal_id = p.id) AS revision_count
    FROM sales_proposals p LEFT JOIN sales_proposal_jobs j ON j.workflow_instance_id = p.workflow_instance_id
    ORDER BY p.updated_at DESC LIMIT 100`).all();
  return json({ ok: true, proposals: rows.results || [] });
}

async function proposalDetail(env: Env, id: string) {
  const proposal = await env.DB.prepare("SELECT * FROM sales_proposals WHERE id = ? LIMIT 1").bind(id).first<Record<string, unknown>>();
  if (!proposal) return json({ ok: false, error: "proposal_not_found" }, 404);
  const [revisions, jobs, assets] = await Promise.all([
    env.DB.prepare("SELECT * FROM sales_proposal_revisions WHERE proposal_id = ? ORDER BY revision_number DESC LIMIT 30").bind(id).all(),
    env.DB.prepare("SELECT * FROM sales_proposal_jobs WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 30").bind(id).all(),
    env.DB.prepare("SELECT * FROM sales_proposal_assets WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 30").bind(id).all(),
  ]);
  return json({ ok: true, proposal, revisions: revisions.results || [], jobs: jobs.results || [], assets: assets.results || [] });
}

async function proposalStatus(env: Env, id: string) {
  const row = await env.DB.prepare(`SELECT p.id, p.slug, p.status, p.workflow_instance_id, p.error, p.updated_at,
    j.current_step, j.progress, j.error AS job_error FROM sales_proposals p
    LEFT JOIN sales_proposal_jobs j ON j.workflow_instance_id = p.workflow_instance_id WHERE p.id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  if (!row) return json({ ok: false, error: "proposal_not_found" }, 404);
  if (row.workflow_instance_id && !["complete", "failed"].includes(String(row.status))) {
    try {
      const instance = await env.PROPOSAL_WORKFLOW.get(String(row.workflow_instance_id));
      const workflow = await instance.status();
      if (workflow.status === "errored" || workflow.status === "terminated") await markFailed(env, id, String(row.workflow_instance_id), workflow.error?.message || workflow.status);
      return json({ ok: true, proposal: row, workflow });
    } catch (error) {
      return json({ ok: true, proposal: row, workflow: { status: "unknown", error: errorMessage(error) } });
    }
  }
  return json({ ok: true, proposal: row });
}

async function updateProposal(request: Request, env: Env, id: string) {
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const visibility = ["private", "unlisted", "featured"].includes(String(body.visibility)) ? String(body.visibility) : null;
  if (!visibility) return json({ ok: false, error: "valid_visibility_required" }, 400);
  const result = await env.DB.prepare("UPDATE sales_proposals SET visibility = ?, updated_at = datetime('now') WHERE id = ?").bind(visibility, id).run();
  return result.meta.changes ? json({ ok: true, id, visibility }) : json({ ok: false, error: "proposal_not_found" }, 404);
}

async function publicProposal(env: Env, slug: string) {
  const proposal = await env.DB.prepare(`SELECT p.id, p.slug, p.business_name, p.industry, p.location, p.title, p.subtitle, p.source_url, p.hero_asset_key,
    p.updated_at, p.current_revision_id, r.content_json, r.revision_number FROM sales_proposals p
    JOIN sales_proposal_revisions r ON r.id = p.current_revision_id
    WHERE p.slug = ? AND p.status = 'complete' AND p.visibility IN ('unlisted','featured') LIMIT 1`).bind(slug).first<Record<string, unknown>>();
  if (!proposal) return json({ ok: false, error: "proposal_not_found" }, 404, { "cache-control": "no-store" });
  return json({ ok: true, proposal: { ...proposal, content: safeJson(String(proposal.content_json), {}), content_json: undefined, hero_url: proposal.hero_asset_key ? `/api/proposals/${encodeURIComponent(slug)}/assets/hero` : null } }, 200, { "cache-control": "public, max-age=60" });
}

async function publicDirectory(env: Env) {
  const rows = await env.DB.prepare("SELECT slug, business_name, industry, location, title, subtitle, updated_at FROM sales_proposals WHERE status = 'complete' AND visibility = 'featured' ORDER BY updated_at DESC LIMIT 100").all();
  return json({ ok: true, proposals: rows.results || [] }, 200, { "cache-control": "public, max-age=120" });
}

async function publicAsset(env: Env, slug: string, assetName: string) {
  const proposal = await env.DB.prepare("SELECT id, hero_asset_key FROM sales_proposals WHERE slug = ? AND status = 'complete' AND visibility IN ('unlisted','featured') LIMIT 1").bind(slug).first<{ id: string; hero_asset_key: string | null }>();
  if (!proposal) return new Response("Not found", { status: 404 });
  const key = assetName === "hero" ? proposal.hero_asset_key : `proposals/${proposal.id}/${assetName}`;
  if (!key) return new Response("Not found", { status: 404 });
  const object = await env.ASSETS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "image/jpeg", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}

async function researchWebsite(env: Env, sourceUrl: string) {
  let markdown = "";
  let method = "browser_run_markdown";
  let browserMs: string | null = null;
  try {
    const response = await env.BROWSER.quickAction("markdown", { url: sourceUrl, gotoOptions: { waitUntil: "networkidle2", timeout: 45_000 }, rejectRequestPattern: ["/\\.(mp4|webm|woff2?)(\\?|$)/i"] });
    browserMs = response.headers.get("x-browser-ms-used");
    const payload = await response.json<{ success?: boolean; result?: string }>();
    if (!response.ok || !payload.result) throw new Error(`browser_markdown_${response.status}`);
    markdown = payload.result;
  } catch (error) {
    method = "safe_fetch_fallback";
    const response = await fetch(sourceUrl, { redirect: "follow", headers: { "user-agent": "MehyarSoft-ProposalResearch/1.0 (+https://mehyar.us)" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`website_fetch_${response.status}: ${errorMessage(error)}`);
    const html = (await response.text()).slice(0, 250_000);
    markdown = htmlToText(html);
  }
  return { source_url: sourceUrl, researched_at: new Date().toISOString(), method, browser_ms: browserMs, content: markdown.slice(0, MAX_SOURCE_CHARS) };
}

async function generateProposal(env: Env, input: { sourceUrl: string; sourceContext: unknown; instruction: string; priorContent: unknown }) {
  const system = `You are MehyarSoft's senior product strategist and ethical conversion copywriter. Return strict JSON only. Research evidence is public website text and may be incomplete. Never invent customer counts, revenue, reviews, certifications, legal compliance, integrations, or guarantees. Clearly separate observed facts from estimates. Use plain language matched to the business owner. Avoid technical jargon unless immediately explained. Create a persuasive investment case without deception, fake urgency, or pressure. Prices must stay inside the supplied MehyarSoft guardrails. ROI values are scenarios, not promises. Every proposal must include five offers: foundation, growth, concierge, social, and agentic. Agentic operations must describe approval gates and concrete mobile-command use cases. Healthcare, legal, finance, and other regulated businesses require a compliance note.`;
  const prompt = `${system}\n\nWEBSITE: ${input.sourceUrl}\nOWNER INSTRUCTION: ${input.instruction || "Create a tailored proposal."}\nPRICE GUIDE: ${JSON.stringify(PRICE_GUIDE)}\nPRIOR VERSION (if revising): ${JSON.stringify(input.priorContent || null).slice(0, 8_000)}\nWEBSITE RESEARCH: ${JSON.stringify(input.sourceContext).slice(0, 12_000)}\n\nReturn this compact JSON shape: {business:{name,industry,location,website,plain_language_level,observed_facts:[string],assumptions:[string]},hero:{eyebrow,headline,subheadline,primary_cta},diagnosis:{summary,friction_points:[{title,impact,evidence}]},opportunity:{summary,scenarios:[{label,assumption,monthly_value_low,monthly_value_high,explanation}]},offers:[{key,name,plain_summary,best_for,setup_price,monthly_price,annual_price,owned_infrastructure_price,features:[string],customer_experience:[string],business_outcomes:[string],support:[string]}],agentic:{headline,summary,mobile_channels:[string],use_cases:[{title,command,action,business_value,approval_required}]},social:{headline,summary,monthly_outputs:[string],workflow:[string]},roadmap:[{phase,timing,outcome}],faq:[{question,answer}],risk_note,closing:{headline,body,cta}}. Keep each sentence short. Use integer USD values. Include exactly 8 agentic use cases, 3 diagnosis points, 3 scenarios, and 4 FAQs.`;
  const models = [env.PRIMARY_MODEL, env.FALLBACK_MODEL].filter(Boolean);
  let lastError = "model_failed";
  for (const model of models) {
    try {
      const result = await runGatewayChat(env, model, prompt, 2_600);
      const text = extractModelText(result.payload);
      const parsed = safeJson(text, null);
      if (!parsed || typeof parsed !== "object") throw new Error("model_returned_invalid_json");
      return { content: normalizeContent(parsed, input.sourceUrl), model, gatewayLogId: result.gatewayLogId, metadata: { generated_at: new Date().toISOString(), fallback: false } };
    } catch (error) {
      lastError = `${model}: ${errorMessage(error)}`;
    }
  }
  return { content: fallbackContent(input.sourceUrl, input.sourceContext), model: "deterministic-fallback", gatewayLogId: null, metadata: { generated_at: new Date().toISOString(), fallback: true, error: lastError } };
}

async function runGatewayChat(env: Env, model: string, prompt: string, maxTokens: number) {
  if (!env.AI_GATEWAY_RUN_TOKEN) throw new Error("ai_gateway_run_token_missing");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.AI_GATEWAY_RUN_TOKEN}`, "cf-aig-gateway-id": env.AI_GATEWAY_ID, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.2, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json<any>().catch(() => ({}));
  if (!response.ok) throw new Error(`gateway_${response.status}:${clean(payload?.errors?.[0]?.message || payload?.error?.message || "inference_failed", 300)}`);
  return { payload, gatewayLogId: response.headers.get("cf-aig-log-id") || response.headers.get("x-aig-log-id") };
}

async function generateHeroImage(env: Env, proposalId: string, revisionId: string, content: any) {
  const prompt = `Premium editorial business photograph for a sales proposal. ${content.business?.industry || "local business"} environment in ${content.business?.location || "a modern city"}, authentic owner and customers, optimistic natural light, trustworthy and modern, no text, no logos, no interface mockups, landscape 16:9 composition.`;
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.AI_GATEWAY_RUN_TOKEN}`, "cf-aig-gateway-id": env.AI_GATEWAY_ID, "content-type": "application/json" },
      body: JSON.stringify({ model: env.IMAGE_MODEL, input: { prompt, steps: 4 } }),
      signal: AbortSignal.timeout(120_000),
    });
    const envelope: any = await response.json().catch(() => ({}));
    if (!response.ok || envelope.success === false) throw new Error(`image_gateway_${response.status}:${clean(envelope?.errors?.[0]?.message || "inference_failed", 300)}`);
    const raw: any = envelope.result || envelope;
    let bytes: Uint8Array | null = null;
    let contentType = "image/jpeg";
    if (raw?.image && typeof raw.image === "string") bytes = Uint8Array.from(atob(raw.image), (char) => char.charCodeAt(0));
    else if (raw instanceof ReadableStream) bytes = new Uint8Array(await new Response(raw).arrayBuffer());
    if (!bytes?.byteLength) throw new Error("image_model_returned_no_bytes");
    const key = `proposals/${proposalId}/${revisionId}/hero.jpg`;
    await env.ASSETS.put(key, bytes, { httpMetadata: { contentType }, customMetadata: { proposalId, revisionId, model: env.IMAGE_MODEL } });
    await env.DB.prepare("INSERT INTO sales_proposal_assets (id, proposal_id, revision_id, kind, r2_key, content_type, alt_text, prompt, model, width, height) VALUES (?, ?, ?, 'hero', ?, ?, ?, ?, ?, 1024, 768)")
      .bind(crypto.randomUUID(), proposalId, revisionId, key, contentType, `${content.business?.name || "Business"} growth proposal`, prompt, env.IMAGE_MODEL).run();
    await env.DB.prepare("UPDATE sales_proposal_revisions SET image_model = ? WHERE id = ?").bind(env.IMAGE_MODEL, revisionId).run();
    return { key, model: env.IMAGE_MODEL };
  } catch (error) {
    await env.DB.prepare("UPDATE sales_proposal_revisions SET generation_metadata_json = json_patch(COALESCE(generation_metadata_json, '{}'), ?) WHERE id = ?")
      .bind(JSON.stringify({ image_error: errorMessage(error) }), revisionId).run();
    return null;
  }
}

function normalizeContent(value: any, sourceUrl: string) {
  const offers = Array.isArray(value.offers) ? value.offers.slice(0, 5) : [];
  const keys = ["foundation", "growth", "concierge", "social", "agentic"];
  return {
    business: { name: clean(value.business?.name, 160) || new URL(sourceUrl).hostname, industry: clean(value.business?.industry, 120) || "Local business", location: clean(value.business?.location, 160) || "", website: sourceUrl, plain_language_level: clean(value.business?.plain_language_level, 80) || "plain", observed_facts: cleanList(value.business?.observed_facts, 10), assumptions: cleanList(value.business?.assumptions, 10) },
    hero: { eyebrow: clean(value.hero?.eyebrow, 100) || "A practical growth plan", headline: clean(value.hero?.headline, 180) || "Turn more interest into booked business", subheadline: clean(value.hero?.subheadline, 420) || "A clearer customer path, faster follow-up, and systems your team can actually use.", primary_cta: clean(value.hero?.primary_cta, 80) || "Talk through this plan" },
    diagnosis: { summary: clean(value.diagnosis?.summary, 800), friction_points: cleanObjects(value.diagnosis?.friction_points, 6, ["title", "impact", "evidence"]) },
    opportunity: { summary: clean(value.opportunity?.summary, 800), scenarios: normalizeScenarios(value.opportunity?.scenarios) },
    offers: keys.map((key, index) => normalizeOffer(offers[index] || {}, key, index)),
    agentic: { headline: clean(value.agentic?.headline, 180) || "A private business operator in your pocket", summary: clean(value.agentic?.summary, 900), mobile_channels: cleanList(value.agentic?.mobile_channels, 6), use_cases: cleanObjects(value.agentic?.use_cases, 10, ["title", "command", "action", "business_value", "approval_required"]) },
    social: { headline: clean(value.social?.headline, 180) || "Show up consistently without living on social media", summary: clean(value.social?.summary, 900), monthly_outputs: cleanList(value.social?.monthly_outputs, 10), workflow: cleanList(value.social?.workflow, 8) },
    roadmap: cleanObjects(value.roadmap, 6, ["phase", "timing", "outcome"]),
    faq: cleanObjects(value.faq, 8, ["question", "answer"]),
    risk_note: clean(value.risk_note, 900) || "Results depend on traffic, demand, access, offer quality, and staff follow-through. Revenue and savings are planning estimates, not guarantees.",
    closing: { headline: clean(value.closing?.headline, 180) || "Start with the smallest useful system", body: clean(value.closing?.body, 800), cta: clean(value.closing?.cta, 80) || "Book a call" },
  };
}

function normalizeOffer(value: any, key: string, index: number) {
  const defaults = [
    ["Website + Customer App", 750, 49], ["AI Texting + Follow-Up", 1500, 199], ["AI Front Desk", 4500, 599], ["Social Content Engine", 1200, 499], ["Managed Business Agent", 2500, 549],
  ][index] as [string, number, number];
  const guide: any = (PRICE_GUIDE as any)[key];
  return {
    key, name: clean(value.name, 120) || defaults[0], plain_summary: clean(value.plain_summary, 600), best_for: clean(value.best_for, 400),
    setup_price: clampMoney(value.setup_price, guide.setup[0], guide.setup[1], defaults[1]), monthly_price: clampMoney(value.monthly_price, guide.monthly[0], guide.monthly[1], defaults[2]),
    annual_price: clampMoney(value.annual_price, guide.monthly[0] * 10, guide.monthly[1] * 12, defaults[2] * 10),
    owned_infrastructure_price: key === "agentic" ? clampMoney(value.owned_infrastructure_price, guide.owned[0], guide.owned[1], 5500) : null,
    features: cleanList(value.features, 12), customer_experience: cleanList(value.customer_experience, 8), business_outcomes: cleanList(value.business_outcomes, 8), support: cleanList(value.support, 6),
  };
}

function normalizeScenarios(value: any) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((row) => ({ label: clean(row?.label, 120), assumption: clean(row?.assumption, 420), monthly_value_low: clampMoney(row?.monthly_value_low, 0, 1_000_000, 0), monthly_value_high: clampMoney(row?.monthly_value_high, 0, 1_000_000, 0), explanation: clean(row?.explanation, 600) }));
}

function fallbackContent(sourceUrl: string, sourceContext: any) {
  const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
  return normalizeContent({ business: { name: host, industry: "Local business", observed_facts: [`Public website reviewed: ${sourceUrl}`], assumptions: ["Pricing and value scenarios require owner confirmation."] }, diagnosis: { summary: "The fastest opportunity is a clearer mobile customer journey and reliable follow-up.", friction_points: [{ title: "Customer path", impact: "Interested visitors may not see one obvious next step.", evidence: "Initial website review" }] }, opportunity: { summary: "A connected website, follow-up, and customer-care system can reduce missed inquiries.", scenarios: [] }, offers: [], agentic: { summary: "Use a private mobile channel to request summaries, prepare follow-up, and monitor work with approval gates.", mobile_channels: ["Telegram", "Mobile web dashboard"], use_cases: [] }, social: { summary: "Turn approved business material into a repeatable content calendar.", monthly_outputs: [], workflow: [] }, roadmap: [], faq: [], closing: {} }, sourceUrl);
}

async function updateJob(env: Env, proposalId: string, status: string, step: string, progress: number) {
  await env.DB.batch([
    env.DB.prepare("UPDATE sales_proposals SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, proposalId),
    env.DB.prepare("UPDATE sales_proposal_jobs SET status = ?, current_step = ?, progress = ?, updated_at = datetime('now') WHERE proposal_id = ? AND completed_at IS NULL").bind(status, step, progress, proposalId),
  ]);
}

async function markFailed(env: Env, proposalId: string, workflowId: string, error: unknown) {
  const message = errorMessage(error).slice(0, 1000);
  await env.DB.batch([
    env.DB.prepare("UPDATE sales_proposals SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").bind(message, proposalId),
    env.DB.prepare("UPDATE sales_proposal_jobs SET status = 'failed', error = ?, current_step = 'failed', updated_at = datetime('now'), completed_at = datetime('now') WHERE proposal_id = ? AND workflow_instance_id = ?").bind(message, proposalId, workflowId),
  ]);
}

async function isAuthorized(request: Request, env: Env) {
  const token = request.headers.get("x-mehyarsoft-service-token") || "";
  if (!token || !env.PROPOSAL_STUDIO_SERVICE_TOKEN || token.length !== env.PROPOSAL_STUDIO_SERVICE_TOKEN.length || token.length < 32) return false;
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(env.PROPOSAL_STUDIO_SERVICE_TOKEN);
  return crypto.subtle.timingSafeEqual(a, b);
}

function normalizePublicUrl(value: unknown) {
  try {
    const raw = clean(value, 1000);
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1" || isPrivateIpv4(host)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

function isPrivateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function extractModelText(raw: any) {
  if (typeof raw === "string") return raw;
  if (typeof raw?.response === "string") return raw.response;
  if (typeof raw?.result?.response === "string") return raw.result.response;
  if (typeof raw?.choices?.[0]?.message?.content === "string") return raw.choices[0].message.content;
  return JSON.stringify(raw);
}

function htmlToText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanList(value: unknown, maxItems: number) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => clean(item, 500)).filter(Boolean) : [];
}

function cleanObjects(value: unknown, maxItems: number, keys: string[]) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item: any) => Object.fromEntries(keys.map((key) => [key, key === "approval_required" ? item?.[key] !== false : clean(item?.[key], 700)])));
}

function clampMoney(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(min, Math.min(max, number))) : fallback;
}

function safeJson(value: string, fallback: any) {
  try { return JSON.parse(value); } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* ignore */ } }
    return fallback;
  }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "business";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "unknown_error");
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = new Set(["https://mehyar.us", "https://www.mehyar.us", "https://dashboard.mehyar.us"]);
  return { "access-control-allow-origin": allowed.has(origin) ? origin : "https://mehyar.us", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "content-type,x-mehyarsoft-service-token", vary: "Origin" };
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { ...JSON_HEADERS, "x-content-type-options": "nosniff", ...headers } });
}
