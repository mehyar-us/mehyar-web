// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarClock, ChevronRight, ExternalLink, Inbox, Loader2, Mail, RefreshCw, Search, Send, Sparkles, UsersRound, X } from "lucide-react";
import { AdminGate, AdminNav, useAdminSession } from "./AdminShell";
import { AdminProposalStudio } from "./AdminProposalStudio";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type View = "appointments" | "leads" | "submissions" | "proposals" | "replies";

export default function AdminClients() {
  return <AdminGate>{(token) => <ClientWorkspace token={token} />}</AdminGate>;
}

function ClientWorkspace({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("appointments");
  const [search, setSearch] = useState("");
  const [replyLead, setReplyLead] = useState<any>(null);
  const [zoho, setZoho] = useState<any>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const headers = { authorization: `Bearer ${token}` };
      const [opsResponse, zohoResponse] = await Promise.all([
        fetch("/api/admin/client-ops", { headers, cache: "no-store" }),
        fetch("/api/admin/client-ops/zoho?action=status", { headers, cache: "no-store" }),
      ]);
      const ops = await opsResponse.json();
      if (!opsResponse.ok) throw new Error(ops.error || `Dashboard failed (${opsResponse.status})`);
      setData(ops); setZoho(await zohoResponse.json().catch(() => ({})));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Dashboard unavailable"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token]);

  const query = search.trim().toLowerCase();
  const matches = (row: any) => !query || Object.values(row || {}).some((value) => String(value || "").toLowerCase().includes(query));
  const submissions = useMemo(() => (data?.submissions || []).filter(matches), [data, query]);
  const leads = useMemo(() => (data?.leads || []).filter(matches), [data, query]);
  const appointments = useMemo(() => (data?.appointments || []).filter(matches), [data, query]);
  const replies = useMemo(() => (data?.replies || []).filter(matches), [data, query]);
  const eventsFor = (leadId: string) => (data?.events || []).filter((row: any) => row.lead_id === leadId);

  const connectZoho = async () => {
    const response = await fetch("/api/admin/client-ops/zoho?action=connect", { headers: { authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (payload.authorization_url) window.open(payload.authorization_url, "zoho-calendar-oauth", "width=720,height=760");
  };

  const tabs = [
    ["appointments", "Calendar", CalendarDays, data?.appointments?.length || 0],
    ["leads", "Leads", UsersRound, data?.leads?.length || 0],
    ["submissions", "Forms", Inbox, data?.submissions?.length || 0],
    ["proposals", "AI proposals", Sparkles, null],
    ["replies", "Replies", Mail, data?.replies?.length || 0],
  ];

  return <div className="mx-auto max-w-7xl p-3 pb-[calc(88px+env(safe-area-inset-bottom))] sm:p-5 md:p-6">
    <AdminNav active="clients" onLogout={logout} onRefresh={load} />
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Owner workspace</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">Clients, calendar, and proposals</h1><p className="mt-1 text-sm text-muted-foreground">Everything a client sent, every booked call, and every tailored sales page.</p></div>
      <Badge className={zoho?.connected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}>{zoho?.connected ? "Zoho connected" : "Zoho needs access"}</Badge>
    </header>
    {!zoho?.connected && !loading ? <Card className="mb-4 border-amber-200 bg-amber-50"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong>Reconnect Zoho Calendar</strong><p className="mt-1 text-sm text-muted-foreground">Required for live availability and event creation.</p></div><Button onClick={connectZoho}>Connect Zoho</Button></CardContent></Card> : null}
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">{[
      ["Upcoming calls", data?.counts?.upcoming_appointments || 0, CalendarClock],
      ["Active leads", data?.counts?.active_leads || 0, UsersRound],
      ["New this week", data?.counts?.submissions_7d || 0, Inbox],
      ["Replies this week", data?.counts?.replies_7d || 0, Send],
    ].map(([label, value, Icon]: any) => <Card key={label}><CardContent className="p-3 sm:p-4"><Icon className="h-4 w-4 text-emerald-600" /><div className="mt-2 text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></CardContent></Card>)}</div>

    <nav className="sticky top-0 z-20 -mx-3 mb-4 overflow-x-auto border-y bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:mx-0 sm:rounded-2xl sm:border" aria-label="Client workspace sections">
      <div className="flex min-w-max gap-1">{tabs.map(([key, label, Icon, count]: any) => <button key={key} onClick={() => setView(key)} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${view === key ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-muted"}`}><Icon className="h-4 w-4" />{label}{count !== null ? <span className="rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/15">{count}</span> : null}</button>)}</div>
    </nav>

    {view !== "proposals" ? <div className="relative mb-4"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search every field and note" /></div> : null}
    {loading ? <div className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading workspace…</div> : error ? <Card><CardContent className="p-8 text-center text-red-700">{error}<div><Button className="mt-4" variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div></CardContent></Card> : null}

    {!loading && !error && view === "appointments" ? <AppointmentWorkspace appointments={appointments} eventsFor={eventsFor} onReply={(row: any) => setReplyLead({ id: row.lead_id, name: row.name, email: row.email })} /> : null}
    {!loading && !error && view === "leads" ? <div className="space-y-3">{leads.map((lead: any) => <LeadCard key={lead.id} lead={lead} events={eventsFor(lead.id)} onReply={() => setReplyLead(lead)} />)}{!leads.length ? <Empty label="No matching leads" /> : null}</div> : null}
    {!loading && !error && view === "submissions" ? <div className="space-y-3">{submissions.map((lead: any) => <SubmissionCard key={lead.id} lead={lead} events={eventsFor(lead.id)} onReply={() => setReplyLead(lead)} />)}{!submissions.length ? <Empty label="No matching forms" /> : null}</div> : null}
    {!loading && !error && view === "proposals" ? <AdminProposalStudio token={token} /> : null}
    {!loading && !error && view === "replies" ? <div className="space-y-3">{replies.map((reply: any) => <ReplyCard key={reply.id} reply={reply} />)}{!replies.length ? <Empty label="No matching replies" /> : null}</div> : null}
    {replyLead ? <ReplyComposer lead={replyLead} token={token} onClose={() => setReplyLead(null)} onSent={() => { setReplyLead(null); void load(); }} /> : null}
  </div>;
}

function AppointmentWorkspace({ appointments, eventsFor, onReply }: any) {
  const grouped = appointments.reduce((map: Record<string, any[]>, row: any) => { const day = String(row.starts_at || row.created_at || "").slice(0, 10); (map[day] ||= []).push(row); return map; }, {});
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  const initial = days.find((day) => new Date(`${day}T23:59:59`).getTime() >= Date.now()) || days[0] || "";
  const [selectedDay, setSelectedDay] = useState(initial);
  useEffect(() => { if (!selectedDay && initial) setSelectedDay(initial); }, [initial]);
  return <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
    <Card className="h-fit"><CardContent className="p-3"><p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Appointment days</p><div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">{days.map((day) => <button key={day} onClick={() => setSelectedDay(day)} className={`flex min-w-[170px] items-center justify-between rounded-xl px-3 py-3 text-left lg:min-w-0 ${selectedDay === day ? "bg-emerald-600 text-white" : "bg-muted/60 hover:bg-muted"}`}><span><span className="block text-xs opacity-75">{formatDay(day)}</span><strong>{grouped[day].length} call{grouped[day].length === 1 ? "" : "s"}</strong></span><ChevronRight className="h-4 w-4" /></button>)}{!days.length ? <p className="p-3 text-sm text-muted-foreground">No appointments yet.</p> : null}</div></CardContent></Card>
    <div className="space-y-3">{(grouped[selectedDay] || []).map((appointment: any) => <AppointmentCard key={appointment.id} appointment={appointment} events={eventsFor(appointment.lead_id)} onReply={() => onReply(appointment)} />)}{days.length && !(grouped[selectedDay] || []).length ? <Empty label="No calls on this day" /> : null}</div>
  </div>;
}

function AppointmentCard({ appointment, events, onReply }: any) {
  const upcoming = new Date(appointment.starts_at).getTime() >= Date.now();
  return <Card className={upcoming && appointment.status === "confirmed" ? "border-emerald-300" : ""}><CardContent className="p-4 sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{appointment.name || "Unnamed client"}</h2><Status value={appointment.status} /><Status value={appointment.provider_status} /></div><p className="mt-2 text-lg font-bold text-emerald-700">{formatDate(appointment.starts_at)}</p><p className="mt-1 break-all text-sm">{appointment.email} · {appointment.phone || "No phone"}</p><p className="text-sm text-muted-foreground">{appointment.company || "No company"} · {appointment.service_interest || "Consulting call"}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" onClick={onReply}><Mail className="mr-2 h-4 w-4" />Email</Button>{appointment.zoho_view_url ? <Button size="sm" variant="outline" asChild><a href={appointment.zoho_view_url} target="_blank" rel="noreferrer">Zoho <ExternalLink className="ml-2 h-3 w-3" /></a></Button> : null}</div></div>
    {appointment.notes ? <section className="mt-4 rounded-xl bg-muted/60 p-3"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">What they want</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{appointment.notes}</p></section> : null}
    <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3"><Fact label="Duration" value={`${appointment.duration_minutes || 30} minutes`} /><Fact label="Timezone" value={appointment.timezone} /><Fact label="Client email" value={appointment.client_email_status} /><Fact label="Owner email" value={appointment.owner_email_status} /><Fact label="Zoho event ID" value={appointment.zoho_event_id} /><Fact label="Database ID" value={appointment.id} /></div>
    <Metadata title="Booking and device metadata" value={appointment.request_metadata_json} /><Metadata title="Zoho provider response" value={appointment.provider_metadata_json} /><EventHistory events={events} />
  </CardContent></Card>;
}

function LeadCard({ lead, events, onReply }: any) {
  return <Card><CardContent className="p-4 sm:p-5"><RecordHeader lead={lead} onReply={onReply} />
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Fact label="Interest" value={lead.service_interest || lead.selected_offer} /><Fact label="Budget" value={lead.budget_range} /><Fact label="Timeline" value={lead.timeline} /><Fact label="Source" value={lead.source || lead.utm_source} /></div>
    {lead.message ? <section className="mt-4 rounded-xl bg-muted/60 p-3"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Request or description</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{lead.message}</p></section> : null}
    <Metadata title="Complete submission metadata" value={lead.metadata_json} /><EventHistory events={events} />
  </CardContent></Card>;
}

function SubmissionCard({ lead, events, onReply }: any) {
  return <Card><CardContent className="p-4 sm:p-5"><RecordHeader lead={lead} onReply={onReply} />
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Fact label="Form" value={String(lead.form_type || "form").replaceAll("_", " ")} /><Fact label="Offer" value={lead.selected_offer || lead.offer_code} /><Fact label="Consent to contact" value={lead.consent_contact ? "Yes" : "No"} /><Fact label="Notification" value={lead.notification_status} /></div>
    {lead.message ? <p className="mt-4 whitespace-pre-wrap rounded-xl bg-muted/60 p-3 text-sm leading-6">{lead.message}</p> : null}<Metadata title="All submitted fields and metadata" value={{ ...lead, metadata_json: parseJson(lead.metadata_json) }} /><EventHistory events={events} />
  </CardContent></Card>;
}

function RecordHeader({ lead, onReply }: any) { return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{lead.name || "Unnamed request"}</h2><Badge variant="outline">{String(lead.form_type || "lead").replaceAll("_", " ")}</Badge><Status value={lead.status || lead.notification_status} /></div><p className="mt-1 break-all text-sm">{lead.email}{lead.phone ? ` · ${lead.phone}` : ""}</p><p className="mt-1 text-xs text-muted-foreground">{lead.company || "No business name"} · {formatDate(lead.created_at)}</p>{lead.website ? <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700" href={lead.website} target="_blank" rel="noreferrer">Open website <ExternalLink className="h-3 w-3" /></a> : null}</div><Button size="sm" onClick={onReply}><Mail className="mr-2 h-4 w-4" />Reply</Button></div>; }

function ReplyCard({ reply }: any) { return <Card><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{reply.subject}</div><div className="mt-1 text-xs text-muted-foreground">To {reply.to_email} · {formatDate(reply.sent_at || reply.created_at)}</div></div><Status value={reply.status} /></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{reply.body_text}</p><Metadata title="Delivery metadata" value={reply} /></CardContent></Card>; }

function Metadata({ title, value }: any) { const parsed = parseJson(value); if (!parsed || (typeof parsed === "object" && !Object.keys(parsed).length)) return null; return <details className="mt-4 rounded-xl border bg-background p-3"><summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 text-[11px] leading-5 text-zinc-100">{JSON.stringify(parsed, null, 2)}</pre></details>; }
function EventHistory({ events }: any) { if (!events?.length) return null; return <details className="mt-3 rounded-xl border p-3"><summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">Activity history ({events.length})</summary><div className="mt-3 space-y-2">{events.map((event: any) => <div key={event.id} className="rounded-lg bg-muted/60 p-2 text-xs"><div className="font-semibold">{String(event.event_type || "event").replaceAll("_", " ")}</div><div className="text-muted-foreground">{formatDate(event.created_at)} · {event.actor}</div><Metadata title="Event data" value={event.metadata_json} /></div>)}</div></details>; }
function Fact({ label, value }: any) { return <div className="rounded-xl border bg-background p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 break-words font-medium">{value || "Not provided"}</div></div>; }

function ReplyComposer({ lead, token, onClose, onSent }: any) {
  const [subject, setSubject] = useState("Re: Your MehyarSoft request");
  const [message, setMessage] = useState(`Hi ${lead.name || "there"},\n\nThanks for reaching out to MehyarSoft.\n\n\nBest,\nMehyar`);
  const [sending, setSending] = useState(false); const [error, setError] = useState("");
  const send = async () => { setSending(true); setError(""); try { const response = await fetch("/api/admin/client-ops/reply", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ lead_id: lead.id, subject, message, confirm_send: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Email failed"); onSent(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Email failed"); } finally { setSending(false); } };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true"><Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-b-none sm:rounded-2xl"><CardContent className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Send from info@mehyar.us</p><h2 className="mt-1 text-xl font-semibold">Reply to {lead.name || lead.email}</h2><p className="mt-1 text-sm text-muted-foreground">{lead.email}</p></div><Button size="icon" variant="ghost" onClick={onClose}><X className="h-5 w-5" /></Button></div><div className="mt-5 space-y-4"><div className="space-y-2"><Label>Subject</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></div><div className="space-y-2"><Label>Message</Label><Textarea rows={10} value={message} onChange={(event) => setMessage(event.target.value)} /></div>{error ? <p className="text-sm text-red-700">{error}</p> : null}<div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Review the recipient and message before sending this external email.</div><Button className="w-full" size="lg" onClick={send} disabled={sending || !subject.trim() || !message.trim()}>{sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send email</Button></div></CardContent></Card></div>;
}

function Status({ value }: { value: string }) { const ok = ["sent", "confirmed", "accepted", "connected", "complete"].includes(String(value)); return <Badge className={ok ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}>{String(value || "unknown").replaceAll("_", " ")}</Badge>; }
function Empty({ label }: { label: string }) { return <Card><CardContent className="py-14 text-center text-muted-foreground"><Inbox className="mx-auto mb-3 h-8 w-8 opacity-40" />{label}</CardContent></Card>; }
function parseJson(value: any) { if (!value) return null; if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } }
function formatDay(value: string) { const date = new Date(`${value}T12:00:00`); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(date) : value; }
function formatDate(value: string) { if (!value) return "Unknown time"; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date) : value; }
