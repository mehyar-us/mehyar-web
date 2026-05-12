import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Inbox,
  LockKeyhole,
  MailCheck,
  MailWarning,
  MessageSquareReply,
  RefreshCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
  AdminEmailSyncStatus,
  AdminEmailThreadDetail,
  AdminEmailThreadSummary,
  AdminMetrics,
  AdminSuppressionStatus,
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
};

const metricCards = [
  { key: "leads", label: "Total leads", icon: Users },
  { key: "contactRequests", label: "General", icon: Users },
  { key: "auditRequests", label: "Audits", icon: ClipboardCheck },
  { key: "bookingRequests", label: "Booking", icon: CalendarClock },
  { key: "microOfferRequests", label: "$330 rescue", icon: ClipboardCheck },
  { key: "suppressions", label: "Suppressions", icon: ShieldCheck },
] as const;

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
          <table className="w-full min-w-[760px] text-left text-sm">
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
  const canSend = Boolean(draft?.id && draftBody.trim() && !isSuppressed);

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
          <p className="text-xs leading-5 text-muted-foreground">Send opens a confirmation gate and calls the backend send endpoint with confirm_manual_send=true. No bulk send or autonomous send path exists in this UI.</p>
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
      const nextMetrics = await mehyarSoftApi.getMetrics(sessionToken);
      setMetrics({ ...emptyMetrics, ...nextMetrics });
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
    const recipient = [...(threadDetail?.messages || [])].reverse().find((message) => message.direction !== "outbound")?.from_email || threadDetail?.thread.primary_email || "the original inbound sender";
    const confirmed = window.confirm(`Manual send confirmation required. Send exactly one reviewed reply from contact@mehyar.us to ${recipient}? This is not a bulk or autonomous send.`);
    if (!confirmed) return;
    setIsDraftBusy(true);
    try {
      await mehyarSoftApi.updateEmailDraft(token, activeDraft.id, { subject: draftSubject, body_text: draftBody });
      if (activeDraft.status !== "approved") await mehyarSoftApi.approveEmailDraft(token, activeDraft.id);
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
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {metricCards.map(({ key, label, icon: Icon }) => (
                  <Card key={key} className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
                    <CardContent className="p-6">
                      <Icon className="mb-4 text-brand-700 dark:text-brand-100" size={28} aria-hidden="true" />
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-foreground">{metrics[key]}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
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
