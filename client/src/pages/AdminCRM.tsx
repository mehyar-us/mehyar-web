// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Loader2, Sparkles, Filter, Search, ChevronRight,
  Briefcase, Globe, Send, Phone, Mail, Calendar, RefreshCw,
  X, Plus, Brain, CheckCircle2, ArrowRight, MailIcon, Trash2,
  MessageSquare, MessageCircle, Check, ExternalLink, AlertTriangle, Clock, DollarSign, Target, Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AdminNav, MayorBar, AdminGate, useAdminSession, STAGE_BADGE, ScoreBar } from "./AdminShell";

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
  const [kind, setKind] = useState<"all"|"prospect"|"sam"|"replies">("all");
  const [stage, setStage] = useState<string>("");
  const [sort, setSort] = useState<"deadline_asc"|"leak_desc"|"fit_desc"|"created_desc">("created_desc");
  const [includeImminent, setIncludeImminent] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // ── Deep-link sync: read ?kind= ?stage= ?sort= from URL on every render.
  // Pages like /admin/leads?kind=replies (from the Mayor dashboard KPI cards)
  // land here and pre-select the matching sticky-tab on arrival. We parse on
  // every paint and let useState's equality check absorb unchanged values.
  const search = typeof window !== "undefined" ? window.location.search : "";
  useEffect(() => {
    const url = new URLSearchParams(search);
    const k = url.get("kind");
    if (k === "prospect" || k === "sam" || k === "replies" || k === "all") setKind(k);
    const st = url.get("stage");
    if (st) setStage(st);
    const so = url.get("sort");
    if (so === "deadline_asc" || so === "leak_desc" || so === "fit_desc" || so === "created_desc") setSort(so);
  }, [search]);

  const params = new URLSearchParams({ q, kind, stage, sort });
  if (includeImminent) params.set("include_imminent", "true");
  const leadQ = useQuery({
    queryKey: ["admin-crm", token, params.toString()],
    queryFn: () => fetchCRM(token, params.toString()),
    enabled: kind !== "replies", // replies have their own endpoint
  });

  // Replies tab fetches from a separate endpoint that surfaces prospect_replies.
  const repliesQ = useQuery({
    queryKey: ["admin-crm-replies", token, q],
    queryFn: async () => {
      const r = await fetch(`/api/admin/mayor/replies?needs_action=1&limit=100&q=${encodeURIComponent(q)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    enabled: kind === "replies",
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-crm"] });

  // Mark a prospect_reply as handled (clears needs_action flag from D1).
  const markReplyHandled = async (replyId: string) => {
    try {
      const r = await fetch(`/api/admin/mayor/replies/${replyId}/mark-handled`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (r.ok) qc.invalidateQueries({ queryKey: ["admin-crm-replies"] });
    } catch { /* ignore */ }
  };

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
    <div className="p-4 md:p-6 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <AdminNav active="crm" onLogout={logout} onRefresh={refresh} />

      <div className="mb-5 space-y-3">
        <MayorBar token={token} placeholder="Try: 'count prospects by city', 'promote all leak>70', 'enrich a0daf6…'" />
        <AiDailySuggestions token={token} onOpen={(id, kind) => openDrawer(id, kind)} />
        <BusinessScanner token={token} onUpdate={refresh} />
        <EUScouter token={token} onUpdate={refresh} />
        <FindJobsPanel token={token} onUpdate={refresh} />
      </div>

      {/* ── Sticky 4-tab CRM header (always below navbar / sticky on scroll) ─── */}
      <div className="sticky top-14 md:top-16 z-20 -mx-4 md:-mx-6 -mt-2 mb-4">
        <div className="backdrop-blur bg-white/95 dark:bg-zinc-900/95 border-b border-zinc-200 dark:border-zinc-700 px-4 md:px-6">
          <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto py-2">
            {([
              { k: "all",      label: "📋 Inbox (mixed)",   icon: "📋", count: filtered.length, mixed: true },
              { k: "sam",      label: "🏛 Gov Opps",        icon: "🏛",  count: null },
              { k: "prospect", label: "🧲 Local Biz",       icon: "🧲", count: null },
              { k: "replies",  label: "💌 Replies",         icon: "💌", count: kind === "replies" ? (repliesQ.data?.replies?.length ?? null) : null },
            ] as const).map((t) => {
              const active = kind === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => setKind(t.k as any)}
                  aria-pressed={active}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 px-3 md:px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition flex items-center gap-1.5 ${
                    active
                      ? t.mixed
                        ? "border-amber-500 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30"
                        : "border-violet-600 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30"
                      : "border-transparent text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-300 dark:hover:border-zinc-600"
                  }`}
                >
                  <span>{t.label}</span>
                  {t.count != null && (
                    <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${
                      active
                        ? t.mixed
                          ? "bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100"
                          : "bg-violet-200 dark:bg-violet-800 text-violet-900 dark:text-violet-100"
                        : "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
                    }`}>{t.count}</span>
                  )}
                </button>
              );
            })}
            <span className="ml-auto text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
              {kind === "replies"
                ? `${(repliesQ.data?.replies || []).length} reply${(repliesQ.data?.replies || []).length === 1 ? "" : "ies"}`
                : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      </div>

      {/* ── Active-filter banner (explains what's in view so nothing feels
              mixed-up) — only shown when not on the "All" tab ─── */}
      {kind !== "all" && kind !== "replies" && (
        <div className="mb-3 px-4 md:px-0 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-200 font-medium">
            <Filter className="w-3 h-3" />
            Filter: {kind === "sam" ? "Government opportunities only" : "Local business prospects only"}
          </span>
          <button
            onClick={() => setKind("all")}
            className="text-[11px] underline text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            show mixed inbox →
          </button>
          <span className="ml-auto text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            {filtered.length} of {leadQ.data?.total ?? "—"} total
          </span>
        </div>
      )}

      {kind === "replies" && (
        <div className="mb-3 px-4 md:px-0 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-200 font-medium">
            <Filter className="w-3 h-3" />
            Filter: Inbound replies needing your eyes
          </span>
          <button
            onClick={() => setKind("all")}
            className="text-[11px] underline text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            show mixed inbox →
          </button>
        </div>
      )}

      {kind === "all" && (
        <div className="mb-3 px-4 md:px-0 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200 font-medium">
            ⚠ Mixed inbox — showing government + local-business items together
          </span>
          <button
            onClick={() => setKind("sam")}
            className="text-[11px] underline text-violet-700 dark:text-violet-300 hover:text-violet-900"
          >
            split: Gov → 
          </button>
          <button
            onClick={() => setKind("prospect")}
            className="text-[11px] underline text-violet-700 dark:text-violet-300 hover:text-violet-900"
          >
            split: Local →
          </button>
        </div>
      )}


      {/* ── Sub-tabs by lifecycle — only on pure-kind tabs (sam/prospect) ─── */}
      {(kind === "sam" || kind === "prospect") && (
        <div className="mb-3 flex items-center gap-1.5 text-xs overflow-x-auto">
          <button onClick={() => setStage("")}
            className={`px-2.5 py-1 rounded-full border transition whitespace-nowrap ${
              !stage ? "bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200 border-violet-300 dark:border-violet-700" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}>All stages</button>
          {[
            { k: "new", l: "🆕 New" },
            { k: "scanned", l: "🔎 Scanned" },
            { k: "draft_needed", l: "✍️ Drafts needed" },
            { k: "drafting", l: "📝 Drafting" },
            { k: "ready", l: "✅ Ready" },
            { k: "queued", l: "📤 Queued" },
            { k: "sent", l: "📬 Sent" },
            { k: "replied", l: "💬 Replied" },
            { k: "won", l: "🏆 Won" },
            { k: "lost", l: "❌ Lost" },
          ].map((s) => (
            <button key={s.k} onClick={() => setStage(s.k)}
              className={`px-2.5 py-1 rounded-full border transition whitespace-nowrap ${
                stage === s.k ? "bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200 border-violet-300 dark:border-violet-700" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}>{s.l}</button>
          ))}
        </div>
      )}

      {/* Toolbar (search + sort + filters) — visible on all tabs except pure-replies */}
      <Card className="mb-4 sticky top-[88px] md:top-[100px] z-10 backdrop-blur bg-white dark:bg-zinc-900/95">
        <CardContent className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px] bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-700">
              <Search className="w-4 h-4 text-zinc-400 dark:text-zinc-400" />
              <Input
                placeholder={kind === "replies" ? "Search replies by sender, subject, body…" : "Filter by name, domain, agency, city…"}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="border-0 bg-transparent focus-visible:ring-0 px-0 text-sm h-7"
              />
              {q && <button onClick={() => setQ("")} className="text-zinc-500 dark:text-zinc-400"><X className="w-4 h-4" /></button>}
            </div>
            {kind !== "replies" && (
              <>
                <button onClick={() => setShowFilters((s) => !s)}
                  className={`px-2.5 py-1.5 text-xs rounded-full border ${showFilters ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"}`}>
                  <Filter className="inline w-3 h-3 mr-1" />Filters
                </button>
              </>
            )}
            <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto tabular-nums">
              {leadQ.data?.hidden_imminent > 0 && kind !== "replies" && (
                <button
                  type="button"
                  onClick={() => setIncludeImminent((v) => !v)}
                  className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-900"
                  title={`${leadQ.data.hidden_imminent} opportunities hidden because deadline < ${leadQ.data.min_days ?? 7} days. Click to ${includeImminent ? "hide" : "show"} them anyway.`}
                >
                  {includeImminent ? "✓" : "🚫"} {leadQ.data.hidden_imminent} {"<"}7d
                </button>
              )}
            </span>
          </div>
          {showFilters && kind !== "replies" && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Stage:</span>
                <select value={stage} onChange={(e) => setStage(e.target.value)} className="text-xs border rounded px-2 py-1.5 bg-white dark:bg-zinc-900">
                  <option value="">all</option>
                  {["new","scanned","draft_needed","drafting","ready","queued","sent","replied","won","lost","archived"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Sort:</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="text-xs border rounded px-2 py-1.5 bg-white dark:bg-zinc-900">
                  <option value="deadline_asc">⏰ Deadline (soonest)</option>
                  <option value="leak_desc">🩸 Leak score (high→low)</option>
                  <option value="fit_desc">🎯 Fit score (high→low)</option>
                  <option value="created_desc">🕒 Newest first</option>
                </select>
              </div>
              <BulkActions token={token} ids={filtered.map((x:any) => x.id)} kind={kind === "replies" ? "any" : kind} onDone={() => { refresh(); setToast(`Bulk action queued on ${filtered.length} leads`); }} />
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
        <Card><CardContent className="py-8 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
          ⚠ Failed to load CRM: {String((leadQ.error as Error)?.message || leadQ.error)}
          <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
        </CardContent></Card>
      )}

      {repliesQ.isError && kind === "replies" && (
        <Card><CardContent className="py-8 text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
          ⚠ Failed to load replies: {String((repliesQ.error as Error)?.message || repliesQ.error)}
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin-crm-replies"] })}>Retry</Button>
        </CardContent></Card>
      )}

      {kind === "replies" && (
        repliesQ.data?.replies?.length > 0 ? (
          <div className="space-y-2">
            {repliesQ.data.replies.map((r: any) => (
              <Card key={r.id} className="hover:border-emerald-300 dark:hover:border-emerald-700 transition">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold truncate">{r.from_name || r.from_email || "(unknown sender)"}</span>
                        {r.classification && (
                          <Badge variant="outline" className="text-[10px] uppercase">{r.classification}</Badge>
                        )}
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                          {r.received_at ? new Date(r.received_at).toLocaleString() : ""}
                        </span>
                      </div>
                      {r.subject && <div className="text-sm font-medium mb-1 line-clamp-1">{r.subject}</div>}
                      {r.body_excerpt && <div className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-3">{r.body_excerpt}</div>}
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {r.prospect_id && (
                          <a href={`/admin/leads?kind=prospect&focus=${r.prospect_id}`} className="underline hover:text-violet-700">
                            open prospect →
                          </a>
                        )}
                        {r.prospect_email && <span className="font-mono">{r.prospect_email}</span>}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => markReplyHandled(r.id)}>Handled</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !repliesQ.isLoading && (
          <Card><CardContent className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <MessageCircle className="inline w-10 h-10 mb-3 text-zinc-300 dark:text-zinc-600" />
            <div className="font-medium text-zinc-700 dark:text-zinc-200">No replies need attention right now.</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Mayor is auto-classifying inbound replies; this view shows ones not yet handled.</div>
          </CardContent></Card>
        )
      )}

      {leadQ.data && filtered.length === 0 && kind !== "replies" && (
        <Card><CardContent className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Sparkles className="inline w-10 h-10 mb-3 text-zinc-300 dark:text-zinc-300" />
          <div className="font-medium text-zinc-500 dark:text-zinc-400">No leads match these filters.</div>
          <div className="text-xs text-zinc-400 dark:text-zinc-400 mt-1">Try clearing the search box or switching kind to "All".</div>
          {(q || stage) && (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => { setQ(""); setStage(""); }}>Clear filters</Button>
          )}
        </CardContent></Card>
      )}

      {leadQ.data && filtered.length > 0 && kind !== "replies" && (
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
            <Badge className="ml-1 bg-violet-100 text-violet-800 dark:text-violet-300">curated</Badge>
          </h3>
          <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Reshuffle
          </Button>
        </div>
        {reasoning && <p className="text-xs text-zinc-500 dark:text-zinc-400 italic mb-2">💭 {reasoning}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
          {items.slice(0, 5).map((it: any, i: number) => (
            <button
              key={`${it.kind}:${it.id}`}
              onClick={() => onOpen(it.id, it.kind)}
              className="text-left rounded-lg border border-zinc-200 bg-white dark:bg-zinc-900 hover:border-violet-400 hover:shadow-md transition p-2.5"
            >
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs text-zinc-400 dark:text-zinc-400 font-mono">#{i + 1}</span>
                <span className="text-sm">{it.kind === "sam" ? "🏛" : "🧲"}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{it.kind === "sam" ? "SAM" : "Prospect"}</span>
                {typeof it.priority_score === "number" && (
                  <span className="ml-auto text-[10px] font-bold text-violet-700 dark:text-violet-400 tabular-nums">{it.priority_score}</span>
                )}
              </div>
              <div className="font-medium text-xs leading-tight line-clamp-2 mb-1">{it.title}</div>
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2">{it.why}</div>
              {it.suggested_action && (
                <div className="mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-violet-700 dark:text-violet-400">
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
      className={`w-full text-left rounded-lg border bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-400 dark:hover:border-zinc-500 hover:shadow-sm transition p-3 ${
        isHot ? "border-amber-300 dark:border-amber-700" : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="text-base mt-0.5 shrink-0">{row.kind === "sam" ? "🏛" : "🧲"}</div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-sm leading-tight">{row.title}</h3>
            <Badge className={`text-[10px] ${STAGE_BADGE[row.stage] || "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"}`}>{row.stage}</Badge>
            {row.deadline_in_days != null && row.kind === "sam" && (
              <span className={`text-[11px] font-mono font-bold ${row.deadline_in_days <= 0 ? "text-red-700 dark:text-red-400" : row.deadline_in_days <= 2 ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                {row.deadline_in_days <= 0 ? "OVERDUE" : `D-${row.deadline_in_days}`}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-1">{row.subtitle || ""}</div>
          {row.ai_suggestion && (
            <div className="mt-1.5 text-xs text-violet-700 dark:text-violet-400 inline-flex items-center gap-1">
              🧠 {row.ai_suggestion}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {typeof row.leak_score === "number" && <ScoreBar score={row.leak_score} max={100} label="leak" tone="leak" />}
          {typeof row.fit_score === "number" && <ScoreBar score={row.fit_score} max={100} label="fit" />}
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-400 dark:text-zinc-400 mt-1 shrink-0" />
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
  const [busyPdf, setBusyPdf] = useState(false);
  const refreshDetail = () => qc.invalidateQueries({ queryKey: ["admin-lead-detail"] });

  return (
    createPortal(
      <>
        <div className="fixed inset-0 bg-black/40 z-40 animate-fade-in" onClick={onClose} />
        {/* MOBILE: bottom-sheet (full-width, slide up from bottom, max 90vh)
            DESKTOP (md+): right-side drawer (720px wide, full viewport height) */}
        <aside className="fixed z-50 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col
                          inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl
                          md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:max-h-none md:h-screen md:w-[720px] md:rounded-none md:rounded-l-2xl
                          animate-slide-up md:animate-slide-in">
          {/* Bottom-sheet handle (mobile only) */}
          <div className="md:hidden pt-2 pb-1 flex justify-center" onClick={onClose}>
            <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          </div>
          {/* Drawer header — explicit dark text + bg so it stays readable even when html.dark is set */}
          <div className="shrink-0 sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 z-10 px-4 py-3 md:px-5 flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="text-xl shrink-0">{kind === "sam" ? "🏛" : "🧲"}</div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-base leading-tight text-zinc-900 dark:text-zinc-100 break-words line-clamp-2">{opp.title || "Loading…"}</h2>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{opp.agency || opp.root_domain || "—"}</div>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close drawer" className="rounded-full p-2 hover:bg-zinc-100 text-zinc-700 dark:text-zinc-300 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer body — min-h-0 is critical for overflow-y-auto to work inside a flex container */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-5 bg-white text-zinc-900 dark:text-zinc-100" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
            {q.isLoading && (
              <div className="space-y-2">
                {[0,1,2].map((i) => <Card key={i} className="animate-pulse"><CardContent className="p-4 h-16" /></Card>)}
              </div>
            )}
            {q.error && <div className="text-sm text-red-700 dark:text-red-400">⚠ {String((q.error as Error)?.message)}</div>}

            {opp.id && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 space-y-3">
                  <StageMover row={{...opp, kind, id}} token={token} onUpdate={() => { refreshDetail(); onRefresh(); }} />

                  {kind === "sam" && opp.how_to_apply?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><ArrowRight className="w-4 h-4" /> How to apply</h4>
                      <ol className="space-y-1 text-sm">
                        {opp.how_to_apply.map((s: any, i: number) => (
                          <li key={i} className="flex gap-2"><span className="font-mono text-zinc-400 dark:text-zinc-400 w-5">{s.step}.</span><span>{s.label}{s.url && <> · <a href={s.url} className="text-blue-700 dark:text-blue-400 underline" target="_blank" rel="noreferrer">open</a></>}{s.value && <span className="text-xs text-zinc-500 dark:text-zinc-400"> — {String(s.value).slice(0, 100)}</span>}</span></li>
                        ))}
                      </ol>
                    </CardContent></Card>
                  )}

                  {kind === "sam" && opp.requirements?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Brain className="w-4 h-4" /> Requirements</h4>
                      <ul className="space-y-1 text-sm">
                        {opp.requirements.map((r: any, i: number) => (
                          <li key={i}><Badge className="mr-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">{r.label}</Badge>{String(r.value).slice(0, 160)}</li>
                        ))}
                      </ul>
                    </CardContent></Card>
                  )}

                  {kind === "sam" && opp.attachments?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold">📎 Attachments ({opp.attachments.length})</h4>
                        <Button
                          size="sm"
                          variant="cta"
                          disabled={busyPdf}
                          onClick={async () => {
                            setBusyPdf(true);
                            try {
                              const r = await fetch(`/api/admin/opportunities/${encodeURIComponent(id)}/evaluate-pdf`, {
                                method: "POST",
                                headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                                body: JSON.stringify({ mode: "all" }),
                              });
                              const j = await r.json();
                              if (j.ok && j.aggregate) {
                                onAction(`📄 PDF eval done — fit ${j.aggregate.best_fit_score}/100 · ${j.aggregate.recommended_services?.[0]?.name || ""}`);
                                if (j.aggregate.suggested_tiers?.length) {
                                  alert(`📄 PDF eval fit: ${j.aggregate.best_fit_score}/100\n\nTop services:\n${j.aggregate.recommended_services?.map(s => `• ${s.name}: ${s.rationale}`).join("\n") || "(none)"}\n\nPricing tiers:\n${j.aggregate.suggested_tiers.map(t => `• ${t.name}: $${t.price_usd?.toLocaleString()} — ${t.scope}`).join("\n")}\n\nNext: ${j.aggregate.aggregate_summary?.slice(0, 300)}`);
                                }
                                refreshDetail();
                              } else {
                                onAction(`PDF eval failed: ${j.error || "unknown"}`);
                              }
                            } finally { setBusyPdf(false); }
                          }}
                          className="min-h-[44px]"
                        >
                          {busyPdf ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Brain className="w-3 h-3 mr-1" />}
                          Evaluate PDFs
                        </Button>
                      </div>
                      <ul className="text-sm space-y-1">
                        {opp.attachments.map((a: any, i: number) => (
                          <li key={i}><a href={a.url} className="text-blue-700 dark:text-blue-400 underline" target="_blank" rel="noreferrer">{a.name}</a> {a.type && <span className="text-xs text-zinc-500 dark:text-zinc-400">· {a.type}</span>}</li>
                        ))}
                      </ul>
                    </CardContent></Card>
                  )}

                  <DeepEval kind={kind} id={id} token={token} onAction={onAction} />
                  {kind === "prospect" && <DeepAnalyze id={id} token={token} onAction={onAction} />}
                </div>

                <div className="space-y-3">
                  {kind === "sam" && opp.poc?.length > 0 && (
                    <Card><CardContent className="p-4">
                      <h4 className="text-sm font-semibold mb-2">📇 Contacts</h4>
                      <ul className="text-sm space-y-2">
                        {opp.poc.map((c: any, i: number) => (
                          <li key={i} className="border-l-2 border-zinc-200 dark:border-zinc-700 pl-2">
                            <div className="font-medium">{c.name || "—"}</div>
                            {c.role && <div className="text-xs text-zinc-500 dark:text-zinc-400">{c.role}</div>}
                            {c.email && <a href={`mailto:${c.email}`} className="text-blue-700 dark:text-blue-400 text-xs underline block">{c.email}</a>}
                            {c.phone && <span className="text-xs text-zinc-500 dark:text-zinc-400">{c.phone}</span>}
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
                            <span className="text-zinc-500 dark:text-zinc-400">{label as string}</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
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

// ── Business scanner ──────────────────────────────────────────────────
// POST /api/admin/prospects/scan-businesses — find SMBs in a vertical/city,
// scan their websites for leak signals, optionally auto-draft top picks.
function BusinessScanner({ token, onUpdate }: { token: string; onUpdate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [vertical, setVertical] = useState("");
  const [city, setCity] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [autoDraftTop, setAutoDraftTop] = useState(2);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/admin/prospects/scan-businesses", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          vertical: vertical || undefined,
          city: city || undefined,
          max_results: maxResults,
          auto_draft_top: autoDraftTop,
        }),
      });
      const j = await r.json();
      setResult(j);
      if (j.ok && j.scanned > 0) onUpdate?.();
    } catch (e) {
      setResult({ ok: false, error: String(e?.message || e) });
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full text-left rounded-lg border border-dashed border-zinc-300 hover:border-emerald-400 hover:bg-emerald-50/30 transition p-3 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Search className="w-4 h-4 text-emerald-600" />
        <span className="font-medium text-emerald-700 dark:text-emerald-400">🧲 Scan for businesses that need our services</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto">vertical + city → leak_score → auto-draft</span>
      </button>
    );
  }

  return (
    <Card className="border-emerald-300 dark:border-emerald-700 bg-gradient-to-r from-emerald-50/40 via-white to-cyan-50/40">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <Search className="w-4 h-4 text-emerald-600" />
            🧲 Scan for businesses
          </h3>
          <button onClick={() => setOpen(false)} className="text-zinc-500 dark:text-zinc-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input placeholder="vertical (e.g. dental)" value={vertical} onChange={(e) => setVertical(e.target.value)} className="text-sm" />
          <Input placeholder="city (e.g. Brooklyn)" value={city} onChange={(e) => setCity(e.target.value)} className="text-sm" />
          <Input type="number" min={1} max={30} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value) || 10)} className="text-sm" placeholder="max results" />
          <Input type="number" min={0} max={5} value={autoDraftTop} onChange={(e) => setAutoDraftTop(Number(e.target.value) || 0)} className="text-sm" placeholder="auto-draft top N" />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="cta" onClick={submit} disabled={busy} className="min-h-[44px]">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
            {busy ? "Scanning…" : "Scan & draft top picks"}
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Filters DB prospects by vertical/city, hits their sites, scores them by leak signals (no SSL, no booking, no form, slow), then drafts the top N.</span>
        </div>
        {result && (
          <div className={`text-xs rounded p-2 ${result.ok ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 dark:bg-red-950/30 border border-red-200"}`}>
            {result.ok ? (
              <>
                <div className="font-semibold text-emerald-800">✓ Scanned {result.scanned} · drafted {result.drafted}</div>
                {result.top_picks && result.top_picks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.top_picks.slice(0, 5).map((p: any) => (
                      <li key={p.id} className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                        <span className="font-medium truncate flex-1">{p.business_name}</span>
                        <span className="font-mono text-red-700 dark:text-red-400">leak {p.leak_score}</span>
                        {p.drafted && <Badge className="bg-violet-100 text-violet-800 dark:text-violet-300 text-[10px]">drafted</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
                {result.scanned === 0 && <div className="mt-1 text-zinc-500 dark:text-zinc-400">No matching prospects in DB. Add some first, or broaden filters.</div>}
              </>
            ) : (
              <span className="text-red-700 dark:text-red-400">⚠ {result.error || "Scan failed"}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
        {busy && <Loader2 className="w-3 h-3 animate-spin text-zinc-400 dark:text-zinc-400" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button key={s}
            onClick={() => set(s)}
            disabled={busy || s === row.stage}
            className={`text-xs px-2 py-1 rounded-full transition ${
              s === row.stage
                ? "bg-zinc-900 text-white font-semibold ring-2 ring-emerald-400"
                : "bg-zinc-100 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:bg-zinc-700"
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
      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Sends only after manual approval.</div>
    </CardContent></Card>
  );
}

// ── Deep evaluation ───────────────────────────────────────────────────
function DeepEval({ kind, id, token, onAction }: { kind: string; id: string; token: string; onAction: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(null);
  const [generatingTier, setGeneratingTier] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

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
              window.location.href = `/admin/money?focus=${j.draft_id}`;
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
    <Card className="border-2 border-violet-300 dark:border-violet-700">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="font-semibold flex items-center gap-1.5"><Brain className="w-4 h-4 text-violet-500" /> Deep evaluation
            <Badge className="ml-1">3 services · 3 price tiers</Badge>
          </h4>
          <Button size="sm" variant="cta" onClick={() => run(false)} disabled={busy}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Evaluating (10-30s)…</> : <><Sparkles className="w-4 h-4 mr-1" />{data ? "Refresh" : "Deep evaluate"}</> }
          </Button>
        </div>

        {!data && !busy && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            The AI inspects <strong>all</strong> data (signals, agency, deal type, contact role) and returns 3 services × 3 pricing tiers — packaged as "what MehyarSoft could sell them." Click any tier to turn it into an outreach draft.
          </p>
        )}

        {busy && (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3" />
            <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded w-full" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-20 bg-zinc-100 dark:bg-zinc-800 rounded" />
              <div className="h-20 bg-zinc-100 dark:bg-zinc-800 rounded" />
              <div className="h-20 bg-zinc-100 dark:bg-zinc-800 rounded" />
            </div>
          </div>
        )}

        {data && (
          <>
            <DeepEvalBody data={data} onGenerate={generateDraftFromTier} generatingTier={generatingTier} />
            <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                💬 Want to refine? Tell the AI what to add, remove, or change — it'll suggest a structured patch you can apply.
              </div>
              <Button
                size="sm"
                variant={chatOpen ? "default" : "outline"}
                onClick={() => setChatOpen((v) => !v)}
              >
                <MessageSquare className="w-3.5 h-3.5 mr-1" />
                {chatOpen ? "Hide chat" : "Refine with AI"}
              </Button>
            </div>
            {chatOpen && (
              <DeepEvalChat
                kind={kind}
                id={id}
                token={token}
                currentEval={data}
                onApplied={(newEval, reason) => {
                  setData(newEval);
                  onAction(`Eval refined · ${reason}`);
                }}
              />
            )}
          </>
        )}
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
        <div className="flex flex-wrap items-baseline gap-2 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <span className="text-base font-bold">{verdict}</span>
          {typeof score === "number" && <span className="font-mono text-2xl font-bold text-zinc-900 dark:text-zinc-100">{score}<span className="text-base text-zinc-400 dark:text-zinc-400">/100</span></span>}
          {data.used_llm === false && <Badge className="bg-amber-100 text-amber-800 dark:text-amber-300">heuristic</Badge>}
          {data.used_llm === true && <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800">AI</Badge>}
        </div>
      )}
      {summary && <p className="text-zinc-500 dark:text-zinc-400">{summary}</p>}
      {services.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">🛠 What we could sell them</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {services.slice(0, 3).map((s: any, i: number) => (
              <div key={i} className="rounded-lg border border-zinc-200 bg-white dark:bg-zinc-900 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{s.icon || "🛠"}</span>
                  <span className="font-medium text-sm">{s.name}</span>
                </div>
                {s.description && <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.description}</p>}
                {s.deliverables && <ul className="text-xs mt-1.5 space-y-0.5">{s.deliverables.slice(0, 4).map((d: string, j: number) => <li key={j}>· {d}</li>)}</ul>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tiers.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1.5">💰 Pricing tiers — click to draft</div>
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
                    i === 1 ? "border-violet-400 bg-violet-50 dark:bg-violet-950/40/40" : "border-zinc-200 bg-white dark:bg-zinc-900"
                  } ${generatingTier === tierKey ? "animate-pulse" : ""}`}
                >
                  <div className="flex justify-between items-baseline">
                    <span className="font-semibold text-sm">{t.tier || t.name}</span>
                    {i === 1 && <Badge className="bg-violet-100 text-violet-800 dark:text-violet-300 text-[10px]">⭐ recommended</Badge>}
                  </div>
                  <div className="text-xl font-bold mt-1">${(t.price_min ?? t.min ?? 0).toLocaleString()}<span className="text-xs font-normal text-zinc-500 dark:text-zinc-400"> – ${(t.price_max ?? t.max ?? 0).toLocaleString()}</span></div>
                  {t.monthly_min && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${t.monthly_min} – ${t.monthly_max}/mo retain</div>}
                  {t.scope && <ul className="text-xs mt-2 space-y-0.5 text-zinc-500 dark:text-zinc-400">{t.scope.slice(0, 6).map((s: string, j: number) => <li key={j}>· {s}</li>)}</ul>}
                  <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center gap-1 text-xs text-violet-700 dark:text-violet-400 font-medium">
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
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">⚠️ Risk flags</div>
          <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">{data.risk_flags.slice(0, 5).map((r: string, i: number) => <li key={i}>· {r}</li>)}</ul>
        </div>
      )}
      {data.next_action && (
        <div className="rounded-lg bg-gradient-to-r from-emerald-50 to-cyan-50 p-3 border border-emerald-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">➡️ Next action</div>
          <p className="text-sm font-medium">{data.next_action}</p>
        </div>
      )}
    </div>
  );
}

// ── DeepEvalChat — refine the saved evaluation through a multi-turn LLM chat ─
//
// Each user message returns:
//   - reply: conversational response
//   - patch: optional structured change (add/remove/edit services/tiers/score/etc.)
//   - new_eval_preview: the merged result if you applied the patch
//
// Apply button saves new_eval as the canonical deep_evaluate (old one stays in
// opportunity_events history with _applied_reason). Conversation is persisted
// for multi-turn coherence and audit.

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  patch?: any;
  new_eval_preview?: any;
  applied?: boolean;
  rejected?: boolean;
  ts?: string;
};

function DeepEvalChat({
  kind, id, token, currentEval, onApplied,
}: {
  kind: string;
  id: string;
  token: string;
  currentEval: any;
  onApplied: (newEval: any, reason: string) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pendingPatch, setPendingPatch] = useState<{
    patch: any; new_eval_preview: any; turnIdx: number;
  } | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Always send the latest known evaluation
  const evalRef = useRef(currentEval);
  useEffect(() => { evalRef.current = currentEval; }, [currentEval]);

  // Autoscroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, sending]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    setSending(true);
    const userTurn: ChatTurn = { role: "user", content: msg, ts: new Date().toISOString() };
    setTurns((t) => [...t, userTurn]);
    try {
      const r = await fetch(
        `/api/admin/leads/${encodeURIComponent(id)}/chat-eval?kind=${kind}`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ message: msg, current_eval: evalRef.current }),
        }
      );
      const j = await r.json();
      if (!j.ok) {
        setTurns((t) => [...t, { role: "assistant", content: `⚠ ${j.error || "request failed"}: ${j.details || ""}`, ts: new Date().toISOString() }]);
        return;
      }
      const asst: ChatTurn = {
        role: "assistant",
        content: j.reply || "(no reply)",
        patch: j.patch || null,
        new_eval_preview: j.new_eval_preview || null,
        ts: new Date().toISOString(),
      };
      setTurns((t) => {
        const next = [...t, asst];
        if (j.patch && j.new_eval_preview) {
          setPendingPatch({ patch: j.patch, new_eval_preview: j.new_eval_preview, turnIdx: next.length - 1 });
        }
        return next;
      });
    } catch (e: any) {
      setTurns((t) => [...t, { role: "assistant", content: `⚠ ${e?.message || "network error"}`, ts: new Date().toISOString() }]);
    } finally { setSending(false); }
  };

  const applyPatch = async () => {
    if (!pendingPatch || applying) return;
    setApplying(true);
    try {
      const r = await fetch(
        `/api/admin/leads/${encodeURIComponent(id)}/chat-eval/apply?kind=${kind}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            new_eval: pendingPatch.new_eval_preview,
            reason: pendingPatch.patch.reason || "Chat refinement",
          }),
        }
      );
      const j = await r.json();
      if (!j.ok) {
        setTurns((t) => [...t, { role: "assistant", content: `⚠ apply failed: ${j.error || "unknown"}: ${j.details || ""}`, ts: new Date().toISOString() }]);
        return;
      }
      // Mark turn applied
      setTurns((t) => t.map((x, i) => i === pendingPatch.turnIdx ? { ...x, applied: true } : x));
      // Notify parent to swap in the new eval
      onApplied(pendingPatch.new_eval_preview, pendingPatch.patch.reason || "applied");
      setPendingPatch(null);
    } catch (e: any) {
      setTurns((t) => [...t, { role: "assistant", content: `⚠ ${e?.message || "apply network error"}`, ts: new Date().toISOString() }]);
    } finally { setApplying(false); }
  };

  const rejectPatch = () => {
    if (!pendingPatch) return;
    setTurns((t) => t.map((x, i) => i === pendingPatch.turnIdx ? { ...x, rejected: true } : x));
    setPendingPatch(null);
  };

  return (
    <div className="mt-3 rounded-lg border border-violet-200 dark:border-violet-700 bg-violet-50/30 dark:bg-violet-950/20 p-2">
      <div
        ref={scrollRef}
        className="max-h-72 overflow-y-auto overscroll-contain space-y-2 px-1 py-1"
      >
        {turns.length === 0 && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 px-2 py-3 text-center">
            💡 Try asking: <em>"Add a HIPAA compliance service"</em>, <em>"Why is the Growth tier $8k?"</em>, <em>"Drop the Starter tier — they're too small for our minimum"</em>, or <em>"Raise fit score to 80, they already have a procurement portal"</em>.
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`rounded-lg p-2 text-sm ${
              t.role === "user"
                ? "bg-cyan-100 dark:bg-cyan-900/40 ml-6"
                : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 mr-6"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400">
                {t.role === "user" ? "🧑 you" : "🤖 assistant"}
                {t.applied && <span className="ml-2 text-emerald-700 dark:text-emerald-400 normal-case font-normal">✓ applied</span>}
                {t.rejected && <span className="ml-2 text-zinc-500 dark:text-zinc-400 normal-case font-normal">dismissed</span>}
              </span>
              {t.ts && <span className="text-[10px] text-zinc-400 dark:text-zinc-400">{new Date(t.ts).toLocaleTimeString()}</span>}
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{t.content}</div>
            {t.patch && (
              <div className="mt-2 p-2 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                  📝 Proposed changes
                  {t.patch.reason && <span className="font-normal text-zinc-400 dark:text-zinc-400"> — {t.patch.reason}</span>}
                </div>
                <ul className="text-xs space-y-0.5">
                  {t.patch.set && Object.entries(t.patch.set).map(([k, v]) => (
                    <li key={k}><span className="text-zinc-500 dark:text-zinc-400">set</span> <code className="text-cyan-700 dark:text-cyan-300">{k}</code> → {JSON.stringify(v)}</li>
                  ))}
                  {t.patch.add_services?.map((s: any, j: number) => (
                    <li key={`as-${j}`}>+ service <strong>{s.name}</strong>{s.description && <span className="text-zinc-500 dark:text-zinc-400"> — {s.description.slice(0, 80)}{s.description.length > 80 ? "…" : ""}</span>}</li>
                  ))}
                  {t.patch.remove_service_names?.map((n: string, j: number) => (
                    <li key={`rs-${j}`}><span className="text-red-700 dark:text-red-400">− service</span> {n}</li>
                  ))}
                  {t.patch.add_pricing_tiers?.map((tier: any, j: number) => (
                    <li key={`at-${j}`}>+ tier <strong>{tier.tier}</strong> ${tier.price_min?.toLocaleString()}–${tier.price_max?.toLocaleString()}</li>
                  ))}
                  {t.patch.remove_pricing_tier_names?.map((n: string, j: number) => (
                    <li key={`rt-${j}`}><span className="text-red-700 dark:text-red-400">− tier</span> {n}</li>
                  ))}
                  {t.patch.edit_pricing_tiers?.map((tier: any, j: number) => (
                    <li key={`et-${j}`}>~ tier <strong>{tier.match_name}</strong> → ${tier.price_min?.toLocaleString()}–${tier.price_max?.toLocaleString()}/mo ${tier.monthly_min?.toLocaleString()}–${tier.monthly_max?.toLocaleString()}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 mr-6">
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Thinking…</span>
            </div>
          </div>
        )}
      </div>

      {pendingPatch && (
        <div className="mt-2 flex items-center gap-2 p-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-700">
          <span className="text-xs flex-1 text-emerald-900 dark:text-emerald-200">
            💡 Apply this patch to the saved evaluation?
          </span>
          <Button size="sm" variant="cta" onClick={applyPatch} disabled={applying} className="min-h-[36px]">
            {applying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
            Apply
          </Button>
          <Button size="sm" variant="outline" onClick={rejectPatch} disabled={applying} className="min-h-[36px]">
            <X className="w-3 h-3 mr-1" />
            Dismiss
          </Button>
        </div>
      )}

      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={2}
          placeholder="Ask the Mayor to refine the evaluation…"
          disabled={sending}
          className="flex-1 resize-none rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-sm p-2 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50"
        />
        <Button onClick={send} disabled={sending || !input.trim()} className="min-h-[44px]">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  );
}

// ── EUScouter — pull real EU businesses + EU gov contracts to outreach ───
//
// Two sources:
//   1. OpenStreetMap Overpass API — real businesses by category in EU cities
//      (no API key required). Free.
//   2. TED (Tenders Electronic Daily) — EU public procurement notices,
//      equivalent to SAM.gov. Free public data.
//
// Inserts new prospects / opportunities to D1 with proper source attribution
// so existing prospect-sources/scan and gov deep-evaluate pipelines pick them up.

const EU_COUNTRIES = [
  { code: "DE", label: "🇩🇪 Germany" },
  { code: "FR", label: "🇫🇷 France" },
  { code: "NL", label: "🇳🇱 Netherlands" },
  { code: "ES", label: "🇪🇸 Spain" },
  { code: "IT", label: "🇮🇹 Italy" },
  { code: "IE", label: "🇮🇪 Ireland" },
  { code: "BE", label: "🇧🇪 Belgium" },
  { code: "AT", label: "🇦🇹 Austria" },
  { code: "SE", label: "🇸🇪 Sweden" },
  { code: "DK", label: "🇩🇰 Denmark" },
  { code: "FI", label: "🇫🇮 Finland" },
  { code: "PL", label: "🇵🇱 Poland" },
];

const EU_VERTICALS = [
  "dental", "cafe", "restaurant", "gym", "clinic", "law_firm",
  "agency", "hotel", "spa", "veterinary", "coworking", "bakery",
  "florist", "accounting", "pharmacy",
];

function EUScouter({ token, onUpdate }: { token: string; onUpdate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [countries, setCountries] = useState<string[]>(["DE", "FR", "NL"]);
  const [verticals, setVerticals] = useState<string[]>(["dental", "cafe", "gym", "clinic"]);
  const [maxPerCity, setMaxPerCity] = useState(15);
  const [maxTotal, setMaxTotal] = useState(60);
  const [busyBiz, setBusyBiz] = useState(false);
  const [busyGov, setBusyGov] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [bizResult, setBizResult] = useState<any>(null);
  const [govResult, setGovResult] = useState<any>(null);
  const [daysBack, setDaysBack] = useState(14);
  const [minValueEur, setMinValueEur] = useState(0);

  const toggleCountry = (code: string) => {
    setCountries((cs) => cs.includes(code) ? cs.filter((c) => c !== code) : [...cs, code]);
  };
  const toggleVertical = (v: string) => {
    setVerticals((vs) => vs.includes(v) ? vs.filter((x) => x !== v) : [...vs, v]);
  };

  const runBusinesses = async () => {
    if (countries.length === 0) return;
    setBusyBiz(true);
    setBizResult(null);
    try {
      const r = await fetch("/api/admin/prospect-sources/eu-businesses", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          countries, verticals,
          max_per_city: maxPerCity,
          max_total: maxTotal,
          include_website_only: true,
          dry_run: dryRun,
        }),
      });
      const j = await r.json();
      setBizResult(j);
      if (j.ok && !dryRun && j.inserted > 0) onUpdate?.();
    } catch (e: any) {
      setBizResult({ ok: false, error: String(e?.message || e) });
    } finally { setBusyBiz(false); }
  };

  const runGov = async () => {
    if (countries.length === 0) return;
    setBusyGov(true);
    setGovResult(null);
    try {
      const r = await fetch("/api/admin/prospect-sources/eu-gov", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          countries,
          days_back: daysBack,
          min_value_eur: minValueEur,
          max_results: maxTotal,
          dry_run: dryRun,
        }),
      });
      const j = await r.json();
      setGovResult(j);
      if (j.ok && !dryRun && j.inserted > 0) onUpdate?.();
    } catch (e: any) {
      setGovResult({ ok: false, error: String(e?.message || e) });
    } finally { setBusyGov(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full text-left rounded-lg border border-dashed border-blue-300 hover:border-blue-500 hover:bg-blue-50 dark:bg-blue-950/30/30 transition p-3 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <span className="text-base">🇪🇺</span>
        <span className="font-medium text-blue-700 dark:text-blue-400">Find EU businesses + EU gov contracts to outreach</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto">12 EU markets · OSM + TED · free public sources</span>
      </button>
    );
  }

  return (
    <Card className="border-blue-300 bg-gradient-to-r from-blue-50/40 via-white to-cyan-50/40">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <span className="text-base">🇪🇺</span>
            EU scouter — businesses + gov contracts
          </h3>
          <button onClick={() => setOpen(false)} className="text-zinc-500 dark:text-zinc-400"><X className="w-4 h-4" /></button>
        </div>

        {/* Country + vertical selectors */}
        <div>
          <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">COUNTRIES ({countries.length} selected)</div>
          <div className="flex flex-wrap gap-1">
            {EU_COUNTRIES.map((c) => (
              <button key={c.code} onClick={() => toggleCountry(c.code)}
                className={`px-2 py-1 text-xs rounded-full border transition ${
                  countries.includes(c.code)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-400"
                }`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">VERTICALS (businesses only — {verticals.length})</div>
          <div className="flex flex-wrap gap-1">
            {EU_VERTICALS.map((v) => (
              <button key={v} onClick={() => toggleVertical(v)}
                className={`px-2 py-1 text-xs rounded-full border transition ${
                  verticals.includes(v)
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-emerald-400"
                }`}>
                {v.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="text-xs flex flex-col gap-0.5">
            <span className="text-zinc-500 dark:text-zinc-400">Max per city</span>
            <Input type="number" min={1} max={50} value={maxPerCity} onChange={(e) => setMaxPerCity(Number(e.target.value) || 15)} className="text-sm h-9" />
          </label>
          <label className="text-xs flex flex-col gap-0.5">
            <span className="text-zinc-500 dark:text-zinc-400">Max total</span>
            <Input type="number" min={1} max={500} value={maxTotal} onChange={(e) => setMaxTotal(Number(e.target.value) || 60)} className="text-sm h-9" />
          </label>
          <label className="text-xs flex flex-col gap-0.5">
            <span className="text-zinc-500 dark:text-zinc-400">Gov days back</span>
            <Input type="number" min={1} max={60} value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value) || 14)} className="text-sm h-9" />
          </label>
          <label className="text-xs flex flex-col gap-0.5">
            <span className="text-zinc-500 dark:text-zinc-400">Min gov value €</span>
            <Input type="number" min={0} value={minValueEur} onChange={(e) => setMinValueEur(Number(e.target.value) || 0)} className="text-sm h-9" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-blue-600" />
          <span className="text-zinc-500 dark:text-zinc-400">
            <strong>Dry run</strong> — preview results without inserting to DB
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="cta" onClick={runBusinesses} disabled={busyBiz || busyGov || countries.length === 0} className="min-h-[40px]">
            {busyBiz ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
            🧲 {dryRun ? "Preview" : "Import"} EU businesses
          </Button>
          <Button size="sm" variant="outline" onClick={runGov} disabled={busyBiz || busyGov || countries.length === 0} className="min-h-[40px]">
            {busyGov ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
            🏛 {dryRun ? "Preview" : "Import"} EU gov contracts
          </Button>
        </div>

        {bizResult && (
          <div className={`text-xs rounded p-2 ${bizResult.ok ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 dark:bg-red-950/30 border border-red-200"}`}>
            {bizResult.ok ? (
              <>
                <div className="font-semibold text-emerald-800 mb-1">
                  {dryRun ? "🔍 Preview · " : "✓ Imported · "}
                  {bizResult.results_found} businesses found · {bizResult.unique_after_dedup} unique
                  {!dryRun && ` · ${bizResult.inserted} new · ${bizResult.skipped_existing} skipped`}
                </div>
                {bizResult.sample && bizResult.sample.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-zinc-500 dark:text-zinc-400">
                    {bizResult.sample.map((b: any, i: number) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 w-4">{i + 1}.</span>
                        <strong className="truncate flex-1">{b.business_name}</strong>
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· {b.city}, {b.country}</span>
                        <span className="text-[10px] text-blue-700 dark:text-blue-400">· {b.vertical}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="text-red-700 dark:text-red-400">⚠ {bizResult.error || "failed"}</div>
            )}
          </div>
        )}

        {govResult && (
          <div className={`text-xs rounded p-2 ${govResult.ok ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200" : "bg-red-50 dark:bg-red-950/30 border border-red-200"}`}>
            {govResult.ok ? (
              <>
                <div className="font-semibold text-blue-800 mb-1">
                  {dryRun ? "🔍 Preview · " : "✓ Imported · "}
                  {govResult.results_found} EU gov contracts found ({govResult.source})
                  {!dryRun && ` · ${govResult.inserted} new · ${govResult.skipped_existing} skipped`}
                </div>
                {govResult.sample && govResult.sample.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-zinc-500 dark:text-zinc-400">
                    {govResult.sample.map((g: any, i: number) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 w-4">{i + 1}.</span>
                        <strong className="truncate flex-1">{g.title}</strong>
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· {g.buyer}, {g.country}</span>
                        {g.deadline && <span className="text-[10px] text-amber-700 dark:text-amber-400">· due {g.deadline}</span>}
                        {g.value && <span className="text-[10px] text-emerald-700 dark:text-emerald-400">· €{g.value?.toLocaleString()}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="text-red-700 dark:text-red-400">⚠ {govResult.error || "failed"}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Deep Analyze (full AI analysis with pricing + execution plan + Mayor chat) ──
// Goes far beyond DeepEval. Uses the /api/admin/prospects/<id>/deep-analyze
// endpoint. Cached for 12h. User can refine via /chat-analyze (multi-turn).

function DeepAnalyze({ id, token, onAction }: { id: string; token: string; onAction: (msg: string) => void }) {
  const [open, setOpen] = useState(true);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"plan"|"chat"|"json">("plan");
  const [cached, setCached] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const load = async (force = false) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/prospects/${encodeURIComponent(id)}/deep-analyze`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const j = await r.json();
      if (!j.ok) { setError(j.error || "failed"); return; }
      setAnalysis(j.analysis);
      setCached(!!j.cached);
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  return (
    <Card className="border-2 border-violet-200 dark:border-violet-800">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-500" /> Mayor Deep-Analyze
              <Badge variant="secondary" className="text-[10px]">2026 c2c pricing</Badge>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Full business intel + 3-tier pricing + execution plan · 12h cache</p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Open"}</Button>
          </div>
        </div>

        {!open ? null : !analysis && !loading && !error ? (
          <div className="text-center py-6 space-y-3">
            <Sparkles className="w-8 h-8 text-violet-400 mx-auto" />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Generate a complete analysis: pain points, services, 3-tier pricing, 4-12 week plan, and outreach hook.
            </p>
            <Button onClick={() => load(false)} className="bg-violet-600 hover:bg-violet-700">
              <Brain className="w-4 h-4 mr-2" /> Analyze this business
            </Button>
          </div>
        ) : null}

        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2 text-violet-500" />
            Analyzing… (LLM call, ~10-30s)
          </div>
        )}

        {error && (
          <div className="text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 text-red-700 dark:text-red-300">
            ⚠ {error}
          </div>
        )}

        {analysis && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1">
                {[
                  { k: "plan", label: "Plan" },
                  { k: "chat", label: "💬 Refine" },
                  { k: "json", label: "JSON" },
                ].map((t) => (
                  <button key={t.k}
                    onClick={() => { setActiveTab(t.k as any); if (t.k === "chat") setChatOpen(true); }}
                    className={`px-3 py-1 rounded text-xs font-medium transition ${activeTab === t.k ? "bg-violet-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1">
                {cached && <Badge variant="outline" className="text-[10px]">cached</Badge>}
                <Button size="sm" variant="ghost" onClick={() => load(true)} className="h-7 text-xs">
                  <RefreshCw className="w-3 h-3 mr-1" />Re-run
                </Button>
              </div>
            </div>

            {activeTab === "plan" && <DeepAnalyzeView analysis={analysis} />}
            {activeTab === "chat" && chatOpen && (
              <DeepAnalyzeChat
                id={id} token={token}
                analysis={analysis}
                onApply={(updated) => { setAnalysis(updated); onAction("Analysis updated"); }}
                onClose={() => { setChatOpen(false); setActiveTab("plan"); }}
              />
            )}
            {activeTab === "json" && (
              <pre className="text-[10px] bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(analysis, null, 2)}
              </pre>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Pretty rendering of the deep-analysis JSON
function DeepAnalyzeView({ analysis }: { analysis: any }) {
  const verdict = analysis.verdict || "🟡 evaluate further";
  const fitScore = Number(analysis.fit_score || 0);
  const conf = analysis.confidence || "medium";
  const bi = analysis.business_intelligence || {};
  const pains = analysis.pain_points || [];
  const services = analysis.proposed_services || [];
  const tiers = analysis.pricing_tiers || [];
  const plan = analysis.execution_plan || [];
  const risks = analysis.risk_flags || [];
  const out = analysis.outreach_angle || {};

  return (
    <div className="space-y-3">
      {/* Verdict + score */}
      <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800/50 rounded p-3">
        <div className="text-2xl">{verdict.includes("🟢") ? "🟢" : verdict.includes("🔴") ? "🔴" : "🟡"}</div>
        <div className="flex-1">
          <div className="font-semibold text-sm">{verdict}</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">confidence: {conf} · reasoning below</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-violet-600 dark:text-violet-400">{fitScore}</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">/100 fit</div>
        </div>
      </div>

      {/* Business intel */}
      <details className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-3" open>
        <summary className="font-semibold text-sm cursor-pointer flex items-center gap-2">
          🏢 Business Intelligence
        </summary>
        <div className="mt-2 space-y-1.5 text-xs">
          {bi.what_they_do && <p><span className="font-semibold">What they do:</span> {bi.what_they_do}</p>}
          {bi.target_market && <p><span className="font-semibold">Target market:</span> {bi.target_market}</p>}
          <div className="grid grid-cols-2 gap-2">
            {bi.likely_revenue_band && <div><span className="text-zinc-500 dark:text-zinc-400">Revenue band:</span> {bi.likely_revenue_band}</div>}
            {bi.likely_team_size && <div><span className="text-zinc-500 dark:text-zinc-400">Team:</span> {bi.likely_team_size}</div>}
          </div>
          {(bi.tech_stack_signals?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {bi.tech_stack_signals.map((t: string, i: number) => (
                <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Pain points */}
      {pains.length > 0 && (
        <details className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-3" open>
          <summary className="font-semibold text-sm cursor-pointer flex items-center gap-2">
            ⚠ Pain Points <Badge variant="secondary" className="text-[10px]">{pains.length}</Badge>
          </summary>
          <ul className="mt-2 space-y-2">
            {pains.map((p: any, i: number) => {
              const sevColor = p.severity === "critical" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                : p.severity === "high" ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                : p.severity === "medium" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200";
              return (
                <li key={i} className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sevColor}`}>{p.severity}</span>
                    <strong className="text-sm">{p.title}</strong>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-auto">{p.estimated_hours}h</span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5"><span className="font-semibold">Evidence:</span> {p.evidence}</p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5"><span className="font-semibold">Fix:</span> {p.fix_summary}</p>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {/* Services */}
      {services.length > 0 && (
        <details className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-3">
          <summary className="font-semibold text-sm cursor-pointer flex items-center gap-2">
            🛠 Services We'd Offer <Badge variant="secondary" className="text-[10px]">{services.length}</Badge>
          </summary>
          <div className="mt-2 space-y-2">
            {services.map((s: any, i: number) => (
              <div key={i} className="border border-zinc-200 dark:border-zinc-700 rounded p-2 bg-white dark:bg-zinc-900">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{s.icon}</span>
                  <strong className="text-sm">{s.name}</strong>
                  <Badge variant="outline" className="text-[10px] ml-auto">{s.estimated_hours}h @ ${s.blended_hourly_rate}/hr</Badge>
                </div>
                {s.description && <p className="text-xs text-zinc-600 dark:text-zinc-300">{s.description}</p>}
                {s.deliverables?.length > 0 && (
                  <ul className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 list-disc pl-4">
                    {s.deliverables.map((d: string, j: number) => <li key={j}>{d}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Pricing tiers */}
      {tiers.length > 0 && (
        <details className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-3" open>
          <summary className="font-semibold text-sm cursor-pointer flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-500" /> Pricing Tiers
            <Badge variant="secondary" className="text-[10px]">2026 c2c</Badge>
          </summary>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {tiers.map((t: any, i: number) => {
              const isMid = t.tier === "Growth";
              return (
                <div key={i} className={`rounded p-3 border-2 ${isMid ? "border-emerald-400 bg-emerald-50/40 dark:bg-emerald-900/10" : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <strong className="text-sm">{t.tier}</strong>
                    {isMid && <Badge className="bg-emerald-500 text-[10px]">Recommended</Badge>}
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 mb-2">{t.rationale}</p>
                  <div className="space-y-1 text-xs">
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                      ${t.one_time_min?.toLocaleString()} – ${t.one_time_max?.toLocaleString()}
                    </div>
                    <div className="text-zinc-500 dark:text-zinc-400">one-time · {t.estimated_total_hours}h</div>
                    {t.monthly_min > 0 && (
                      <div className="text-zinc-700 dark:text-zinc-300">
                        + ${t.monthly_min} – ${t.monthly_max}/mo retainer
                      </div>
                    )}
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">~{t.estimated_completion_weeks} weeks</div>
                  </div>
                  {t.scope?.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[10px] cursor-pointer text-zinc-600 dark:text-zinc-400">scope ({t.scope.length} items)</summary>
                      <ul className="text-[10px] text-zinc-600 dark:text-zinc-300 mt-1 list-disc pl-3">
                        {t.scope.map((s: string, j: number) => <li key={j}>{s}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Execution plan */}
      {plan.length > 0 && (
        <details className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-3">
          <summary className="font-semibold text-sm cursor-pointer flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-500" /> Execution Plan
            <Badge variant="secondary" className="text-[10px]">{plan.length} weeks</Badge>
          </summary>
          <ol className="mt-2 space-y-1.5">
            {plan.map((w: any, i: number) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 text-xs font-bold flex items-center justify-center">
                  W{w.week}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm">{w.phase}</strong>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{w.estimated_hours}h</span>
                  </div>
                  {w.milestones?.length > 0 && (
                    <ul className="text-xs text-zinc-600 dark:text-zinc-300 list-disc pl-4 mt-0.5">
                      {w.milestones.map((m: string, j: number) => <li key={j}>{m}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* Risk flags */}
      {risks.length > 0 && (
        <details className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-3">
          <summary className="font-semibold text-sm cursor-pointer flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Risks <Badge variant="secondary" className="text-[10px]">{risks.length}</Badge>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {risks.map((r: any, i: number) => (
              <li key={i} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={`text-[10px] ${r.severity === "high" ? "border-red-400 text-red-700 dark:text-red-300" : r.severity === "medium" ? "border-amber-400 text-amber-700 dark:text-amber-300" : "border-zinc-400 text-zinc-600 dark:text-zinc-300"}`}>{r.severity}</Badge>
                  <strong>{r.risk}</strong>
                </div>
                <p className="text-zinc-600 dark:text-zinc-300 ml-1 mt-0.5">↪ {r.mitigation}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Outreach angle */}
      {out.hook && (
        <details className="bg-gradient-to-br from-emerald-50 to-cyan-50 dark:from-emerald-900/20 dark:to-cyan-900/20 rounded p-3" open>
          <summary className="font-semibold text-sm cursor-pointer flex items-center gap-2">
            ✉️ Outreach Angle
          </summary>
          <div className="mt-2 space-y-1.5 text-xs">
            <div><span className="text-zinc-500 dark:text-zinc-400">Subject:</span> <strong>{out.subject_line}</strong></div>
            <div className="bg-white dark:bg-zinc-900 rounded p-2 border border-zinc-200 dark:border-zinc-700">
              <p className="italic">{out.hook}</p>
              {out.call_to_action && <p className="mt-1 font-semibold">{out.call_to_action}</p>}
            </div>
          </div>
        </details>
      )}

      {analysis.reasoning_summary && (
        <div className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50 rounded p-2 italic">
          💭 {analysis.reasoning_summary}
        </div>
      )}

      {analysis.next_action && (
        <div className="text-xs bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded p-2 flex items-start gap-2">
          <Zap className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
          <span><span className="font-semibold">Next action:</span> {analysis.next_action}</span>
        </div>
      )}
    </div>
  );
}

// Multi-turn chat to refine the deep analysis. Sends message → LLM proposes
// a structured patch → user previews the merged analysis → applies to save.
function DeepAnalyzeChat({ id, token, analysis, onApply, onClose }: any) {
  const [messages, setMessages] = useState<Array<{ role: "user"|"assistant"; content: string; patch?: any }>>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<any>(analysis);
  const [pendingPatch, setPendingPatch] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCurrentAnalysis(analysis); }, [analysis]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, pendingPatch]);

  const send = async () => {
    const txt = input.trim();
    if (!txt || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: txt }]);
    try {
      const r = await fetch(`/api/admin/prospects/${encodeURIComponent(id)}/chat-analyze`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ message: txt, current_analysis: currentAnalysis }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      setMessages((m) => [...m, { role: "assistant", content: j.reply, patch: j.patch }]);
      if (j.patch) {
        setPendingPatch(j.patch);
        setPreview(j.new_analysis_preview);
      } else {
        setPendingPatch(null);
        setPreview(null);
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠ ${String(e?.message || e)}` }]);
    }
    setBusy(false);
  };

  const apply = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/prospects/${encodeURIComponent(id)}/chat-analyze/apply`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ new_analysis: preview, reason: pendingPatch?.reason || "Chat refinement" }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      setCurrentAnalysis(preview);
      setPendingPatch(null);
      setPreview(null);
      onApply?.(preview);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠ ${String(e?.message || e)}` }]);
    }
    setBusy(false);
  };

  const dismiss = () => { setPendingPatch(null); setPreview(null); };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-violet-500" />
          <strong className="text-sm">Mayor — refine the analysis</strong>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>×</Button>
      </div>

      {/* Message thread */}
      <div ref={scrollRef} className="bg-zinc-50 dark:bg-zinc-800/30 rounded border border-zinc-200 dark:border-zinc-700 p-2 max-h-72 overflow-y-auto space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 italic text-center py-4">
            Try: "make it sound less corporate", "drop the Premium tier", "add a risk about slow content updates", "raise the Growth one-time to $15k", "tighten the outreach hook to one sentence"
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "bg-violet-600 text-white" : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.patch && (
                <div className="mt-1 text-[10px] opacity-80">
                  📝 proposed patch: {Object.keys(m.patch).filter((k) => k !== "reason").join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Pending patch preview */}
      {pendingPatch && preview && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-800 rounded p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <strong className="text-sm text-emerald-800 dark:text-emerald-200">Patch ready to apply</strong>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-300 ml-auto">{pendingPatch.reason}</span>
          </div>
          <details>
            <summary className="text-xs cursor-pointer text-emerald-700 dark:text-emerald-300">Show preview diff</summary>
            <div className="mt-2 text-[10px] space-y-1 max-h-40 overflow-y-auto">
              {pendingPatch.set && Object.entries(pendingPatch.set).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <Badge variant="outline" className="text-[9px]">set {k}</Badge>
                  <span className="font-mono">{JSON.stringify(v)}</span>
                </div>
              ))}
              {pendingPatch.add_pain_points?.map((p: any, i: number) => (
                <div key={"pp"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px] bg-green-100">+ pain</Badge><span>{p.title}</span></div>
              ))}
              {pendingPatch.remove_pain_points?.map((t: string, i: number) => (
                <div key={"rp"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px] bg-red-100 dark:bg-red-900/40">− pain</Badge><span>{t}</span></div>
              ))}
              {pendingPatch.edit_services?.map((s: any, i: number) => (
                <div key={"es"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px]">edit svc</Badge><span>{s.match_name}</span></div>
              ))}
              {pendingPatch.add_services?.map((s: any, i: number) => (
                <div key={"as"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px] bg-green-100">+ svc</Badge><span>{s.name}</span></div>
              ))}
              {pendingPatch.remove_services?.map((t: string, i: number) => (
                <div key={"rs"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px] bg-red-100 dark:bg-red-900/40">− svc</Badge><span>{t}</span></div>
              ))}
              {pendingPatch.edit_tiers?.map((t: any, i: number) => (
                <div key={"et"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px]">edit tier</Badge><span>{t.match_tier}</span></div>
              ))}
              {pendingPatch.add_tiers?.map((t: any, i: number) => (
                <div key={"at"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px] bg-green-100">+ tier</Badge><span>{t.tier}</span></div>
              ))}
              {pendingPatch.remove_tiers?.map((t: string, i: number) => (
                <div key={"rt"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px] bg-red-100 dark:bg-red-900/40">− tier</Badge><span>{t}</span></div>
              ))}
              {pendingPatch.edit_plan_weeks?.map((w: any, i: number) => (
                <div key={"ew"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px]">edit W{w.match_week}</Badge></div>
              ))}
              {pendingPatch.add_plan_weeks?.map((w: any, i: number) => (
                <div key={"aw"+i} className="flex gap-2"><Badge variant="outline" className="text-[9px] bg-green-100">+ W{w.week}</Badge></div>
              ))}
              {pendingPatch.set_outreach && (
                <div className="flex gap-2"><Badge variant="outline" className="text-[9px]">set outreach</Badge></div>
              )}
            </div>
          </details>
          <div className="flex gap-2">
            <Button size="sm" onClick={apply} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
              <Check className="w-3 h-3 mr-1" />Apply + save
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>Dismiss</Button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask Mayor to change something or ask about the analysis…"
          disabled={busy}
          className="text-sm"
        />
        <Button onClick={send} disabled={busy || !input.trim()} size="sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
// Live job search across RemoteOK, WeWorkRemotely, and ArbeitNow public feeds.
// Inserts matched jobs as new prospects so the scan + draft + outreach
// pipelines pick them up automatically.

function FindJobsPanel({ token, onUpdate }: { token: string; onUpdate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [sources, setSources] = useState<string[]>(["remoteok", "arbeitnow", "remotive", "himalayas"]);
  const [minBudget, setMinBudget] = useState(0);
  const [maxResults, setMaxResults] = useState(40);
  const [kwText, setKwText] = useState("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const toggleSrc = (s: string) =>
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const run = async () => {
    setBusy(true); setResult(null);
    try {
      const keywords = kwText.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await fetch("/api/admin/prospect-sources/find-jobs", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          sources, min_budget_usd: minBudget, max_results: maxResults,
          keywords: keywords.length ? keywords : undefined,
          dry_run: dryRun,
        }),
      });
      const j = await r.json();
      setResult(j);
      if (j?.ok && !dryRun && j.inserted > 0) onUpdate?.();
    } catch (e) { setResult({ ok: false, error: String(e) }); }
    setBusy(false);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">💼 Find Jobs Right Now</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Live remote + freelance postings · auto-imported as prospects</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Open"}</Button>
        </div>
        {!open ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pulls from <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">RemoteOK</code>, <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">ArbeitNow</code>, <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">Remotive</code>, <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">Himalayas</code> — filtered to your keywords + last 14 days.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "remoteok", label: "RemoteOK" },
                { id: "arbeitnow", label: "ArbeitNow" },
                { id: "remotive", label: "Remotive" },
                { id: "himalayas", label: "Himalayas" },
              ].map((s) => (
                <button key={s.id}
                  onClick={() => toggleSrc(s.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${sources.includes(s.id) ? "bg-emerald-500 text-white border-emerald-500" : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs space-y-1">
                <span className="text-zinc-500 dark:text-zinc-400">Min salary (USD/yr or $/hr equiv)</span>
                <Input type="number" min="0" step="5000" value={minBudget} onChange={(e) => setMinBudget(Number(e.target.value || 0))} className="h-8 text-xs" />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-zinc-500 dark:text-zinc-400">Max results</span>
                <Input type="number" min="5" max="200" step="5" value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value || 40))} className="h-8 text-xs" />
              </label>
            </div>
            <Input
              placeholder="Extra keywords (comma-separated) — leave blank for default list"
              value={kwText}
              onChange={(e) => setKwText(e.target.value)}
              className="text-xs"
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="rounded" />
              <span className="text-zinc-600 dark:text-zinc-300">Dry run (preview only — don't import)</span>
            </label>
            <Button onClick={run} disabled={busy || sources.length === 0} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              {busy ? "Searching…" : dryRun ? "🔍 Preview matches" : `🚀 Find + Import ${sources.length === 1 ? sources[0] : sources.length + " sources"}`}
            </Button>
            {result && (
              <div className={`text-xs rounded p-3 space-y-2 ${result.ok ? "bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800" : "bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800"}`}>
                {result.ok ? (
                  <>
                    <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                      {result.dry_run ? "🔍 Preview — " : "✓ Imported — "}
                      {result.fetched} fetched → {result.unique_after_dedup} unique
                      {!result.dry_run && ` · ${result.inserted} new prospects · ${result.skipped_existing} already in CRM`}
                    </div>
                    {result.sample?.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {result.sample.map((j: any, i: number) => (
                          <li key={i} className="border-l-2 border-emerald-300 dark:border-emerald-700 pl-2 py-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 w-4">{i + 1}.</span>
                              <a href={j.url} target="_blank" rel="noreferrer" className="font-medium text-blue-700 dark:text-blue-400 hover:underline truncate flex-1">
                                {j.title}
                              </a>
                              <a href={j.url} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 text-zinc-400" /></a>
                            </div>
                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-5">
                              {j.company} · {j.location || "Remote"} · <Badge variant="secondary" className="text-[9px] py-0">{j.source}</Badge>
                              {(j.salary_min || j.salary_max) && (
                                <span className="ml-1 text-emerald-700 dark:text-emerald-400">
                                  {j.salary_min ? `$${j.salary_min.toLocaleString()}` : ""}{j.salary_min && j.salary_max ? "–" : ""}{j.salary_max ? `$${j.salary_max.toLocaleString()}` : ""}
                                </span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {result.errors?.length > 0 && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-2">
                        ⚠ {result.errors.length} source errors (see logs)
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-red-700 dark:text-red-300">⚠ {result.error || "failed"}</div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
