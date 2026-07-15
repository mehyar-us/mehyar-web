// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Sparkles, Zap, Flame, Send, Mail, Calendar, Bell, RefreshCw,
  ChevronRight, Brain, Hourglass, Briefcase, Globe, ArrowRight, CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, JarvisBar, AdminGate, useAdminSession, STAGE_BADGE, ScoreBar } from "./AdminShell";

// Combined backend endpoint that powers the NOW tab
async function fetchNow(token: string) {
  const r = await fetch("/api/admin/now", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function AdminNow() {
  return (
    <AdminGate>{(token) => <NowView token={token} />}</AdminGate>
  );
}

function NowView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-now", token], queryFn: () => fetchNow(token), refetchInterval: 30_000 });
  const r = (name: string, body: any) => fetch(`/api/admin/opportunities/${encodeURIComponent(name)}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-now"] });

  const data = q.data || {};
  const buckets = data.buckets || {};
  const counts = data.counts || {};
  const tone = data.tone || "calm";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav active="now" onLogout={logout} onRefresh={refresh} />

      {/* Top — Jarvis + KPI strip */}
      <div className="mb-5">
        <JarvisBar token={token} placeholder="Try: 'count opportunities in Discovery', 'enrich a0daf6…', or 'sql: SELECT …'" />
      </div>

      <KpiStrip counts={counts} tone={tone} />

      {/* Three column triage */}
      {q.isLoading && (
        <div className="text-center py-20 text-zinc-500"><Loader2 className="inline w-6 h-6 animate-spin mr-2" />Loading today…</div>
      )}

      {q.isError && (
        <Card><CardContent className="py-8 text-sm text-red-700">⚠ {String((q.error as Error)?.message || q.error)}</CardContent></Card>
      )}

      {q.data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          <Column title="🔥 Now" sub="< 48h or urgent" items={buckets.now || []} accent="red" />
          <Column title="📅 Today" sub="Outreach scheduled, drafts pending" items={buckets.today || []} accent="amber" />
          <Column title="🌤 This week" sub="Up next" items={buckets.week || []} accent="sky" />
        </div>
      )}

      {/* Bottom — cron & live ops */}
      {q.data && <OpsFooter data={q.data} token={token} />}
    </div>
  );
}

function KpiStrip({ counts, tone }: { counts: any; tone: string }) {
  const strip = [
    { key: "sam_active",       label: "🟢 SAM live",         val: counts.sam_active, tone: counts.sam_active ? "text-emerald-700" : "text-zinc-500" },
    { key: "sam_due_48h",      label: "🔥 Due ≤48h",         val: counts.sam_due_48h, tone: counts.sam_due_48h ? "text-red-700" : "text-zinc-500" },
    { key: "prospects_live",   label: "🧲 Live prospects",   val: counts.prospects_live, tone: "text-indigo-700" },
    { key: "drafts_to_review", label: "📝 Drafts to review", val: counts.drafts_to_review, tone: counts.drafts_to_review ? "text-violet-700" : "text-zinc-500" },
    { key: "outreach_due",     label: "📤 Outreach due",     val: counts.outreach_due, tone: "text-amber-700" },
    { key: "replies_24h",      label: "📬 Replies 24h",      val: counts.replies_24h, tone: counts.replies_24h ? "text-emerald-700" : "text-zinc-500" },
    { key: "won_30d",          label: "💰 Won 30d",          val: counts.won_30d, tone: "text-green-700" },
    { key: "pipeline_value",   label: "💎 Pipeline $",       val: counts.pipeline_value, tone: "text-cyan-700", prefix: "$" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
      {strip.map((s) => (
        <Card key={s.key}>
          <CardContent className="p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 leading-tight">{s.label}</div>
            <div className={`text-xl font-bold mt-1 leading-tight ${s.tone}`}>
              {s.prefix || ""}{(s.val ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Column({ title, sub, items, accent }: any) {
  const border = accent === "red" ? "border-red-300" : accent === "amber" ? "border-amber-300" : "border-sky-300";
  const titleIcon = accent === "red" ? "🔥" : accent === "amber" ? "📅" : "🌤";
  return (
    <div>
      <div className={`rounded-t-xl border ${border} bg-gradient-to-b from-white to-${accent}-50 px-4 py-3`}>
        <h3 className="font-bold flex items-center gap-2">
          <span>{titleIcon}</span>{title.replace(/^\S+\s/, "")}
          <Badge className={`ml-2 ${accent === "red" ? "bg-red-100 text-red-800" : accent === "amber" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{items.length}</Badge>
        </h3>
        <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>
      </div>
      <div className="space-y-2 border-l border-r border-b border-zinc-200 rounded-b-xl bg-white p-2 min-h-[200px]">
        {items.length === 0 ? (
          <div className="text-center text-xs text-zinc-400 py-12"><CheckCircle2 className="inline w-5 h-5 mr-1" />Inbox zero</div>
        ) : items.map((it: any, i: number) => <NowItem key={i} item={it} />)}
      </div>
    </div>
  );
}

function NowItem({ item }: { item: any }) {
  return (
    <div className="rounded-lg border border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50 transition p-3 cursor-pointer">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm leading-tight">{item.title}</span>
        {item.kind && <Badge className="text-[10px]">{item.kind === "sam" ? "🏛" : item.kind === "prospect" ? "🧲" : item.kind}</Badge>}
        {item.stage && <Badge className={`text-[10px] ${STAGE_BADGE[item.stage] || "bg-zinc-100 text-zinc-700"}`}>{item.stage}</Badge>}
        {typeof item.leak_score === "number" && <ScoreBar score={item.leak_score} max={100} label="leak" tone="leak" />}
        {typeof item.fit_score === "number" && <ScoreBar score={item.fit_score} max={100} label="fit" />}
        {item.deadline_in_days != null && (
          <span className={`ml-auto text-[11px] font-mono ${item.deadline_in_days <= 2 ? "text-red-700" : "text-zinc-500"}`}>
            {item.deadline_in_days <= 0 ? "OVERDUE" : `D-${item.deadline_in_days}`}
          </span>
        )}
      </div>
      {item.subtitle && <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{item.subtitle}</div>}
      {item.suggestion && (
        <div className="text-xs bg-violet-50 border border-violet-100 rounded px-2 py-1.5 mt-2 text-violet-800">
          🧠 {item.suggestion}
        </div>
      )}
      {item.deeplink && (
        <a href={item.deeplink} className="inline-flex items-center gap-1 text-xs text-blue-700 mt-1.5 hover:underline">
          Open <ChevronRight className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function OpsFooter({ data, token }: { data: any; token: string }) {
  const ops = data.ops || {};
  const lastCron = ops.last_cron;
  const aiSpend = ops.ai_spend_today || 0;
  const errs = ops.errors_24h || 0;
  const backups = ops.last_backup;
  return (
    <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3">
      <Card>
        <CardContent className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Hourglass className="w-3 h-3" />Cron</div>
          <div className="text-xs mt-1">Last: <strong>{lastCron?.triggered_at?.slice(11, 19) || "—"}</strong> UTC</div>
          <div className="text-xs text-zinc-500">{lastCron?.status || "—"}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Brain className="w-3 h-3" />AI spend (today)</div>
          <div className="text-xl font-bold text-violet-700">${aiSpend.toFixed(2)}</div>
          <div className="text-xs text-zinc-500">{ops.llm_calls_today || 0} LLM calls</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Bell className="w-3 h-3" />Errors 24h</div>
          <div className={`text-xl font-bold ${errs > 0 ? "text-red-700" : "text-emerald-700"}`}>{errs}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Calendar className="w-3 h-3" />Last backup</div>
          <div className="text-xs mt-1">{backups?.at?.slice(0, 10) || "—"}</div>
          <a href="/admin/system#backup" className="text-xs text-blue-700 hover:underline">Download latest →</a>
        </CardContent>
      </Card>
    </div>
  );
}
