// @ts-nocheck
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Sparkles, Zap, Flame, Send, Mail, Calendar, Bell, RefreshCw,
  ChevronRight, Brain, Hourglass, Briefcase, Globe, ArrowRight, CheckCircle2,
  BrainCircuit, BrainCog, Database, AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, JarvisBar, AdminGate, useAdminSession, STAGE_BADGE, ScoreBar, EmptyState } from "./AdminShell";

async function fetchNow(token: string) {
  const r = await fetch("/api/admin/now", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function AdminNow() {
  return <AdminGate>{(token) => <NowView token={token} />}</AdminGate>;
}

function NowView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const qc = useQueryClient();
  const [now, setNow] = useState(new Date());

  const q = useQuery({
    queryKey: ["admin-now", token],
    queryFn: () => fetchNow(token),
    refetchInterval: 30_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-now"] });
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const data = q.data || {};
  const buckets = data.buckets || {};
  const counts = data.counts || {};
  const tone = data.tone || "calm";

  const handleClick = (item: any) => {
    if (item.deeplink && item.deeplink.startsWith("/admin/leads?focus=")) {
      const id = item.deeplink.split("focus=")[1];
      window.location.href = `/admin/leads?focus=${encodeURIComponent(id)}`;
    } else if (item.deeplink) {
      window.location.href = item.deeplink;
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <AdminNav active="now" onLogout={logout} onRefresh={refresh} />

      {/* Top — Jarvis + Greeting + clock */}
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <h1 className="text-xl font-bold">{greetingFor(now)}, Mehyar.</h1>
            <p className="text-xs text-zinc-500">
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              {" · "}
              <span className="font-mono">{now.toLocaleTimeString()}</span>
              <Badge className={`ml-2 ${tone === "hot" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                {tone === "hot" ? "🔥 hot" : "😌 calm"}
              </Badge>
            </p>
          </div>
        </div>
        <JarvisBar token={token} placeholder="Try: 'count prospects last 7d', 'sql: select * from…', 'show today's stage changes'" />
      </div>

      {q.isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {[0,1,2,3,4,5,6,7].map((i) => <Card key={i} className="animate-pulse"><CardContent className="p-3 h-16" /></Card>)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[0,1,2].map((i) => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-64" /></Card>)}
          </div>
        </div>
      )}

      {q.isError && (
        <Card><CardContent className="py-8 text-sm text-red-700 flex items-center gap-2">
          ⚠ {String((q.error as Error)?.message || q.error)}
          <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
        </CardContent></Card>
      )}

      {q.data && (
        <>
          <KpiStrip counts={counts} />
          <AiInsightPanel data={q.data} token={token} />

          {/* Three column triage */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
            <Column title="🔥 Now"    sub="< 48h or urgent"  items={buckets.now || []}   accent="red"  onClick={handleClick} />
            <Column title="📅 Today"  sub="Outreach scheduled, drafts pending" items={buckets.today || []} accent="amber" onClick={handleClick} />
            <Column title="🌤 Week"   sub="Coming up"  items={buckets.week || []}  accent="sky"  onClick={handleClick} />
          </div>

          <OpsFooter data={q.data} token={token} />
        </>
      )}
    </div>
  );
}

// ── AI insight panel — what should I do first today ───────────────────
function AiInsightPanel({ data, token }: { data: any; token: string }) {
  const [busy, setBusy] = useState(false);
  const [insight, setInsight] = useState<{ text: string; actions: { label: string; href: string }[] } | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/now/insight", { headers: { authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (j.ok) setInsight({ text: j.text, actions: j.actions || [] });
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); }, []);

  if (busy && !insight) {
    return (
      <Card className="mt-4 border-violet-200 bg-gradient-to-r from-violet-50/50 via-white to-cyan-50/50">
        <CardContent className="p-4 animate-pulse">
          <div className="h-4 bg-violet-100 rounded w-1/3 mb-2" />
          <div className="h-3 bg-zinc-100 rounded w-full mb-1" />
          <div className="h-3 bg-zinc-100 rounded w-2/3" />
        </CardContent>
      </Card>
    );
  }
  if (!insight) return null;
  return (
    <Card className="mt-4 border-violet-300 bg-gradient-to-r from-violet-50/40 via-white to-cyan-50/40">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-500" />
            🧠 AI insight — what to do first today
          </h3>
          <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Refresh
          </Button>
        </div>
        <p className="text-sm leading-relaxed text-zinc-700 whitespace-pre-line">{insight.text}</p>
        {insight.actions?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-violet-200">
            {insight.actions.map((a, i) => (
              <a key={i} href={a.href} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition">
                {a.label} →
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function greetingFor(d: Date) {
  const h = d.getHours();
  if (h < 5) return "🌙 Late night";
  if (h < 12) return "☀️ Good morning";
  if (h < 17) return "🌤 Good afternoon";
  if (h < 22) return "🌇 Good evening";
  return "🌙 Good night";
}

function KpiStrip({ counts }: any) {
  const strip = [
    { key: "sam_active",       label: "🟢 SAM live",       val: counts.sam_active,         tone: counts.sam_active       ? "text-emerald-700" : "text-zinc-500" },
    { key: "sam_due_48h",      label: "🔥 Due ≤48h",       val: counts.sam_due_48h,        tone: counts.sam_due_48h      ? "text-red-700"    : "text-zinc-500" },
    { key: "prospects_live",   label: "🧲 Live prospects", val: counts.prospects_live,     tone: "text-indigo-700" },
    { key: "drafts_to_review", label: "📝 Drafts to review", val: counts.drafts_to_review, tone: counts.drafts_to_review ? "text-violet-700" : "text-zinc-500" },
    { key: "outreach_due",     label: "📤 Outreach due",   val: counts.outreach_due,       tone: "text-amber-700" },
    { key: "replies_24h",      label: "📬 Replies 24h",    val: counts.replies_24h,        tone: counts.replies_24h      ? "text-emerald-700" : "text-zinc-500" },
    { key: "won_30d",          label: "💰 Won 30d",        val: counts.won_30d,            tone: "text-green-700" },
    { key: "pipeline_value",   label: "💎 Pipeline $",     val: counts.pipeline_value,     tone: "text-cyan-700", prefix: "$" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
      {strip.map((s) => (
        <Card key={s.key} className="hover:border-zinc-300 transition">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 leading-tight">{s.label}</div>
            <div className={`text-xl font-bold mt-1 leading-tight tabular-nums ${s.tone}`}>
              {s.prefix || ""}{(s.val ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Column({ title, sub, items, accent, onClick }: any) {
  const border = accent === "red" ? "border-red-300" : accent === "amber" ? "border-amber-300" : "border-sky-300";
  const titleIcon = accent === "red" ? "🔥" : accent === "amber" ? "📅" : "🌤";
  const titleLabel = title.replace(/^\S+\s/, "");

  return (
    <div>
      <div className={`rounded-t-xl border ${border} bg-gradient-to-b from-white px-4 py-3`}>
        <h3 className="font-bold flex items-center gap-2">
          <span>{titleIcon}</span>{titleLabel}
          <Badge className={`ml-2 ${accent === "red" ? "bg-red-100 text-red-800" : accent === "amber" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{items.length}</Badge>
        </h3>
        <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>
      </div>
      <div className="space-y-2 border-l border-r border-b border-zinc-200 rounded-b-xl bg-white p-2 min-h-[280px]">
        {items.length === 0 ? (
          <div className="text-center text-xs text-zinc-400 py-16">
            <CheckCircle2 className="inline w-6 h-6 mb-1 text-emerald-300" />
            <div>Inbox zero</div>
          </div>
        ) : items.map((it: any, i: number) => (
          <button key={i} onClick={() => onClick(it)}
            className="block w-full text-left rounded-lg border border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50 transition p-3 cursor-pointer">
            <NowItem item={it} />
          </button>
        ))}
      </div>
    </div>
  );
}

function NowItem({ item }: { item: any }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm leading-tight">{item.title}</span>
        {item.kind && <Badge className="text-[10px]">{item.kind === "sam" ? "🏛" : item.kind === "prospect" ? "🧲" : item.kind === "outreach" ? "📤" : item.kind === "auto_tender" ? "🪄" : item.kind === "reply" ? "📬" : item.kind}</Badge>}
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
        <div className="inline-flex items-center gap-1 text-xs text-blue-700 mt-1.5">
          Open <ChevronRight className="w-3 h-3" />
        </div>
      )}
    </>
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
      <Card className="hover:border-zinc-300 transition cursor-pointer" onClick={() => window.location.href = "/admin/system"}>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Hourglass className="w-3 h-3" />Cron</div>
          <div className="text-base font-bold mt-1">Last: <span className="font-mono">{lastCron?.triggered_at?.slice(11, 19) || "—"}</span> UTC</div>
          <div className="text-xs text-zinc-500">{lastCron?.status || "—"}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Brain className="w-3 h-3" />AI spend (today)</div>
          <div className="text-xl font-bold text-violet-700 tabular-nums">${aiSpend.toFixed(2)}</div>
          <div className="text-xs text-zinc-500 tabular-nums">{ops.llm_calls_today || 0} LLM calls</div>
        </CardContent>
      </Card>
      <Card className={errs > 0 ? "border-red-300" : ""}>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Bell className="w-3 h-3" />Errors 24h</div>
          <div className={`text-xl font-bold tabular-nums ${errs > 0 ? "text-red-700" : "text-emerald-700"}`}>{errs}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1"><Database className="w-3 h-3" />Last backup</div>
          <div className="text-base font-bold mt-1">{backups?.at?.slice(0, 10) || "—"}</div>
          <a href="/admin/system#backup" className="text-xs text-blue-700 hover:underline">Download latest →</a>
        </CardContent>
      </Card>
    </div>
  );
}
