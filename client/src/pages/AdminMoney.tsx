// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Sparkles, DollarSign, TrendingUp, Trophy, FileText, Save,
  RefreshCw, Brain, ChevronDown, ChevronRight, ArrowRight, Plus, Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { AdminNav, JarvisBar, AdminGate, useAdminSession, STAGE_BADGE } from "./AdminShell";

const STAGES = ["discovery","evaluating","drafting","ready","queued","sent","replied"];
const CLOSED = ["won","lost","no_bid","on_hold","archived"];

async function fetchPipeline(token: string) {
  const r = await fetch("/api/admin/money", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function AdminMoney() {
  return <AdminGate>{(token) => <MoneyView token={token} />}</AdminGate>;
}

function MoneyView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-money", token], queryFn: () => fetchPipeline(token) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-money"] });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav active="money" onLogout={logout} onRefresh={refresh} />

      <div className="mb-5">
        <JarvisBar token={token} placeholder="Try: 'forecast for next 30 days', 'show closed-won this quarter'" />
      </div>

      {q.isLoading && (
        <div className="text-center py-20 text-zinc-500"><Loader2 className="inline w-6 h-6 animate-spin mr-2" />Loading pipeline…</div>
      )}

      {q.isError && (
        <Card><CardContent className="py-8 text-sm text-red-700">⚠ {String((q.error as Error)?.message || q.error)}</CardContent></Card>
      )}

      {q.data && (
        <>
          <ForecastStrip kpis={q.data.kpis || {}} />
          <Funnel data={q.data.funnel || []} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
            <ActiveDealsBoard deals={q.data.open || []} token={token} onUpdate={refresh} />
            <RecentOutcomes deals={(q.data.recent_won || []).concat(q.data.recent_lost || []).slice(0, 8)} token={token} onUpdate={refresh} />
          </div>
          <CaseStudies data={q.data.case_studies || []} token={token} onUpdate={refresh} />
        </>
      )}
    </div>
  );
}

// ── KPI strip ───────────────────────────────────────────────────────────
function ForecastStrip({ kpis }: any) {
  const cells = [
    { label: "💎 Pipeline $",           val: kpis.pipeline_value,      tone: "text-cyan-700",     prefix: "$" },
    { label: "🔥 Weighted forecast",     val: kpis.weighted_forecast,   tone: "text-orange-700",   prefix: "$" },
    { label: "🏆 Won (last 30d)",        val: kpis.won_value_30d,       tone: "text-emerald-700",  prefix: "$" },
    { label: "📈 Win rate (last 30d)",   val: kpis.win_rate_30d,        tone: "text-emerald-700",  suffix: "%" },
    { label: "📊 Avg deal size",         val: kpis.avg_deal_size,       tone: "text-zinc-800",     prefix: "$" },
    { label: "🚀 Activity → Win",       val: kpis.activity_to_win,     tone: "text-violet-700",   suffix: "%" },
    { label: "🧠 AI suggestions today", val: kpis.ai_suggestions_today, tone: "text-blue-700" },
    { label: "🩸 Outbound failures 24h", val: kpis.outreach_failures_24h, tone: "text-red-700" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
      {cells.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 leading-tight">{c.label}</div>
            <div className={`text-xl font-bold mt-1 leading-tight ${c.tone}`}>{c.prefix || ""}{(c.val ?? 0).toLocaleString()}{c.suffix || ""}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Funnel ─────────────────────────────────────────────────────────────
function Funnel({ data }: any) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((s: any) => Number(s.value_usd_total) || 0), 1);
  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4" /> Pipeline funnel — value by stage</h3>
        <div className="space-y-2">
          {data.map((s: any) => {
            const pct = Math.max(8, ((Number(s.value_usd_total) || 0) / max) * 100);
            return (
              <div key={s.stage} className="flex items-center gap-2 text-sm">
                <span className="w-24 capitalize text-zinc-700">{s.stage}</span>
                <div className="flex-1 h-7 bg-zinc-100 rounded overflow-hidden relative">
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500 to-cyan-500" style={{ width: `${pct}%` }} />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-medium text-zinc-900">
                    {s.count} · ${(Number(s.value_usd_total) || 0).toLocaleString()}
                    <span className="ml-auto pr-2 text-xs text-zinc-700">avg ${Math.round(Number(s.avg_value_usd) || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Active deals board ─────────────────────────────────────────────────
function ActiveDealsBoard({ deals, token, onUpdate }: any) {
  const [drag, setDrag] = useState<string|null>(null);
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-semibold mb-2">🔥 Open deals</h3>
        {!deals?.length ? <div className="text-sm text-zinc-500">No open deals yet.</div> : (
          <div className="space-y-1">
            {deals.slice(0, 12).map((d: any) => (
              <div key={d.id}
                draggable
                onDragStart={() => setDrag(d.id)}
                onDragEnd={(e) => { if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; setDrag(null); }}
                onDoubleClick={async () => {
                  await fetch(`/api/admin/opportunities/${encodeURIComponent(d.id)}/decision?kind=${d.kind}`, {
                    method: "POST",
                    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                    body: JSON.stringify({ outcome: "won", value_usd: d.estimated_value_usd || 5000 }),
                  });
                  onUpdate();
                }}
                title="Double-click to mark Won"
                className="rounded border border-zinc-200 p-2 text-sm hover:bg-emerald-50 cursor-pointer transition"
              >
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] ${STAGE_BADGE[d.stage] || "bg-zinc-100"}`}>{d.stage}</Badge>
                  <span className="font-medium truncate flex-1">{d.title}</span>
                  <span className="text-xs font-mono text-emerald-700">${(d.estimated_value_usd || 0).toLocaleString()}</span>
                </div>
                {d.subtitle && <div className="text-xs text-zinc-500 mt-0.5 truncate">{d.subtitle}</div>}
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-zinc-500 mt-2">💡 Double-click any deal to mark Won (auto-drafts a case study + post-mortem).</div>
      </CardContent>
    </Card>
  );
}

// ── Recent outcomes ────────────────────────────────────────────────────
function RecentOutcomes({ deals, token, onUpdate }: any) {
  if (!deals?.length) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Trophy className="w-4 h-4" /> Recent outcomes</h3>
        <ul className="space-y-1.5 text-sm">
          {deals.map((d: any) => (
            <li key={d.id} className="rounded border border-zinc-200 p-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-[10px] ${STAGE_BADGE[d.stage] || "bg-zinc-100"}`}>
                  {d.stage === "won" ? "🏆 won" : d.stage === "lost" ? "😤 lost" : d.stage}
                </Badge>
                <span className="font-medium truncate flex-1">{d.title}</span>
                <span className="text-xs font-mono">${(d.value_usd || 0).toLocaleString()}</span>
              </div>
              {d.decision_at && <div className="text-xs text-zinc-500 mt-0.5">{new Date(d.decision_at).toLocaleDateString()}</div>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Case studies ───────────────────────────────────────────────────────
function CaseStudies({ data, token, onUpdate }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const generate = async (oppId: string) => {
    setBusy(oppId);
    try {
      await fetch(`/api/admin/case-studies/from-opportunity`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ opportunity_id: oppId }),
      });
      onUpdate();
    } finally { setBusy(null); }
  };
  return (
    <Card className="mt-6">
      <CardContent className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><FileText className="w-4 h-4" /> Case studies</h3>
        {data.length === 0 ? (
          <div className="text-sm text-zinc-500">Mark a deal Won and the AI will draft a public case study for SEO.</div>
        ) : (
          <ul className="space-y-1">
            {data.map((cs: any) => (
              <li key={cs.id} className="border rounded p-2 flex items-start gap-2">
                <div className="flex-1">
                  <div className="font-medium">{cs.title}</div>
                  <div className="text-xs text-zinc-500">/{cs.slug} · {cs.published ? "🟢 published" : "🟡 draft"}</div>
                </div>
                <a href={`/case-studies/${cs.slug}`} className="text-blue-700 text-xs underline">view →</a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
