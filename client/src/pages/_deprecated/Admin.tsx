import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  BellRing,
  BookmarkPlus,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Download,
  ExternalLink,
  FileStack,
  FileText,
  Gauge,
  Inbox,
  Layers,
  ListChecks,
  LockKeyhole,
  MailCheck,
  MailWarning,
  Megaphone,
  MessageSquareReply,
  PencilLine,
  RefreshCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Unplug,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import AdminOpportunityScout from "@/pages/_deprecated/AdminOpportunityScout";
import {
  AdminAnalyticsDiagnosticsResponse,
  AdminAnalyticsOverview,
  AdminEmailDraft,
  AdminDashboardSnapshot,
  BillingLedgerResponse,
  AdminEmailAuditEvent,
  AdminEmailSyncStatus,
  AdminEmailThreadDetail,
  AdminEmailThreadSummary,
  AdminGovAgencyWatch,
  AdminGovApplicationWorkspace,
  AdminGovOpportunity,
  AdminLeadSummary,
  AdminMetrics,
  AdminRevenueSummary,
  AdminSubscriberSummary,
  AdminSuppressionStatus,
  MEHYARSOFT_ADMIN_API_BASE_URL,
  mehyarSoftApi,
} from "@/lib/mehyarsoft-api";

const emptyMetrics: AdminMetrics = {
  leads: 0,
  contactRequests: 0,
  auditRequests: 0,
  bookingRequests: 0,
  microOfferRequests: 0,
  newsletterRequests: 0,
  suppressions: 0,
  pipelineValueCents: 0,
  first330CollectedCents: 0,
  monthlyRecurringCents: 0,
};

const metricCards = [
  { key: "leads", label: "Total leads", icon: Users },
  { key: "contactRequests", label: "General", icon: Users },
  { key: "auditRequests", label: "Audits", icon: ClipboardCheck },
  { key: "bookingRequests", label: "Booking", icon: CalendarClock },
  { key: "microOfferRequests", label: "$330 rescue", icon: ClipboardCheck },
  { key: "suppressions", label: "Suppressions", icon: ShieldCheck },
] as const;

const emptyDashboard: AdminDashboardSnapshot = {
  leads: [],
  revenue: {
    pipeline_value_cents: 0,
    first_330_collected_cents: 0,
    first_330_target_cents: 33000,
    monthly_recurring_cents: 0,
    monthly_recurring_target_cents: 900000,
  },
  sources: [],
  funnel: [],
  outreachDrafts: [],
  campaigns: [],
  complianceGates: [],
  auditLog: [],
  conversionTrend: [],
  suppressions: 0,
  zohoStatus: null,
};

const fallbackComplianceGates = [
  { key: "manual_send", label: "Manual approval before send", status: "pass", detail: "UI keeps AI draft, approval, and send confirmation separate." },
  { key: "suppression", label: "Suppression enforcement visible", status: "pass", detail: "Suppressed recipients are shown and send controls are disabled." },
  { key: "bulk_send", label: "No bulk-send surface", status: "pass", detail: "Dashboard v1 exposes review queues only." },
  { key: "api_contract", label: "Rich dashboard API", status: "attention", detail: "Frontend expects /v1/admin/dashboard when backend rollups are ready." },
];

const statusTone: Record<string, string> = {
  new: "bg-secondary text-secondary-foreground",
  waiting_admin: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100",
  drafted: "bg-cyan-100 text-cyan-900 dark:bg-cyan-400/15 dark:text-cyan-100",
  ready_to_send: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100",
  sent: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100",
  waiting_reply: "bg-brand-100 text-brand-900 dark:bg-white/10 dark:text-brand-100",
  follow_up_due: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100",
  suppressed: "bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-100",
  error: "bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-100",
};

function formatDate(value?: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatShortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function labelize(value?: string | null) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function suppressionStatusValue(value?: AdminSuppressionStatus | null) {
  if (!value) return "unknown";
  if (typeof value === "string") return value;
  return value.status || (value.suppressed ? "email_suppressed" : "clear");
}

function isSuppressionBlocked(value?: AdminSuppressionStatus | null) {
  if (!value) return false;
  if (typeof value === "string") return value !== "clear" && value !== "unknown";
  return Boolean(value.suppressed) || Boolean(value.status && value.status !== "clear" && value.status !== "unknown");
}

function suppressionDetail(value?: AdminSuppressionStatus | null) {
  if (!value || typeof value === "string") return null;
  const detail = [
    value.channels?.length ? `channels: ${value.channels.join(", ")}` : null,
    value.reasons?.length ? `reasons: ${value.reasons.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
  return detail || null;
}

function auditEventLabel(event: { event_type?: string | null; type?: string | null }) {
  return labelize(event.event_type || event.type || "audit event");
}

function nextSyncLabel(sync?: AdminEmailSyncStatus | null) {
  if (!sync) return "Not returned by API";
  if (sync.next_expected_sync_at) return formatDate(sync.next_expected_sync_at);
  if (!sync.last_success_at) return "Not returned by API";
  const last = new Date(sync.last_success_at);
  if (Number.isNaN(last.getTime())) return "After next scheduler run";
  const hour = last.getHours();
  const minutes = hour >= 8 && hour < 20 ? 5 : 30;
  return new Date(last.getTime() + minutes * 60_000).toLocaleString();
}

function getThreadIdFromPath(path: string) {
  const marker = "/admin/email/thread/";
  if (!path.startsWith(marker)) return null;
  const raw = path.slice(marker.length).split("/")[0];
  return raw ? decodeURIComponent(raw) : null;
}

function ThreadStatusBadge({ value }: { value?: string | null }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusTone[value || ""] || "bg-muted text-muted-foreground"}`}>{labelize(value)}</span>;
}

function SyncStatusCard({ sync, onSync, isSyncing }: { sync?: AdminEmailSyncStatus | null; onSync: () => void; isSyncing: boolean }) {
  const hasError = Boolean(sync?.last_error_code || sync?.last_status === "failed");
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
      <CardContent className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className="border-border bg-secondary text-secondary-foreground hover:bg-secondary">info@mehyar.us</Badge>
            <Badge className={hasError ? "bg-red-100 text-red-900 hover:bg-red-100 dark:bg-red-400/15 dark:text-red-100" : "bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-400/15 dark:text-emerald-100"}>
              {hasError ? "Sync needs attention" : labelize(sync?.last_status || "scheduler ready")}
            </Badge>
          </div>
          <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
            <p><span className="block font-semibold text-foreground">Last sync</span>{formatDate(sync?.last_success_at)}</p>
            <p><span className="block font-semibold text-foreground">Next expected</span>{nextSyncLabel(sync)}</p>
            <p><span className="block font-semibold text-foreground">Errors</span>{sync ? (sync.last_error_code || sync.last_error_message || "None reported") : "Not returned by API"}</p>
          </div>
        </div>
        <Button variant="outline" onClick={onSync} disabled={isSyncing}>
          <RefreshCcw className={isSyncing ? "animate-spin" : ""} aria-hidden="true" />
          {isSyncing ? "Syncing..." : "Sync now"}
        </Button>
      </CardContent>
    </Card>
  );
}

function EmailInboxTable({ threads, selectedId, onSelect }: { threads: AdminEmailThreadSummary[]; selectedId?: string | null; onSelect: (threadId: string) => void }) {
  if (!threads.length) {
    return (
      <Card className="border-dashed border-border bg-card">
        <CardContent className="p-8 text-center">
          <Inbox className="mx-auto mb-4 h-9 w-9 text-brand-700 dark:text-brand-100" aria-hidden="true" />
          <h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground">No synced inbox threads yet</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Use Sync now after backend credentials are live. Empty state is intentional: no secrets, raw OAuth payloads, or public admin links are exposed.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="border-b border-border bg-secondary/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Sender</th>
                <th className="px-5 py-3 font-semibold">Subject</th>
                <th className="px-5 py-3 font-semibold">Received</th>
                <th className="px-5 py-3 font-semibold">Matched lead</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Suppression</th>
                <th className="px-5 py-3 font-semibold">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {threads.map((thread) => (
                <tr key={thread.id} className={`cursor-pointer transition hover:bg-secondary/50 ${selectedId === thread.id ? "bg-secondary/70" : ""}`} onClick={() => onSelect(thread.id)}>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-foreground">{thread.primary_name || thread.primary_email || "Unknown sender"}</p>
                    <p className="text-xs text-muted-foreground">{thread.primary_email || "No email"}</p>
                  </td>
                  <td className="max-w-[280px] px-5 py-4">
                    <p className="truncate font-medium text-foreground">{thread.subject || "No subject"}</p>
                    <p className="truncate text-xs text-muted-foreground">{thread.last_snippet || "No preview available"}</p>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{formatShortDate(thread.last_message_at)}</td>
                  <td className="px-5 py-4">
                    {thread.related_lead_id ? (
                      <div>
                        <p className="font-medium text-foreground">{thread.related_business_name || "Linked lead"}</p>
                        <p className="text-xs text-muted-foreground">{thread.related_lead_id}</p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Unmatched</span>
                    )}
                  </td>
                  <td className="px-5 py-4"><ThreadStatusBadge value={thread.status} /></td>
                  <td className="px-5 py-4">
                    <span className={isSuppressionBlocked(thread.suppression_status) ? "rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900 dark:bg-red-400/15 dark:text-red-100" : "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100"}>
                      {labelize(suppressionStatusValue(thread.suppression_status))}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-900 dark:bg-white/10 dark:text-brand-100">{thread.priority_score ?? 0}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function money(cents?: number | null) {
  if (!cents) return "$0";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function AdminBillingLedgerPanel({ ledger, isLoading, onRefresh }: { ledger: BillingLedgerResponse | null; isLoading: boolean; onRefresh: () => void }) {
  const totals = ledger?.totals || {};
  const total = (key: string) => typeof totals[key] === "number" ? totals[key] as number : 0;
  const orders = ledger?.orders || [];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border bg-card"><CardContent className="p-5"><CreditCard className="mb-3 text-brand-700 dark:text-brand-100" /><p className="text-sm text-muted-foreground">Gross sales</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{money(total("gross_cents"))}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="p-5"><Gauge className="mb-3 text-brand-700 dark:text-brand-100" /><p className="text-sm text-muted-foreground">Net after fees</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{money(total("net_cents"))}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="p-5"><TrendingUp className="mb-3 text-brand-700 dark:text-brand-100" /><p className="text-sm text-muted-foreground">Estimated profit</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{money(total("profit_cents"))}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="p-5"><ShieldCheck className="mb-3 text-brand-700 dark:text-brand-100" /><p className="text-sm text-muted-foreground">Live gate</p><p className="mt-1 text-sm font-semibold text-foreground">Owner approval required</p></CardContent></Card>
      </div>
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Stripe billing ledger</h3><p className="text-sm text-muted-foreground">Sanitized orders, payment status, fees, costs, and profit. No Stripe secrets are rendered.</p></div><Button variant="outline" onClick={onRefresh} disabled={isLoading}>{isLoading ? "Loading..." : "Refresh"}</Button></div>
          {orders.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-border text-xs uppercase tracking-[0.14em] text-muted-foreground"><tr><th className="py-3 pr-4">Created</th><th className="py-3 pr-4">Service</th><th className="py-3 pr-4">Mode</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Gross</th><th className="py-3 pr-4">Fee</th><th className="py-3 pr-4">Cost</th><th className="py-3 pr-4">Profit</th><th className="py-3 pr-4">Session</th></tr></thead><tbody className="divide-y divide-border">{orders.map((order) => <tr key={order.id}><td className="py-4 pr-4 text-muted-foreground">{formatShortDate(order.created_at)}</td><td className="py-4 pr-4"><p className="font-medium text-foreground">{order.service_name}</p><p className="text-xs text-muted-foreground">{order.id}</p></td><td className="py-4 pr-4"><Badge variant="outline">{order.mode || "test"}</Badge></td><td className="py-4 pr-4"><ThreadStatusBadge value={order.payment_status || order.status} /></td><td className="py-4 pr-4">{money(order.amount_cents)}</td><td className="py-4 pr-4">{money(order.estimated_fee_cents)}</td><td className="py-4 pr-4">{money(order.estimated_cost_cents)}</td><td className="py-4 pr-4 font-semibold text-foreground">{money(order.profit_cents)}</td><td className="py-4 pr-4 text-xs text-muted-foreground">{order.stripe_checkout_session_id || "pending"}</td></tr>)}</tbody></table></div>
          ) : <EmptyState icon={CreditCard} title="No billing orders yet" detail="Public Stripe Checkout orders will appear here after /v1/billing/checkout creates sessions." />}
        </CardContent>
      </Card>
    </div>
  );
}

function percent(current?: number | null, target?: number | null) {
  if (!current || !target) return "0%";
  return `${Math.min(100, Math.round((current / target) * 100))}%`;
}

function leadSource(lead: AdminLeadSummary) {
  return lead.source_channel || lead.utm_source || lead.utm_medium || "unknown";
}

function leadFollowUp(lead: AdminLeadSummary) {
  return lead.follow_up_due_at || lead.next_step || lead.last_touch_at;
}

function scoreTone(score?: number | null) {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 80) return "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100";
  if (score >= 50) return "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100";
  return "bg-secondary text-secondary-foreground";
}

function gateTone(status?: string | null) {
  if (status === "pass" || status === "ok" || status === "clear") return "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100";
  if (status === "blocked" || status === "fail") return "bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-100";
  if (status === "attention" || status === "warning") return "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100";
  return "bg-muted text-muted-foreground";
}

function isDraftApproved(draft?: AdminEmailDraft | null) {
  return Boolean(draft?.approved_at || draft?.status === "approved");
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof Inbox; title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-secondary/30 p-6 text-sm leading-6 text-muted-foreground">
      <Icon className="mb-3 h-6 w-6 text-brand-700 dark:text-brand-100" aria-hidden="true" />
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1">{detail}</p>
    </div>
  );
}

function KpiCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof Users }) {
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Icon className="h-6 w-6 text-brand-700 dark:text-brand-100" aria-hidden="true" />
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">30d</span>
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground">{value}</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function RecentLeadsPanel({ leads, onOpenEmail }: { leads: AdminLeadSummary[]; onOpenEmail: () => void }) {
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
      <CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Lead + offer pipeline</h3>
            <p className="text-sm text-muted-foreground">Request type, offer tier, stage, value, follow-up, source, compliance, and suppression.</p>
          </div>
          <Button variant="outline" onClick={onOpenEmail}><Inbox aria-hidden="true" /> Email inbox</Button>
        </div>
        {leads.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr><th className="py-3 pr-4">Lead</th><th className="py-3 pr-4">Request / offer</th><th className="py-3 pr-4">Stage</th><th className="py-3 pr-4">Value</th><th className="py-3 pr-4">Follow-up due</th><th className="py-3 pr-4">Source</th><th className="py-3 pr-4">Quality</th><th className="py-3 pr-4">Compliance</th><th className="py-3 pr-4">Suppression</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.slice(0, 8).map((lead) => (
                  <tr key={lead.id}>
                    <td className="py-4 pr-4"><p className="font-semibold text-foreground">{lead.company || lead.name || "Unnamed lead"}</p><p className="text-xs text-muted-foreground">{lead.email || lead.phone || lead.id}</p>{lead.website ? <p className="text-xs text-muted-foreground">{lead.website}</p> : null}</td>
                    <td className="py-4 pr-4"><p className="font-medium capitalize text-foreground">{labelize(lead.request_type)}</p><p className="text-xs capitalize text-muted-foreground">{labelize(lead.offer_tier || lead.offer_code || lead.selected_offer)}</p></td>
                    <td className="py-4 pr-4"><ThreadStatusBadge value={lead.conversion_stage || lead.status} /></td>
                    <td className="py-4 pr-4"><p className="font-medium text-foreground">{money(lead.estimated_value_cents)}</p><p className="text-xs text-muted-foreground">$330: {labelize(lead.first_330_status || "pending")}</p></td>
                    <td className="py-4 pr-4 text-muted-foreground">{formatShortDate(leadFollowUp(lead)) || "Review"}</td>
                    <td className="py-4 pr-4"><p className="font-medium text-foreground">{labelize(leadSource(lead))}</p><p className="text-xs text-muted-foreground">{lead.utm_campaign || "no campaign"}</p></td>
                    <td className="py-4 pr-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scoreTone(lead.intake_quality)}`}>{lead.intake_quality ?? "—"}</span></td>
                    <td className="py-4 pr-4 text-xs text-muted-foreground">{lead.compliance_flags?.length ? lead.compliance_flags.join(", ") : labelize(lead.consent_status || "clear")}</td>
                    <td className="py-4 pr-4"><span className={isSuppressionBlocked(lead.suppression_status) ? "rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900 dark:bg-red-400/15 dark:text-red-100" : "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100"}>{labelize(suppressionStatusValue(lead.suppression_status))}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={Users} title="No lead rows returned yet" detail="The owner UI is ready for /v1/admin/dashboard recent_leads. Until then, only aggregate metrics load." />}
      </CardContent>
    </Card>
  );
}


function subscriberSource(subscriber: AdminSubscriberSummary) {
  return subscriber.source_page || subscriber.source_channel || subscriber.utm_source || "unknown page";
}

function subscriberOffer(subscriber: AdminSubscriberSummary) {
  return subscriber.recommended_offer || subscriber.interest_tags?.[0] || "$330 audit / missed-lead cleanup";
}

function NewsletterSubscribersPanel({
  subscribers,
  metrics,
  exportUrl,
  isLoading,
  actionId,
  onRefresh,
  onPromote,
  onDraft,
}: {
  subscribers: AdminSubscriberSummary[];
  metrics: AdminMetrics;
  exportUrl?: string | null;
  isLoading: boolean;
  actionId?: string | null;
  onRefresh: () => void;
  onPromote: (subscriber: AdminSubscriberSummary) => void;
  onDraft: (subscriber: AdminSubscriberSummary) => void;
}) {
  const conversions = subscribers.filter((subscriber) => Boolean(subscriber.converted_at || subscriber.promoted_lead_id || ["prospect", "lead", "qualified", "won"].includes(subscriber.lifecycle_stage || ""))).length;
  const suppressed = subscribers.filter((subscriber) => isSuppressionBlocked(subscriber.suppression_status)).length;
  const dueFollowUps = subscribers.filter((subscriber) => subscriber.next_follow_up_at && new Date(subscriber.next_follow_up_at).getTime() <= Date.now()).length;
  const safeExportUrl = safeAdminExportUrl(exportUrl);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Newsletter signups" value={metrics.newsletterRequests || subscribers.length} detail="Top-of-funnel subscribers captured with consent" icon={MailCheck} />
        <KpiCard label="Signup conversions" value={conversions} detail="Subscribers promoted into prospect/lead stages" icon={TrendingUp} />
        <KpiCard label="Follow-ups due" value={dueFollowUps} detail="Newsletter contacts needing owner action" icon={CalendarClock} />
        <KpiCard label="Suppressed" value={suppressed} detail="Do-not-contact state visible before outreach" icon={ShieldCheck} />
      </div>

      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
        <CardContent className="p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Signups / subscribers</h3>
              <p className="text-sm text-muted-foreground">Consent, source page, interests, suppression, next offer, and manual Zoho draft actions.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={onRefresh} disabled={isLoading}><RefreshCcw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />Refresh</Button>
              {safeExportUrl ? <Button variant="secondary" onClick={() => window.open(safeExportUrl, "_blank", "noopener,noreferrer")}><Download aria-hidden="true" />Export CSV</Button> : <Button variant="secondary" disabled><Unplug aria-hidden="true" />CSV pending API</Button>}
            </div>
          </div>
          {subscribers.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr><th className="py-3 pr-4">Subscriber</th><th className="py-3 pr-4">Source page</th><th className="py-3 pr-4">Interests</th><th className="py-3 pr-4">Consent</th><th className="py-3 pr-4">Suppression</th><th className="py-3 pr-4">Pipeline</th><th className="py-3 pr-4">Next follow-up</th><th className="py-3 pr-4">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {subscribers.slice(0, 20).map((subscriber) => {
                    const suppressedRow = isSuppressionBlocked(subscriber.suppression_status);
                    return (
                      <tr key={subscriber.id}>
                        <td className="py-4 pr-4"><p className="font-semibold text-foreground">{subscriber.name || subscriber.email || "Unnamed subscriber"}</p><p className="text-xs text-muted-foreground">{subscriber.email || subscriber.id}</p></td>
                        <td className="py-4 pr-4"><p className="font-medium text-foreground">{subscriberSource(subscriber)}</p><p className="text-xs text-muted-foreground">{subscriber.utm_campaign || "no campaign"}</p></td>
                        <td className="py-4 pr-4"><div className="flex max-w-[240px] flex-wrap gap-1.5">{subscriber.interest_tags?.length ? subscriber.interest_tags.map((tag) => <span key={tag} className="rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">{labelize(tag)}</span>) : <span className="text-muted-foreground">No tag</span>}</div></td>
                        <td className="py-4 pr-4"><p className="font-medium text-foreground">{subscriber.consent_marketing === false ? "No marketing" : "Marketing ok"}</p><p className="text-xs text-muted-foreground">{formatShortDate(subscriber.consent_timestamp || subscriber.created_at)}</p></td>
                        <td className="py-4 pr-4"><span className={suppressedRow ? "rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900 dark:bg-red-400/15 dark:text-red-100" : "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100"}>{labelize(suppressionStatusValue(subscriber.suppression_status))}</span></td>
                        <td className="py-4 pr-4"><ThreadStatusBadge value={subscriber.lifecycle_stage || subscriber.conversion_stage || "subscriber"} /><p className="mt-2 text-xs text-muted-foreground">Offer: {labelize(subscriberOffer(subscriber))}</p></td>
                        <td className="py-4 pr-4 text-muted-foreground">{formatShortDate(subscriber.next_follow_up_at) || "Recommend now"}</td>
                        <td className="py-4 pr-4"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onPromote(subscriber)} disabled={Boolean(actionId) || Boolean(subscriber.promoted_lead_id) || suppressedRow}>Promote</Button><Button size="sm" variant="secondary" onClick={() => onDraft(subscriber)} disabled={Boolean(actionId) || suppressedRow || !subscriber.email}>Zoho draft</Button></div>{actionId === subscriber.id ? <p className="mt-2 text-xs text-muted-foreground">Working...</p> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={MailCheck} title="No subscriber rows returned yet" detail="Expected backend: /v1/admin/newsletter/subscribers with source_page, interest_tags, consent_timestamp, suppression_status, next_follow_up_at, recommended_offer, and export_url." />}
        </CardContent>
      </Card>
    </div>
  );
}



function getGovernmentOpportunityIdFromPath(path: string) {
  const marker = "/admin/government/";
  if (!path.startsWith(marker)) return null;
  const raw = path.slice(marker.length).split("/")[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function safeExternalSourceUrl(rawUrl?: string | null) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function listText(items?: string[] | null, fallback = "Not returned by API") {
  return items?.length ? items.join(" · ") : fallback;
}

function govStatusTone(status?: string | null) {
  if (["submitted", "follow_up", "watching"].includes(status || "")) return "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100";
  if (["draft_needed", "reviewing"].includes(status || "")) return "bg-brand-100 text-brand-900 dark:bg-white/10 dark:text-brand-100";
  if (["not_fit", "archived"].includes(status || "")) return "bg-secondary text-secondary-foreground";
  return "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100";
}

function fitScoreTone(score?: number | null) {
  if (score == null) return "border-muted bg-muted text-muted-foreground";
  if (score >= 80) return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100";
  if (score >= 60) return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100";
  return "border-border bg-secondary text-secondary-foreground";
}

function GovOpportunityCard({ opportunity, selected, onSelect }: { opportunity: AdminGovOpportunity; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(opportunity.id)}
      className={`w-full rounded-[1.25rem] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(8,63,84,0.10)] ${selected ? "border-brand-700 bg-brand-50/70 dark:border-brand-100 dark:bg-white/10" : "border-border bg-card"}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{opportunity.source || "source pending"} · {labelize(opportunity.opportunity_type)}</p>
          <h4 className="mt-1 line-clamp-2 text-lg font-semibold tracking-[-0.02em] text-foreground">{opportunity.title}</h4>
        </div>
        <span className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${fitScoreTone(opportunity.fit_score)}`}>{opportunity.fit_score ?? "—"}</span>
      </div>
      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <p><Building2 className="mr-1.5 inline h-4 w-4" aria-hidden="true" />{opportunity.agency || "Agency pending"}</p>
        <p><CalendarClock className="mr-1.5 inline h-4 w-4" aria-hidden="true" />{formatShortDate(opportunity.deadline_at) || "Deadline pending"}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${govStatusTone(opportunity.status)}`}>{labelize(opportunity.status || "new")}</span>
        {opportunity.set_aside ? <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">{opportunity.set_aside}</span> : null}
        {opportunity.confidence ? <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">{opportunity.confidence} confidence</span> : null}
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{opportunity.next_action || opportunity.why_fit?.[0] || "Open detail after backend returns fit reasons and next action."}</p>
    </button>
  );
}

function GovFilters({ search, status, source, minScore, onSearch, onStatus, onSource, onMinScore, onRefresh, isLoading }: { search: string; status: string; source: string; minScore: number; onSearch: (value: string) => void; onStatus: (value: string) => void; onSource: (value: string) => void; onMinScore: (value: number) => void; onRefresh: () => void; isLoading: boolean }) {
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.2fr_repeat(3,minmax(150px,0.6fr))_auto] lg:items-end">
        <div className="space-y-2">
          <Label htmlFor="gov-search"><Search className="mr-1.5 inline h-4 w-4" aria-hidden="true" />Search</Label>
          <Input id="gov-search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="software, automation, dashboard, agency" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gov-status">Status</Label>
          <select id="gov-status" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(event) => onStatus(event.target.value)}>
            {['all','new','reviewing','draft_needed','submitted','follow_up','not_fit','archived'].map((item) => <option key={item} value={item}>{labelize(item)}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gov-source">Source</Label>
          <select id="gov-source" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={source} onChange={(event) => onSource(event.target.value)}>
            {['all','sam.gov','usaspending','both'].map((item) => <option key={item} value={item}>{labelize(item)}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gov-score">Minimum fit</Label>
          <Input id="gov-score" type="number" min={0} max={100} value={minScore} onChange={(event) => onMinScore(Number(event.target.value) || 0)} />
        </div>
        <Button variant="outline" onClick={onRefresh} disabled={isLoading}><RefreshCcw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />Refresh</Button>
      </CardContent>
    </Card>
  );
}

function GovWorkspacePanel({ workspace, opportunity }: { workspace?: AdminGovApplicationWorkspace | null; opportunity?: AdminGovOpportunity | null }) {
  const checklist = workspace?.checklist || [];
  const outline = workspace?.outline || [];
  const capabilities = workspace?.capability_blocks || [];
  const questions = workspace?.questions || [];
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="border-border bg-card"><CardContent className="p-5">
        <h4 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><ListChecks className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Submission checklist</h4>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Extracted requirements stay separated from owner-written response language.</p>
        {checklist.length ? <div className="space-y-3">{checklist.map((item) => <div key={item.id} className="rounded-2xl border border-border bg-secondary/40 p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium text-foreground">{item.label}</p><ThreadStatusBadge value={item.status || "pending"} /></div>{item.detail ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p> : null}</div>)}</div> : <EmptyState icon={ClipboardCheck} title="Checklist waiting for protected API" detail="Expected: /v1/admin/government/opportunities/:id/workspace returns requirements/checklist rows after owner auth." />}
      </CardContent></Card>
      <Card className="border-border bg-card"><CardContent className="p-5">
        <h4 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><FileStack className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Response outline</h4>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Drafting assist only. Boss reviews and submits manually.</p>
        {outline.length ? <div className="space-y-3">{outline.map((item) => <div key={item.id} className="rounded-2xl border border-border bg-secondary/40 p-3"><p className="font-medium text-foreground">{item.heading}</p>{item.notes ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.notes}</p> : null}{item.source ? <p className="mt-2 text-xs text-muted-foreground">Source: {item.source}</p> : null}</div>)}</div> : <EmptyState icon={FileText} title="Outline blocks pending" detail={`Select an opportunity${opportunity ? ` like “${opportunity.title.slice(0, 42)}…”` : ""} once backend workspace extraction is available.`} />}
      </CardContent></Card>
      <Card className="border-border bg-card"><CardContent className="p-5">
        <h4 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><Layers className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Capability blocks</h4>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Reusable private MehyarSoft positioning snippets — never public testimonials or invented credentials.</p>
        {capabilities.length ? <div className="space-y-3">{capabilities.map((item) => <div key={item.id} className="rounded-2xl border border-border bg-secondary/40 p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium text-foreground">{item.title}</p><ThreadStatusBadge value={item.status || "draft"} /></div>{item.body ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p> : null}</div>)}</div> : <EmptyState icon={BriefcaseBusiness} title="Capability library pending" detail="Expected protected fields: company summary, core services, security/privacy statement, owner bio snippets, NAICS targets." />}
      </CardContent></Card>
      <Card className="border-border bg-card"><CardContent className="p-5">
        <h4 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><MessageSquareReply className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Contracting questions</h4>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Questions for owner review before contacting any contracting officer.</p>
        {questions.length ? <div className="space-y-3">{questions.map((item) => <div key={item.id} className="rounded-2xl border border-border bg-secondary/40 p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium text-foreground">{item.question}</p><ThreadStatusBadge value={item.status || "draft"} /></div></div>)}</div> : <EmptyState icon={MessageSquareReply} title="No question drafts yet" detail="The page has the workspace slots, but protected backend data must supply the content after auth." />}
      </CardContent></Card>
    </div>
  );
}

function GovDetailPanel({ opportunity, workspace, notes, status, onNotes, onStatus, onSave, isSaving }: { opportunity?: AdminGovOpportunity | null; workspace?: AdminGovApplicationWorkspace | null; notes: string; status: string; onNotes: (value: string) => void; onStatus: (value: string) => void; onSave: () => void; isSaving: boolean }) {
  if (!opportunity) {
    return <Card className="border-border bg-card"><CardContent className="p-6"><Target className="mb-4 h-8 w-8 text-brand-700 dark:text-brand-100" aria-hidden="true" /><h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground">Select an opportunity</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Open a protected record to review fit score, reasons, status, notes, and application workspace.</p></CardContent></Card>;
  }
  const sourceUrl = safeExternalSourceUrl(opportunity.source_url);
  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{opportunity.source || "source"} · {labelize(opportunity.opportunity_type)}</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-foreground">{opportunity.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{opportunity.agency || "Agency pending"}{opportunity.office ? ` · ${opportunity.office}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-sm font-semibold ${fitScoreTone(opportunity.fit_score)}`}>Fit {opportunity.fit_score ?? "—"}</span><span className={`rounded-full px-3 py-1 text-sm font-semibold ${govStatusTone(opportunity.status)}`}>{labelize(opportunity.status || "new")}</span></div>
        </div>
        <div className="grid gap-3 rounded-2xl border border-border bg-secondary/50 p-4 text-sm md:grid-cols-2">
          <p><span className="block font-semibold text-foreground">Deadline</span>{formatDate(opportunity.deadline_at)}</p>
          <p><span className="block font-semibold text-foreground">Estimated value</span>{money(opportunity.estimated_value_cents)}</p>
          <p><span className="block font-semibold text-foreground">Set-aside / NAICS</span>{opportunity.set_aside || "Not returned"}{opportunity.naics?.length ? ` · ${opportunity.naics.join(", ")}` : ""}</p>
          <p><span className="block font-semibold text-foreground">Next action</span>{opportunity.next_action || "Review source, confirm eligibility, then draft checklist."}</p>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-background/70 p-4"><h4 className="mb-2 flex items-center gap-2 font-semibold text-foreground"><Star className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />Why it fits</h4><p className="text-sm leading-6 text-muted-foreground">{listText(opportunity.why_fit)}</p></div>
          <div className="rounded-2xl border border-border bg-background/70 p-4"><h4 className="mb-2 flex items-center gap-2 font-semibold text-foreground"><ShieldAlert className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />Gaps / cautions</h4><p className="text-sm leading-6 text-muted-foreground">{listText(opportunity.why_not, "No caution rows returned yet")}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">{sourceUrl ? <Button variant="outline" onClick={() => window.open(sourceUrl, "_blank", "noopener,noreferrer")}><ExternalLink aria-hidden="true" />Source</Button> : null}<Button variant="secondary" disabled><BookmarkPlus aria-hidden="true" />Watchlist action pending API</Button></div>
      </CardContent></Card>

      <Card className="border-border bg-card"><CardContent className="p-5">
        <h4 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><PencilLine className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Status and owner notes</h4>
        <div className="grid gap-4 lg:grid-cols-[220px_1fr_auto] lg:items-end">
          <div className="space-y-2"><Label htmlFor="gov-detail-status">Status</Label><select id="gov-detail-status" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(event) => onStatus(event.target.value)}>{['new','reviewing','draft_needed','submitted','follow_up','not_fit','archived'].map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="gov-notes">Private notes</Label><Textarea id="gov-notes" rows={3} value={notes} onChange={(event) => onNotes(event.target.value)} placeholder="Eligibility notes, proposal approach, pricing cautions, or owner decision." /></div>
          <Button variant="cta" onClick={onSave} disabled={isSaving}>{isSaving ? "Saving..." : "Save"}</Button>
        </div>
      </CardContent></Card>

      <GovWorkspacePanel workspace={workspace} opportunity={opportunity} />
    </div>
  );
}

function GovWatchlistPanel({ watchlist }: { watchlist: AdminGovAgencyWatch[] }) {
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Agency watchlist</h3><p className="text-sm text-muted-foreground">Agencies buying software, workflow automation, dashboards, web modernization, and operations support.</p></div><Building2 className="h-6 w-6 text-brand-700 dark:text-brand-100" aria-hidden="true" /></div>
      {watchlist.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{watchlist.map((agency) => <div key={agency.id} className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="font-semibold text-foreground">{agency.agency}</p><p className="mt-1 text-sm text-muted-foreground">{agency.office || agency.spend_category || "Office/category pending"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{agency.keywords?.length ? agency.keywords.join(", ") : "Keyword watch pending"}</p><p className="mt-2 text-xs font-medium text-foreground">{agency.typical_value_cents ? `Typical value ${money(agency.typical_value_cents)}` : "Value pattern pending"}</p><p className="mt-2 text-xs text-muted-foreground">{agency.next_monitoring_action || "Monitor next daily run"}</p></div>)}</div> : <EmptyState icon={Building2} title="Watchlist waiting for protected API" detail="No agency names, internal notes, or private scoring are bundled publicly. Rows load only after owner auth." />}
    </CardContent></Card>
  );
}

function GovernmentOpportunitiesPanel({ opportunities, watchlist, workspace, selectedId, notes, status, isLoading, isSaving, search, statusFilter, sourceFilter, minScore, onSearch, onStatusFilter, onSourceFilter, onMinScore, onRefresh, onSelect, onNotes, onStatus, onSave }: { opportunities: AdminGovOpportunity[]; watchlist: AdminGovAgencyWatch[]; workspace?: AdminGovApplicationWorkspace | null; selectedId?: string | null; notes: string; status: string; isLoading: boolean; isSaving: boolean; search: string; statusFilter: string; sourceFilter: string; minScore: number; onSearch: (value: string) => void; onStatusFilter: (value: string) => void; onSourceFilter: (value: string) => void; onMinScore: (value: number) => void; onRefresh: () => void; onSelect: (id: string) => void; onNotes: (value: string) => void; onStatus: (value: string) => void; onSave: () => void }) {
  const selected = opportunities.find((item) => item.id === selectedId) || null;
  const dueSoon = opportunities.filter((item) => item.deadline_at && new Date(item.deadline_at).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000).length;
  const applyToday = opportunities.filter((item) => (item.fit_score || 0) >= 80 && !["submitted", "not_fit", "archived"].includes(item.status || "")).length;
  const draftNeeded = opportunities.filter((item) => item.status === "draft_needed" || item.status === "reviewing").length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Daily inbox" value={opportunities.length} detail="Protected government opportunity rows returned" icon={Inbox} />
        <KpiCard label="Apply candidates" value={applyToday} detail="Fit score ≥80 and still active" icon={Target} />
        <KpiCard label="Deadlines ≤7d" value={dueSoon} detail="Urgent review before proposal effort" icon={CalendarClock} />
        <KpiCard label="Workspace drafts" value={draftNeeded} detail="Reviewing or draft-needed records" icon={FileStack} />
      </div>
      <Card className="border-border bg-card"><CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center"><div className="flex gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div><div><h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Government opportunities are owner-only</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">This surface renders shell UI publicly, but opportunity rows, notes, fit logic, watchlist, and drafts load only with the admin bearer token.</p></div></div><Badge className="bg-secondary text-secondary-foreground hover:bg-secondary">No auto-submit path</Badge></CardContent></Card>
      <GovFilters search={search} status={statusFilter} source={sourceFilter} minScore={minScore} onSearch={onSearch} onStatus={onStatusFilter} onSource={onSourceFilter} onMinScore={onMinScore} onRefresh={onRefresh} isLoading={isLoading} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(440px,1.05fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Daily opportunity inbox</h3><p className="text-sm text-muted-foreground">Fit score cards, filters, deadline pressure, source, status, and next best action.</p></div>{isLoading ? <Badge className="bg-secondary text-secondary-foreground">Loading...</Badge> : null}</div>
          {opportunities.length ? <div className="space-y-3">{opportunities.map((opportunity) => <GovOpportunityCard key={opportunity.id} opportunity={opportunity} selected={selectedId === opportunity.id} onSelect={onSelect} />)}</div> : <EmptyState icon={SlidersHorizontal} title="No government rows returned yet" detail="Expected protected API: /v1/admin/government/opportunities?limit=50 with SAM.gov/USAspending records, fit scores, status, reasons, and next action." />}
          <GovWatchlistPanel watchlist={watchlist} />
        </div>
        <GovDetailPanel opportunity={selected} workspace={workspace} notes={notes} status={status} onNotes={onNotes} onStatus={onStatus} onSave={onSave} isSaving={isSaving} />
      </div>
    </div>
  );
}

function RevenueEnginePanel({ revenue, metrics, leads }: { revenue: AdminRevenueSummary; metrics: AdminMetrics; leads: AdminLeadSummary[] }) {
  const first330Current = revenue.first_330_collected_cents || metrics.first330CollectedCents || 0;
  const first330Target = revenue.first_330_target_cents || 33000;
  const monthlyCurrent = revenue.monthly_recurring_cents || metrics.monthlyRecurringCents || 0;
  const monthlyTarget = revenue.monthly_recurring_target_cents || 900000;
  const followUpsDue = revenue.due_follow_ups ?? leads.filter((lead) => lead.follow_up_due_at && new Date(lead.follow_up_due_at).getTime() <= Date.now()).length;
  const openValue = revenue.open_offer_value_cents ?? leads.filter((lead) => !["won", "lost"].includes(lead.status || "")).reduce((total, lead) => total + (lead.estimated_value_cents || 0), 0);
  const cards = [
    { label: "Open offer pipeline", value: money(openValue || revenue.pipeline_value_cents || metrics.pipelineValueCents), detail: "Estimated value across active offers", icon: TrendingUp },
    { label: "First $330 tracker", value: `${money(first330Current)} / ${money(first330Target)}`, detail: `${percent(first330Current, first330Target)} of first paid rescue setup`, icon: CheckCircle2 },
    { label: "$9K/month tracker", value: `${money(monthlyCurrent)} / ${money(monthlyTarget)}`, detail: `${percent(monthlyCurrent, monthlyTarget)} of monthly systems-retainer target`, icon: Gauge },
    { label: "Follow-ups due", value: followUpsDue, detail: "Leads needing owner action now or next", icon: CalendarClock },
  ];
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <KpiCard key={card.label} {...card} />)}</div>;
}

function SourcesAndFunnelPanel({ dashboard, metrics }: { dashboard: AdminDashboardSnapshot; metrics: AdminMetrics }) {
  const sources = dashboard.sources.length ? dashboard.sources : [
    { source: "contact", leads: metrics.contactRequests, pipeline_cents: 0 },
    { source: "audit", leads: metrics.auditRequests, pipeline_cents: 0 },
    { source: "booking", leads: metrics.bookingRequests, pipeline_cents: 0 },
    { source: "newsletter", leads: metrics.newsletterRequests, pipeline_cents: 0 },
    { source: "micro_offer", leads: metrics.microOfferRequests, pipeline_cents: 0 },
  ].filter((row) => row.leads > 0);
  const funnel = dashboard.funnel.length ? dashboard.funnel : [
    { stage: "new", count: metrics.leads },
    { stage: "audit", count: metrics.auditRequests },
    { stage: "booking", count: metrics.bookingRequests },
    { stage: "reply queue", count: dashboard.outreachDrafts.length },
  ];
  const maxSource = Math.max(1, ...sources.map((row) => row.leads));
  const maxFunnel = Math.max(1, ...funnel.map((row) => row.count));
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Source attribution</h3>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Where demand is entering and which channels deserve follow-up.</p>
        {sources.length ? <div className="space-y-4">{sources.map((row) => <div key={row.source}><div className="mb-1 flex justify-between text-sm"><span className="font-medium capitalize text-foreground">{labelize(row.source)}</span><span className="text-muted-foreground">{row.leads} leads · {money(row.pipeline_cents)}</span></div><div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-brand-700 dark:bg-brand-100" style={{ width: `${Math.max(6, (row.leads / maxSource) * 100)}%` }} /></div></div>)}</div> : <EmptyState icon={Megaphone} title="Attribution waiting for API rows" detail="Expected fields: sources/source_attribution with source, leads, qualified, converted, pipeline_cents." />}
      </CardContent></Card>
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Request-type funnel</h3>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Lead movement from intake to conversion handoff.</p>
        <div className="space-y-4">{funnel.map((row) => <div key={row.stage}><div className="mb-1 flex justify-between text-sm"><span className="font-medium capitalize text-foreground">{labelize(row.stage)}</span><span className="text-muted-foreground">{row.count}{row.conversion_rate != null ? ` · ${Math.round(row.conversion_rate * 100)}%` : ""}</span></div><div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-emerald-600 dark:bg-emerald-300" style={{ width: `${Math.max(6, (row.count / maxFunnel) * 100)}%` }} /></div></div>)}</div>
      </CardContent></Card>
    </div>
  );
}

function OperationsPanels({ dashboard, threads }: { dashboard: AdminDashboardSnapshot; threads: AdminEmailThreadSummary[] }) {
  const drafts = dashboard.outreachDrafts.length ? dashboard.outreachDrafts : threads.filter((thread) => ["drafted", "ready_to_send", "waiting_admin"].includes(thread.status || "")).map((thread) => ({ id: thread.id, lead_id: thread.related_lead_id, thread_id: thread.id, recipient: thread.primary_email, subject: thread.subject, status: thread.status, risk_flags: isSuppressionBlocked(thread.suppression_status) ? ["suppressed"] : [], updated_at: thread.last_message_at }));
  const campaigns = dashboard.campaigns;
  const gates = dashboard.complianceGates.length ? dashboard.complianceGates : fallbackComplianceGates;
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Outreach draft review</h3>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Manual approval queue. No autonomous send path.</p>
        {drafts.length ? <div className="space-y-3">{drafts.slice(0, 5).map((draft) => <div key={draft.id} className="rounded-2xl border border-border bg-secondary/40 p-3"><div className="flex items-center justify-between gap-2"><p className="truncate font-semibold text-foreground">{draft.subject || "Untitled draft"}</p><ThreadStatusBadge value={draft.status} /></div><p className="mt-1 truncate text-xs text-muted-foreground">{draft.recipient || draft.lead_id || draft.thread_id}</p>{draft.risk_flags?.length ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">Risk: {draft.risk_flags.join(", ")}</p> : null}</div>)}</div> : <EmptyState icon={FileText} title="No drafts waiting" detail="AI-assisted email drafts appear here after backend returns outreach_drafts/reply_queue." />}
      </CardContent></Card>
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Campaign registry</h3>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Campaigns stay visible before any outreach scale-up.</p>
        {campaigns.length ? <div className="space-y-3">{campaigns.slice(0, 5).map((campaign) => <div key={campaign.id} className="rounded-2xl border border-border bg-secondary/40 p-3"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-foreground">{campaign.name}</p><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${gateTone(campaign.compliance_status || campaign.status)}`}>{labelize(campaign.compliance_status || campaign.status)}</span></div><p className="mt-1 text-xs text-muted-foreground">{labelize(campaign.channel)} · {campaign.audience || "audience TBD"} · {campaign.drafts_pending ?? 0} drafts</p></div>)}</div> : <EmptyState icon={Megaphone} title="No campaign registry rows" detail="Expected API: campaigns/campaign_registry with status, audience, compliance_status, and drafts_pending." />}
      </CardContent></Card>
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Compliance gates</h3>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Control before scale: suppressions, consent, audit, manual send.</p>
        <div className="space-y-3">{gates.map((gate) => <div key={gate.key} className="rounded-2xl border border-border bg-secondary/40 p-3"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-foreground">{gate.label}</p><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${gateTone(gate.status)}`}>{labelize(gate.status)}</span></div>{gate.detail ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{gate.detail}</p> : null}</div>)}</div>
      </CardContent></Card>
    </div>
  );
}

function TrendAndAuditPanel({ dashboard }: { dashboard: AdminDashboardSnapshot }) {
  const maxTrend = Math.max(1, ...dashboard.conversionTrend.map((row) => row.leads));
  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Conversion trends</h3>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Daily lead and qualification movement without exposing raw PII.</p>
        {dashboard.conversionTrend.length ? <div className="flex h-56 items-end gap-2 border-b border-border pb-3">{dashboard.conversionTrend.slice(-14).map((point) => <div key={point.date} className="flex min-w-8 flex-1 flex-col items-center gap-2"><div className="w-full rounded-t-xl bg-brand-700 dark:bg-brand-100" style={{ height: `${Math.max(8, (point.leads / maxTrend) * 180)}px` }} title={`${point.date}: ${point.leads} leads`} /><span className="text-[10px] text-muted-foreground">{point.date.slice(5)}</span></div>)}</div> : <EmptyState icon={TrendingUp} title="Trend rollups pending" detail="Expected API: conversion_trend/trends with date, leads, qualified, converted." />}
      </CardContent></Card>
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="p-5">
        <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Recent audit log</h3>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Owner auth/actions and workflow audit tail.</p>
        {dashboard.auditLog.length ? <AuditList events={dashboard.auditLog} /> : <EmptyState icon={ListChecks} title="No audit rows returned" detail="Expected API: audit_log/recent_audit with created_at, event_type, actor, entity." />}
      </CardContent></Card>
    </div>
  );
}

function AuditList({ events }: { events: AdminEmailAuditEvent[] }) {
  return <div className="space-y-3">{events.slice(0, 7).map((event, index) => <div key={event.id || `${event.event_type}-${index}`} className="rounded-2xl border border-border bg-secondary/40 p-3 text-sm"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-foreground">{auditEventLabel(event)}</p><span className="text-xs text-muted-foreground">{formatShortDate(event.created_at)}</span></div><p className="mt-1 text-xs text-muted-foreground">{labelize(event.actor_type || event.actor)} · {labelize(event.entity_type)} {event.entity_id || ""}</p></div>)}</div>;
}

function analyticsValue(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return 0;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  }
  return 0;
}

function diagnosticRecord(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function AnalyticsConnectionPanel({ overview, diagnostics }: { overview: AdminAnalyticsOverview | null; diagnostics: AdminAnalyticsDiagnosticsResponse | null }) {
  const provider = overview?.provider || {};
  const diagnosticPayload = diagnostics?.diagnostics || overview?.diagnostics || {};
  const ga4 = diagnosticRecord(diagnosticPayload, "ga4");
  const db = diagnosticRecord(diagnosticPayload, "database");
  const searchConsole = diagnosticRecord(diagnosticPayload, "search_console");
  const stripe = diagnosticRecord(diagnosticPayload, "stripe");
  const routes = diagnosticRecord(diagnosticPayload, "routes");
  const missing = Array.isArray(ga4.missing) ? ga4.missing.filter((item): item is string => typeof item === "string") : [];
  const hasGa4 = provider.configured === true || ga4.status === "configured";
  const hasDatabase = db.status === "ok";
  const searchPending = searchConsole.status !== "configured" && searchConsole.status !== "ok";
  const stripePending = stripe.status !== "connected" && stripe.status !== "ok";
  const productionRoutePending = routes.production_admin_analytics !== "deployed" && routes.production_route !== "deployed";
  const callouts = [
    { label: "GA4 Data API / service account", status: hasGa4 ? "configured" : "attention", detail: hasGa4 ? "Aggregate GA4 admin reads can load after owner auth." : missing.length ? `Missing env/config names: ${missing.join(", ")}` : "Pending server-side GA4 property configuration and Google service-account authorization." },
    { label: "Search Console", status: searchPending ? "pending" : "configured", detail: searchPending ? "Search Console import is pending; no query/page ranking data is assumed in the UI." : "Search Console diagnostics are available." },
    { label: "Stripe revenue", status: stripePending ? "not connected" : "connected", detail: stripePending ? "Stripe is not connected or no revenue rows were returned; revenue cards stay at safe empty state." : "Stripe ledger can contribute sanitized revenue totals." },
    { label: "Production route", status: productionRoutePending ? "not deployed" : "deployed", detail: productionRoutePending ? "Local/admin shell is built; production /admin/analytics still needs deploy QA before release." : "Production admin analytics route reported deployed." },
  ];
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><Gauge className="h-5 w-5" aria-hidden="true" /></div>
            <div>
              <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Site analytics connection</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Public Google tag events stay public-only. Admin analytics diagnostics come from protected /v1 admin API and return env/config names only.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className={hasGa4 ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-400/15 dark:text-emerald-100" : "bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-400/15 dark:text-amber-100"}>{hasGa4 ? "GA4 configured" : "GA4 missing"}</Badge>
            <Badge className={hasDatabase ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-400/15 dark:text-emerald-100" : "bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-400/15 dark:text-amber-100"}>{hasDatabase ? "D1 snapshots ready" : "D1 diagnostics pending"}</Badge>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Public tag env</p><p className="mt-2 font-semibold text-foreground">MEHYAR_PUBLIC_GOOGLE_TAG_ID</p><p className="mt-1 text-xs text-muted-foreground">Client bundle accepts only explicit public analytics IDs.</p></div>
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">GA4 admin diagnostics</p><p className="mt-2 font-semibold text-foreground">{hasGa4 ? "Configured" : missing.length ? `Missing ${missing.join(", ")}` : "Pending check"}</p><p className="mt-1 text-xs text-muted-foreground">Names only; credential values stay server-side.</p></div>
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Admin metrics API</p><p className="mt-2 font-semibold text-foreground">{provider.name || "ga4-data-api"}</p><p className="mt-1 text-xs text-muted-foreground">Aggregate traffic, offer, checkout, and revenue diagnostics behind admin auth.</p></div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {callouts.map((callout) => <div key={callout.label} className="rounded-2xl border border-border bg-background/70 p-4"><div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-semibold text-foreground">{callout.label}</p><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${gateTone(callout.status === "configured" || callout.status === "connected" || callout.status === "deployed" ? "pass" : "attention")}`}>{callout.status}</span></div><p className="text-xs leading-5 text-muted-foreground">{callout.detail}</p></div>)}
        </div>
      </CardContent>
    </Card>
  );
}

function AdminAnalyticsPanel({ dashboard, metrics, billingLedger, analyticsOverview, analyticsDiagnostics, analyticsError, isLoading, onRefresh }: { dashboard: AdminDashboardSnapshot; metrics: AdminMetrics; billingLedger: BillingLedgerResponse | null; analyticsOverview: AdminAnalyticsOverview | null; analyticsDiagnostics: AdminAnalyticsDiagnosticsResponse | null; analyticsError?: string | null; isLoading: boolean; onRefresh: () => void }) {
  const traffic = analyticsOverview?.traffic || {};
  const events = analyticsOverview?.events || {};
  const revenue = analyticsOverview?.revenue || {};
  const ledgerTotals = billingLedger?.totals || {};
  const trafficCards = [
    { label: "Sessions", value: analyticsValue(traffic, ["sessions", "activeUsers", "users"]), detail: "GA4 aggregate traffic, never visitor-level PII", icon: Activity },
    { label: "Views", value: analyticsValue(traffic, ["screenPageViews", "pageviews", "views"]), detail: "Public page demand feeding the offer funnel", icon: Gauge },
    { label: "Lead events", value: analyticsValue(events, ["lead_submit", "generate_lead", "contact_submit", "conversions"]), detail: "Tracked form or CTA conversions when available", icon: Target },
    { label: "Checkout events", value: analyticsValue(events, ["begin_checkout", "checkout", "purchase"]), detail: "Stripe intent/revenue signal after integration", icon: CreditCard },
  ];
  const roiCards = [
    { label: "Scout opportunities", value: dashboard.leads.filter((lead) => lead.source_channel === "opportunity_scout" || lead.utm_source === "opportunity_scout").length, detail: "Opportunity Scout sourced leads returned by dashboard API", icon: Search },
    { label: "Scout pipeline", value: money(analyticsValue(revenue, ["opportunity_scout_pipeline_cents", "scout_pipeline_cents"]) || dashboard.revenue.open_offer_value_cents || 0), detail: "Estimated value attributed to scout/workflow surfaces", icon: TrendingUp },
    { label: "Stripe gross", value: money(analyticsValue(ledgerTotals, ["gross_cents"]) || analyticsValue(revenue, ["gross_cents", "revenue_cents"])), detail: "Sanitized ledger total; empty until Stripe is connected", icon: CreditCard },
  ];
  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center"><div><h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Analytics dashboard shell</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Traffic, offer funnel, and Opportunity Scout ROI. Data is protected, aggregate-only, and safe when APIs return empty or missing-credential states.</p></div><Button variant="outline" onClick={onRefresh} disabled={isLoading}><RefreshCcw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />{isLoading ? "Loading..." : "Refresh analytics"}</Button></CardContent></Card>
      {analyticsError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"><ShieldAlert className="mr-2 inline h-5 w-5" aria-hidden="true" />Analytics API error state: {analyticsError}. Showing safe empty shell; no credential values are rendered.</div> : null}
      {isLoading ? <EmptyState icon={RefreshCcw} title="Loading protected analytics" detail="Fetching /v1/admin/analytics, /v1/admin/analytics/diagnostics, dashboard rollups, and billing ledger through owner-authenticated API calls." /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{trafficCards.map((card) => <KpiCard key={card.label} {...card} />)}</div>
      <SourcesAndFunnelPanel dashboard={dashboard} metrics={metrics} />
      <div className="grid gap-4 md:grid-cols-3">{roiCards.map((card) => <KpiCard key={card.label} {...card} />)}</div>
      <AnalyticsConnectionPanel overview={analyticsOverview} diagnostics={analyticsDiagnostics} />
    </div>
  );
}

function safeAdminExportUrl(rawUrl?: string | null) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, MEHYARSOFT_ADMIN_API_BASE_URL || window.location.origin);
    const adminOrigin = new URL(MEHYARSOFT_ADMIN_API_BASE_URL || window.location.origin).origin;
    const allowedOrigin = url.origin === adminOrigin || url.origin === window.location.origin;
    return url.protocol === "https:" && allowedOrigin && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function AdminDashboard({ dashboard, metrics, threads, sync, analyticsOverview, analyticsDiagnostics, isLoading, onRefresh, onOpenEmail }: { dashboard: AdminDashboardSnapshot; metrics: AdminMetrics; threads: AdminEmailThreadSummary[]; sync: AdminEmailSyncStatus | null; analyticsOverview: AdminAnalyticsOverview | null; analyticsDiagnostics: AdminAnalyticsDiagnosticsResponse | null; isLoading: boolean; onRefresh: () => void; onOpenEmail: () => void }) {
  const effectiveSync = dashboard.zohoStatus || sync;
  const safeExportUrl = safeAdminExportUrl(dashboard.exportUrl);
  const waiting = threads.filter((thread) => thread.status === "waiting_admin" || (thread.unread_count || 0) > 0).length;
  const highQuality = dashboard.leads.filter((lead) => (lead.intake_quality || 0) >= 80).length;
  const suppressions = dashboard.suppressions || metrics.suppressions;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Lead inbox" value={metrics.leads} detail={`${highQuality} high-quality rows returned by dashboard API`} icon={Inbox} />
        <KpiCard label="$330 rescue leads" value={metrics.microOfferRequests} detail="Micro-offer demand separated from general inquiries" icon={ClipboardCheck} />
        <KpiCard label="Needs reply" value={waiting + dashboard.outreachDrafts.length} detail="Email threads and draft review queue requiring owner action" icon={BellRing} />
        <KpiCard label="Suppression controls" value={suppressions} detail="Unsubscribes/suppressed recipients visible before outreach" icon={ShieldCheck} />
      </div>

      <RevenueEnginePanel revenue={dashboard.revenue} metrics={metrics} leads={dashboard.leads} />

      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><Activity className="h-5 w-5" aria-hidden="true" /></div><div><h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Owner operating view</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Zoho: {effectiveSync ? labelize(effectiveSync.last_status || "ready") : "not returned"} · Last sync {formatDate(effectiveSync?.last_success_at)} · Updated {formatDate(dashboard.updatedAt || metrics.updatedAt)}</p></div></div>
        <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={onRefresh} disabled={isLoading}><RefreshCcw className={isLoading ? "animate-spin" : ""} aria-hidden="true" />Refresh</Button>{safeExportUrl ? <Button variant="secondary" onClick={() => window.open(safeExportUrl, "_blank", "noopener,noreferrer")}><Download aria-hidden="true" />Export</Button> : <Button variant="secondary" disabled><Unplug aria-hidden="true" />Export pending API</Button>}</div>
      </CardContent></Card>

      <RecentLeadsPanel leads={dashboard.leads} onOpenEmail={onOpenEmail} />
      <SourcesAndFunnelPanel dashboard={dashboard} metrics={metrics} />
      <AnalyticsConnectionPanel overview={analyticsOverview} diagnostics={analyticsDiagnostics} />
      <OperationsPanels dashboard={dashboard} threads={threads} />
      <TrendAndAuditPanel dashboard={dashboard} />
    </div>
  );
}

function ThreadDetail({
  detail,
  draft,
  draftSubject,
  draftBody,
  setDraftSubject,
  setDraftBody,
  onGenerateDraft,
  onSaveDraft,
  onApproveDraft,
  onSendDraft,
  isBusy,
}: {
  detail?: AdminEmailThreadDetail | null;
  draft?: AdminEmailDraft | null;
  draftSubject: string;
  draftBody: string;
  setDraftSubject: (value: string) => void;
  setDraftBody: (value: string) => void;
  onGenerateDraft: () => void;
  onSaveDraft: () => void;
  onApproveDraft: () => void;
  onSendDraft: () => void;
  isBusy: boolean;
}) {
  if (!detail) {
    return (
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
        <CardContent className="p-6">
          <MessageSquareReply className="mb-4 h-8 w-8 text-brand-700 dark:text-brand-100" aria-hidden="true" />
          <h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground">Select a message</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Open a thread to review the sanitized message history, lead context, reply draft, and audit trail.</p>
        </CardContent>
      </Card>
    );
  }

  const latestInbound = [...detail.messages].reverse().find((message) => message.direction !== "outbound");
  const effectiveSuppression = detail.lead?.suppression_status || detail.thread.suppression_status;
  const isSuppressed = isSuppressionBlocked(effectiveSuppression);
  const approvedDraftReady = isDraftApproved(draft);
  const hasUnapprovedEdits = approvedDraftReady && (draftSubject !== (draft?.subject || "") || draftBody !== (draft?.body_text || ""));
  const canSend = Boolean(draft?.id && draftBody.trim() && approvedDraftReady && !hasUnapprovedEdits && !isSuppressed);

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Thread detail</p>
              <h3 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-foreground">{detail.thread.subject || latestInbound?.subject || "No subject"}</h3>
            </div>
            <ThreadStatusBadge value={detail.thread.status} />
          </div>
          <div className="grid gap-3 rounded-2xl border border-border bg-secondary/50 p-4 text-sm md:grid-cols-2">
            <p><span className="block font-semibold text-foreground">Matched lead</span>{detail.lead?.business_name || detail.thread.related_business_name || detail.thread.related_lead_id || "No lead linked yet"}</p>
            <p><span className="block font-semibold text-foreground">Offer context</span>{labelize(detail.lead?.offer_code || detail.thread.offer_code || "general inbox")}</p>
            <p><span className="block font-semibold text-foreground">Suppression</span>{labelize(suppressionStatusValue(effectiveSuppression))}{suppressionDetail(effectiveSuppression) ? <span className="block text-xs text-muted-foreground">{suppressionDetail(effectiveSuppression)}</span> : null}</p>
            <p><span className="block font-semibold text-foreground">Next follow-up</span>{formatDate(detail.thread.next_follow_up_at)}</p>
          </div>
        </CardContent>
      </Card>

      {isSuppressed ? (
        <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-950 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          Sending is blocked because this recipient or lead is suppressed. Drafts may be reviewed, but backend send must remain blocked.
        </div>
      ) : null}

      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
        <CardContent className="space-y-4 p-5">
          <h4 className="text-lg font-semibold tracking-[-0.02em] text-foreground">Message history</h4>
          {detail.messages.map((message) => (
            <article key={message.id} className="rounded-2xl border border-border bg-background/70 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-[0.14em]">{message.direction === "outbound" ? "Outbound" : "Inbound"}</span>
                <span>{formatDate(message.sent_at || message.received_at)}</span>
              </div>
              <p className="font-semibold text-foreground">{message.from_name || message.from_email || "Unknown sender"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{message.subject || "No subject"}</p>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground">{message.body_text || "No plain-text body returned by API."}</p>
            </article>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold tracking-[-0.02em] text-foreground">AI-assisted reply</h4>
              <p className="mt-1 text-sm text-muted-foreground">AI can draft only. Boss edits, approves, and confirms before anything sends from info@mehyar.us.</p>
            </div>
            <Button variant="outline" onClick={onGenerateDraft} disabled={isBusy}>
              <Sparkles aria-hidden="true" />
              {draft ? "Regenerate draft" : "AI draft reply"}
            </Button>
          </div>

          {draft?.risk_flags?.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
              Risk flags: {draft.risk_flags.join(", ")}. Edit the draft before approval.
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email-draft-subject">Subject</Label>
            <Input id="email-draft-subject" value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} placeholder="Re: subject" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-draft-body">Editable draft body</Label>
            <Textarea id="email-draft-body" rows={10} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} placeholder="Generate or write a reply. Manual review is required before send." />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onSaveDraft} disabled={!draft?.id || isBusy || !draftBody.trim()}>
              <CheckCircle2 aria-hidden="true" />
              Save edits
            </Button>
            <Button variant="outline" onClick={onApproveDraft} disabled={!draft?.id || isBusy || !draftBody.trim()}>
              <MailCheck aria-hidden="true" />
              Approve draft
            </Button>
            <Button variant="cta" onClick={onSendDraft} disabled={!canSend || isBusy}>
              <Send aria-hidden="true" />
              Send reviewed reply
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Send is locked until the active draft has already been approved, opens a confirmation gate, and calls the backend send endpoint with confirm_manual_send=true. No bulk send or autonomous send path exists in this UI.
            {draft?.id && !approvedDraftReady ? " Approve this draft before send is enabled." : ""}
            {hasUnapprovedEdits ? " Edits after approval require saving and approving again before send." : ""}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
        <CardContent className="p-5">
          <h4 className="mb-4 text-lg font-semibold tracking-[-0.02em] text-foreground">Reply history / audit status</h4>
          {detail.audit_tail?.length ? (
            <div className="space-y-3">
              {detail.audit_tail.slice(0, 6).map((event, index) => (
                <div key={event.id || `${event.event_type}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-secondary/40 p-3 text-sm">
                  <span className="font-medium text-foreground">{auditEventLabel(event)}</span>
                  <span className="text-muted-foreground">{formatDate(event.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No draft/send audit events returned yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const Admin = () => {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(() => sessionStorage.getItem("mehyarsoft_admin_token") || "");
  const [metrics, setMetrics] = useState<AdminMetrics>(emptyMetrics);
  const [dashboard, setDashboard] = useState<AdminDashboardSnapshot>(emptyDashboard);
  const [threads, setThreads] = useState<AdminEmailThreadSummary[]>([]);
  const [subscribers, setSubscribers] = useState<AdminSubscriberSummary[]>([]);
  const [subscriberExportUrl, setSubscriberExportUrl] = useState<string | null>(null);
  const [subscriberActionId, setSubscriberActionId] = useState<string | null>(null);
  const [isSubscriberLoading, setIsSubscriberLoading] = useState(false);
  const [govOpportunities, setGovOpportunities] = useState<AdminGovOpportunity[]>([]);
  const [govWatchlist, setGovWatchlist] = useState<AdminGovAgencyWatch[]>([]);
  const [govWorkspace, setGovWorkspace] = useState<AdminGovApplicationWorkspace | null>(null);
  const [selectedGovOpportunityId, setSelectedGovOpportunityId] = useState<string | null>(() => getGovernmentOpportunityIdFromPath(window.location.pathname));
  const [govSearch, setGovSearch] = useState("");
  const [govStatusFilter, setGovStatusFilter] = useState("all");
  const [govSourceFilter, setGovSourceFilter] = useState("all");
  const [govMinScore, setGovMinScore] = useState(0);
  const [govNotes, setGovNotes] = useState("");
  const [govStatus, setGovStatus] = useState("new");
  const [isGovLoading, setIsGovLoading] = useState(false);
  const [isGovSaving, setIsGovSaving] = useState(false);
  const [billingLedger, setBillingLedger] = useState<BillingLedgerResponse | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [analyticsOverview, setAnalyticsOverview] = useState<AdminAnalyticsOverview | null>(null);
  const [analyticsDiagnostics, setAnalyticsDiagnostics] = useState<AdminAnalyticsDiagnosticsResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [sync, setSync] = useState<AdminEmailSyncStatus | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => getThreadIdFromPath(window.location.pathname));
  const [threadDetail, setThreadDetail] = useState<AdminEmailThreadDetail | null>(null);
  const [activeDraft, setActiveDraft] = useState<AdminEmailDraft | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDraftBusy, setIsDraftBusy] = useState(false);

  const isEmailRoute = location.startsWith("/admin/email");
  const isNewsletterRoute = location.startsWith("/admin/newsletter");
  const isGovernmentRoute = location.startsWith("/admin/government");
  const isOpportunityScoutRoute = location.startsWith("/admin/opportunity-scout");
  const isBillingRoute = location.startsWith("/admin/billing");
  const isAnalyticsRoute = location.startsWith("/admin/analytics");
  const isProspectsRoute = location.startsWith("/admin/prospects");
  const isTodayRoute = location.startsWith("/admin/today");

  useEffect(() => {
    document.title = isEmailRoute
      ? "Email Command Center | MehyarSoft"
      : isNewsletterRoute
        ? "Newsletter Money Cockpit | MehyarSoft"
        : isGovernmentRoute
          ? "Government Opportunities | MehyarSoft"
          : isOpportunityScoutRoute
            ? "Opportunity Scout | MehyarSoft"
            : isBillingRoute
              ? "Billing Ledger | MehyarSoft"
              : isAnalyticsRoute
                ? "Analytics Dashboard | MehyarSoft"
                : "Admin Metrics | MehyarSoft";
  }, [isEmailRoute, isNewsletterRoute, isGovernmentRoute, isOpportunityScoutRoute, isBillingRoute, isAnalyticsRoute]);

  const loadMetrics = async (sessionToken = token) => {
    if (!sessionToken) return;
    setIsLoading(true);
    try {
      setAnalyticsError(null);
      const captureAnalyticsError = (error: unknown) => {
        const message = error instanceof Error ? error.message : "Analytics endpoint unavailable";
        setAnalyticsError((current) => current || message);
        return null;
      };
      const [nextMetrics, nextDashboard, nextAnalyticsOverview, nextAnalyticsDiagnostics] = await Promise.all([
        mehyarSoftApi.getMetrics(sessionToken),
        mehyarSoftApi.getDashboardSnapshot(sessionToken).catch(() => null),
        mehyarSoftApi.getAnalyticsOverview(sessionToken).catch(captureAnalyticsError),
        mehyarSoftApi.getAnalyticsDiagnostics(sessionToken).catch(captureAnalyticsError),
      ]);
      setMetrics({ ...emptyMetrics, ...nextMetrics });
      if (nextDashboard) setDashboard({ ...emptyDashboard, ...nextDashboard });
      if (nextAnalyticsOverview) setAnalyticsOverview(nextAnalyticsOverview);
      if (nextAnalyticsDiagnostics) setAnalyticsDiagnostics(nextAnalyticsDiagnostics);
    } catch (error) {
      sessionStorage.removeItem("mehyarsoft_admin_token");
      setToken("");
      toast({
        title: "Admin session unavailable",
        description: error instanceof Error ? error.message : "Could not load metrics.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadEmailThreads = async (sessionToken = token) => {
    if (!sessionToken) return;
    setIsEmailLoading(true);
    try {
      const response = await mehyarSoftApi.getEmailThreads(sessionToken);
      setThreads(response.items || []);
      setSync(response.sync || null);
    } catch (error) {
      toast({
        title: "Email inbox unavailable",
        description: error instanceof Error ? error.message : "Could not load info@mehyar.us inbox.",
        variant: "destructive",
      });
    } finally {
      setIsEmailLoading(false);
    }
  };

  const loadSubscribers = async (sessionToken = token, showError = false) => {
    if (!sessionToken) return;
    setIsSubscriberLoading(true);
    try {
      const response = await mehyarSoftApi.getNewsletterSubscribers(sessionToken);
      setSubscribers(response.items || []);
      setSubscriberExportUrl(response.exportUrl || null);
    } catch (error) {
      setSubscriberExportUrl(null);
      if (showError) {
        toast({
          title: "Subscriber API unavailable",
          description: error instanceof Error ? error.message : "Showing dashboard-derived newsletter rows if available.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSubscriberLoading(false);
    }
  };

  const loadGovernmentOpportunities = async (sessionToken = token, showError = false) => {
    if (!sessionToken) return;
    setIsGovLoading(true);
    try {
      const response = await mehyarSoftApi.getGovernmentOpportunities(sessionToken, {
        status: govStatusFilter,
        source: govSourceFilter,
        minScore: govMinScore,
        q: govSearch,
      });
      setGovOpportunities(response.items || []);
      setGovWatchlist(response.watchlist || []);
      if (response.workspace) setGovWorkspace(response.workspace);
      const pathId = getGovernmentOpportunityIdFromPath(location);
      const nextSelected = pathId || selectedGovOpportunityId || response.items[0]?.id || null;
      if (nextSelected) {
        setSelectedGovOpportunityId(nextSelected);
        const selected = response.items.find((item) => item.id === nextSelected) || null;
        setGovNotes(selected?.owner_notes || "");
        setGovStatus(selected?.status || "new");
        try {
          const workspace = await mehyarSoftApi.getGovernmentOpportunityWorkspace(sessionToken, nextSelected);
          setGovWorkspace(workspace);
        } catch {
          setGovWorkspace(response.workspace || null);
        }
      }
    } catch (error) {
      setGovOpportunities([]);
      setGovWatchlist([]);
      setGovWorkspace(null);
      if (showError) {
        toast({ title: "Government opportunities unavailable", description: error instanceof Error ? error.message : "Protected government opportunity API did not return rows.", variant: "destructive" });
      }
    } finally {
      setIsGovLoading(false);
    }
  };

  const loadThread = async (threadId: string, sessionToken = token) => {
    if (!sessionToken) return;
    setIsEmailLoading(true);
    try {
      const response = await mehyarSoftApi.getEmailThread(sessionToken, threadId);
      setThreadDetail(response);
      const currentDraft = response.drafts?.find((draft) => draft.status !== "sent" && draft.status !== "discarded") || response.drafts?.[0] || null;
      setActiveDraft(currentDraft || null);
      setDraftSubject(currentDraft?.subject || response.messages.at(-1)?.subject || "");
      setDraftBody(currentDraft?.body_text || "");
    } catch (error) {
      toast({
        title: "Thread unavailable",
        description: error instanceof Error ? error.message : "Could not load message detail.",
        variant: "destructive",
      });
    } finally {
      setIsEmailLoading(false);
    }
  };

  useEffect(() => {
    if (token) void loadMetrics(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !isEmailRoute) return;
    void loadEmailThreads(token);
    const threadId = getThreadIdFromPath(location);
    setSelectedThreadId(threadId);
    if (threadId) void loadThread(threadId, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isEmailRoute, location]);

  useEffect(() => {
    if (!token || !isNewsletterRoute) return;
    void loadSubscribers(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isNewsletterRoute]);

  useEffect(() => {
    if (!token || !isGovernmentRoute) return;
    void loadGovernmentOpportunities(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isGovernmentRoute, location]);

  useEffect(() => {
    if (!token || (!isBillingRoute && !isAnalyticsRoute)) return;
    void loadBillingLedger(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isBillingRoute, isAnalyticsRoute]);

  const emailSummary = useMemo(() => {
    const waiting = threads.filter((thread) => thread.status === "waiting_admin" || (thread.unread_count || 0) > 0).length;
    const suppressed = threads.filter((thread) => isSuppressionBlocked(thread.suppression_status)).length;
    const highPriority = threads.filter((thread) => (thread.priority_score || 0) >= 70).length;
    return { waiting, suppressed, highPriority };
  }, [threads]);

  const effectiveSubscribers = useMemo<AdminSubscriberSummary[]>(() => {
    if (subscribers.length) return subscribers;
    return dashboard.leads
      .filter((lead) => lead.request_type === "newsletter" || lead.offer_code === "newsletter" || lead.selected_offer === "newsletter")
      .map((lead) => ({
        id: lead.id,
        created_at: lead.created_at,
        email: lead.email,
        name: lead.name,
        source_page: lead.website,
        source_channel: leadSource(lead),
        utm_source: lead.utm_source,
        utm_campaign: lead.utm_campaign,
        interest_tags: [lead.selected_offer, lead.offer_code, lead.offer_tier].filter((value): value is string => Boolean(value)),
        consent_marketing: lead.consent_status === "marketing_ok" || lead.consent_status === "contact_ok" ? true : null,
        consent_timestamp: lead.created_at,
        suppression_status: lead.suppression_status,
        lifecycle_stage: lead.conversion_stage || lead.status || "subscriber",
        promoted_lead_id: lead.request_type === "newsletter" ? null : lead.id,
        next_follow_up_at: lead.follow_up_due_at,
        recommended_offer: lead.offer_code || lead.selected_offer || lead.offer_tier,
        zoho_draft_status: null,
        conversion_stage: lead.conversion_stage,
        converted_at: null,
      }));
  }, [dashboard.leads, subscribers]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      const session = await mehyarSoftApi.login({ username, password });
      sessionStorage.setItem("mehyarsoft_admin_token", session.token);
      setToken(session.token);
      setPassword("");
      toast({ title: "Admin session started", description: "Owner dashboard is connected to Cloudflare admin APIs." });
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Check admin credentials and API availability.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("mehyarsoft_admin_token");
    setToken("");
    setMetrics(emptyMetrics);
    setDashboard(emptyDashboard);
    setThreads([]);
    setSubscribers([]);
    setSubscriberExportUrl(null);
    setGovOpportunities([]);
    setGovWatchlist([]);
    setGovWorkspace(null);
    setBillingLedger(null);
    setAnalyticsOverview(null);
    setAnalyticsDiagnostics(null);
    setAnalyticsError(null);
    setThreadDetail(null);
    setActiveDraft(null);
  };

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    setLocation(`/admin/email/thread/${encodeURIComponent(threadId)}`);
  };

  const handleSelectGovOpportunity = async (opportunityId: string) => {
    setSelectedGovOpportunityId(opportunityId);
    setLocation(`/admin/government/${encodeURIComponent(opportunityId)}`);
    const selected = govOpportunities.find((item) => item.id === opportunityId) || null;
    setGovNotes(selected?.owner_notes || "");
    setGovStatus(selected?.status || "new");
    if (!token) return;
    try {
      const workspace = await mehyarSoftApi.getGovernmentOpportunityWorkspace(token, opportunityId);
      setGovWorkspace(workspace);
    } catch {
      setGovWorkspace(null);
    }
  };

  const handleSaveGovOpportunity = async () => {
    if (!token || !selectedGovOpportunityId) return;
    setIsGovSaving(true);
    try {
      const response = await mehyarSoftApi.updateGovernmentOpportunity(token, selectedGovOpportunityId, { status: govStatus, owner_notes: govNotes });
      setGovOpportunities((current) => current.map((item) => item.id === selectedGovOpportunityId ? { ...item, ...response.opportunity, status: govStatus, owner_notes: govNotes } : item));
      toast({ title: "Opportunity updated", description: "Status and private owner notes were sent to the protected admin API." });
    } catch (error) {
      toast({ title: "Save unavailable", description: error instanceof Error ? error.message : "Protected government opportunity API did not save this record.", variant: "destructive" });
    } finally {
      setIsGovSaving(false);
    }
  };

  const loadBillingLedger = async (sessionToken = token) => {
    if (!sessionToken) return;
    setIsBillingLoading(true);
    try {
      setBillingLedger(await mehyarSoftApi.getBillingLedger(sessionToken));
    } catch (error) {
      toast({ title: "Billing ledger unavailable", description: error instanceof Error ? error.message : "Protected billing endpoint did not respond.", variant: "destructive" });
    } finally {
      setIsBillingLoading(false);
    }
  };

  const handleSync = async () => {
    if (!token) return;
    setIsSyncing(true);
    try {
      const response = await mehyarSoftApi.syncEmail(token);
      toast({ title: "Inbox sync requested", description: response.message || `Status: ${response.status || "queued"}` });
      await loadEmailThreads(token);
    } catch (error) {
      toast({ title: "Sync failed", description: error instanceof Error ? error.message : "Manual sync could not start.", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePromoteSubscriber = async (subscriber: AdminSubscriberSummary) => {
    if (!token) return;
    setSubscriberActionId(subscriber.id);
    try {
      const response = await mehyarSoftApi.promoteNewsletterSubscriber(token, subscriber.id);
      setSubscribers((current) => current.map((item) => item.id === subscriber.id ? { ...item, ...response.subscriber, promoted_lead_id: response.leadId || response.subscriber.promoted_lead_id || item.promoted_lead_id, lifecycle_stage: response.subscriber.lifecycle_stage || "prospect" } : item));
      toast({ title: "Subscriber promoted", description: response.leadId ? "Prospect/lead handoff is now linked." : "Backend accepted the promotion action." });
      await loadMetrics(token);
    } catch (error) {
      toast({ title: "Promotion unavailable", description: error instanceof Error ? error.message : "Backend did not promote this subscriber.", variant: "destructive" });
    } finally {
      setSubscriberActionId(null);
    }
  };

  const handleNewsletterDraft = async (subscriber: AdminSubscriberSummary) => {
    if (!token) return;
    if (isSuppressionBlocked(subscriber.suppression_status)) {
      toast({ title: "Draft blocked", description: "Suppressed subscribers stay review-only and cannot receive outreach drafts.", variant: "destructive" });
      return;
    }
    setSubscriberActionId(subscriber.id);
    try {
      const response = await mehyarSoftApi.createNewsletterReplyDraft(token, subscriber.id);
      setSubscribers((current) => current.map((item) => item.id === subscriber.id ? { ...item, zoho_draft_status: response.draft.status || "drafted" } : item));
      toast({ title: "Zoho reply draft queued", description: "Draft is manual-review only; no autonomous send path was opened." });
      if (response.threadId) setLocation(`/admin/email/thread/${encodeURIComponent(response.threadId)}`);
    } catch (error) {
      toast({ title: "Draft unavailable", description: error instanceof Error ? error.message : "Backend did not create a Zoho draft.", variant: "destructive" });
    } finally {
      setSubscriberActionId(null);
    }
  };

  const handleGenerateDraft = async () => {
    if (!token || !selectedThreadId) return;
    const messageId = [...(threadDetail?.messages || [])].reverse().find((message) => message.direction !== "outbound")?.id;
    setIsDraftBusy(true);
    try {
      const response = await mehyarSoftApi.generateEmailDraft(token, selectedThreadId, messageId);
      setActiveDraft(response.draft);
      setDraftSubject(response.draft.subject || "");
      setDraftBody(response.draft.body_text || "");
      toast({ title: "AI draft ready", description: "Review and edit before approval or send." });
      await loadThread(selectedThreadId, token);
    } catch (error) {
      toast({ title: "Draft failed", description: error instanceof Error ? error.message : "AI draft endpoint did not return a draft.", variant: "destructive" });
    } finally {
      setIsDraftBusy(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!token || !activeDraft?.id) return;
    setIsDraftBusy(true);
    try {
      const response = await mehyarSoftApi.updateEmailDraft(token, activeDraft.id, { subject: draftSubject, body_text: draftBody });
      setActiveDraft({ ...activeDraft, ...response.draft, subject: draftSubject, body_text: draftBody });
      toast({ title: "Draft edits saved", description: "Audit status updated by backend." });
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Could not save draft edits.", variant: "destructive" });
    } finally {
      setIsDraftBusy(false);
    }
  };

  const handleApproveDraft = async () => {
    if (!token || !activeDraft?.id) return;
    setIsDraftBusy(true);
    try {
      await mehyarSoftApi.updateEmailDraft(token, activeDraft.id, { subject: draftSubject, body_text: draftBody });
      const response = await mehyarSoftApi.approveEmailDraft(token, activeDraft.id);
      setActiveDraft({ ...activeDraft, ...response.draft, subject: draftSubject, body_text: draftBody });
      toast({ title: "Draft approved", description: "Manual approval recorded. Send still requires confirmation." });
    } catch (error) {
      toast({ title: "Approval failed", description: error instanceof Error ? error.message : "Could not approve draft.", variant: "destructive" });
    } finally {
      setIsDraftBusy(false);
    }
  };

  const handleSendDraft = async () => {
    if (!token || !activeDraft?.id || !selectedThreadId) return;
    const effectiveSuppression = threadDetail?.lead?.suppression_status || threadDetail?.thread.suppression_status;
    if (isSuppressionBlocked(effectiveSuppression)) {
      toast({ title: "Send blocked", description: "Backend reports this recipient or lead is suppressed. Review only; do not send.", variant: "destructive" });
      return;
    }
    if (!isDraftApproved(activeDraft)) {
      toast({ title: "Approval required", description: "Approve the reviewed draft before opening the send confirmation gate.", variant: "destructive" });
      return;
    }
    if (draftSubject !== (activeDraft.subject || "") || draftBody !== (activeDraft.body_text || "")) {
      toast({ title: "Approve latest edits", description: "Save and approve the current draft text before sending. Send never auto-approves edits.", variant: "destructive" });
      return;
    }
    const recipient = [...(threadDetail?.messages || [])].reverse().find((message) => message.direction !== "outbound")?.from_email || threadDetail?.thread.primary_email || "the original inbound sender";
    const confirmed = window.confirm(`Manual send confirmation required. Send exactly one reviewed reply from info@mehyar.us to ${recipient}? This is not a bulk or autonomous send.`);
    if (!confirmed) return;
    setIsDraftBusy(true);
    try {
      const response = await mehyarSoftApi.sendEmailDraft(token, activeDraft.id, activeDraft.next_follow_up_at || activeDraft.suggested_follow_up_at || undefined);
      toast({ title: "Reply sent", description: response.send_event?.sent_at ? `Sent ${formatDate(response.send_event.sent_at)}` : "Backend confirmed send request." });
      await loadThread(selectedThreadId, token);
      await loadEmailThreads(token);
    } catch (error) {
      toast({ title: "Send blocked or failed", description: error instanceof Error ? error.message : "Backend did not send the reply.", variant: "destructive" });
    } finally {
      setIsDraftBusy(false);
    }
  };

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.14),transparent_34%),linear-gradient(180deg,hsl(var(--background))_0%,#fff_100%)] px-4 pb-16 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_34%),linear-gradient(180deg,hsl(var(--brand-950))_0%,hsl(var(--background))_100%)] md:pt-32">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
              Owner-only
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">
              {isEmailRoute ? "Email Command Center" : isNewsletterRoute ? "Newsletter Money Cockpit" : isGovernmentRoute ? "Government Opportunities" : isOpportunityScoutRoute ? "Opportunity Scout" : isBillingRoute ? "Billing Ledger" : isAnalyticsRoute ? "Analytics Dashboard" : "Admin Metrics"}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
              {isEmailRoute
                ? "Private info@mehyar.us inbox, lead context, AI draft assistance, and manual reply controls. AI drafts only; Boss reviews before send."
                : isNewsletterRoute
                  ? "Private signup cockpit for source attribution, consent, suppressions, subscriber promotion, follow-up timing, offer fit, and manual Zoho draft actions."
                  : isGovernmentRoute
                    ? "Private government-opportunity inbox for SAM.gov and USAspending signals, fit scoring, agency watchlists, and proposal workspace drafting assist."
                    : isOpportunityScoutRoute
                      ? "Private Opportunity Scout for no-spend daily business ideas, evidence review, AI wealth assist, and approval-gated internal Kanban creation."
                      : isBillingRoute
                        ? "Private Stripe billing ledger for service orders, webhook status, estimated fees, net revenue, and profit. Live charges remain owner-gated."
                        : isAnalyticsRoute
                          ? "Owner-only analytics shell for aggregate traffic, offer funnel, Opportunity Scout ROI, and missing-integration diagnostics without exposing secrets."
                          : "Private operating shell for lead intake, audit demand, booking requests, and suppression counts. Credentials stay in Cloudflare environment secrets."}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
            <span className="font-semibold text-foreground">SEO boundary:</span> this route is noindex, nofollow, noarchive and excluded from public sitemap surfaces.
          </div>
        </div>

        {!token ? (
          <Card className="max-w-md border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
            <CardContent className="p-6 md:p-7">
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Admin Login</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Authenticate before metrics, inbox, or owner workflow data loads.</p>
                </div>
              </div>
              <form className="space-y-5" onSubmit={handleLogin}>
                <div className="space-y-2">
                  <Label htmlFor="admin-username">Username</Label>
                  <Input id="admin-username" type="text" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Password</Label>
                  <Input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
                </div>
                <Button type="submit" variant="cta" className="w-full" disabled={isLoading}>{isLoading ? "Connecting..." : "Login"}</Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">CRM Command Center</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Last update: {metrics.updatedAt ? new Date(metrics.updatedAt).toLocaleString() : "API response"}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant={isTodayRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin/today")}>Today</Button>
                <Button variant={!isEmailRoute && !isNewsletterRoute && !isGovernmentRoute && !isOpportunityScoutRoute && !isBillingRoute && !isAnalyticsRoute && !isProspectsRoute && !isTodayRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin")}>Metrics</Button>
                <Button variant={isAnalyticsRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin/analytics")}>Analytics</Button>
                <Button variant={isNewsletterRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin/newsletter")}>Signups</Button>
                <Button variant={isGovernmentRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin/government")}>Government</Button>
                <Button variant={isOpportunityScoutRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin/opportunity-scout")}>Opportunity Scout</Button>
                <Button variant={isBillingRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin/billing")}>Billing</Button>
                <Button variant={isEmailRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin/email")}>Email Command Center</Button>
                <Button variant="outline" onClick={() => void (isEmailRoute ? loadEmailThreads() : isNewsletterRoute ? loadSubscribers(undefined, true) : isGovernmentRoute ? loadGovernmentOpportunities(undefined, true) : isOpportunityScoutRoute ? Promise.resolve() : isBillingRoute ? loadBillingLedger() : isAnalyticsRoute ? Promise.all([loadMetrics(), loadBillingLedger()]) : loadMetrics())} disabled={isLoading || isEmailLoading || isSubscriberLoading || isGovLoading || isBillingLoading}>Refresh</Button>
                <Button variant="secondary" onClick={handleLogout}>Logout</Button>
              </div>
            </div>

            {isNewsletterRoute ? (
              <NewsletterSubscribersPanel
                subscribers={effectiveSubscribers}
                metrics={metrics}
                exportUrl={subscriberExportUrl}
                isLoading={isSubscriberLoading}
                actionId={subscriberActionId}
                onRefresh={() => void loadSubscribers(undefined, true)}
                onPromote={(subscriber) => void handlePromoteSubscriber(subscriber)}
                onDraft={(subscriber) => void handleNewsletterDraft(subscriber)}
              />
            ) : isBillingRoute ? (
              <AdminBillingLedgerPanel ledger={billingLedger} isLoading={isBillingLoading} onRefresh={() => void loadBillingLedger()} />
            ) : isAnalyticsRoute ? (
              <AdminAnalyticsPanel dashboard={dashboard} metrics={metrics} billingLedger={billingLedger} analyticsOverview={analyticsOverview} analyticsDiagnostics={analyticsDiagnostics} analyticsError={analyticsError} isLoading={isLoading || isBillingLoading} onRefresh={() => void Promise.all([loadMetrics(), loadBillingLedger()])} />
            ) : isOpportunityScoutRoute ? (
              <AdminOpportunityScout token={token} />
            ) : isGovernmentRoute ? (
              <GovernmentOpportunitiesPanel
                opportunities={govOpportunities}
                watchlist={govWatchlist}
                workspace={govWorkspace}
                selectedId={selectedGovOpportunityId}
                notes={govNotes}
                status={govStatus}
                isLoading={isGovLoading}
                isSaving={isGovSaving}
                search={govSearch}
                statusFilter={govStatusFilter}
                sourceFilter={govSourceFilter}
                minScore={govMinScore}
                onSearch={setGovSearch}
                onStatusFilter={setGovStatusFilter}
                onSourceFilter={setGovSourceFilter}
                onMinScore={setGovMinScore}
                onRefresh={() => void loadGovernmentOpportunities(undefined, true)}
                onSelect={(opportunityId) => void handleSelectGovOpportunity(opportunityId)}
                onNotes={setGovNotes}
                onStatus={setGovStatus}
                onSave={() => void handleSaveGovOpportunity()}
              />
            ) : !isEmailRoute && !isAnalyticsRoute && !isOpportunityScoutRoute ? (
              <AdminDashboard
                dashboard={dashboard}
                metrics={metrics}
                threads={threads}
                sync={sync}
                analyticsOverview={analyticsOverview}
                analyticsDiagnostics={analyticsDiagnostics}
                isLoading={isLoading}
                onRefresh={() => void loadMetrics()}
                onOpenEmail={() => setLocation("/admin/email")}
              />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <Card className="border-border bg-card"><CardContent className="p-5"><Inbox className="mb-3 text-brand-700 dark:text-brand-100" aria-hidden="true" /><p className="text-sm text-muted-foreground">Waiting admin</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{emailSummary.waiting}</p></CardContent></Card>
                  <Card className="border-border bg-card"><CardContent className="p-5"><MailWarning className="mb-3 text-brand-700 dark:text-brand-100" aria-hidden="true" /><p className="text-sm text-muted-foreground">High priority</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{emailSummary.highPriority}</p></CardContent></Card>
                  <Card className="border-border bg-card"><CardContent className="p-5"><ShieldAlert className="mb-3 text-brand-700 dark:text-brand-100" aria-hidden="true" /><p className="text-sm text-muted-foreground">Suppressed/blocked</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{emailSummary.suppressed}</p></CardContent></Card>
                </div>

                <SyncStatusCard sync={sync} onSync={handleSync} isSyncing={isSyncing} />

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Inbox</h3>
                        <p className="text-sm text-muted-foreground">Sender, subject, matched lead, status, and priority from backend sync.</p>
                      </div>
                      {isEmailLoading ? <Badge className="bg-secondary text-secondary-foreground">Loading...</Badge> : null}
                    </div>
                    <EmailInboxTable threads={threads} selectedId={selectedThreadId} onSelect={handleSelectThread} />
                  </div>

                  <ThreadDetail
                    detail={threadDetail}
                    draft={activeDraft}
                    draftSubject={draftSubject}
                    draftBody={draftBody}
                    setDraftSubject={setDraftSubject}
                    setDraftBody={setDraftBody}
                    onGenerateDraft={handleGenerateDraft}
                    onSaveDraft={handleSaveDraft}
                    onApproveDraft={handleApproveDraft}
                    onSendDraft={handleSendDraft}
                    isBusy={isDraftBusy || isEmailLoading}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default Admin;
