// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, ExternalLink, Inbox, Loader2, Mail, RefreshCw, Search, Send, UsersRound, X } from "lucide-react";
import { AdminGate, AdminNav, useAdminSession } from "./AdminShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type View = "submissions" | "appointments" | "replies";

export default function AdminClients() {
  return <AdminGate>{(token) => <ClientWorkspace token={token} />}</AdminGate>;
}

function ClientWorkspace({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("submissions");
  const [search, setSearch] = useState("");
  const [replyLead, setReplyLead] = useState<any>(null);
  const [zoho, setZoho] = useState<any>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [opsResponse, zohoResponse] = await Promise.all([
        fetch("/api/admin/client-ops", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/admin/client-ops/zoho?action=status", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const ops = await opsResponse.json();
      const zohoPayload = await zohoResponse.json().catch(() => ({}));
      if (!opsResponse.ok) throw new Error(ops.error || `Dashboard failed (${opsResponse.status})`);
      setData(ops); setZoho(zohoPayload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Dashboard unavailable"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token]);

  const query = search.trim().toLowerCase();
  const submissions = useMemo(() => (data?.submissions || []).filter((row: any) => !query || [row.name, row.email, row.company, row.form_type, row.service_interest, row.message].some((value) => String(value || "").toLowerCase().includes(query))), [data, query]);
  const appointments = useMemo(() => (data?.appointments || []).filter((row: any) => !query || [row.name, row.email, row.company, row.service_interest, row.status].some((value) => String(value || "").toLowerCase().includes(query))), [data, query]);
  const replies = useMemo(() => (data?.replies || []).filter((row: any) => !query || [row.to_email, row.subject, row.body_text, row.status].some((value) => String(value || "").toLowerCase().includes(query))), [data, query]);

  const connectZoho = async () => {
    const response = await fetch("/api/admin/client-ops/zoho?action=connect", { headers: { authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (payload.authorization_url) window.open(payload.authorization_url, "zoho-calendar-oauth", "width=720,height=760");
  };

  return (
    <div className="mx-auto max-w-7xl p-4 pb-[calc(80px+env(safe-area-inset-bottom))] md:p-6">
      <AdminNav active="clients" onLogout={logout} onRefresh={load} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Client desk</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">Forms, calls, and replies</h1><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">One owner-only view for every website request and booked Zoho call.</p></div><Badge className={zoho?.connected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}>{zoho?.connected ? "Zoho Calendar connected" : "Zoho Calendar needs access"}</Badge></div>
      {!zoho?.connected && !loading ? <Card className="mb-5 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong>Connect Zoho Calendar once</strong><p className="mt-1 text-sm text-muted-foreground">Approve the new Calendar scopes so live availability and event creation can work. Existing credentials stay in Cloudflare.</p></div><Button onClick={connectZoho}>Connect Zoho Calendar</Button></CardContent></Card> : null}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{[
        ["All forms", data?.counts?.submissions || 0, Inbox],
        ["New this week", data?.counts?.submissions_7d || 0, UsersRound],
        ["Upcoming calls", data?.counts?.upcoming_appointments || 0, CalendarClock],
        ["Replies this week", data?.counts?.replies_7d || 0, Send],
      ].map(([label, value, Icon]: any) => <Card key={label}><CardContent className="p-4"><Icon className="h-4 w-4 text-emerald-600" /><div className="mt-2 text-2xl font-bold">{value}</div><div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div></CardContent></Card>)}</div>
      <div className="sticky top-0 z-20 mb-4 rounded-2xl border bg-white/95 p-2 shadow-sm backdrop-blur dark:bg-zinc-900/95 md:top-[68px]"><div className="grid grid-cols-3 gap-1">{[
        ["submissions", "Forms", Inbox, data?.submissions?.length || 0],
        ["appointments", "Calls", CalendarClock, data?.appointments?.length || 0],
        ["replies", "Replies", Mail, data?.replies?.length || 0],
      ].map(([key, label, Icon, count]: any) => <button key={key} onClick={() => setView(key)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${view === key ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}><Icon className="h-4 w-4" /><span>{label}</span><span className="rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/15">{count}</span></button>)}</div></div>
      <div className="relative mb-4"><Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, business, service, or message" /></div>
      {loading ? <div className="flex min-h-64 items-center justify-center gap-2 text-zinc-500"><Loader2 className="h-5 w-5 animate-spin" />Loading client activity…</div> : error ? <Card><CardContent className="p-8 text-center text-red-700">{error}<Button className="mt-4" variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></CardContent></Card> : null}
      {!loading && !error && view === "submissions" ? <div className="space-y-3">{submissions.map((lead: any) => <SubmissionCard key={lead.id} lead={lead} onReply={() => setReplyLead(lead)} />)}{!submissions.length ? <Empty label="No matching forms" /> : null}</div> : null}
      {!loading && !error && view === "appointments" ? <div className="space-y-3">{appointments.map((appointment: any) => <AppointmentCard key={appointment.id} appointment={appointment} onReply={() => setReplyLead({ id: appointment.lead_id, name: appointment.name, email: appointment.email })} />)}{!appointments.length ? <Empty label="No matching appointments" /> : null}</div> : null}
      {!loading && !error && view === "replies" ? <div className="space-y-3">{replies.map((reply: any) => <Card key={reply.id}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{reply.subject}</div><div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">To {reply.to_email} · {formatDate(reply.sent_at || reply.created_at)}</div></div><Status value={reply.status} /></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">{reply.body_text}</p></CardContent></Card>)}{!replies.length ? <Empty label="No matching replies" /> : null}</div> : null}
      {replyLead ? <ReplyComposer lead={replyLead} token={token} onClose={() => setReplyLead(null)} onSent={() => { setReplyLead(null); void load(); }} /> : null}
    </div>
  );
}

function SubmissionCard({ lead, onReply }: any) {
  return <Card><CardContent className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{lead.name || "Unnamed request"}</h2><Badge variant="outline">{String(lead.form_type || "form").replaceAll("_", " ")}</Badge><Status value={lead.notification_status} /></div><p className="mt-1 break-all text-sm text-zinc-600 dark:text-zinc-300">{lead.email}{lead.phone ? ` · ${lead.phone}` : ""}{lead.company ? ` · ${lead.company}` : ""}</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{formatDate(lead.created_at)} · {lead.service_interest || "General request"}</p></div><Button size="sm" onClick={onReply}><Mail className="mr-2 h-4 w-4" />Reply</Button></div>{lead.message ? <p className="mt-4 whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-sm leading-6 dark:bg-zinc-800/60">{lead.message}</p> : null}{lead.website ? <a className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-400" href={lead.website} target="_blank" rel="noreferrer">Open website <ExternalLink className="h-3 w-3" /></a> : null}</CardContent></Card>;
}

function AppointmentCard({ appointment, onReply }: any) {
  const upcoming = new Date(appointment.starts_at).getTime() >= Date.now();
  return <Card className={upcoming && appointment.status === "confirmed" ? "border-emerald-200 dark:border-emerald-900" : ""}><CardContent className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{appointment.name}</h2><Status value={appointment.status} /></div><p className="mt-2 text-lg font-bold text-emerald-800 dark:text-emerald-300">{formatDate(appointment.starts_at)}</p><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{appointment.email} · {appointment.phone || "No phone"}{appointment.company ? ` · ${appointment.company}` : ""}</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{appointment.service_interest || "Consulting call"} · Client email: {appointment.client_email_status} · Owner email: {appointment.owner_email_status}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={onReply}><Mail className="mr-2 h-4 w-4" />Email</Button>{appointment.zoho_view_url ? <Button size="sm" variant="outline" asChild><a href={appointment.zoho_view_url} target="_blank" rel="noreferrer">Zoho <ExternalLink className="ml-2 h-3 w-3" /></a></Button> : null}</div></div>{appointment.notes ? <p className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">{appointment.notes}</p> : null}{appointment.provider_error ? <p className="mt-3 text-xs text-red-700">{appointment.provider_error}</p> : null}</CardContent></Card>;
}

function ReplyComposer({ lead, token, onClose, onSent }: any) {
  const [subject, setSubject] = useState(`Re: Your MehyarSoft request`);
  const [message, setMessage] = useState(`Hi ${lead.name || "there"},\n\nThanks for reaching out to MehyarSoft.\n\n\nBest,\nMehyar`);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const send = async () => { setSending(true); setError(""); try { const response = await fetch("/api/admin/client-ops/reply", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ lead_id: lead.id, subject, message, confirm_send: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Email failed"); onSent(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Email failed"); } finally { setSending(false); } };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true"><Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-b-none sm:rounded-2xl"><CardContent className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Send from info@mehyar.us</p><h2 className="mt-1 text-xl font-semibold">Reply to {lead.name || lead.email}</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{lead.email}</p></div><Button size="icon" variant="ghost" onClick={onClose}><X className="h-5 w-5" /></Button></div><div className="mt-5 space-y-4"><div className="space-y-2"><Label>Subject</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></div><div className="space-y-2"><Label>Message</Label><Textarea rows={10} value={message} onChange={(event) => setMessage(event.target.value)} /></div>{error ? <p className="text-sm text-red-700">{error}</p> : null}<div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Sending is an external action. Review the recipient, subject, and message before pressing Send.</div><Button className="w-full" size="lg" onClick={send} disabled={sending || !subject.trim() || !message.trim()}>{sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send email</Button></div></CardContent></Card></div>;
}

function Status({ value }: { value: string }) { const ok = ["sent", "confirmed", "accepted"].includes(String(value)); return <Badge className={ok ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}>{String(value || "unknown").replaceAll("_", " ")}</Badge>; }
function Empty({ label }: { label: string }) { return <Card><CardContent className="py-14 text-center text-zinc-500"><Inbox className="mx-auto mb-3 h-8 w-8 opacity-40" />{label}</CardContent></Card>; }
function formatDate(value: string) { if (!value) return "Unknown time"; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date) : value; }
