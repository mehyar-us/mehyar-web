// @ts-nocheck
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCcw, Plus, X, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, useAdminSession } from "./AdminChrome";

const LABEL_COLORS = {
  import:  "bg-blue-100 text-blue-700",
  seed:   "bg-amber-100 text-amber-700",
  inbound:"bg-emerald-100 text-emerald-700",
  manual: "bg-zinc-100 text-zinc-700",
};

function timeAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function AdminProspectSources() {
  const [, setLocation] = useLocation();
  const { token, isLoggedIn, logout } = useAdminSession();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "import", dedup_days: "90", enforce_30day: true, tag: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const list = useQuery({
    enabled: !!token && isLoggedIn,
    queryKey: ["admin-prospect-sources", token],
    queryFn: async () => {
      const r = await fetch("/api/admin/prospect-sources", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      return d.items || [];
    },
  });

  const createMut = useMutation({
    mutationFn: async (payload) => {
      const r = await fetch("/api/admin/prospect-sources", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText); }
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries(["admin-prospect-sources"]); setShowNew(false); setForm({ name: "", kind: "import", dedup_days: "90", enforce_30day: true, tag: "", description: "" }); },
    onError: (e) => setErr(e.message),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setErr(null);
    createMut.mutate({
      name: form.name.trim(),
      kind: form.kind,
      dedup_days: parseInt(form.dedup_days) || 90,
      enforce_30day: !!form.enforce_30day,
      tag: form.tag.trim(),
      description: form.description.trim(),
    });
    setSaving(false);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminNav token={token} onLogout={logout} isLoading={list.isFetching} />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Prospect Sources</h1>
          <p className="text-sm text-gray-500 mt-1">Authoritative registry of prospect ingestion channels and their dedup rules.</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" />Add Source</Button>
      </div>

      {err && <div className="bg-red-50 border border-red-300 rounded p-3 mb-4 text-sm text-red-700">{err}</div>}

      {/* New source form */}
      {showNew && (
        <Card className="mb-4 border-blue-300">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">New Prospect Source</h3>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Source Name *</label>
                  <input className="w-full border rounded px-3 py-1.5 text-sm" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. NY DOS CSV" required />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Kind</label>
                  <select className="w-full border rounded px-3 py-1.5 text-sm" value={form.kind} onChange={(e) => setForm(f => ({ ...f, kind: e.target.value }))}>
                    <option value="import">Import</option>
                    <option value="seed">Seed</option>
                    <option value="inbound">Inbound</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Dedup Days</label>
                  <input type="number" className="w-full border rounded px-3 py-1.5 text-sm" value={form.dedup_days} onChange={(e) => setForm(f => ({ ...f, dedup_days: e.target.value }))} min="1" max="3650" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Source Tag</label>
                  <input className="w-full border rounded px-3 py-1.5 text-sm" value={form.tag} onChange={(e) => setForm(f => ({ ...f, tag: e.target.value }))} placeholder="e.g. [NY DOS]" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="enforce30" checked={form.enforce_30day} onChange={(e) => setForm(f => ({ ...f, enforce_30day: e.target.checked }))} />
                <label htmlFor="enforce30" className="text-sm">Block auto-email within 30 days of creation (default: on)</label>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Description</label>
                <textarea className="w-full border rounded px-3 py-1.5 text-sm" rows={2} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
                <Button type="submit" variant="cta" size="sm" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Source"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Sources list */}
      {(list.data || []).length === 0 && !list.isFetching ? (
        <Card><CardContent className="py-12 text-center text-sm text-gray-500">No sources yet. Add one to get started.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {(list.data || []).map((src) => (
            <Card key={src.id} className={src.active ? "" : "opacity-60"}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-medium">{src.name}</h3>
                      <Badge className={LABEL_COLORS[src.kind] || "bg-zinc-100 text-zinc-700"}>{src.kind}</Badge>
                      {!src.active && <Badge className="bg-red-100 text-red-700">Inactive</Badge>}
                    </div>
                    <div className="text-sm text-gray-500 mb-2">{src.description || <span className="italic">No description</span>}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>🗂 Tag: <code className="bg-zinc-100 px-1 rounded">{src.tag || "(none)"}</code></span>
                      <span>📅 Dedup: {src.dedup_days} days</span>
                      <span>🔒 Enforce 30-day: {src.enforce_30day ? "Yes" : "No"}</span>
                      <span>🕒 Updated {timeAgo(src.updated_at)}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
