// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Send, CheckCircle2, X, ChevronDown, ChevronRight, Briefcase, FileText, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, useAdminSession } from "./AdminChrome";

export default function AdminAutoTender() {
  const { token, logout, isLoggedIn } = useAdminSession();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  const runs = useQuery({
    enabled: !!token && isLoggedIn,
    queryKey: ["admin-auto-tender", token],
    queryFn: async () => {
      const r = await fetch(`/api/admin/auto-tender?limit=50`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  const filtered = (runs.data?.items || []).filter((r) => {
    if (activeTab === "all") return true;
    if (activeTab === "pending") return r.status === "running" || r.status === "completed";
    if (activeTab === "approved") return r.status === "approved";
    if (activeTab === "rejected") return r.status === "rejected";
    return true;
  });

  const triggerPipeline = async () => {
    if (running) return;
    setRunning(true);
    setRunResult(null);
    try {
      const r = await fetch(`/api/admin/auto-tender`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.details || data?.error || "pipeline_failed");
      setRunResult(data);
      runs.refetch();
    } catch (e) {
      setRunResult({ ok: false, error: String(e?.message || e) });
    }
    setRunning(false);
  };

  const triggerOne = async (samId) => {
    if (running) return;
    setRunning(true);
    try {
      const r = await fetch(`/api/admin/auto-tender`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sam_id: samId }),
      });
      const data = await r.json();
      setRunResult(data);
      runs.refetch();
    } finally {
      setRunning(false);
    }
  };

  const decide = async (runId, decision, note) => {
    const r = await fetch(`/api/admin/auto-tender/${encodeURIComponent(runId)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    if (r.ok) runs.refetch();
  };

  const draft = useQuery({
    enabled: !!openRunId && !!token,
    queryKey: ["admin-auto-tender-draft", token, openRunId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/auto-tender/runs/${encodeURIComponent(openRunId!)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  if (!isLoggedIn) return <div className="p-6">Loading session…</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav token={token} onLogout={logout} isLoading={runs.isFetching} />

      {/* Header */}
      <Card className="mb-4 border-2 border-violet-300">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-violet-500" /> Auto-tender
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Morning bid pipeline. Drafts appear here after the cron fires (or after you click Run). Owner approves before anything goes out.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Window: {(runs.data?.window || [1, 10]).join("…")} days &middot; Cap per run: {runs.data?.per_run_limit || 5} &middot;
                One draft per SAM per calendar day (idempotent).
              </p>
            </div>
            <Button variant="cta" size="lg" onClick={triggerPipeline} disabled={running}>
              {running ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {running ? "Drafting…" : "Run pipeline now"}
            </Button>
          </div>

          {runResult && (
            <div className={`mt-3 rounded-md p-3 text-sm border ${runResult.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
              {runResult.ok
                ? <>✅ Pipeline ran. Drafted <strong>{runResult.drafted}</strong> of <strong>{runResult.runs?.length || 0}</strong> candidate SAM items.</>
                : <>✗ {String(runResult.error || runResult.details || "failed")}</>}
              {runResult.runs?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {runResult.runs.map((r, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">{r.status}</span> &middot; {r.title || r.sam_id}
                      {r.skipped && <em className="text-gray-600"> ({r.reason})</em>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filter chips */}
      <div className="flex gap-2 mb-3 text-sm">
        {(["pending", "approved", "rejected", "all"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setActiveTab(k)}
            className={`px-3 py-1 rounded-full border ${activeTab === k ? "bg-blue-100 border-blue-500 text-blue-900 font-medium" : "border-zinc-200 text-zinc-700"}`}
          >
            {k === "pending" ? "🟡 Pending / Running" : k === "approved" ? "✅ Approved" : k === "rejected" ? "❌ Rejected" : "All"}
            {runs.data?.items && (
              <span className="ml-1 text-xs text-gray-500">({runs.data.items.filter((r) => k === "all" || (k === "pending" ? (r.status === "running" || r.status === "completed") : r.status === k)).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {runs.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          {String((runs.error as Error)?.message || runs.error)}
        </div>
      )}

      {filtered.length === 0 && !runs.isFetching ? (
        <Card><CardContent className="py-12 text-center text-sm text-gray-500">
          No runs {activeTab !== "all" ? `matching "${activeTab}"` : "yet"}. Click <strong>Run pipeline now</strong> above to test, or wait for the morning cron.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <RunCard
              key={r.id}
              run={r}
              onSelect={() => setOpenRunId(r.id === openRunId ? null : r.id)}
              isOpen={r.id === openRunId}
              draft={draft.data}
              loadingDraft={draft.isFetching && draft.isPending !== false}
              onRedraft={() => triggerOne(r.sam_item_id)}
              onDecide={(d) => decide(r.id, d)}
              running={running}
            />
          ))}
        </div>
      )}

      {/* Hidden: when toggling openRunId we re-render the expandable. The expanded view is inside RunCard. */}
    </div>
  );
}

function RunCard({ run, onSelect, isOpen, draft, loadingDraft, onRedraft, onDecide, running }: any) {
  const statusColor =
    run.status === "completed" ? "bg-amber-100 text-amber-800" :
    run.status === "approved" ? "bg-emerald-100 text-emerald-800" :
    run.status === "rejected" ? "bg-red-100 text-red-800" :
    run.status === "failed"    ? "bg-red-100 text-red-800" :
    run.status === "running"   ? "bg-blue-100 text-blue-800" :
                                "bg-zinc-100 text-zinc-700";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <button onClick={onSelect} className="text-gray-400 hover:text-gray-700">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-[260px]">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{run.sam_item_title || run.sam_item_id}</h3>
              <Badge className={statusColor}>{run.status}</Badge>
              {run.sam_item_fit_score != null && <span className="text-xs text-gray-500">🎯 fit {run.sam_item_fit_score}</span>}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              🕒 {new Date(run.triggered_at).toLocaleString()}
              {run.completed_at && <> &middot; ⏱️ completed {new Date(run.completed_at).toLocaleString()}</>}
              {run.sam_item_deadline && <> &middot; 📅 deadline {run.sam_item_deadline}</>}
            </div>
            {run.status_detail && run.status_detail !== "ok" && (
              <div className="text-xs text-amber-700 mt-1">⚠️ {run.status_detail}</div>
            )}
            {run.errors?.length > 0 && (
              <div className="text-xs text-red-700 mt-1">⚠️ {run.errors.slice(0, 3).join("; ")}</div>
            )}
          </div>
          <div className="flex gap-2">
            {(run.status === "completed" || run.status === "running") && (
              <>
                <Button variant="cta" size="sm" onClick={(e) => { e.stopPropagation(); onDecide("approve"); }}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />Approve
                </Button>
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onDecide("reject"); }}>
                  <X className="w-4 h-4 mr-1" />Reject
                </Button>
              </>
            )}
            {run.sam_item_id && (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRedraft(); }} disabled={running}>
                <Sparkles className="w-4 h-4 mr-1" />Re-draft
              </Button>
            )}
          </div>
        </div>

        {isOpen && (
          <div className="mt-4 border-t border-zinc-200 pt-4">
            {loadingDraft ? (
              <div className="text-sm text-gray-500"><Loader2 className="inline w-4 h-4 animate-spin mr-1" /> Generating draft…</div>
            ) : draft ? (
              <DraftView draft={draft} />
            ) : (
              <div className="text-xs text-gray-500">Click the chevron / row to load the draft.</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DraftView({ draft }: any) {
  const d = draft.draft;
  if (!d) {
    return (
      <div className="text-sm text-amber-700">
        No draft produced. Run errors: {(draft.errors || []).slice(0, 3).join("; ") || "unknown"}
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-1">
        {d.llmCoverLetter && <Badge className="bg-violet-100 text-violet-800">cover ✨ LLM</Badge>}
        {d.llmSectionK && <Badge className="bg-violet-100 text-violet-800">section-K ✨ LLM</Badge>}
        {d.llmCapabilityNarrative && <Badge className="bg-violet-100 text-violet-800">capability ✨ LLM</Badge>}
        {d.llmSectionBPricing && <Badge className="bg-violet-100 text-violet-800">pricing ✨ LLM</Badge>}
        {!d.llmCoverLetter && !d.llmSectionK && !d.llmCapabilityNarrative && !d.llmSectionBPricing && (
          <Badge className="bg-amber-100 text-amber-800">heuristic only — LLM unreachable</Badge>
        )}
      </div>

      {d.coverLetter && (
        <Section title={<><Send className="inline w-4 h-4 mr-1" /> Cover letter</>}>
          <pre className="whitespace-pre-wrap text-xs bg-zinc-50 p-3 rounded">{d.coverLetter}</pre>
        </Section>
      )}

      {d.capabilityNarrative && (
        <Section title={<><Layers className="inline w-4 h-4 mr-1" /> Capability narrative</>}>
          <pre className="whitespace-pre-wrap text-xs bg-zinc-50 p-3 rounded">{d.capabilityNarrative}</pre>
        </Section>
      )}

      {d.sectionBMarkdown && (
        <Section title={<><FileText className="inline w-4 h-4 mr-1" /> Section B — pricing</>}>
          <pre className="whitespace-pre-wrap text-xs bg-zinc-50 p-3 rounded">{d.sectionBMarkdown}</pre>
        </Section>
      )}

      {d.sectionK && (
        <Section title={<><Briefcase className="inline w-4 h-4 mr-1" /> Section K — compliance matrix</>}>
          <details><summary className="text-xs text-blue-600 cursor-pointer">show JSON</summary>
            <pre className="whitespace-pre-wrap text-xs bg-zinc-50 p-3 rounded">{JSON.stringify(d.sectionK, null, 2)}</pre>
          </details>
        </Section>
      )}

      {d.ownerConfirmationItems?.length > 0 && (
        <Section title="⚠️ Owner confirmation required">
          <ul className="text-xs space-y-1">
            {d.ownerConfirmationItems.map((s, i) => <li key={i}>• {s}</li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: any) {
  return (
    <div className="border border-zinc-200 rounded p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}
