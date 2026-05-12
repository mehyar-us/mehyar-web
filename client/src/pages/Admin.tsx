import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Gauge,
  Inbox,
  ListChecks,
  LockKeyhole,
  MailCheck,
  MailWarning,
  Megaphone,
  MessageSquareReply,
  RefreshCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
import {
  AdminEmailDraft,
  AdminDashboardSnapshot,
  AdminEmailAuditEvent,
  AdminEmailSyncStatus,
  AdminEmailThreadDetail,
  AdminEmailThreadSummary,
  AdminLeadSummary,
  AdminMetrics,
  AdminRevenueSummary,
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
            <Badge className="border-border bg-secondary text-secondary-foreground hover:bg-secondary">contact@mehyar.us</Badge>
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

function AdminDashboard({ dashboard, metrics, threads, sync, isLoading, onRefresh, onOpenEmail }: { dashboard: AdminDashboardSnapshot; metrics: AdminMetrics; threads: AdminEmailThreadSummary[]; sync?: AdminEmailSyncStatus | null; isLoading: boolean; onRefresh: () => void; onOpenEmail: () => void }) {
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
              <p className="mt-1 text-sm text-muted-foreground">AI can draft only. Boss edits, approves, and confirms before anything sends from contact@mehyar.us.</p>
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

  useEffect(() => {
    document.title = isEmailRoute ? "Email Command Center | MehyarSoft" : "Admin Metrics | MehyarSoft";
  }, [isEmailRoute]);

  const loadMetrics = async (sessionToken = token) => {
    if (!sessionToken) return;
    setIsLoading(true);
    try {
      const [nextMetrics, nextDashboard] = await Promise.all([
        mehyarSoftApi.getMetrics(sessionToken),
        mehyarSoftApi.getDashboardSnapshot(sessionToken).catch(() => null),
      ]);
      setMetrics({ ...emptyMetrics, ...nextMetrics });
      if (nextDashboard) setDashboard({ ...emptyDashboard, ...nextDashboard });
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
        description: error instanceof Error ? error.message : "Could not load contact@mehyar.us inbox.",
        variant: "destructive",
      });
    } finally {
      setIsEmailLoading(false);
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

  const emailSummary = useMemo(() => {
    const waiting = threads.filter((thread) => thread.status === "waiting_admin" || (thread.unread_count || 0) > 0).length;
    const suppressed = threads.filter((thread) => isSuppressionBlocked(thread.suppression_status)).length;
    const highPriority = threads.filter((thread) => (thread.priority_score || 0) >= 70).length;
    return { waiting, suppressed, highPriority };
  }, [threads]);

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
    setThreadDetail(null);
    setActiveDraft(null);
  };

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    setLocation(`/admin/email/thread/${encodeURIComponent(threadId)}`);
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
    const confirmed = window.confirm(`Manual send confirmation required. Send exactly one reviewed reply from contact@mehyar.us to ${recipient}? This is not a bulk or autonomous send.`);
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
              {isEmailRoute ? "Email Command Center" : "Admin Metrics"}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
              {isEmailRoute
                ? "Private contact@mehyar.us inbox, lead context, AI draft assistance, and manual reply controls. AI drafts only; Boss reviews before send."
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
                <Button variant={isEmailRoute ? "secondary" : "outline"} onClick={() => setLocation("/admin")}>Metrics</Button>
                <Button variant={isEmailRoute ? "outline" : "secondary"} onClick={() => setLocation("/admin/email")}>Email Command Center</Button>
                <Button variant="outline" onClick={() => void (isEmailRoute ? loadEmailThreads() : loadMetrics())} disabled={isLoading || isEmailLoading}>Refresh</Button>
                <Button variant="secondary" onClick={handleLogout}>Logout</Button>
              </div>
            </div>

            {!isEmailRoute ? (
              <AdminDashboard
                dashboard={dashboard}
                metrics={metrics}
                threads={threads}
                sync={sync}
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
