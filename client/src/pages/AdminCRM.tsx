// @ts-nocheck
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Loader2, Sparkles, Filter, Search, ChevronRight,
  Briefcase, Globe, Send, Phone, Mail, Calendar, RefreshCw,
  X, Plus, Brain, CheckCircle2, ArrowRight, MailIcon, Trash2,
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
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const params = new URLSearchParams({ q, kind, stage, sort });
  const leadQ = useQuery({ queryKey: ["admin-crm", token, params.toString()], queryFn: () => fetchCRM(token, params.toString()) });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-crm"] });

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Focus a row from URL ?focus=…
  useEffect(() => {
    const url = new URL(window.location.href);
    const focus = url.searchParams.get("focus");
    if (focus && !openId) {
      setOpenId(focus);
      setOpenKind(url.searchParams.get("kind") || "sam");
      url.searchParams.delete("focus");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, []);

  const filtered = (leadQ.data?.items || []);

  const openDrawer = (id: string, kind: string) => { setOpenId(id); setOpenKind(kind); };
  const closeDrawer = () => { setOpenId(null); setOpenKind(null); };

  // Close drawer on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <AdminNav active="crm" onLogout={logout} onRefresh={refresh} />

      <div className="mb-5 space-y-3">
        <JarvisBar token={token} placeholder="Try: 'count prospects by city', 'promote all leak>70', 'enrich a0daf6…'" />
        <AiDailySuggestions token={token} onOpen={(id, kind) => openDrawer(id, kind)} />
      </div>

      {/* Toolbar */}
      <Card className="mb-4 sticky top-16 z-10 backdrop-blur bg-white/95">
        <CardContent className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px] bg-zinc-50 rounded-lg px-2.5 py-1.5 border border-zinc-200">
              <Search className="w-4 h-4 text-zinc-400" />
              <Input
                placeholder="Filter by name, domain, agency, city…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="border-0 bg-transparent focus-visible:ring-0 px-0 text-sm h-7"
              />
              {q && <button onClick={() => setQ("")} className="text-zinc-400 hover:text-zinc-600"><X className="w-4 h-4" /></button>}
            </div>
            <div className="flex gap-1">
              {(["all","prospect","sam"] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)}
                  className={`px-2.5 py-1.5 text-xs rounded-full transition ${kind === k ? "bg-zinc-900 text-white shadow-sm" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}>
                  {k === "all" ? "All" : k === "sam" ? "🏛 SAM.gov" : "🧲 Prospects"}
                </button>
              ))}
            </div>
            <button onClick={() => setShowFilters((s) => !s)}
              className={`px-2.5 py-1.5 text-xs rounded-full border ${showFilters ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400"}`}>
              <Filter className="inline w-3 h-3 mr-1" />Filters
            </button>
            <span className="text-xs text-zinc-500 ml-auto tabular-nums">{filtered.length} leads</span>
          </div>
          {showFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-100">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500">Stage:</span>
                <select value={stage} onChange={(e) => setStage(e.target.value)} className="text-xs border rounded px-2 py-1.5 bg-white">
                  <option value="">all</option>
                  {["new","scanned","draft_needed","drafting","ready","queued","sent","replied","won","lost","archived"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500">Sort:</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="text-xs border rounded px-2 py-1.5 bg-white">
                  <option value="deadline_asc">⏰ Deadline (soonest)</option>
                  <option value="leak_desc">🩸 Leak score (high→low)</option>
                  <option value="fit_desc">🎯 Fit score (high→low)</option>
                  <option value="created_desc">🕒 Newest first</option>
                </select>
              </div>
              <BulkActions token={token} ids={filtered.map((x:any) => x.id)} kind={kind} onDone={() => { refresh(); setToast(`Bulk action queued on ${filtered.length} leads`); }} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white px-4 py-2 rounded-lg shadow-2xl text-sm flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />{toast}
        </div>
      )}

      {/* Loading / Error / Empty / Rows */}
      {leadQ.isLoading && (
        <div className="space-y-2">
          {[0,1,2,3].map((i) => (
            <Card key={i} className="animate-pulse"><CardContent className="p-4 h-20" /></Card>
          ))}
        </div>
      )}

      {leadQ.isError && (
        <Card><CardContent className="py-8 text-sm text-red-700 flex items-center gap-2">
          ⚠ Failed to load CRM: {String((leadQ.error as Error)?.message || leadQ.error)}
          <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
        </CardContent></Card>
      )}

      {leadQ.data && filtered.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-zinc-500">
          <Sparkles className="inline w-10 h-10 mb-3 text-zinc-300" />
          <div className="font-medium text-zinc-700">No leads match these filters.</div>
          <div className="text-xs text-zinc-400 mt-1">Try clearing the search box or switching kind to "All".</div>
          {(q || stage) && (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => { setQ(""); setStage(""); }}>Clear filters</Button>
          )}
        </CardContent></Card>
      )}

      {leadQ.data && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((it: any) => (
            <LeadRow
              key={`${it.kind}:${it.id}`}
              row={it}
              onOpen={() => openDrawer(it.id, it.kind)}
            />
          ))}
        </div>
      )}

      {/* Detail Drawer */}
      {openId && openKind && (
        <LeadDrawer
          token={token}
          kind={openKind}
          id={openId}
          onClose={closeDrawer}
          onAction={(msg) => { setToast(msg); refresh(); }}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

// ── AI daily suggestions panel ─────────────────────────────────────────
function AiDailySuggestions({ token, onOpen }: { token: string; onOpen: (id: string, kind: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [reasoning, setReasoning] = useState<string>("");

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/leads/daily-suggestions?limit=5", {
        headers: { authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (j.ok) {
        setItems(j.items || []);
        setReasoning(j.reasoning || "");
      }
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); }, []);

  if (items.length === 0 && !busy) return null;
  return (
    <Card className="border-2 border-gradient-to-r from-violet-300 to-cyan-300 bg-gradient-to-r from-violet-50/40 via-white to-cyan-50/40">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span>🤖 AI suggests focusing on these {items.length} today</span>
            <Badge className="ml-1 bg-violet-100 text-violet-800">curated</Badge>
          </h3>
          <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Reshuffle
          </Button>
        </div>
        {reasoning && <p className="text-xs text-zinc-600 italic mb-2">💭 {reasoning}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
          {items.slice(0, 5).map((it: any, i: number) => (
            <button
              key={`${it.kind}:${it.id}`}
              onClick={() => onOpen(it.id, it.kind)}
              className="text-left rounded-lg border border-zinc-200 bg-white hover:border-violet-400 hover:shadow-md transition p-2.5"
            >
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs text-zinc-400 font-mono">#{i + 1}</span>
                <span className="text-sm">{it.kind === "sam" ? "🏛" : "🧲"}</span>
                <span className="text-xs text-zinc-500">{it.kind === "sam" ? "SAM" : "Prospect"}</span>
                {typeof it.priority_score === "number" && (
                  <span className="ml-auto text-[10px] font-bold text-violet-700 tabular-nums">{it.priority_score}</span>
                )}
              </div>
              <div className="font-medium text-xs leading-tight line-clamp-2 mb-1">{it.title}</div>
              <div className="text-[10px] text-zinc-500 line-clamp-2">{it.why}</div>
              {it.suggested_action && (
                <div className="mt-1.5 pt-1.5 border-t border-zinc-100 text-[10px] text-violet-700">
                  ➡ {it.suggested_action}
                </div>
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Compact row ─────────────────────────────────────────────────────────
function LeadRow({ row, onOpen }: { row: any; onOpen: () => void }) {
  const isHot = row.leak_score >= 70 || row.fit_score >= 60 || (row.deadline_in_days != null && row.deadline_in_days <= 2);
  return (
    <button
      onClick={onOpen}
      className={`w-full text-left rounded-lg border bg-white hover:bg-zinc-50 hover:border-zinc-400 hover:shadow-sm transition p-3 ${
        isHot ? "border-amber-300" : "border-zinc-200"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="text-base mt-0.5 shrink-0">{row.kind === "sam" ? "🏛" : "🧲"}</div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-sm leading-tight">{row.title}</h3>
            <Badge className={`text-[10px] ${STAGE_BADGE[row.stage] || "bg-zinc-100 text-zinc-700"}`}>{row.stage}</Badge>
            {row.deadline_in_days != null && row.kind === "sam" && (
              <span className={`text-[11px] font-mono font-bold ${row.deadline_in_days <= 0 ? "text-red-700" : row.deadline_in_days <= 2 ? "text-red-600" : "text-zinc-500"}`}>
                {row.deadline_in_days <= 0 ? "OVERDUE" : `D-${row.deadline_in_days}`}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-1 line-clamp-1">{row.subtitle || ""}</div>
          {row.ai_suggestion && (
            <div className="mt-1.5 text-xs text-violet-700 inline-flex items-center gap-1">
              🧠 {row.ai_suggestion}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {typeof row.leak_score === "number" && <ScoreBar score={row.leak_score} max={100} label="leak" tone="leak" />}
          {typeof row.fit_score === "number" && <ScoreBar score={row.fit_score} max={100} label="fit" />}
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-400 mt-1 shrink-0" />
      </div>
    </button>
  );
}

// ── Right-side drawer ──────────────────────────────────────────────────
function LeadDrawer({ token, kind, id, onClose, onAction, onRefresh }: any) {
  const qc = useQueryClient();
  const q = useQuery({
    enabled: !!id && !!token,
    queryKey: ["admin-lead-detail", token, kind, id],
    queryFn: () => fetchDetail(token, kind, id),
  });
  const opp = q.data?.opportunity || {};
  const refreshDetail = () => qc.invalidateQueries({ queryKey: ["admin-lead-detail"] });

  return (
    createPortal(
      <>
        <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
        <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[640px] md:w-[720px] bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
          {/* Drawer header */}
          <div className="sticky top-0 bg-white border-b z-10 px-5 py-3 flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="text-xl">{kind === "sam" ? "🏛" : "🧲"}</div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-base leading-tight truncate">{opp.title || "Loading…"}</h2>
                <div className="text-xs text-zinc-500 truncate">{opp.agency || opp.root_domain || "—"}</div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-zinc-100 text-zinc-500">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer body */}
          <div className="flex-1 overflow-y-auto p-5">
            {q.isLoading && (
              <div className="space-y-2">
                {[0,1,2].map((i) => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-16" /></Card>)}
              </div>
            )}
            {q.error && <div className="text-sm text-red-700">⚠ {String((q.error as Error)?.message)}</div>}

            {opp.id && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 space-y-3">
                  <StageMover row={{...opp, kind, id}} token={token} onUpdate={() => { refreshDetail(); onRefresh(); }} />

                  {kind === "sam" && opp.how_to_apply?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><ArrowRight className="w-4 h-4" /> How to apply</h4>
                      <ol className="space-y-1 text-sm">
                        {opp.how_to_apply.map((s: any, i: number) => (
                          <li key={i} className="flex gap-2"><span className="font-mono text-zinc-400 w-5">{s.step}.</span><span>{s.label}{s.url && <> · <a href={s.url} className="text-blue-700 underline" target="_blank" rel="noreferrer">open</a></>}{s.value && <span className="text-xs text-zinc-500"> — {String(s.value).slice(0, 100)}</span>}</span></li>
                        ))}
                      </ol>
                    </CardContent></Card>
                  )}

                  {kind === "sam" && opp.requirements?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Brain className="w-4 h-4" /> Requirements</h4>
                      <ul className="space-y-1 text-sm">
                        {opp.requirements.map((r: any, i: number) => (
                          <li key={i}><Badge className="mr-1 bg-zinc-100 text-zinc-700">{r.label}</Badge>{String(r.value).slice(0, 160)}</li>
                        ))}
                      </ul>
                    </CardContent></Card>
                  )}

                  {kind === "sam" && opp.attachments?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold mb-2">📎 Attachments ({opp.attachments.length})</h4>
                      <ul className="text-sm space-y-1">
                        {opp.attachments.map((a: any, i: number) => (
                          <li key={i}><a href={a.url} className="text-blue-700 underline" target="_blank" rel="noreferrer">{a.name}</a> {a.type && <span className="text-xs text-zinc-500">· {a.type}</span>}</li>
                        ))}
                      </ul>
                    </CardContent></Card>
                  )}

                  <DeepEval kind={kind} id={id} token={token} onAction={onAction} />
                </div>

                <div className="space-y-3">
                  {kind === "sam" && opp.poc?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold mb-2">📇 Contacts</h4>
                      <ul className="text-sm space-y-2">
                        {opp.poc.map((c: any, i: number) => (
                          <li key={i} className="border-l-2 border-zinc-200 pl-2">
                            <div className="font-medium">{c.name || "—"}</div>
                            {c.role && <div className="text-xs text-zinc-500">{c.role}</div>}
                            {c.email && <a href={`mailto:${c.email}`} className="text-blue-700 text-xs underline block">{c.email}</a>}
                            {c.phone && <span className="text-xs text-zinc-600">{c.phone}</span>}
                          </li>
                        ))}
                      </ul>
                    </CardContent></Card>
                  )}

                  {kind === "prospect" && opp.signals && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold mb-2">🔎 Latest signals</h4>
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        {[
                          ["SSL", opp.signals.has_ssl],
                          ["Booking", opp.signals.has_booking_cta],
                          ["Click-call", opp.signals.has_phone_click_to_call],
                          ["Form", opp.signals.has_form_action],
                          ["Email link", opp.signals.has_email_link],
                          ["Address", opp.signals.has_address],
                        ].map(([label, val]) => (
                          <div key={label as string} className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] text-white ${val ? "bg-emerald-500" : "bg-red-400"}`}>{val ? "✓" : "✕"}</span>
                            <span className="text-zinc-700">{label as string}</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-zinc-500 mt-2 pt-2 border-t border-zinc-100">
                        <div>Platform: <strong>{opp.signals.detected_platform || "?"}</strong></div>
                        <div>HTTP {opp.signals.status_code} · {opp.signals.load_time_ms}ms · {opp.signals.page_weight_kb}KB</div>
                        {typeof opp.signals.leak_score === "number" && <ScoreBar score={opp.signals.leak_score} label="leak" tone="leak" />}
                      </div>
                    </CardContent></Card>
                  )}

                  {kind === "sam" && <WinLoseQuick row={{id, kind}} token={token} onAction={(msg) => { onAction(msg); }} />}
                  {kind === "prospect" && <OutreachEnqueue row={{id}} token={token} onAction={(msg) => { onAction(msg); }} />}
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

// ── Bulk actions ───────────────────────────────────────────────────────
function BulkActions({ token, ids, kind, onDone }: { token: string; ids: string[]; kind: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async (action: string) => {
    if (!ids.length) return;
    if (!confirm(`Apply '${action}' to ${ids.length} leads?`)) return;
    setBusy(true);
    try {
      await fetch("/api/admin/leads/bulk", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: kind === "all" ? "any" : kind, ids, action }),
      });
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <div className="flex gap-1 ml-auto">
      <Button size="sm" variant="outline" disabled={!ids.length || busy} onClick={() => submit("stage:queued")}><Send className="w-3 h-3 mr-1" />Queue</Button>
      <Button size="sm" variant="outline" disabled={!ids.length || busy} onClick={() => submit("stage:archived")}><Trash2 className="w-3 h-3 mr-1" />Archive</Button>
      <Button size="sm" variant="cta" disabled={!ids.length || busy} onClick={() => submit("deep_evaluate")}><Sparkles className="w-3 h-3 mr-1" />Deep eval</Button>
    </div>
  );
}

// ── Stage mover ────────────────────────────────────────────────────────
function StageMover({ row, token, onUpdate }: any) {
  const [busy, setBusy] = useState(false);
  const STAGES = row.kind === "sam"
    ? ["discovery","evaluating","drafting","ready","queued","sent","replied","won","lost","archived"]
    : ["new","scanned","draft_needed","drafting","approved","queued","sent","replied","won","lost","archived"];
  const set = async (stage: string) => {
    if (stage === row.stage) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/leads/${encodeURIComponent(row.id)}/stage?kind=${row.kind}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      onUpdate();
    } finally { setBusy(false); }
  };
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">📊 Pipeline</h4>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />}
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
            }`}>
            {s}{s === row.stage && <CheckCircle2 className="inline w-3 h-3 ml-1" />}
          </button>
        ))}
      </div>
    </CardContent></Card>
  );
}

// ── Win/Lose quick ─────────────────────────────────────────────────────
function WinLoseQuick({ row, token, onAction }: any) {
  const [busy, setBusy] = useState(false);
  const decide = async (outcome: string) => {
    const value = outcome === "won" ? prompt("Value won (USD)?", "5000") : null;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/opportunities/${encodeURIComponent(row.id)}/decision?kind=${row.kind}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ outcome, value_usd: value ? Number(value) : null }),
      });
      const j = await r.json();
      onAction(j.ok ? `Marked ${outcome}` : `Failed: ${j.error}`);
    } finally { setBusy(false); }
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
function OutreachEnqueue({ row, token, onAction }: any) {
  const [busy, setBusy] = useState(false);
  const enq = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/outreach/enqueue-next`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ prospect_id: row.id }),
      });
      const j = await r.json();
      onAction(j.ok ? "Step queued for review" : `Failed: ${j.error}`);
    } finally { setBusy(false); }
  };
  return (
    <Card><CardContent className="p-4">
      <h4 className="text-sm font-semibold flex items-center gap-1 mb-2"><Send className="w-4 h-4" /> Outreach</h4>
      <Button size="sm" onClick={enq} disabled={busy} className="w-full">
        {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
        Enqueue day-0 cold email
      </Button>
      <div className="text-xs text-zinc-500 mt-1">Sends only after manual approval.</div>
    </CardContent></Card>
  );
}

// ── Deep evaluation ───────────────────────────────────────────────────
function DeepEval({ kind, id, token, onAction }: { kind: string; id: string; token: string; onAction: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(null);
  const [generatingTier, setGeneratingTier] = useState<number | null>(null);

  const run = async (force = false) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/leads/${encodeURIComponent(id)}/deep-evaluate?kind=${kind}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const j = await r.json();
      if (j.ok) {
        setData(j.evaluation);
        onAction(`Deep eval done · ${j.used_llm ? "LLM" : "heuristic"}`);
      } else {
        onAction(`Deep eval failed: ${j.error}`);
      }
    } finally { setBusy(false); }
  };

  // Generate an outreach draft seeded from a specific pricing tier
  const generateDraftFromTier = async (tier: any, service: any) => {
    setGeneratingTier(tier._idx ?? 0);
    try {
      const r = await fetch("/api/admin/leads/draft-from-eval", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          lead_kind: kind,
          lead_id: id,
          service: service?.name || "AI consultation",
          tier_name: tier?.tier || tier?.name,
          tier_min: tier?.price_min ?? tier?.min,
          tier_max: tier?.price_max ?? tier?.max,
          scope: tier?.scope || service?.deliverables || [],
        }),
      });
      const j = await r.json();
      if (j.ok) {
        onAction(`Draft created · ${j.draft_id?.slice(0, 8) || ""}`);
        // Optionally deep-link to outreach tab
        if (j.draft_id) {
          setTimeout(() => {
            if (confirm("Open this draft in the outreach queue?")) {
              window.location.href = `/admin/outreach?focus=${j.draft_id}`;
            }
          }, 200);
        }
      } else {
        onAction(`Draft failed: ${j.error}`);
      }
    } catch (e: any) {
      onAction(`Draft error: ${e.message}`);
    } finally { setGeneratingTier(null); }
  };

  return (
    <Card className="border-2 border-violet-300">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="font-semibold flex items-center gap-1.5"><Brain className="w-4 h-4 text-violet-500" /> Deep evaluation
            <Badge className="ml-1">3 services · 3 price tiers</Badge>
          </h4>
          <Button size="sm" variant="cta" onClick={() => run(false)} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Evaluating (10-30s)…</> : <><Sparkles className="w-4 h-4 mr-1" />{data ? "Refresh" : "Deep evaluate"}</>}
          </Button>
        </div>

        {!data && !busy && (
          <p className="text-xs text-zinc-600">
            The AI inspects <strong>all</strong> data (signals, agency, deal type, contact role) and returns 3 services × 3 pricing tiers — packaged as "what MehyarSoft could sell them." Click any tier to turn it into an outreach draft.
          </p>
        )}

        {busy && (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-zinc-200 rounded w-1/3" />
            <div className="h-3 bg-zinc-100 rounded w-full" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-20 bg-zinc-100 rounded" />
              <div className="h-20 bg-zinc-100 rounded" />
              <div className="h-20 bg-zinc-100 rounded" />
            </div>
          </div>
        )}

        {data && <DeepEvalBody data={data} onGenerate={generateDraftFromTier} generatingTier={generatingTier} />}
      </CardContent>
    </Card>
  );
}

function DeepEvalBody({ data, onGenerate, generatingTier }: { data: any; onGenerate: (tier: any, service: any) => void; generatingTier: number | null }) {
  const verdict = data.verdict;
  const score = data.fit_score ?? data.score;
  const summary = data.executive_summary;
  const services = data.services || data.offerings || [];
  const tiers = data.pricing_tiers || data.pricing || [];

  return (
    <div className="space-y-3 text-sm">
      {verdict && (
        <div className="flex flex-wrap items-baseline gap-2 p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
          <span className="text-base font-bold">{verdict}</span>
          {typeof score === "number" && <span className="font-mono text-2xl font-bold text-zinc-900">{score}<span className="text-base text-zinc-400">/100</span></span>}
          {data.used_llm === false && <Badge className="bg-amber-100 text-amber-800">heuristic</Badge>}
          {data.used_llm === true && <Badge className="bg-emerald-100 text-emerald-800">AI</Badge>}
        </div>
      )}
      {summary && <p className="text-zinc-700">{summary}</p>}
      {services.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1.5">🛠 What we could sell them</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {services.slice(0, 3).map((s: any, i: number) => (
              <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{s.icon || "🛠"}</span>
                  <span className="font-medium text-sm">{s.name}</span>
                </div>
                {s.description && <p className="text-xs text-zinc-600">{s.description}</p>}
                {s.deliverables && <ul className="text-xs mt-1.5 space-y-0.5">{s.deliverables.slice(0, 4).map((d: string, j: number) => <li key={j}>· {d}</li>)}</ul>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tiers.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1.5">💰 Pricing tiers — click to draft</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {tiers.slice(0, 3).map((t: any, i: number) => {
              const tierKey = t._idx ?? i;
              const matchingService = services[i] || services[0];
              return (
                <button
                  key={i}
                  onClick={() => onGenerate({ ...t, _idx: tierKey }, matchingService)}
                  disabled={generatingTier !== null}
                  className={`text-left rounded-lg border p-3 transition hover:border-violet-500 hover:shadow-md ${
                    i === 1 ? "border-violet-400 bg-violet-50/40" : "border-zinc-200 bg-white"
                  } ${generatingTier === tierKey ? "animate-pulse" : ""}`}
                >
                  <div className="flex justify-between items-baseline">
                    <span className="font-semibold text-sm">{t.tier || t.name}</span>
                    {i === 1 && <Badge className="bg-violet-100 text-violet-800 text-[10px]">⭐ recommended</Badge>}
                  </div>
                  <div className="text-xl font-bold mt-1">${(t.price_min ?? t.min ?? 0).toLocaleString()}<span className="text-xs font-normal text-zinc-500"> – ${(t.price_max ?? t.max ?? 0).toLocaleString()}</span></div>
                  {t.monthly_min && <div className="text-xs text-zinc-500 mt-0.5">${t.monthly_min} – ${t.monthly_max}/mo retain</div>}
                  {t.scope && <ul className="text-xs mt-2 space-y-0.5 text-zinc-600">{t.scope.slice(0, 6).map((s: string, j: number) => <li key={j}>· {s}</li>)}</ul>}
                  <div className="mt-2 pt-2 border-t border-zinc-200 flex items-center gap-1 text-xs text-violet-700 font-medium">
                    {generatingTier === tierKey ? <><Loader2 className="w-3 h-3 animate-spin" /> Drafting…</> : <><ArrowRight className="w-3 h-3" /> Generate draft from this tier</>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {Array.isArray(data.risk_flags) && data.risk_flags.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">⚠️ Risk flags</div>
          <ul className="text-xs text-amber-700 space-y-0.5">{data.risk_flags.slice(0, 5).map((r: string, i: number) => <li key={i}>· {r}</li>)}</ul>
        </div>
      )}
      {data.next_action && (
        <div className="rounded-lg bg-gradient-to-r from-emerald-50 to-cyan-50 p-3 border border-emerald-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 mb-1">➡️ Next action</div>
          <p className="text-sm font-medium">{data.next_action}</p>
        </div>
      )}
    </div>
  );
}
