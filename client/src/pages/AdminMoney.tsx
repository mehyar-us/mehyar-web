// @ts-nocheck
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Loader2, Sparkles, DollarSign, TrendingUp, Trophy, FileText, Save,
  RefreshCw, Brain, ChevronDown, ChevronRight, ArrowRight, Plus, Trash2,
  Mail, Send, X,
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

  const [focusDraftId, setFocusDraftId] = useState<string | null>(null);

  // Handle /admin/money?focus=<draft_id> deep link
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const focus = url.searchParams.get("focus");
    if (focus) {
      setFocusDraftId(focus);
      url.searchParams.delete("focus");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <AdminNav active="money" onLogout={logout} onRefresh={refresh} />

      <div className="mb-5">
        <JarvisBar token={token} placeholder="Try: 'forecast for next 30 days', 'show closed-won this quarter'" />
      </div>

      {q.isLoading && (
        <div className="text-center py-20 text-zinc-500 dark:text-zinc-400"><Loader2 className="inline w-6 h-6 animate-spin mr-2" />Loading pipeline…</div>
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
          <OutreachQueue token={token} onOpenDraft={(id) => setFocusDraftId(id)} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <QuoteGenerator token={token} onCreated={(msg) => alert(msg)} />
            <ServiceCatalog token={token} />
          </div>
          <CaseStudies data={q.data.case_studies || []} token={token} onUpdate={refresh} />
        </>
      )}

      {focusDraftId && (
        <DraftDetailDrawer
          token={token}
          draftId={focusDraftId}
          onClose={() => setFocusDraftId(null)}
        />
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
    { label: "📊 Avg deal size",         val: kpis.avg_deal_size,       tone: "text-zinc-800 dark:text-zinc-200",     prefix: "$" },
    { label: "🚀 Activity → Win",       val: kpis.activity_to_win,     tone: "text-violet-700",   suffix: "%" },
    { label: "🧠 AI suggestions today", val: kpis.ai_suggestions_today, tone: "text-blue-700" },
    { label: "🩸 Outbound failures 24h", val: kpis.outreach_failures_24h, tone: "text-red-700" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
      {cells.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 leading-tight">{c.label}</div>
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
                <span className="w-24 capitalize text-zinc-700 dark:text-zinc-300">{s.stage}</span>
                <div className="flex-1 h-7 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden relative">
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500 to-cyan-500" style={{ width: `${pct}%` }} />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    {s.count} · ${(Number(s.value_usd_total) || 0).toLocaleString()}
                    <span className="ml-auto pr-2 text-xs text-zinc-700 dark:text-zinc-300">avg ${Math.round(Number(s.avg_value_usd) || 0).toLocaleString()}</span>
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
        {!deals?.length ? <div className="text-sm text-zinc-500 dark:text-zinc-400">No open deals yet.</div> : (
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
                className="rounded border border-zinc-200 dark:border-zinc-700 p-2 text-sm hover:bg-emerald-50 cursor-pointer transition"
              >
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] ${STAGE_BADGE[d.stage] || "bg-zinc-100 dark:bg-zinc-800"}`}>{d.stage}</Badge>
                  <span className="font-medium truncate flex-1">{d.title}</span>
                  <span className="text-xs font-mono text-emerald-700">${(d.estimated_value_usd || 0).toLocaleString()}</span>
                </div>
                {d.subtitle && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{d.subtitle}</div>}
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">💡 Double-click any deal to mark Won (auto-drafts a case study + post-mortem).</div>
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
            <li key={d.id} className="rounded border border-zinc-200 dark:border-zinc-700 p-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-[10px] ${STAGE_BADGE[d.stage] || "bg-zinc-100 dark:bg-zinc-800"}`}>
                  {d.stage === "won" ? "🏆 won" : d.stage === "lost" ? "😤 lost" : d.stage}
                </Badge>
                <span className="font-medium truncate flex-1">{d.title}</span>
                <span className="text-xs font-mono">${(d.value_usd || 0).toLocaleString()}</span>
              </div>
              {d.decision_at && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{new Date(d.decision_at).toLocaleDateString()}</div>}
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
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Client name *</label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Acme Corp" />
              </div>
              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Client email</label>
                <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="billing@acme.com" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Address (optional)</label>
                <Input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="123 Main St, City" />
              </div>
              <div>
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Payment due (days)</label>
                <Input type="number" value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Line items</label>
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
                <span className="text-zinc-500 dark:text-zinc-400">Subtotal:</span>{" "}
                <span className="font-bold text-emerald-700">${subtotal.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button onClick={submit} disabled={busy} variant="cta">
                {busy ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Generating…</> : <><FileText className="w-3 h-3 mr-1" /> Generate quote PDF & link</>}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
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
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">Click any row to copy a ready-to-paste quote block.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                navigator.clipboard.writeText(`${s.name}\n${s.desc}\nPrice: ${s.price}\nTimeline: ${s.time}`);
                alert(`Copied: ${s.name}`);
              }}
              className="text-left rounded border border-zinc-200 dark:border-zinc-700 hover:border-violet-400 hover:bg-violet-50/30 transition p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{s.name}</span>
                <span className="font-mono text-emerald-700 text-xs">{s.price}</span>
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{s.desc}</div>
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
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Mark a deal Won and the AI will draft a public case study for SEO.</div>
        ) : (
          <ul className="space-y-1">
            {data.map((cs: any) => (
              <li key={cs.id} className="border rounded p-2 flex items-start gap-2">
                <div className="flex-1">
                  <div className="font-medium">{cs.title}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">/{cs.slug} · {cs.published ? "🟢 published" : "🟡 draft"}</div>
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

// ── Outreach queue — list of generated drafts awaiting approval ───────
function OutreachQueue({ token, onOpenDraft }: { token: string; onOpenDraft: (id: string) => void }) {
  const qc = useQueryClient();
  const drafts = useQuery({
    queryKey: ["admin-outreach-queue", token],
    queryFn: async () => {
      const r = await fetch("/api/admin/outreach/send-due", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const [sending, setSending] = useState(false);

  // Also load recent drafts for context
  const recentDrafts = useQuery({
    queryKey: ["admin-recent-drafts", token],
    queryFn: async () => {
      // Reuse /api/admin/leads with kind=prospect and a draft filter? No — that doesn't exist.
      // Instead, list via D1 from a different endpoint. For now, derive from send-due.
      return { items: [] };
    },
    enabled: false,
  });

  return (
    <Card className="mt-6">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Send className="w-4 h-4" /> Outreach queue
          </h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={sending}
              onClick={async () => {
                setSending(true);
                try {
                  await fetch("/api/admin/outreach/send-due", {
                    method: "POST",
                    headers: { authorization: `Bearer ${token}` },
                  });
                  qc.invalidateQueries({ queryKey: ["admin-outreach-queue"] });
                } finally { setSending(false); }
              }}
            >
              {sending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Run send-due
            </Button>
          </div>
        </div>

        {drafts.isLoading && <div className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center"><Loader2 className="inline w-4 h-4 animate-spin mr-1" />Loading queue…</div>}
        {drafts.error && <div className="text-sm text-red-700">⚠ {String((drafts.error as Error)?.message || drafts.error)}</div>}

        {drafts.data && (
          <>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              <strong className="font-mono text-zinc-900 dark:text-zinc-100">{drafts.data.send_due_count ?? 0}</strong> outreach step{(drafts.data.send_due_count ?? 0) === 1 ? "" : "s"} queued
              · next send window: {drafts.data.next_window_at || "—"}
            </div>

            {Array.isArray(drafts.data.items) && drafts.data.items.length > 0 ? (
              <div className="space-y-1.5">
                {drafts.data.items.slice(0, 20).map((it: any, i: number) => (
                  <div key={`${it.prospect_id}-${it.step_order}-${i}`} className="border border-zinc-200 rounded-lg p-2.5 bg-white dark:bg-zinc-900 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.business_name}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {it.source_name || it.source_key} · step {it.step_order}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500 dark:text-zinc-400 py-4 text-center">
                No outreach steps ready to send.{" "}
                <span className="text-zinc-400">Generate a draft from CRM → Deep eval → click a pricing tier.</span>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                💡 <strong>Tip:</strong> When you click a pricing tier in a lead drawer, a draft is generated and deeplinks here. Tap a draft below to view/edit before approving.
              </div>
              <RecentDraftsList token={token} onOpen={onOpenDraft} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Recent drafts list — shows prospect_drafts awaiting review ─────────
// Uses the same prospect_drafts table directly via a small proxy endpoint.
function RecentDraftsList({ token, onOpen }: { token: string; onOpen: (id: string) => void }) {
  const drafts = useQuery({
    queryKey: ["admin-recent-drafts-v2", token],
    queryFn: async () => {
      // Use /api/admin/jarvis sql to fetch safely
      const r = await fetch("/api/admin/jarvis", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ question: "sql: SELECT id, subject, status, prospect_id, sam_id, created_at FROM prospect_drafts ORDER BY created_at DESC LIMIT 10" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return Array.isArray(j.rows) ? j.rows : [];
    },
    refetchInterval: 30_000,
  });

  if (drafts.isLoading) return <div className="text-xs text-zinc-400 py-2">Loading drafts…</div>;
  if (!drafts.data || drafts.data.length === 0) {
    return <div className="text-xs text-zinc-400 py-2">No drafts yet — click a pricing tier in CRM to generate one.</div>;
  }

  return (
    <div className="space-y-1">
      {drafts.data.map((d: any) => (
        <button
          key={d.id}
          onClick={() => onOpen(d.id)}
          className="w-full text-left rounded border border-zinc-200 bg-white dark:bg-zinc-900 hover:border-emerald-400 hover:bg-emerald-50/30 transition p-2 flex items-center gap-2"
        >
          <Mail className="w-3.5 h-3.5 text-violet-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{d.subject}</div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">{d.id.slice(0, 8)} · {d.status} · {new Date(d.created_at).toLocaleDateString()}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
        </button>
      ))}
    </div>
  );
}

// ── Draft detail drawer — opens when ?focus=<draft_id> ────────────────
function DraftDetailDrawer({ token, draftId, onClose }: { token: string; draftId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-draft-detail", token, draftId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/prospects/drafts/${encodeURIComponent(draftId)}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const data = q.data;
  const draft = data?.draft;
  const prospect = data?.prospect;
  const sam = data?.sam_opportunity;
  const send = data?.queued_send;

  const [editingBody, setEditingBody] = useState(false);
  const [body, setBody] = useState("");
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    if (draft?.body_text && !editingBody) setBody(draft.body_text);
  }, [draft?.body_text, editingBody]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const approve = async () => {
    setApproving(true);
    try {
      // Save any in-progress body edits
      if (editingBody && body !== draft?.body_text) {
        await fetch(`/api/admin/prospects/drafts/${encodeURIComponent(draftId)}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ body_text: body }),
        }).catch(() => null);
      }
      // Mark approved — there isn't a dedicated approve endpoint, but draft_from_eval creates prospect_sends on contact_email.
      // For now: update draft status to 'approved' via a simple update.
      await fetch(`/api/admin/prospects/drafts/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }).catch(() => null);
      qc.invalidateQueries({ queryKey: ["admin-draft-detail", token, draftId] });
      qc.invalidateQueries({ queryKey: ["admin-recent-drafts-v2", token] });
      onClose();
    } finally { setApproving(false); }
  };

  return (
    createPortal(
      <>
        <div className="fixed inset-0 bg-black/40 z-40 animate-fade-in" onClick={onClose} />
        <aside className="fixed z-50 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col
                          inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl
                          md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:max-h-none md:w-[720px] md:rounded-none md:rounded-l-2xl
                          animate-slide-up md:animate-slide-in">
          <div className="md:hidden pt-2 pb-1 flex justify-center" onClick={onClose}>
            <div className="w-10 h-1.5 rounded-full bg-zinc-300" />
          </div>
          <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 z-10 px-4 py-3 md:px-5 flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Mail className="w-5 h-5 text-violet-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-base leading-tight text-zinc-900 dark:text-zinc-100 break-words line-clamp-2">
                  {q.isLoading ? "Loading draft…" : draft?.subject || "(no subject)"}
                </h2>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {prospect?.business_name || sam?.title || "—"} · {draft?.status || "—"}
                </div>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close draft" className="rounded-full p-2 hover:bg-zinc-100 text-zinc-700 dark:text-zinc-300 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-5 bg-white text-zinc-900 dark:text-zinc-100" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
            {q.isLoading && (
              <div className="space-y-2">
                {[0,1,2].map((i) => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-16" /></Card>)}
              </div>
            )}
            {q.error && <div className="text-sm text-red-700">⚠ {String((q.error as Error)?.message)}</div>}
            {q.data && !draft && <div className="text-sm text-zinc-500 dark:text-zinc-400">Draft not found: <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{draftId}</code></div>}

            {draft && (
              <div className="space-y-4">
                {/* Header card */}
                <Card><CardContent className="p-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div><span className="text-zinc-500 dark:text-zinc-400">Source:</span> <strong>{data.kind === "sam" ? "🏛 SAM" : "🧲 Prospect"}</strong></div>
                    <div><span className="text-zinc-500 dark:text-zinc-400">Model:</span> <code className="text-[11px] bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{draft.model || "?"}</code></div>
                    <div><span className="text-zinc-500 dark:text-zinc-400">Created:</span> {new Date(draft.created_at).toLocaleString()}</div>
                    <div className="col-span-2 md:col-span-3">
                      <span className="text-zinc-500 dark:text-zinc-400">Subject:</span>{" "}
                      <strong className="break-words">{draft.subject}</strong>
                    </div>
                    {send && (
                      <>
                        <div><span className="text-zinc-500 dark:text-zinc-400">To:</span> <strong>{send.to_email}</strong></div>
                        <div><span className="text-zinc-500 dark:text-zinc-400">Status:</span> <Badge className="bg-zinc-100 text-zinc-800 dark:text-zinc-200">{send.status}</Badge></div>
                        <div><span className="text-zinc-500 dark:text-zinc-400">Scheduled:</span> {send.scheduled_for || "—"}</div>
                      </>
                    )}
                  </div>
                </CardContent></Card>

                {/* Body — editable */}
                <Card><CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-sm">📝 Body</h4>
                    <Button size="sm" variant="ghost" onClick={() => setEditingBody((e) => !e)}>
                      {editingBody ? "👁 Preview" : "✏️ Edit"}
                    </Button>
                  </div>
                  {editingBody ? (
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="w-full border border-zinc-200 dark:border-zinc-700 rounded p-2 text-sm font-mono min-h-[300px] focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{draft.body_text}</pre>
                  )}
                </CardContent></Card>

                {/* LLM context */}
                {draft.payload && (
                  <Card><CardContent className="p-4">
                    <h4 className="font-semibold text-sm mb-2">🧠 LLM context</h4>
                    <pre className="text-[11px] text-zinc-600 dark:text-zinc-400 overflow-auto max-h-40 bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded">{JSON.stringify(draft.payload, null, 2)}</pre>
                  </CardContent></Card>
                )}

                {/* Reviewer notes */}
                {draft.reviewer_notes && (
                  <Card><CardContent className="p-4">
                    <h4 className="font-semibold text-sm mb-2">📝 Reviewer notes</h4>
                    <p className="text-sm">{draft.reviewer_notes}</p>
                  </CardContent></Card>
                )}

                {/* Actions */}
                <div className="flex gap-2 sticky bottom-0 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700 -mx-4 -mb-4 p-3 md:-mx-5 md:-mb-5 md:p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
                  <Button
                    variant="cta"
                    onClick={approve}
                    disabled={approving}
                    className="flex-1 min-h-[44px]"
                  >
                    {approving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
                    {draft.status === "approved" ? "Approved ✓" : "Approve & queue send"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onClose}
                    className="min-h-[44px]"
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </>,
      document.body
    )
  );
}
