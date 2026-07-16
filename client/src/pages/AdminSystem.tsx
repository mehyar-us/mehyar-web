// @ts-nocheck
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Sparkles, Database, History, Clock, AlertTriangle,
  RefreshCw, Download, ShieldCheck, Server, Save, Bell, FileText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { AdminNav, JarvisBar, AdminGate, useAdminSession } from "./AdminShell";

async function fetchAudit(token: string, q: string) {
  const r = await fetch(`/api/admin/audit?q=${encodeURIComponent(q)}&limit=80`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function fetchCron(token: string) {
  const r = await fetch("/api/admin/cron/runs?limit=50", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function fetchHealth(token: string) {
  const r = await fetch("/api/admin/health", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export default function AdminSystem() {
  return <AdminGate>{(token) => <SystemView token={token} />}</AdminGate>;
}

function SystemView({ token }: { token: string }) {
  const { logout } = useAdminSession();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"audit"|"cron"|"backup"|"health"|"settings">("audit");
  const [runningCron, setRunningCron] = useState<string | null>(null);
  const [lastCronResult, setLastCronResult] = useState<any>(null);

  const audit = useQuery({ queryKey: ["admin-audit", token, q], queryFn: () => fetchAudit(token, q), refetchInterval: 15_000 });
  const cron = useQuery({ queryKey: ["admin-cron", token], queryFn: () => fetchCron(token), refetchInterval: 30_000 });
  const health = useQuery({ queryKey: ["admin-health", token], queryFn: () => fetchHealth(token) });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-audit"] });

  const runCron = async (job: string) => {
    setRunningCron(job);
    setLastCronResult(null);
    try {
      const r = await fetch(`/api/admin/cron/run?job=${job}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      setLastCronResult(j);
      // refresh cron table
      setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-cron"] }), 500);
    } finally {
      setRunningCron(null);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}>
      <AdminNav active="system" onLogout={logout} onRefresh={refresh} />

      <div className="mb-5">
        <JarvisBar token={token} placeholder="Try: 'sql: SELECT * FROM cron_runs ORDER BY created_at DESC LIMIT 10'" />
      </div>

      {/* Sub-tab strip */}
      <div className="flex gap-1 mb-3 border-b border-zinc-200 dark:border-zinc-700">
        {[
          { key: "audit", label: "🕵 Audit", desc: "Every event" },
          { key: "cron", label: "⏰ Cron", desc: "Scheduled jobs" },
          { key: "backup", label: "💾 Backup", desc: "Export data" },
          { key: "health", label: "🩺 Health", desc: "DB + LLM" },
          { key: "settings", label: "⚙ Settings", desc: "LLM provider" },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
              tab === t.key ? "border-emerald-500 text-emerald-700 font-medium" : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-100"
            }`}>
            {t.label} <span className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 ml-1">{t.desc}</span>
          </button>
        ))}
      </div>

      {tab === "audit" && (
        <Card><CardContent className="p-4">
          <div className="flex gap-2 mb-3">
            <Input placeholder="Search events, payload, kind…" value={q} onChange={(e) => setQ(e.target.value)} className="text-sm" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 self-center ml-auto">{audit.data?.items?.length || 0} events</span>
          </div>
          {audit.isLoading ? <div className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400 dark:text-zinc-400"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Loading…</div> : (
            <div className="overflow-auto max-h-[60vh] space-y-1 text-xs">
              {(audit.data?.items || []).map((e: any) => (
                <div key={e.id} className="flex gap-2 items-start border-l-2 border-zinc-200 pl-2 py-1 hover:bg-zinc-50 dark:bg-zinc-800/50">
                  <span className="font-mono text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 w-32 shrink-0">{new Date(e.created_at).toLocaleString()}</span>
                  <Badge className="text-[10px]">{e.kind || "any"}</Badge>
                  <Badge className="text-[10px] bg-violet-100 text-violet-800">{e.event_type}</Badge>
                  <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400 dark:text-zinc-400">{(e.prospect_id || e.sam_id || "").slice(0, 8)}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 dark:text-zinc-300 flex-1 truncate">{String(e.summary || e.payload || "").slice(0, 140)}</span>
                </div>
              ))}
              {!audit.data?.items?.length && <div className="text-sm text-zinc-400 dark:text-zinc-400 py-10 text-center">No events yet.</div>}
            </div>
          )}
        </CardContent></Card>
      )}

      {tab === "cron" && (
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4" /> Cron runs</h3>
            <div className="flex gap-2 flex-wrap">
              {["sam-ingest","contracts","outreach","all"].map((j) => (
                <Button key={j} size="sm" variant={j === "all" ? "cta" : "outline"} disabled={runningCron === j} onClick={() => runCron(j)}>
                  {runningCron === j ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                  {j === "sam-ingest" ? "SAM ingest" : j === "contracts" ? "🆕 Fetch contracts" : j === "outreach" ? "Outreach scan" : "Run all"}
                </Button>
              ))}
            </div>
          </div>
          {lastCronResult && (
            <div className={`text-xs px-3 py-2 rounded mb-3 ${lastCronResult.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
              {lastCronResult.ok ? <strong>✓ Done in {lastCronResult.duration_ms}ms</strong> : <strong>✗ Failed</strong>}
              {lastCronResult.run_id && <span className="ml-2 font-mono opacity-70">{lastCronResult.run_id.slice(0, 8)}</span>}
              {lastCronResult.gov && (
                <span className="ml-3">🏛 SAM: {lastCronResult.gov.ok !== false ? `+${lastCronResult.gov.inserted || 0} / ${lastCronResult.gov.updated || 0}` : `error: ${lastCronResult.gov.error}`}</span>
              )}
              {lastCronResult.contracts && (
                <span className="ml-3">🆕 Contracts: {lastCronResult.contracts.ok ? Object.entries(lastCronResult.contracts.sources || {}).map(([k, v]) => `${k}=${v.inserted || 0}/${v.fetched || 0}`).join(" · ") : `error: ${lastCronResult.contracts.error}`}</span>
              )}
              {lastCronResult.outreach && (
                <span className="ml-3">📤 Outreach: {lastCronResult.outreach.send_due_count ?? 0} due</span>
              )}
            </div>
          )}
          <table className="w-full text-xs">
            <thead className="bg-zinc-100 dark:bg-zinc-800 text-left">
              <tr>
                <th className="p-2">Triggered</th>
                <th className="p-2">Status</th>
                <th className="p-2">Source</th>
                <th className="p-2">SAM</th>
                <th className="p-2">Outreach</th>
                <th className="p-2">Errors</th>
                <th className="p-2">Duration</th>
              </tr>
            </thead>
            <tbody>
              {(cron.data?.items || []).map((r: any) => {
                const p = r.payload || {};
                const gov = p.gov || {};
                const out = p.outreach || {};
                return (
                  <tr key={r.id} className="border-b hover:bg-zinc-50 dark:bg-zinc-800/50">
                    <td className="p-2 font-mono">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-2"><Badge className={p.ok !== false ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>{p.ok !== false ? "ok" : "fail"}</Badge></td>
                    <td className="p-2 text-zinc-500 dark:text-zinc-400 dark:text-zinc-400">{r.name || "—"}</td>
                    <td className="p-2">{gov.ok ? (gov.ok !== false ? `+${gov.inserted || 0}/${gov.updated || 0}` : gov.error?.slice(0, 40)) : "—"}</td>
                    <td className="p-2">{out.send_due_count != null ? `due=${out.send_due_count}` : "—"}</td>
                    <td className="p-2 text-red-700 text-xs">{p.errors ? JSON.stringify(p.errors).slice(0, 60) : ""}</td>
                    <td className="p-2 font-mono">{p.duration_ms ? `${p.duration_ms}ms` : "—"}</td>
                  </tr>
                );
              })}
              {!cron.data?.items?.length && <tr><td colSpan={7} className="text-center text-sm text-zinc-400 dark:text-zinc-400 py-10">No cron runs yet — click "Run all now" to invoke the pipeline manually.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      {tab === "backup" && <BackupPanel token={token} />}

      {tab === "health" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mb-2 flex items-center gap-1"><Database className="w-3 h-3" /> D1 database</div>
            {health.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                <div className="text-2xl font-bold">{(health.data?.db?.size_mb || 0).toFixed(2)} MB</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mt-1">{health.data?.db?.tables || "?"} tables · {health.data?.db?.rows_total || "?"} rows</div>
              </>
            )}
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> LLM provider</div>
            {health.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                <div className="text-2xl font-bold">{health.data?.llm?.provider || "cloudflare"}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mt-1">{health.data?.llm?.model || "?"}</div>
                <Badge className={health.data?.llm?.reachable ? "bg-emerald-100 text-emerald-800 mt-1" : "bg-amber-100 text-amber-800 mt-1"}>
                  {health.data?.llm?.reachable ? "✓ reachable" : "⚠ fallback heuristic"}
                </Badge>
              </>
            )}
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mb-2 flex items-center gap-1"><Server className="w-3 h-3" /> Last 24h</div>
            <div className="text-2xl font-bold">{health.data?.errors_24h || 0}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mt-1">{health.data?.requests_24h || 0} API calls · {health.data?.llm_calls_24h || 0} LLM</div>
          </CardContent></Card>
        </div>
      )}

      {tab === "settings" && <SettingsPanel token={token} />}
    </div>
  );
}

function BackupPanel({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const trigger = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/backup/export", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `mehyar-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };
  return (
    <div id="backup">
      <Card><CardContent className="p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-2"><Download className="w-4 h-4" /> Backup</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 dark:text-zinc-400 mb-3">Download a JSON dump of your prospects, opportunities, drafts, replies, and audit events. Up to 5,000 rows per table.</p>
        <Button variant="cta" onClick={trigger} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />} Download backup</Button>
      </CardContent></Card>
    </div>
  );
}

function SettingsPanel({ token }: { token: string }) {
  const [model, setModel] = useState("@cf/meta/llama-3.2-3b-instruct");
  const [emailFrom, setEmailFrom] = useState("leads@mehyar.us");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load existing settings
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/settings", { headers: { authorization: `Bearer ${token}` } });
        const j = await r.json();
        if (j.ok && j.settings) {
          if (typeof j.settings.llm_model === "string") setModel(j.settings.llm_model);
          if (typeof j.settings.email_from === "string") setEmailFrom(j.settings.email_from);
          setLoaded(true);
        }
      } catch (e) {
        setError(String((e as any)?.message || e));
      }
    })();
  }, [token]);

  const save = async () => {
    setSaving(true); setError(null); setSavedAt(null);
    try {
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ settings: { llm_model: model, email_from: emailFrom } }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "save failed");
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String((e as any)?.message || e));
    } finally { setSaving(false); }
  };

  return (
    <Card><CardContent className="p-5">
      <h3 className="font-semibold flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4" /> Settings</h3>
      {!loaded && <div className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mb-2"><Loader2 className="inline w-3 h-3 animate-spin mr-1" />Loading…</div>}
      <div className="space-y-3 text-sm max-w-xl">
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400">Default LLM model</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} className="text-sm" />
          <p className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 mt-1">Cloudflare Workers AI · e.g. <code>@cf/meta/llama-3.2-3b-instruct</code>, <code>@cf/mistral/mistral-7b-instruct-v0.1</code></p>
        </div>
        <div>
          <label className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400">From address (outbound emails)</label>
          <Input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} className="text-sm" />
        </div>
        <Button disabled={saving} onClick={save}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
          {saving ? "Saving…" : "Save"}
        </Button>
        {savedAt && <p className="text-xs text-emerald-700">✓ Saved at {savedAt}</p>}
        {error && <p className="text-xs text-red-700">⚠ {error}</p>}
        <p className="text-xs text-zinc-500 dark:text-zinc-400 dark:text-zinc-400 pt-2">Settings take effect on the next scheduled cron run.</p>
      </div>
    </CardContent></Card>
  );
}
