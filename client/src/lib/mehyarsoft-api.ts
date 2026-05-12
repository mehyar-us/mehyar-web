const DEFAULT_API_BASE_URL = "";
const DEFAULT_ADMIN_API_BASE_URL = "https://api.mehyar.us";

export const MEHYARSOFT_API_BASE_URL = (
  import.meta.env.VITE_MEHYARSOFT_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/$/, "");

export const MEHYARSOFT_ADMIN_API_BASE_URL = (
  import.meta.env.VITE_MEHYARSOFT_ADMIN_API_BASE_URL || DEFAULT_ADMIN_API_BASE_URL
).replace(/\/$/, "");

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };
type ApiPayload = Record<string, JsonValue | undefined>;
type UnknownRecord = Record<string, unknown>;

export type IntakeFormType = "contact" | "audit" | "booking" | "micro_offer" | "newsletter" | "phone_help";

export interface IntakePayload extends ApiPayload {
  form_type: IntakeFormType;
  request_type?: IntakeFormType;
  selected_offer?: string;
  offer_code?: string;
  value_estimate?: number;
  calendar_intent?: string;
  name?: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  service_interest?: string;
  budget_range?: string;
  timeline?: string;
  message?: string;
  consent_contact: boolean;
  consent_marketing?: boolean;
  turnstile_token: string;
  hp_field?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

export interface UnsubscribePayload extends ApiPayload {
  email: string;
  reason?: string;
  source: string;
}

export interface AdminLoginPayload extends ApiPayload {
  username?: string;
  email?: string;
  password: string;
}

export interface AdminSession {
  token: string;
  expiresAt?: string;
  expiresInSeconds?: number;
}

export interface AdminMetrics {
  leads: number;
  contactRequests: number;
  auditRequests: number;
  bookingRequests: number;
  microOfferRequests: number;
  newsletterRequests: number;
  suppressions: number;
  pipelineValueCents?: number;
  first330CollectedCents?: number;
  monthlyRecurringCents?: number;
  updatedAt?: string;
}

export interface AdminLeadSummary {
  id: string;
  created_at?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  website?: string | null;
  request_type?: string | null;
  selected_offer?: string | null;
  offer_code?: string | null;
  offer_tier?: string | null;
  source_channel?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  status?: string | null;
  conversion_stage?: string | null;
  estimated_value_cents?: number | null;
  first_330_status?: string | null;
  monthly_retainer_target_cents?: number | null;
  follow_up_due_at?: string | null;
  compliance_flags?: string[] | null;
  suppression_status?: AdminSuppressionStatus | null;
  intake_quality?: number | null;
  consent_status?: string | null;
  last_touch_at?: string | null;
  next_step?: string | null;
}

export interface AdminSourceAttributionRow {
  source: string;
  leads: number;
  qualified?: number;
  converted?: number;
  pipeline_cents?: number;
}

export interface AdminFunnelStage {
  stage: string;
  count: number;
  conversion_rate?: number | null;
}

export interface AdminOutreachDraftSummary {
  id: string;
  lead_id?: string | null;
  thread_id?: string | null;
  recipient?: string | null;
  subject?: string | null;
  status?: string | null;
  risk_flags?: string[] | null;
  updated_at?: string | null;
}

export interface AdminCampaignSummary {
  id: string;
  name: string;
  status?: string | null;
  channel?: string | null;
  audience?: string | null;
  drafts_pending?: number | null;
  compliance_status?: string | null;
  updated_at?: string | null;
}

export interface AdminComplianceGate {
  key: string;
  label: string;
  status: "pass" | "attention" | "blocked" | "unknown" | string;
  detail?: string | null;
}

export interface AdminConversionTrendPoint {
  date: string;
  leads: number;
  qualified?: number;
  converted?: number;
}

export interface AdminRevenueSummary {
  pipeline_value_cents: number;
  first_330_collected_cents: number;
  first_330_target_cents: number;
  monthly_recurring_cents: number;
  monthly_recurring_target_cents: number;
  open_offer_value_cents?: number;
  due_follow_ups?: number;
  won_leads?: number;
}

export interface AdminDashboardSnapshot {
  leads: AdminLeadSummary[];
  revenue: AdminRevenueSummary;
  sources: AdminSourceAttributionRow[];
  funnel: AdminFunnelStage[];
  outreachDrafts: AdminOutreachDraftSummary[];
  campaigns: AdminCampaignSummary[];
  complianceGates: AdminComplianceGate[];
  auditLog: AdminEmailAuditEvent[];
  conversionTrend: AdminConversionTrendPoint[];
  suppressions: number;
  zohoStatus?: AdminEmailSyncStatus | null;
  exportUrl?: string | null;
  updatedAt?: string;
}

export interface AdminEmailSyncStatus {
  last_success_at?: string | null;
  last_status?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  next_expected_sync_at?: string | null;
}

export type AdminSuppressionStatus =
  | string
  | {
      suppressed?: boolean | null;
      status?: string | null;
      channels?: string[] | null;
      reasons?: string[] | null;
    };

export interface AdminEmailThreadSummary {
  id: string;
  subject?: string | null;
  primary_email?: string | null;
  primary_name?: string | null;
  related_lead_id?: string | null;
  related_business_name?: string | null;
  offer_code?: string | null;
  status?: string | null;
  last_message_at?: string | null;
  last_snippet?: string | null;
  unread_count?: number | null;
  priority_score?: number | null;
  suppression_status?: AdminSuppressionStatus | null;
  next_follow_up_at?: string | null;
}

export interface AdminEmailThreadsResponse {
  items: AdminEmailThreadSummary[];
  next_cursor?: string | null;
  sync?: AdminEmailSyncStatus | null;
}

export interface AdminEmailMessage {
  id: string;
  direction?: "inbound" | "outbound" | string;
  from_email?: string | null;
  from_name?: string | null;
  to_emails?: string[] | null;
  subject?: string | null;
  body_html_sanitized?: string | null;
  body_text?: string | null;
  received_at?: string | null;
  sent_at?: string | null;
  is_read?: boolean | null;
}

export interface AdminEmailLead {
  id?: string | null;
  name?: string | null;
  business_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website_url?: string | null;
  selected_offer?: string | null;
  offer_code?: string | null;
  urgency?: string | null;
  status?: string | null;
  suppression_status?: AdminSuppressionStatus | null;
}

export interface AdminEmailDraft {
  id: string;
  thread_id?: string | null;
  subject?: string | null;
  body_text?: string | null;
  draft_source?: string | null;
  template_key?: string | null;
  status?: string | null;
  requires_manual_approval?: boolean | null;
  requires_manual_send?: boolean | null;
  suggested_follow_up_at?: string | null;
  next_follow_up_at?: string | null;
  risk_flags?: string[] | null;
  updated_at?: string | null;
  approved_at?: string | null;
}

export interface AdminEmailAuditEvent {
  id?: string | null;
  created_at?: string | null;
  actor_type?: string | null;
  actor_user_id?: string | null;
  actor?: string | null;
  event_type?: string | null;
  type?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  surface?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AdminEmailThreadDetail {
  thread: AdminEmailThreadSummary & {
    next_follow_up_at?: string | null;
    suppression_status?: AdminSuppressionStatus | null;
  };
  messages: AdminEmailMessage[];
  lead?: AdminEmailLead | null;
  drafts?: AdminEmailDraft[];
  audit_tail?: AdminEmailAuditEvent[];
}

export interface AdminEmailSyncResponse {
  sync_run_id?: string;
  status?: string;
  message?: string;
}

export interface AdminEmailSendResponse {
  send_event?: {
    id?: string;
    status?: string;
    provider_message_id?: string;
    sent_at?: string;
  };
  thread?: AdminEmailThreadSummary;
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sanitizePayload(payload: ApiPayload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
  );
}

function endpoint(path: string) {
  return `${MEHYARSOFT_API_BASE_URL}${path}`;
}

function adminEndpoint(path: string) {
  return `${MEHYARSOFT_ADMIN_API_BASE_URL}${path}`;
}

async function apiFetch<T>(path: string, init: RequestInit = {}, buildEndpoint = endpoint): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildEndpoint(path), {
    ...init,
    headers,
  });
  const data = await parseResponse(response);

  if (!response.ok || (data && typeof data === "object" && "ok" in data && data.ok === false)) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `MehyarSoft API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

function postJson<T>(path: string, payload: ApiPayload, token?: string, buildEndpoint = endpoint) {
  return apiFetch<T>(path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify(sanitizePayload(payload)),
  }, buildEndpoint);
}

function patchJson<T>(path: string, payload: ApiPayload, token?: string, buildEndpoint = endpoint) {
  return apiFetch<T>(path, {
    method: "PATCH",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify(sanitizePayload(payload)),
  }, buildEndpoint);
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeSuppression(value: unknown): AdminSuppressionStatus | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return {
    suppressed: Boolean(record.suppressed),
    status: asString(record.status) || (record.suppressed ? "email_suppressed" : "clear"),
    channels: asArray(record.channels).filter((item): item is string => typeof item === "string"),
    reasons: asArray(record.reasons).filter((item): item is string => typeof item === "string"),
  };
}

function normalizeMetrics(raw: unknown): AdminMetrics {
  const record = asRecord(raw);
  const sourceCounts: Record<string, number> = Object.fromEntries(
    asArray(record.by_source).map((item) => {
      const row = asRecord(item);
      return [asString(row.source) || "unknown", asNumber(row.count) || 0];
    })
  );
  const suppressionCount = asArray(record.suppressions).reduce<number>((total, item) => total + (asNumber(asRecord(item).count) || 0), 0);
  return {
    leads: asNumber(record.leads) ?? asNumber(record.leads_total) ?? 0,
    contactRequests: sourceCounts.contact || 0,
    auditRequests: sourceCounts.audit || 0,
    bookingRequests: sourceCounts.booking || 0,
    microOfferRequests: sourceCounts.micro_offer || sourceCounts["330"] || 0,
    newsletterRequests: sourceCounts.newsletter || 0,
    suppressions: asNumber(record.suppressions) ?? suppressionCount,
    pipelineValueCents: asNumber(record.pipeline_value_cents) ?? asNumber(record.pipelineValueCents) ?? undefined,
    first330CollectedCents: asNumber(record.first_330_collected_cents) ?? asNumber(record.first330CollectedCents) ?? undefined,
    monthlyRecurringCents: asNumber(record.monthly_recurring_cents) ?? asNumber(record.monthlyRecurringCents) ?? undefined,
    updatedAt: asString(record.updatedAt) || asString(record.updated_at) || new Date().toISOString(),
  };
}

function normalizeThreadSummary(raw: unknown): AdminEmailThreadSummary {
  const record = asRecord(raw);
  const id = asString(record.id) || asString(record.zoho_message_id) || asString(record.thread_id) || "unknown-message";
  return {
    id,
    subject: asString(record.subject),
    primary_email: asString(record.primary_email) || asString(record.from_email),
    primary_name: asString(record.primary_name) || asString(record.from_name),
    related_lead_id: asString(record.related_lead_id) || asString(record.lead_id),
    related_business_name: asString(record.related_business_name) || asString(record.business_name),
    offer_code: asString(record.offer_code),
    status: asString(record.status) || (record.is_read === false ? "waiting_admin" : "new"),
    last_message_at: asString(record.last_message_at) || asString(record.received_at) || asString(record.updated_at),
    last_snippet: asString(record.last_snippet) || asString(record.snippet),
    unread_count: asNumber(record.unread_count) || (record.is_read === false ? 1 : 0),
    priority_score: asNumber(record.priority_score) || asNumber(record.score) || 0,
    suppression_status: normalizeSuppression(record.suppression_status),
    next_follow_up_at: asString(record.next_follow_up_at),
  };
}

function normalizeMessage(raw: unknown): AdminEmailMessage {
  const record = asRecord(raw);
  const toEmails = Array.isArray(record.to_emails)
    ? record.to_emails.filter((item): item is string => typeof item === "string")
    : asString(record.to_email)
      ? [asString(record.to_email)!]
      : null;
  return {
    id: asString(record.id) || asString(record.zoho_message_id) || "unknown-message",
    direction: asString(record.direction) || "inbound",
    from_email: asString(record.from_email),
    from_name: asString(record.from_name),
    to_emails: toEmails,
    subject: asString(record.subject),
    body_html_sanitized: asString(record.body_html_sanitized),
    body_text: asString(record.body_text) || asString(record.snippet),
    received_at: asString(record.received_at),
    sent_at: asString(record.sent_at),
    is_read: typeof record.is_read === "boolean" ? record.is_read : null,
  };
}

function normalizeDraft(raw: unknown, fallback: Partial<AdminEmailDraft> = {}): AdminEmailDraft {
  const record = asRecord(raw);
  return {
    id: asString(record.id) || asString(record.draft_id) || fallback.id || "unknown-draft",
    thread_id: asString(record.thread_id) || asString(record.mail_message_id) || fallback.thread_id || null,
    subject: asString(record.subject) || fallback.subject || null,
    body_text: asString(record.body_text) || asString(record.draft_body) || fallback.body_text || null,
    draft_source: asString(record.draft_source) || fallback.draft_source || "admin_api",
    template_key: asString(record.template_key) || fallback.template_key || null,
    status: asString(record.status) || fallback.status || "draft",
    requires_manual_approval: typeof record.requires_manual_approval === "boolean" ? record.requires_manual_approval : fallback.requires_manual_approval ?? true,
    requires_manual_send: typeof record.requires_manual_send === "boolean" ? record.requires_manual_send : fallback.requires_manual_send ?? Boolean(record.requires_admin_send),
    suggested_follow_up_at: asString(record.suggested_follow_up_at) || fallback.suggested_follow_up_at || null,
    next_follow_up_at: asString(record.next_follow_up_at) || fallback.next_follow_up_at || null,
    risk_flags: Array.isArray(record.risk_flags) ? record.risk_flags.filter((item): item is string => typeof item === "string") : fallback.risk_flags || null,
    updated_at: asString(record.updated_at) || fallback.updated_at || null,
    approved_at: asString(record.approved_at) || fallback.approved_at || null,
  };
}

function normalizeAuditEvent(raw: unknown): AdminEmailAuditEvent {
  const record = asRecord(raw);
  return {
    id: asString(record.id),
    created_at: asString(record.created_at),
    actor_type: asString(record.actor_type) || asString(record.actor),
    actor_user_id: asString(record.actor_user_id),
    actor: asString(record.actor),
    event_type: asString(record.event_type) || asString(record.type),
    type: asString(record.type),
    entity_type: asString(record.entity_type),
    entity_id: asString(record.entity_id),
    surface: asString(record.surface),
    metadata: asRecord(record.metadata),
  };
}

function normalizeThreadDetail(raw: unknown): AdminEmailThreadDetail {
  const record = asRecord(raw);
  const message = asRecord(record.message);
  const threadRows = asArray(record.thread);
  const messages = (threadRows.length ? threadRows : [message]).map(normalizeMessage);
  const summary = normalizeThreadSummary({ ...message, suppression_status: record.suppression_status || message.suppression_status });
  return {
    thread: summary,
    messages,
    lead: message.lead_id ? { id: asString(message.lead_id), suppression_status: normalizeSuppression(record.suppression_status || message.suppression_status) } : null,
    drafts: asArray(record.drafts).map((draft) => normalizeDraft(draft)),
    audit_tail: asArray(record.audit_tail || message.audit_tail).map(normalizeAuditEvent),
  };
}

function syncStatusFromResponse(raw: unknown): AdminEmailSyncStatus {
  const record = asRecord(raw);
  return {
    last_success_at: asString(record.synced_at) || asString(record.last_success_at) || null,
    last_status: asString(record.status) || (record.ok === true ? "synced" : null),
    last_error_code: asString(record.error) || null,
    last_error_message: asString(record.message) || null,
    next_expected_sync_at: asString(record.next_expected_sync_at),
  };
}

function normalizeLeadSummary(raw: unknown): AdminLeadSummary {
  const record = asRecord(raw);
  return {
    id: asString(record.id) || asString(record.lead_id) || "unknown-lead",
    created_at: asString(record.created_at),
    name: asString(record.name),
    email: asString(record.email),
    phone: asString(record.phone),
    company: asString(record.company) || asString(record.business_name),
    website: asString(record.website) || asString(record.website_url),
    request_type: asString(record.request_type) || asString(record.form_type) || asString(record.offer_code),
    selected_offer: asString(record.selected_offer),
    offer_code: asString(record.offer_code),
    offer_tier: asString(record.offer_tier) || asString(record.selected_offer) || asString(record.offer_code),
    source_channel: asString(record.source_channel) || asString(record.source) || asString(record.utm_source),
    utm_source: asString(record.utm_source),
    utm_medium: asString(record.utm_medium),
    utm_campaign: asString(record.utm_campaign),
    status: asString(record.status) || "new",
    conversion_stage: asString(record.conversion_stage) || asString(record.stage),
    estimated_value_cents: asNumber(record.estimated_value_cents) ?? asNumber(record.value_estimate_cents) ?? (asNumber(record.value_estimate) != null ? asNumber(record.value_estimate)! * 100 : null),
    first_330_status: asString(record.first_330_status) || asString(record.deposit_status),
    monthly_retainer_target_cents: asNumber(record.monthly_retainer_target_cents) ?? asNumber(record.retainer_target_cents),
    follow_up_due_at: asString(record.follow_up_due_at) || asString(record.next_follow_up_at),
    compliance_flags: asArray(record.compliance_flags || record.risk_flags).filter((item): item is string => typeof item === "string"),
    suppression_status: normalizeSuppression(record.suppression_status),
    intake_quality: asNumber(record.intake_quality) ?? asNumber(record.quality_score),
    consent_status: asString(record.consent_status) || (record.consent_contact === true ? "contact_ok" : null),
    last_touch_at: asString(record.last_touch_at) || asString(record.updated_at),
    next_step: asString(record.next_step) || asString(record.owner_next_step),
  };
}

function normalizeSourceAttribution(raw: unknown): AdminSourceAttributionRow {
  const record = asRecord(raw);
  return {
    source: asString(record.source) || asString(record.source_channel) || "unknown",
    leads: asNumber(record.leads) ?? asNumber(record.count) ?? 0,
    qualified: asNumber(record.qualified) ?? undefined,
    converted: asNumber(record.converted) ?? undefined,
    pipeline_cents: asNumber(record.pipeline_cents) ?? undefined,
  };
}

function normalizeFunnelStage(raw: unknown): AdminFunnelStage {
  const record = asRecord(raw);
  return {
    stage: asString(record.stage) || asString(record.name) || "unknown",
    count: asNumber(record.count) ?? asNumber(record.leads) ?? 0,
    conversion_rate: asNumber(record.conversion_rate),
  };
}

function normalizeOutreachDraftSummary(raw: unknown): AdminOutreachDraftSummary {
  const record = asRecord(raw);
  return {
    id: asString(record.id) || asString(record.draft_id) || "unknown-draft",
    lead_id: asString(record.lead_id),
    thread_id: asString(record.thread_id),
    recipient: asString(record.recipient) || asString(record.to_email) || asString(record.primary_email),
    subject: asString(record.subject),
    status: asString(record.status) || "draft",
    risk_flags: asArray(record.risk_flags).filter((item): item is string => typeof item === "string"),
    updated_at: asString(record.updated_at),
  };
}

function normalizeCampaignSummary(raw: unknown): AdminCampaignSummary {
  const record = asRecord(raw);
  return {
    id: asString(record.id) || asString(record.campaign_id) || "unknown-campaign",
    name: asString(record.name) || asString(record.campaign_name) || "Untitled campaign",
    status: asString(record.status) || "planned",
    channel: asString(record.channel),
    audience: asString(record.audience),
    drafts_pending: asNumber(record.drafts_pending) ?? asNumber(record.pending) ?? null,
    compliance_status: asString(record.compliance_status),
    updated_at: asString(record.updated_at),
  };
}

function normalizeComplianceGate(raw: unknown): AdminComplianceGate {
  const record = asRecord(raw);
  return {
    key: asString(record.key) || asString(record.id) || "unknown_gate",
    label: asString(record.label) || asString(record.name) || "Compliance gate",
    status: asString(record.status) || "unknown",
    detail: asString(record.detail) || asString(record.message),
  };
}

function normalizeTrendPoint(raw: unknown): AdminConversionTrendPoint {
  const record = asRecord(raw);
  return {
    date: asString(record.date) || asString(record.day) || "unknown",
    leads: asNumber(record.leads) ?? asNumber(record.count) ?? 0,
    qualified: asNumber(record.qualified) ?? undefined,
    converted: asNumber(record.converted) ?? undefined,
  };
}


function normalizeRevenueSummary(raw: unknown, leads: AdminLeadSummary[] = []): AdminRevenueSummary {
  const record = asRecord(raw);
  const pipelineFromLeads = leads.reduce((total, lead) => total + (lead.estimated_value_cents || 0), 0);
  const first330FromLeads = leads.filter((lead) => lead.offer_code === "ai_missed_lead_rescue_330" || lead.selected_offer === "ai_missed_lead_rescue_330" || lead.first_330_status === "collected" || lead.first_330_status === "won").reduce((total, lead) => total + (lead.first_330_status === "collected" || lead.first_330_status === "won" ? 33000 : 0), 0);
  const recurringFromLeads = leads.reduce((total, lead) => total + (lead.monthly_retainer_target_cents || 0), 0);
  return {
    pipeline_value_cents: asNumber(record.pipeline_value_cents) ?? asNumber(record.pipelineValueCents) ?? pipelineFromLeads,
    first_330_collected_cents: asNumber(record.first_330_collected_cents) ?? asNumber(record.first330CollectedCents) ?? first330FromLeads,
    first_330_target_cents: asNumber(record.first_330_target_cents) ?? 33000,
    monthly_recurring_cents: asNumber(record.monthly_recurring_cents) ?? asNumber(record.mrr_cents) ?? recurringFromLeads,
    monthly_recurring_target_cents: asNumber(record.monthly_recurring_target_cents) ?? asNumber(record.mrr_target_cents) ?? 900000,
    open_offer_value_cents: asNumber(record.open_offer_value_cents) ?? undefined,
    due_follow_ups: asNumber(record.due_follow_ups) ?? undefined,
    won_leads: asNumber(record.won_leads) ?? undefined,
  };
}

function normalizeDashboardSnapshot(raw: unknown): AdminDashboardSnapshot {
  const record = asRecord(raw);
  const dashboard = asRecord(record.dashboard || record.snapshot || record);
  const leads = asArray(dashboard.leads || dashboard.recent_leads || record.leads).map(normalizeLeadSummary);
  return {
    leads,
    revenue: normalizeRevenueSummary(dashboard.revenue || dashboard.revenue_summary || dashboard.revenue_engine || dashboard, leads),
    sources: asArray(dashboard.sources || dashboard.source_attribution || dashboard.by_source).map(normalizeSourceAttribution),
    funnel: asArray(dashboard.funnel || dashboard.request_funnel || dashboard.conversion_funnel).map(normalizeFunnelStage),
    outreachDrafts: asArray(dashboard.outreach_drafts || dashboard.drafts || dashboard.reply_queue).map(normalizeOutreachDraftSummary),
    campaigns: asArray(dashboard.campaigns || dashboard.campaign_registry).map(normalizeCampaignSummary),
    complianceGates: asArray(dashboard.compliance_gates || dashboard.gates).map(normalizeComplianceGate),
    auditLog: asArray(dashboard.audit_log || dashboard.audit_tail || dashboard.recent_audit).map(normalizeAuditEvent),
    conversionTrend: asArray(dashboard.conversion_trend || dashboard.trends).map(normalizeTrendPoint),
    suppressions: asNumber(dashboard.suppressions) ?? asArray(dashboard.suppression_list).length,
    zohoStatus: dashboard.zoho_status || dashboard.sync ? syncStatusFromResponse(dashboard.zoho_status || dashboard.sync) : null,
    exportUrl: asString(dashboard.export_url),
    updatedAt: asString(dashboard.updatedAt) || asString(dashboard.updated_at) || new Date().toISOString(),
  };
}

export const mehyarSoftApi = {
  submitIntake(payload: IntakePayload) {
    return postJson<{ ok: boolean; lead_id?: string; message?: string }>("/api/intake", payload);
  },

  createLead(payload: IntakePayload) {
    return this.submitIntake({ ...payload, form_type: "contact" });
  },

  createAuditRequest(payload: IntakePayload) {
    return this.submitIntake({ ...payload, form_type: "audit" });
  },

  createBookingRequest(payload: IntakePayload) {
    return this.submitIntake({ ...payload, form_type: "booking" });
  },

  unsubscribe(payload: UnsubscribePayload) {
    return postJson<{ ok: boolean; status?: string; message?: string }>("/api/suppressions/unsubscribe", payload);
  },

  async login(payload: AdminLoginPayload) {
    const response = await postJson<{ token: string; expires_in_seconds?: number }>("/v1/admin/login", payload, undefined, adminEndpoint);
    return {
      token: response.token,
      expiresInSeconds: response.expires_in_seconds,
      expiresAt: response.expires_in_seconds ? new Date(Date.now() + response.expires_in_seconds * 1000).toISOString() : undefined,
    } satisfies AdminSession;
  },

  async getMetrics(token: string) {
    const response = await apiFetch<unknown>("/v1/admin/metrics", {
      headers: { Authorization: `Bearer ${token}` },
    }, adminEndpoint);
    return normalizeMetrics(response);
  },

  async getDashboardSnapshot(token: string, range = "30d") {
    const response = await apiFetch<unknown>(`/v1/admin/dashboard?range=${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, adminEndpoint);
    return normalizeDashboardSnapshot(response);
  },

  async getEmailThreads(token: string) {
    const response = await apiFetch<unknown>("/v1/admin/email/threads?limit=25", {
      headers: { Authorization: `Bearer ${token}` },
    }, adminEndpoint);
    const record = asRecord(response);
    return {
      items: asArray(record.threads || record.messages || record.items).map(normalizeThreadSummary),
      next_cursor: asString(record.next_cursor),
      sync: record.sync ? syncStatusFromResponse(record.sync) : null,
    } satisfies AdminEmailThreadsResponse;
  },

  async getEmailThread(token: string, threadId: string) {
    const response = await apiFetch<unknown>(`/v1/admin/email/threads/${encodeURIComponent(threadId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, adminEndpoint);
    return normalizeThreadDetail(response);
  },

  async syncEmail(token: string) {
    const response = await postJson<unknown>(
      "/v1/admin/mail/sync",
      { provider: "zoho", account: "contact@mehyar.us", mode: "incremental" },
      token,
      adminEndpoint,
    );
    const record = asRecord(response);
    return {
      sync_run_id: asString(record.sync_run_id) || asString(record.account_id) || undefined,
      status: asString(record.status) || (record.ok === true ? "synced" : undefined),
      message: asString(record.message) || `Inserted ${asNumber(record.inserted) || 0}, updated ${asNumber(record.updated) || 0}`,
    } satisfies AdminEmailSyncResponse;
  },

  async generateEmailDraft(token: string, threadId: string, messageId?: string) {
    const response = await postJson<unknown>(
      `/v1/admin/email/threads/${encodeURIComponent(threadId)}/drafts/ai`,
      {
        message_id: messageId,
        template_key: "missed_lead_rescue_330_initial_reply",
        tone: "warm",
        goal: "reply_to_inbound_request",
        include_follow_up_suggestion: true,
      },
      token,
      adminEndpoint,
    );
    return { draft: normalizeDraft(response, { thread_id: threadId, requires_manual_approval: true, requires_manual_send: true }) };
  },

  async updateEmailDraft(token: string, draftId: string, payload: { subject?: string; body_text?: string; next_follow_up_at?: string }) {
    const response = await patchJson<unknown>(
      `/v1/admin/email/drafts/${encodeURIComponent(draftId)}`,
      { subject: payload.subject, draft_body: payload.body_text, next_follow_up_at: payload.next_follow_up_at },
      token,
      adminEndpoint,
    );
    return { draft: normalizeDraft(response, { id: draftId, subject: payload.subject, body_text: payload.body_text, next_follow_up_at: payload.next_follow_up_at }) };
  },

  async approveEmailDraft(token: string, draftId: string) {
    const response = await postJson<unknown>(
      `/v1/admin/email/drafts/${encodeURIComponent(draftId)}/approve`,
      { approval_note: "Reviewed in MehyarSoft admin dashboard" },
      token,
      adminEndpoint,
    );
    return { draft: normalizeDraft(response, { id: draftId, status: "approved", requires_manual_send: true }) };
  },

  async sendEmailDraft(token: string, draftId: string, nextFollowUpAt?: string) {
    const response = await postJson<unknown>(
      `/v1/admin/email/drafts/${encodeURIComponent(draftId)}/send`,
      { confirm_manual_send: true, status_after_send: "waiting_reply", next_follow_up_at: nextFollowUpAt },
      token,
      adminEndpoint,
    );
    const record = asRecord(response);
    return {
      send_event: {
        id: asString(record.outbound_id) || asString(record.draft_id) || draftId,
        status: record.ok === true ? "sent" : asString(record.status) || undefined,
        provider_message_id: asString(asRecord(record.provider).message_id) || asString(record.provider_message_id) || undefined,
        sent_at: asString(record.sent_at) || new Date().toISOString(),
      },
    } satisfies AdminEmailSendResponse;
  },
};
