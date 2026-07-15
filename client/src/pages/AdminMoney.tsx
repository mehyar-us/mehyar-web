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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <QuoteGenerator token={token} onCreated={(msg) => alert(msg)} />
            <ServiceCatalog token={token} />
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

// ── Quote / Invoice generator ──────────────────────────────────────────
function QuoteGenerator({ token, onCreated }: { token: string; onCreated: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [services, setServices] = useState<{ name: string; desc: string; qty: number; price: number }[]>([
    { name: "AI Workflow Audit", desc: "1-week discovery + recommendation report", qty: 1, price: 2500 },
  ]);
  const [dueDays, setDueDays] = useState(15);
  const [busy, setBusy] = useState(false);

  const add = () => setServices((s) => [...s, { name: "", desc: "", qty: 1, price: 0 }]);
  const remove = (i: number) => setServices((s) => s.filter((_, j) => j !== i));
  const update = (i: number, field: string, val: any) =>
    setServices((s) => s.map((row, j) => (j === i ? { ...row, [field]: val } : row)));

  const subtotal = services.reduce((acc, s) => acc + s.qty * s.price, 0);

  const submit = async () => {
    if (!clientName.trim()) { onCreated("Client name required"); return; }
    if (services.length === 0 || services.every((s) => !s.name.trim())) {
      onCreated("Add at least one line item"); return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/quotes/generate", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          client_email: clientEmail,
          client_address: clientAddress,
          items: services.filter((s) => s.name.trim()),
          due_days: dueDays,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        onCreated(`Quote #${j.quote_number} generated`);
        setOpen(false);
        // Reset
        setClientName(""); setClientEmail(""); setClientAddress("");
        setServices([{ name: "AI Workflow Audit", desc: "1-week discovery + recommendation report", qty: 1, price: 2500 }]);
        if (j.view_url) window.open(j.view_url, "_blank");
      } else {
        onCreated(`Failed: ${j.error}`);
      }
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> 💸 Generate quote / invoice</h3>
          <Button size="sm" variant="cta" onClick={() => setOpen(!open)}>
            {open ? "Cancel" : "+ New quote"}
          </Button>
        </div>
        {open && (
          <div className="space-y-3 mt-3 pt-3 border-t">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-zinc-500">Client name *</label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Acme Corp" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Client email</label>
                <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="billing@acme.com" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-zinc-500">Address (optional)</label>
                <Input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="123 Main St, City" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Payment due (days)</label>
                <Input type="number" value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-zinc-500">Line items</label>
                <Button size="sm" variant="outline" onClick={add}>+ Add item</Button>
              </div>
              <div className="space-y-2">
                {services.map((s, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                    <Input className="col-span-4" placeholder="Service name" value={s.name} onChange={(e) => update(i, "name", e.target.value)} />
                    <Input className="col-span-4" placeholder="Description" value={s.desc} onChange={(e) => update(i, "desc", e.target.value)} />
                    <Input className="col-span-1" type="number" placeholder="qty" value={s.qty} onChange={(e) => update(i, "qty", Number(e.target.value))} />
                    <Input className="col-span-2" type="number" placeholder="price" value={s.price} onChange={(e) => update(i, "price", Number(e.target.value))} />
                    <Button size="sm" variant="ghost" className="col-span-1" onClick={() => remove(i)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                ))}
              </div>
              <div className="text-right mt-2 text-sm">
                <span className="text-zinc-500">Subtotal:</span>{" "}
                <span className="font-bold text-emerald-700">${subtotal.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button onClick={submit} disabled={busy} variant="cta">
                {busy ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Generating…</> : <><FileText className="w-3 h-3 mr-1" /> Generate quote PDF & link</>}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-zinc-500">
              💡 Quote generates a hosted public URL you can send to the client. Set status=invoice later when payment is received.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Service catalog (template rows for quotes) ─────────────────────────
function ServiceCatalog({ token }: { token: string }) {
  const SAMPLES = [
    { name: "AI Workflow Audit", price: "$2,500", desc: "1-week discovery, 1-page plan", time: "5-7 days" },
    { name: "MVP Sprint (4 weeks)", price: "$8,000-12,000", desc: "Web app + auth + AI", time: "4 weeks" },
    { name: "Cloudflare migration", price: "$3,500-6,000", desc: "Move from AWS/GCP to CF Pages", time: "1-2 weeks" },
    { name: "AI Receptionist", price: "$1,200 setup + $99/mo", desc: "Missed-call text-back bot", time: "3 days" },
    { name: "SEO + blog engine", price: "$4,500", desc: "30 articles + meta + JSON-LD", time: "2 weeks" },
    { name: "Government proposal draft", price: "$1,500", desc: "SAM.gov RFI/RFQ response", time: "5 days" },
    { name: "Lead-nurture automation", price: "$2,200", desc: "5-step email/SMS drip", time: "1 week" },
    { name: "Fractional CTO", price: "$2,500/mo", desc: "2 calls/wk + async Slack", time: "monthly" },
  ];
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4" /> 🧾 MehyarSoft service catalog</h3>
        <p className="text-xs text-zinc-500 mb-3">Click any row to copy a ready-to-paste quote block.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                navigator.clipboard.writeText(`${s.name}\n${s.desc}\nPrice: ${s.price}\nTimeline: ${s.time}`);
                alert(`Copied: ${s.name}`);
              }}
              className="text-left rounded border border-zinc-200 hover:border-violet-400 hover:bg-violet-50/30 transition p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{s.name}</span>
                <span className="font-mono text-emerald-700 text-xs">{s.price}</span>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{s.desc}</div>
              <div className="text-[10px] text-zinc-400 mt-1">⏱ {s.time}</div>
            </button>
          ))}
        </div>
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
