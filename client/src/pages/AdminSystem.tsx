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

  const audit = useQuery({ queryKey: ["admin-audit", token, q], queryFn: () => fetchAudit(token, q), refetchInterval: 15_000 });
  const cron = useQuery({ queryKey: ["admin-cron", token], queryFn: () => fetchCron(token), refetchInterval: 30_000 });
  const health = useQuery({ queryKey: ["admin-health", token], queryFn: () => fetchHealth(token) });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-audit"] });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav active="system" onLogout={logout} onRefresh={refresh} />

      <div className="mb-5">
        <JarvisBar token={token} placeholder="Try: 'sql: SELECT * FROM cron_runs ORDER BY created_at DESC LIMIT 10'" />
      </div>

      {/* Sub-tab strip */}
      <div className="flex gap-1 mb-3 border-b border-zinc-200">
        {[
          { key: "audit", label: "🕵 Audit", desc: "Every event" },
          { key: "cron", label: "⏰ Cron", desc: "Scheduled jobs" },
          { key: "backup", label: "💾 Backup", desc: "Export data" },
          { key: "health", label: "🩺 Health", desc: "DB + LLM" },
          { key: "settings", label: "⚙ Settings", desc: "LLM provider" },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
              tab === t.key ? "border-emerald-500 text-emerald-700 font-medium" : "border-transparent text-zinc-600 hover:text-zinc-900"
            }`}>
            {t.label} <span className="text-xs text-zinc-500 ml-1">{t.desc}</span>
          </button>
        ))}
      </div>

      {tab === "audit" && (
        <Card><CardContent className="p-4">
          <div className="flex gap-2 mb-3">
            <Input placeholder="Search events, payload, kind…" value={q} onChange={(e) => setQ(e.target.value)} className="text-sm" />
            <span className="text-xs text-zinc-500 self-center ml-auto">{audit.data?.items?.length || 0} events</span>
          </div>
          {audit.isLoading ? <div className="py-10 text-center text-sm text-zinc-500"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Loading…</div> : (
            <div className="overflow-auto max-h-[60vh] space-y-1 text-xs">
              {(audit.data?.items || []).map((e: any) => (
                <div key={e.id} className="flex gap-2 items-start border-l-2 border-zinc-200 pl-2 py-1 hover:bg-zinc-50">
                  <span className="font-mono text-zinc-500 w-32 shrink-0">{new Date(e.created_at).toLocaleString()}</span>
                  <Badge className="text-[10px]">{e.kind || "any"}</Badge>
                  <Badge className="text-[10px] bg-violet-100 text-violet-800">{e.event_type}</Badge>
                  <span className="font-mono text-xs text-zinc-600">{(e.prospect_id || e.sam_id || "").slice(0, 8)}</span>
                  <span className="text-zinc-700 flex-1 truncate">{String(e.summary || e.payload || "").slice(0, 140)}</span>
                </div>
              ))}
              {!audit.data?.items?.length && <div className="text-sm text-zinc-400 py-10 text-center">No events yet.</div>}
            </div>
          )}
        </CardContent></Card>
      )}

      {tab === "cron" && (
        <Card><CardContent className="p-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Clock className="w-4 h-4" /> Cron runs (last {cron.data?.items?.length || 0})</h3>
          <table className="w-full text-xs">
            <thead className="bg-zinc-100 text-left">
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
              {(cron.data?.items || []).map((r: any) => (
                <tr key={r.id} className="border-b hover:bg-zinc-50">
                  <td className="p-2 font-mono">{new Date(r.triggered_at).toLocaleString()}</td>
                  <td className="p-2"><Badge className={r.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>{r.ok ? "ok" : "fail"}</Badge></td>
                  <td className="p-2">{r.source || "—"}</td>
                  <td className="p-2">{r.gov ? (r.gov.ok ? "✓" : `✗ ${r.gov.error || ""}`) : "—"}</td>
                  <td className="p-2">{r.outreach ? `due=${r.outreach.send_due_count ?? "?"}` : "—"}</td>
                  <td className="p-2 text-red-700">{Array.isArray(r.errors_json) ? r.errors_json.join("; ") : ""}</td>
                  <td className="p-2 font-mono">{r.duration_ms ? `${r.duration_ms}ms` : "—"}</td>
                </tr>
              ))}
              {!cron.data?.items?.length && <tr><td colSpan={7} className="text-center text-sm text-zinc-400 py-10">No cron runs yet — Cloudflare Pages scheduled handler logs here.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      {tab === "backup" && <BackupPanel token={token} />}

      {tab === "health" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase text-zinc-500 mb-2 flex items-center gap-1"><Database className="w-3 h-3" /> D1 database</div>
            {health.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                <div className="text-2xl font-bold">{(health.data?.db?.size_mb || 0).toFixed(2)} MB</div>
                <div className="text-xs text-zinc-500 mt-1">{health.data?.db?.tables || "?"} tables · {health.data?.db?.rows_total || "?"} rows</div>
              </>
            )}
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase text-zinc-500 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> LLM provider</div>
            {health.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                <div className="text-2xl font-bold">{health.data?.llm?.provider || "cloudflare"}</div>
                <div className="text-xs text-zinc-500 mt-1">{health.data?.llm?.model || "?"}</div>
                <Badge className={health.data?.llm?.reachable ? "bg-emerald-100 text-emerald-800 mt-1" : "bg-amber-100 text-amber-800 mt-1"}>
                  {health.data?.llm?.reachable ? "✓ reachable" : "⚠ fallback heuristic"}
                </Badge>
              </>
            )}
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase text-zinc-500 mb-2 flex items-center gap-1"><Server className="w-3 h-3" /> Last 24h</div>
            <div className="text-2xl font-bold">{health.data?.errors_24h || 0}</div>
            <div className="text-xs text-zinc-500 mt-1">{health.data?.requests_24h || 0} API calls · {health.data?.llm_calls_24h || 0} LLM</div>
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
        <p className="text-sm text-zinc-600 mb-3">Download a JSON dump of your prospects, opportunities, drafts, replies, and audit events. Up to 5,000 rows per table.</p>
        <Button variant="cta" onClick={trigger} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />} Download backup</Button>
      </CardContent></Card>
    </div>
  );
}

function SettingsPanel({ token }: { token: string }) {
  const [model, setModel] = useState("@cf/meta/llama-3.2-3b-instruct");
  const [emailFrom, setEmailFrom] = useState("leads@mehyar.us");
  const [saving, setSaving] = useState(false);
  return (
    <Card><CardContent className="p-5">
      <h3 className="font-semibold flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4" /> Settings</h3>
      <div className="space-y-3 text-sm max-w-xl">
        <div>
          <label className="text-xs text-zinc-500">Default LLM model</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} className="text-sm" />
          <p className="text-xs text-zinc-500 mt-1">Cloudflare Workers AI · e.g. <code>@cf/meta/llama-3.2-3b-instruct</code>, <code>@cf/mistral/mistral-7b-instruct-v0.1</code></p>
        </div>
        <div>
          <label className="text-xs text-zinc-500">From address (outbound emails)</label>
          <Input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} className="text-sm" />
        </div>
        <Button disabled={saving} onClick={async () => {
          setSaving(true);
          try {
            await fetch("/api/admin/settings", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ llm_model: model, email_from: emailFrom }) });
          } finally { setSaving(false); }
        }}><Save className="w-4 h-4 mr-1" />{saving ? "Saving…" : "Save"}</Button>
        <p className="text-xs text-zinc-500 pt-2">Settings take effect on the next scheduled cron run.</p>
      </div>
    </CardContent></Card>
  );
}
