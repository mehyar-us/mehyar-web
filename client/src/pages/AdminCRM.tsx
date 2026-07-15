// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Sparkles, Filter, Search, ChevronDown, ChevronRight,
  Briefcase, Globe, Send, Phone, Mail, Calendar, RefreshCw, Tag,
  Save, ArrowRight, X, Plus, Layers, Brain, CheckCircle2, Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AdminNav, JarvisBar, AdminGate, useAdminSession, STAGE_BADGE, ScoreBar } from "./AdminShell";

async function fetchCRM(token: string, params: string) {
  const r = await fetch(`/api/admin/leads?${params}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function fetchDetail(token: string, kind: string, id: string) {
  const r = await fetch(`/api/admin/leads/${encodeURIComponent(id)}?kind=${kind}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function AdminCRM() {
  return <AdminGate>{(token) => <CrmView token={token} />}</AdminGate>;
}

function CrmView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all"|"prospect"|"sam">("all");
  const [stage, setStage] = useState<string>("");
  const [sort, setSort] = useState<"deadline_asc"|"leak_desc"|"fit_desc"|"created_desc">("created_desc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [deepEval, setDeepEval] = useState<{ [id: string]: any }>({});

  const params = new URLSearchParams({ q, kind, stage, sort });
  const leadQ = useQuery({ queryKey: ["admin-crm", token, params.toString()], queryFn: () => fetchCRM(token, params.toString()) });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-crm"] });

  const filtered = (leadQ.data?.items || []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav active="crm" onLogout={logout} onRefresh={refresh} />

      <div className="mb-5">
        <JarvisBar token={token} placeholder="Try: 'count by stage', 'promote all leak>70', 'enrich a0daf6…'" />
      </div>

      {/* Filters row */}
      <Card className="mb-4">
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-zinc-400" />
            <Input
              placeholder="Filter by name, domain, agency, city…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border-0 focus-visible:ring-0 px-1 text-sm"
            />
          </div>
          <div className="flex gap-1">
            {(["all","prospect","sam"] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`px-2.5 py-1 text-xs rounded-full ${kind === k ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>
                {k === "all" ? "All" : k === "sam" ? "🏛 SAM.gov" : "🧲 Prospects"}
              </button>
            ))}
          </div>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="text-xs border rounded px-2 py-1.5 bg-white">
            <option value="">All stages</option>
            {["new","scanned","draft_needed","drafting","ready","queued","sent","replied","won","lost","archived"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="text-xs border rounded px-2 py-1.5 bg-white">
            <option value="deadline_asc">⏰ Deadline (soonest)</option>
            <option value="leak_desc">🩸 Leak score (high→low)</option>
            <option value="fit_desc">🎯 Fit score (high→low)</option>
            <option value="created_desc">🕒 Newest first</option>
          </select>

          <BulkActions token={token} ids={filtered.map((x:any) => x.id)} kind={kind} onDone={refresh} />

          <div className="text-xs text-zinc-500 ml-auto">{filtered.length} leads</div>
        </CardContent>
      </Card>

      {leadQ.isLoading && (
        <div className="text-center py-20 text-zinc-500"><Loader2 className="inline w-6 h-6 animate-spin mr-2" />Loading CRM…</div>
      )}

      {leadQ.isError && (
        <Card><CardContent className="py-8 text-sm text-red-700">⚠ {String((leadQ.error as Error)?.message || leadQ.error)}</CardContent></Card>
      )}

      {leadQ.data && filtered.length === 0 && (
        <Card><CardContent className="py-12 text-center text-sm text-zinc-500">
          <Sparkles className="inline w-8 h-8 mb-2 text-zinc-300" />
          <div>No leads match these filters.</div>
          <div className="text-xs text-zinc-400">Try clearing the search box or switching kind to "All".</div>
        </CardContent></Card>
      )}

      {leadQ.data && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((it: any) => (
            <LeadRow
              key={`${it.kind}:${it.id}`}
              row={it}
              token={token}
              isOpen={openId === it.id}
              onToggle={() => setOpenId(openId === it.id ? null : it.id)}
              deepEval={deepEval[it.id]}
              setDeepEval={(d) => setDeepEval((s) => ({ ...s, [it.id]: d }))}
              onRefresh={() => { leadQ.refetch(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk actions toolbar ────────────────────────────────────────────────
function BulkActions({ token, ids, kind, onDone }: { token: string; ids: string[]; kind: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async (action: string) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/leads/bulk", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: kind === "all" ? "any" : kind, ids, action }),
      });
      await r.json();
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" disabled={!ids.length || busy} onClick={() => submit("stage:queued")}><Send className="w-3 h-3 mr-1" />Queue</Button>
      <Button size="sm" variant="outline" disabled={!ids.length || busy} onClick={() => submit("stage:archived")}><X className="w-3 h-3 mr-1" />Archive</Button>
      <Button size="sm" variant="cta" disabled={!ids.length || busy} onClick={() => submit("deep_evaluate")}><Sparkles className="w-3 h-3 mr-1" />Deep eval {ids.length ? `(${ids.length})` : ""}</Button>
    </div>
  );
}

// ── Single row ──────────────────────────────────────────────────────────
function LeadRow({ row, token, isOpen, onToggle, deepEval, setDeepEval, onRefresh }: any) {
  return (
    <Card className={row.leak_score >= 70 ? "border-red-300" : row.fit_score >= 60 ? "border-emerald-300" : ""}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <button onClick={onToggle} className="text-zinc-400 hover:text-zinc-700 mt-1">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          <div className="flex-1 min-w-[260px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base">{row.kind === "sam" ? "🏛" : "🧲"}</span>
              <h3 className="font-semibold leading-tight">{row.title}</h3>
              <Badge className={`text-[10px] ${STAGE_BADGE[row.stage] || "bg-zinc-100 text-zinc-700"}`}>{row.stage}</Badge>
              <Badge className="text-[10px] bg-zinc-100 text-zinc-700">{row.kind}</Badge>
              {typeof row.leak_score === "number" && <ScoreBar score={row.leak_score} label="leak" tone="leak" />}
              {typeof row.fit_score === "number" && <ScoreBar score={row.fit_score} label="fit" />}
              {row.deadline_in_days != null && row.kind === "sam" && (
                <span className={`text-xs font-mono ${row.deadline_in_days <= 2 ? "text-red-700" : "text-zinc-500"}`}>
                  {row.deadline_in_days <= 0 ? "OVERDUE" : `D-${row.deadline_in_days}`}
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {row.subtitle && <span>{row.subtitle}</span>}
              {row.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{row.email}</span>}
              {row.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{row.phone}</span>}
              {row.city && <span>· {row.city}</span>}
            </div>
            {row.ai_suggestion && (
              <div className="mt-2 text-xs bg-violet-50 border border-violet-100 rounded px-2 py-1.5 text-violet-800 inline-block">
                🧠 {row.ai_suggestion}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onToggle}>{isOpen ? "Close" : "Open"}</Button>
          </div>
        </div>

        {isOpen && <LeadDetail row={row} token={token} deepEval={deepEval} setDeepEval={setDeepEval} onRefresh={onRefresh} />}
      </CardContent>
    </Card>
  );
}

// ── Row detail (lazy-loaded) ────────────────────────────────────────────
function LeadDetail({ row, token, deepEval, setDeepEval, onRefresh }: any) {
  const q = useQuery({
    enabled: !!row.id && !!token,
    queryKey: ["admin-lead-detail", token, row.kind, row.id],
    queryFn: () => fetchDetail(token, row.kind, row.id),
  });

  const detail = q.data || {};
  const opp = detail.opportunity || {};

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4">
      {q.isLoading && <div className="text-sm text-zinc-500"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Loading…</div>}

      {detail.error && <div className="text-sm text-red-700">⚠ {detail.error}</div>}

      {opp.id && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 space-y-3">
            <StageMover row={row} token={token} onUpdate={onRefresh} />

            {/* Attachments / contacts / how-to-apply */}
            {row.kind === "sam" && opp.how_to_apply?.length > 0 && (
              <Card><CardContent className="p-4">
                <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><ArrowRight className="w-4 h-4" /> How to apply</h4>
                <ol className="space-y-1 text-sm">
                  {opp.how_to_apply.map((s: any, i: number) => (
                    <li key={i} className="flex gap-2"><span className="font-mono text-zinc-400 w-5">{s.step}.</span><span>{s.label}{s.url && <> · <a href={s.url} className="text-blue-700 underline" target="_blank" rel="noreferrer">open</a></>}{s.value && <span className="text-xs text-zinc-500"> — {String(s.value).slice(0, 100)}</span>}</span></li>
                  ))}
                </ol>
              </CardContent></Card>
            )}

            {row.kind === "sam" && opp.requirements?.length > 0 && (
              <Card><CardContent className="p-4">
                <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><ListIcon /> Requirements</h4>
                <ul className="space-y-1 text-sm">
                  {opp.requirements.map((r: any, i: number) => (
                    <li key={i}><Badge className="mr-1 bg-zinc-100 text-zinc-700">{r.label}</Badge>{String(r.value).slice(0, 160)}</li>
                  ))}
                </ul>
              </CardContent></Card>
            )}

            {row.kind === "sam" && opp.attachments?.length > 0 && (
              <Card><CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-2">📎 Attachments ({opp.attachments.length})</h4>
                <ul className="text-sm space-y-1">
                  {opp.attachments.map((a: any, i: number) => (
                    <li key={i}><a href={a.url} className="text-blue-700 underline" target="_blank" rel="noreferrer">{a.name}</a> {a.type && <span className="text-xs text-zinc-500">· {a.type}</span>}</li>
                  ))}
                </ul>
              </CardContent></Card>
            )}

            {/* LLM deep evaluation */}
            <DeepEval row={row} token={token} deepEval={deepEval} setDeepEval={setDeepEval} />
          </div>

          <div className="space-y-3">
            {row.kind === "sam" && opp.poc?.length > 0 && (
              <Card><CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-2">📇 Contacts</h4>
                <ul className="text-sm space-y-1">
                  {opp.poc.map((c: any, i: number) => (
                    <li key={i}>
                      <div className="font-medium">{c.name || "—"}</div>
                      {c.role && <div className="text-xs text-zinc-500">{c.role}</div>}
                      {c.email && <a href={`mailto:${c.email}`} className="text-blue-700 text-xs underline">{c.email}</a>}
                      {c.phone && <span className="text-xs text-zinc-600 ml-2">{c.phone}</span>}
                    </li>
                  ))}
                </ul>
              </CardContent></Card>
            )}

            {row.kind === "prospect" && opp.signals && (
              <Card><CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-2">🔎 Latest signals</h4>
                <div className="space-y-1 text-xs">
                  <div>SSL: {opp.signals.has_ssl ? "✅" : "❌"}</div>
                  <div>Booking CTA: {opp.signals.has_booking_cta ? "✅" : "❌"}</div>
                  <div>Click-to-call: {opp.signals.has_phone_click_to_call ? "✅" : "❌"}</div>
                  <div>Working form: {opp.signals.has_form_action ? "✅" : "❌"}</div>
                  <div>Email link: {opp.signals.has_email_link ? "✅" : "❌"}</div>
                  <div>Address: {opp.signals.has_address ? "✅" : "❌"}</div>
                  <div className="text-zinc-500 mt-1">Detected platform: <strong>{opp.signals.detected_platform || "?"}</strong></div>
                  <div className="text-zinc-500">HTTP {opp.signals.status_code} · {opp.signals.load_time_ms}ms · {opp.signals.page_weight_kb}KB</div>
                </div>
              </CardContent></Card>
            )}

            {/* Quick stage + decision */}
            {row.kind === "sam" && <WinLoseQuick row={row} token={token} onUpdate={onRefresh} />}

            {/* Outreach enqueue */}
            {row.kind === "prospect" && <OutreachEnqueue row={row} token={token} onRefresh={onRefresh} />}
          </div>
        </div>
      )}
    </div>
  );
}

function ListIcon() {
  return <Brain className="w-4 h-4" />;
}

// ── Stage mover ─────────────────────────────────────────────────────────
function StageMover({ row, token, onUpdate }: any) {
  const [busy, setBusy] = useState(false);
  const STAGES = ["discovery","evaluating","drafting","ready","queued","sent","replied","won","lost","archived"];
  const set = async (stage: string) => {
    setBusy(true);
    await fetch(`/api/admin/leads/${encodeURIComponent(row.id)}/stage?kind=${row.kind}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    setBusy(false);
    onUpdate();
  };
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">📊 Pipeline</h4>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button key={s}
            onClick={() => set(s)}
            disabled={busy || s === row.stage}
            className={`text-xs px-2 py-1 rounded-full transition ${
              s === row.stage
                ? "bg-zinc-900 text-white font-semibold ring-2 ring-emerald-400"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}>{s}{s === row.stage && <CheckCircle2 className="inline w-3 h-3 ml-1" />}</button>
        ))}
      </div>
    </CardContent></Card>
  );
}

// ── Quick win/lose ─────────────────────────────────────────────────────
function WinLoseQuick({ row, token, onUpdate }: any) {
  const [busy, setBusy] = useState(false);
  const decide = async (outcome: string) => {
    setBusy(true);
    await fetch(`/api/admin/opportunities/${encodeURIComponent(row.id)}/decision?kind=${row.kind}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ outcome, value_usd: null }),
    });
    setBusy(false);
    onUpdate();
  };
  return (
    <Card><CardContent className="p-4">
      <h4 className="text-sm font-semibold mb-2">🏁 Outcome</h4>
      <div className="flex gap-1.5">
        <Button size="sm" variant="cta" disabled={busy} onClick={() => decide("won")} className="flex-1">💰 Won</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("lost")} className="flex-1">😤 Lost</Button>
      </div>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("on_hold")} className="w-full mt-1">⏸ On hold</Button>
    </CardContent></Card>
  );
}

// ── Outreach enqueue ──────────────────────────────────────────────────
function OutreachEnqueue({ row, token, onRefresh }: any) {
  const [busy, setBusy] = useState(false);
  const enq = async () => {
    setBusy(true);
    await fetch(`/api/admin/outreach/enqueue-next`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ prospect_id: row.id }),
    });
    setBusy(false);
    onRefresh();
  };
  return (
    <Card><CardContent className="p-4">
      <h4 className="text-sm font-semibold flex items-center gap-1 mb-2"><Send className="w-4 h-4" /> Outreach</h4>
      <Button size="sm" onClick={enq} disabled={busy} className="w-full">
        {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
        Enqueue day-0 cold email
      </Button>
      <div className="text-xs text-zinc-500 mt-1">Sends only after manual approval in the Outreach queue.</div>
    </CardContent></Card>
  );
}

// ── Deep evaluation — multi-service + multi-pricing ────────────────────
function DeepEval({ row, token, deepEval, setDeepEval }: { row: any; token: string; deepEval: any; setDeepEval: (d: any) => void }) {
  const [busy, setBusy] = useState(false);
  const cached = deepEval;
  const run = async (force = false) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/leads/${encodeURIComponent(row.id)}/deep-evaluate?kind=${row.kind}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await r.json();
      setDeepEval(data);
    } finally { setBusy(false); }
  };

  return (
    <Card className="border-2 border-violet-300">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="font-semibold flex items-center gap-1.5"><Brain className="w-4 h-4 text-violet-500" /> Deep evaluation
            <Badge className="ml-1">Multi-service · Multi-price</Badge>
          </h4>
          <Button size="sm" variant="cta" onClick={() => run(false)} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
            {cached ? "Refresh" : "Deep evaluate"}
          </Button>
        </div>

        {!cached && !busy && (
          <p className="text-xs text-zinc-600">
            The AI looks at <strong>all</strong> available data (signals, industry, deal type, contact role)
            and returns 3 service offerings × 3 pricing tiers — packaged as "what could MehyarSoft sell them."
          </p>
        )}

        {cached && <DeepEvalBody data={cached} />}
      </CardContent>
    </Card>
  );
}

function DeepEvalBody({ data }: { data: any }) {
  const d = data.evaluation || data || {};
  const services = d.services || d.offerings || [];
  const tiers = d.pricing_tiers || d.pricing || [];
  const verdict = d.verdict;
  const score = d.fit_score ?? d.score;
  const summary = d.executive_summary;

  return (
    <div className="space-y-3 text-sm">
      {verdict && (
        <div className="flex flex-wrap items-baseline gap-2 p-2 rounded-lg bg-zinc-50 border border-zinc-200">
          <span className="text-base font-bold">{verdict}</span>
          {typeof score === "number" && <span className="font-mono text-2xl font-bold text-zinc-900">{score}<span className="text-base text-zinc-400">/100</span></span>}
          {data.used_llm === false && <Badge className="bg-amber-100 text-amber-800">heuristic</Badge>}
        </div>
      )}
      {summary && <p className="text-zinc-700">{summary}</p>}
      {services.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">🛠️ What MehyarSoft could sell them</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {services.slice(0, 3).map((s: any, i: number) => (
              <div key={i} className="rounded border border-zinc-200 bg-white p-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">{s.icon || "🛠"}</span>
                  <span className="font-medium">{s.name}</span>
                </div>
                {s.description && <p className="text-xs text-zinc-600 mt-1">{s.description}</p>}
                {s.deliverables && <ul className="text-xs mt-1 space-y-0.5">{s.deliverables.slice(0, 4).map((d: string, j: number) => <li key={j}>· {d}</li>)}</ul>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tiers.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">💰 Pricing tiers</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {tiers.slice(0, 3).map((t: any, i: number) => (
              <div key={i} className={`rounded border p-3 ${i === 1 ? "border-violet-400 bg-violet-50/40" : "border-zinc-200 bg-white"}`}>
                <div className="flex justify-between items-baseline">
                  <span className="font-semibold">{t.tier || t.name}</span>
                  {i === 1 && <Badge className="bg-violet-100 text-violet-800 text-[10px]">⭐ recommended</Badge>}
                </div>
                <div className="text-2xl font-bold mt-1">${(t.price_min ?? t.min ?? 0).toLocaleString()}<span className="text-sm font-normal text-zinc-500"> – ${(t.price_max ?? t.max ?? 0).toLocaleString()}</span></div>
                {t.monthly_min && <div className="text-xs text-zinc-500 mt-0.5">${t.monthly_min} – ${t.monthly_max}/mo retain</div>}
                {t.scope && <ul className="text-xs mt-2 space-y-0.5">{t.scope.slice(0, 6).map((s: string, j: number) => <li key={j}>· {s}</li>)}</ul>}
              </div>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(d.risk_flags) && d.risk_flags.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">⚠️ Risk flags</div>
          <ul className="text-xs text-amber-700 space-y-0.5">{d.risk_flags.slice(0, 5).map((r: string, i: number) => <li key={i}>· {r}</li>)}</ul>
        </div>
      )}
      {d.next_action && (
        <div className="rounded-lg bg-gradient-to-r from-emerald-50 to-cyan-50 p-3 border border-emerald-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 mb-1">➡️ Next action</div>
          <p className="text-sm font-medium">{d.next_action}</p>
        </div>
      )}
    </div>
  );
}
