// AdminSent.tsx — "What emails were sent and to who, with what sender, content,
// and reply tracking." This is the founder's outbound audit page.
//
// Pulls from /api/admin/mayor/sent which already JOINs:
//   prospect_sends ← prospects + outreach_steps + prospect_drafts
//                 + reply tracking via prospect_replies.send_id
//
// Filtering is live — no Apply button. Status, provider, days, replied-only,
// and free-text all pipe straight into the URL params the endpoint reads.

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Mail, ChevronRight, Copy, ExternalLink, Filter, X,
  ChevronDown, ChevronUp, Loader2, Send, Inbox, Eye, Reply, Sparkles, AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, MayorBar, AdminGate, useAdminSession } from "./AdminShell";

async function fetchSent(token: string, params: string) {
  const r = await fetch(`/api/admin/mayor/sent?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function AdminSent() {
  return <AdminGate>{(token) => <SentView token={token} />}</AdminGate>;
}

function SentView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [provider, setProvider] = useState("");
  const [days, setDays] = useState(30);
  const [repliedOnly, setRepliedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status.length) params.set("status", status.join(","));
  if (provider) params.set("provider", provider);
  if (days) params.set("days", String(days));
  if (repliedOnly) params.set("replied", "1");
  params.set("limit", "100");

  const sentQ = useQuery({
    queryKey: ["admin-sent", token, params.toString()],
    queryFn: () => fetchSent(token, params.toString()),
    refetchInterval: 30000,
  });

  const items: any[] = sentQ.data?.items || [];
  const byStatus: Record<string, number> = sentQ.data?.by_status || {};
  const byProvider: Record<string, number> = sentQ.data?.by_provider || {};

  const totals = useMemo(() => {
    const total = items.length;
    const replied = items.filter((x) => x.reply_count > 0).length;
    const interest = items.filter((x) => x.last_reply_class === "interest" || x.last_reply_class === "warm").length;
    return { total, replied, interest, replyRate: total ? Math.round((replied / total) * 100) : 0 };
  }, [items]);

  const toggleStatus = (s: string) =>
    setStatus((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <AdminNav active="sent" onLogout={logout} onRefresh={() => sentQ.refetch()} />

      <div className="mb-5 space-y-3">
        <MayorBar token={token} placeholder="Try: 'show only replied', 'search subject Hey there', 'from_name Mehyar'" />
      </div>

      {/* Header card */}
      <Card className="mb-4">
        <CardContent className="p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                <Send className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                Sent inbox
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">
                Every outbound email Mayor has fired. Click any row to read the body,
                see replies, and replay the exact subject + sender.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Shown" value={totals.total} icon={Send} />
              <Stat label="Replied" value={totals.replied} sub={`${totals.replyRate}% rate`} icon={Reply} tone="emerald" />
              <Stat label="Interested" value={totals.interest} icon={Sparkles} tone="violet" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter strip */}
      <Card className="mb-4">
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subject, body, to/from…"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 bg-white dark:bg-zinc-900">
              <option value="0">all time</option>
              <option value="1">last 24h</option>
              <option value="7">last 7d</option>
              <option value="30">last 30d</option>
              <option value="90">last 90d</option>
            </select>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}
              className="text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 bg-white dark:bg-zinc-900">
              <option value="">all providers</option>
              <option value="manual_approval">manual_approval</option>
              <option value="resend">resend</option>
              <option value="ses">ses</option>
              <option value="sendgrid">sendgrid</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 px-2 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 cursor-pointer">
              <input type="checkbox" checked={repliedOnly} onChange={(e) => setRepliedOnly(e.target.checked)} />
              only replied
            </label>
            {(q || status.length || provider || days !== 30 || repliedOnly) && (
              <button onClick={() => { setQ(""); setStatus([]); setProvider(""); setDays(30); setRepliedOnly(false); }}
                className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline px-2">
                clear
              </button>
            )}
          </div>
          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-semibold mr-1">Status:</span>
            {(["queued", "sent", "delivered", "opened", "clicked", "replied", "bounced", "failed", "unsubscribed"]
              .map((s) => {
                const count = byStatus[s] || 0;
                const active = status.includes(s);
                return (
                  <button key={s} onClick={() => toggleStatus(s)}
                    className={`text-xs px-2 py-1 rounded-full border transition ${
                      active
                        ? "bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200 border-violet-300 dark:border-violet-700"
                        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-violet-300"
                    }`}>
                    {s}{count > 0 ? <span className="ml-1 tabular-nums text-[10px] text-zinc-500">({count})</span> : null}
                  </button>
                );
              }))}
            <span className="ml-auto text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
              {byStatus && Object.keys(byStatus).length > 0 && (
                <span className="mr-3">
                  roll-up: {Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(" · ")}
                </span>
              )}
              {sentQ.data?.updated_at && <span>· last-refreshed {new Date(sentQ.data.updated_at).toLocaleTimeString()}</span>}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Body */}
      {sentQ.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse"><CardContent className="p-4 h-28" /></Card>
          ))}
        </div>
      )}

      {sentQ.isError && (
        <Card><CardContent className="py-8 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
          ⚠ Failed to load sent history: {String((sentQ.error as Error)?.message || sentQ.error)}
          <Button size="sm" variant="outline" onClick={() => sentQ.refetch()}>Retry</Button>
        </CardContent></Card>
      )}

      {sentQ.data && items.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Inbox className="inline w-10 h-10 mb-3 text-zinc-300 dark:text-zinc-600" />
          <div className="font-medium text-zinc-700 dark:text-zinc-200">No emails sent matching these filters yet.</div>
          <div className="text-xs mt-1">Once Mayor fires its first send, it'll show up here with subject, body, and reply tracking.</div>
        </CardContent></Card>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((s) => (
            <SentRow
              key={s.id}
              row={s}
              expanded={expanded === s.id}
              onToggle={() => setExpanded((cur) => (cur === s.id ? null : s.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, tone = "neutral" }: any) {
  const toneCls: Record<string, string> = {
    neutral: "text-zinc-700 dark:text-zinc-200",
    emerald: "text-emerald-700 dark:text-emerald-400",
    violet: "text-violet-700 dark:text-violet-400",
  };
  return (
    <div className="text-center px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 min-w-[80px]">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-semibold flex items-center justify-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${toneCls[tone]}`}>{value}</div>
      {sub && <div className="text-[9px] text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

function SentRow({ row, expanded, onToggle }: any) {
  const body = row.body_text || row.draft_body || "";
  const isReply = row.reply_count > 0;
  const isInterest = row.last_reply_class === "interest" || row.last_reply_class === "warm";
  const statusColor = row.status === "sent" || row.status === "delivered" || row.status === "opened"
    ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200"
    : row.status === "bounced" || row.status === "failed"
    ? "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200"
    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300";
  const isClickable = body || row.subject;
  return (
    <Card className={`transition ${isReply ? "border-emerald-300 dark:border-emerald-700" : ""} ${isInterest ? "ring-1 ring-emerald-300 dark:ring-emerald-700" : ""}`}>
      <CardContent className="p-0">
        <button onClick={onToggle} className="w-full text-left p-3 md:p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Badge className={statusColor}>{row.status || "?"}</Badge>
              {row.step_order && (
                <Badge variant="outline" className="text-[9px]">Step {row.step_order}</Badge>
              )}
              {isReply && (
                <Badge className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-[10px]">
                  <Reply className="w-3 h-3 mr-1" />{row.reply_count}
                </Badge>
              )}
              {isInterest && (
                <Badge className="bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200 text-[10px]">
                  <Sparkles className="w-3 h-3 mr-1" />interested
                </Badge>
              )}
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
              </span>
            </div>
            {isClickable ? (expanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />) : null}
          </div>
          <div className="font-semibold text-sm truncate text-zinc-900 dark:text-zinc-100">{row.subject || "(no subject)"}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
            <span><strong>To:</strong> <span className="font-mono">{row.to_email}</span></span>
            <span><strong>From:</strong> {row.from_name || "—"} &lt;{row.from_email}&gt;</span>
            <span><strong>Provider:</strong> {row.provider}</span>
            {row.prospect_id && (
              <Link href={`/admin/leads/${row.prospect_id}?kind=prospect`} className="underline text-violet-700 dark:text-violet-300 inline-flex items-center gap-1">
                {row.prospect_name || row.prospect_domain || "prospect"} <ExternalLink className="w-3 h-3" />
              </Link>
            )}
            {row.step_name && <span className="text-zinc-500">📋 {row.step_name}</span>}
          </div>
        </button>
        {expanded && isClickable && (
          <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 p-4 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 font-semibold">Body</div>
                <button onClick={() => copyText(`${row.subject}\n\n${body}`)} className="text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1">
                  <Copy className="w-3 h-3" />copy
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md p-3 max-h-80 overflow-y-auto text-zinc-800 dark:text-zinc-200 font-sans">
{body || "(empty)"}
              </pre>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
              <KV k="Draft id" v={row.draft_id} mono />
              <KV k="Send id" v={row.id} mono />
              <KV k="Channel" v={row.channel} />
              <KV k="Reply-to" v={row.reply_to} mono />
              {row.list_unsub_header && <KV k="Unsub header" v={row.list_unsub_header} mono />}
              {row.physical_address && <KV k="Postal addr" v={row.physical_address} />}
              <KV k="Provider msg" v={row.provider_id || "—"} mono />
              {row.attempted_at && <KV k="Attempted" v={new Date(row.attempted_at).toLocaleString()} />}
              {row.finished_at && <KV k="Finished" v={new Date(row.finished_at).toLocaleString()} />}
              {row.last_reply_class && <KV k="Last reply" v={`${row.last_reply_class} (${row.reply_count})`} />}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KV({ k, v, mono }: { k: string; v: any; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{k}</div>
      <div className={`text-xs truncate ${mono ? "font-mono" : ""} text-zinc-800 dark:text-zinc-200`} title={v}>{v || "—"}</div>
    </div>
  );
}

function copyText(s: string) {
  try {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(s);
    }
  } catch { /* ignore */ }
}
