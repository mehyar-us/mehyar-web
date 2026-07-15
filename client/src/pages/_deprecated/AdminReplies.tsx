// @ts-nocheck
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCcw, Plus, X, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, useAdminSession } from "./AdminChrome";

const LABEL_COLORS = {
  interest:        "bg-emerald-100 text-emerald-700",
  warm:             "bg-emerald-100 text-emerald-700",
  replied:          "bg-emerald-100 text-emerald-700",
  unsubscribe:      "bg-red-100 text-red-700",
  stop:             "bg-red-100 text-red-700",
  out_of_office:    "bg-amber-100 text-amber-700",
  objection:        "bg-orange-100 text-orange-700",
  not_interested:   "bg-zinc-100 text-zinc-700",
  invalid:          "bg-red-50 text-red-600",
  unclassified:     "bg-zinc-100 text-zinc-600",
};

const ACTION_BADGES = {
  none:               "",
  suppress_added:     "bg-red-100 text-red-700",
  note_appended:      "bg-blue-100 text-blue-700",
  stage_changed:      "bg-violet-100 text-violet-700",
  replied_recorded:   "bg-emerald-100 text-emerald-700",
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

const LABEL_OPTIONS = [
  "interest", "warm", "replied", "unsubscribe", "stop", "out_of_office", "objection", "not_interested", "invalid", "unclassified"
];

export default function AdminReplies() {
  const [, setLocation] = useLocation();
  const { token, isLoggedIn, logout } = useAdminSession();
  const queryClient = useQueryClient();
  const [labelFilter, setLabelFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [replyForm, setReplyForm] = useState({ prospect_id: "", from_email: "", subject: "", body_excerpt: "", label: "unclassified", review_notes: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Debounce search
  useState(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  const replies = useQuery({
    enabled: !!token && isLoggedIn,
    queryKey: ["admin-replies", token, labelFilter, debouncedSearch],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (labelFilter) qs.set("label", labelFilter);
      if (debouncedSearch) qs.set("q", debouncedSearch);
      qs.set("limit", "100");
      const r = await fetch(`/api/admin/replies?${qs}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      return { items: d.items || [], total: d.total };
    },
  });

  const classifyMut = useMutation({
    mutationFn: async ({ reply_id, label, review_notes }) => {
      // We don't have a PATCH endpoint for reply_classifications yet,
      // so we handle it by re-creating with the manual override via the POST endpoint.
      // For now, we just return success.
      return { ok: true };
    },
    onSuccess: () => queryClient.invalidateQueries(["admin-replies"]),
    onError: (e) => setErr(e.message),
  });

  const createReply = useMutation({
    mutationFn: async (payload) => {
      const r = await fetch("/api/admin/replies", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText); }
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries(["admin-replies"]); setShowNew(false); setReplyForm({ prospect_id: "", from_email: "", subject: "", body_excerpt: "", label: "unclassified", review_notes: "" }); },
    onError: (e) => setErr(e.message),
  });

  const handleSubmitReply = async (e) => {
    e.preventDefault();
    if (!replyForm.prospect_id || !replyForm.from_email) return;
    setSaving(true);
    setErr(null);
    createReply.mutate({
      prospect_id: replyForm.prospect_id.trim(),
      from_email: replyForm.from_email.trim(),
      subject: replyForm.subject.trim(),
      body_excerpt: replyForm.body_excerpt.trim(),
      label: replyForm.label,
      review_notes: replyForm.review_notes.trim(),
    });
    setSaving(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <AdminNav token={token} onLogout={logout} isLoading={replies.isFetching} />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Reply Classifications</h1>
          <p className="text-sm text-gray-500 mt-1">Auto-classified inbound replies from cold outreach. Manually added replies get classified on ingest.</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" />Add Reply</Button>
      </div>

      {err && <div className="bg-red-50 border border-red-300 rounded p-3 mb-4 text-sm text-red-700">{err}</div>}

      {/* New reply form */}
      {showNew && (
        <Card className="mb-4 border-blue-300">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Manually Add Reply</h3>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmitReply} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Prospect ID *</label>
                  <input className="w-full border rounded px-3 py-1.5 text-sm" value={replyForm.prospect_id} onChange={(e) => setReplyForm(f => ({ ...f, prospect_id: e.target.value }))} placeholder="uuid of the prospect" required />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From Email *</label>
                  <input type="email" className="w-full border rounded px-3 py-1.5 text-sm" value={replyForm.from_email} onChange={(e) => setReplyForm(f => ({ ...f, from_email: e.target.value }))} placeholder="reply@example.com" required />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Classification</label>
                  <select className="w-full border rounded px-3 py-1.5 text-sm" value={replyForm.label} onChange={(e) => setReplyForm(f => ({ ...f, label: e.target.value }))}>
                    {LABEL_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Subject</label>
                <input className="w-full border rounded px-3 py-1.5 text-sm" value={replyForm.subject} onChange={(e) => setReplyForm(f => ({ ...f, subject: e.target.value }))} placeholder="Re: quick question" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Body Excerpt</label>
                <textarea className="w-full border rounded px-3 py-1.5 text-sm" rows={3} value={replyForm.body_excerpt} onChange={(e) => setReplyForm(f => ({ ...f, body_excerpt: e.target.value }))} placeholder="Paste a snippet of the reply…" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Review Notes</label>
                <input className="w-full border rounded px-3 py-1.5 text-sm" value={replyForm.review_notes} onChange={(e) => setReplyForm(f => ({ ...f, review_notes: e.target.value }))} placeholder="Optional notes on this classification" />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
                <Button type="submit" variant="cta" size="sm" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add & Classify"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search business name, subject, notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-7 pr-4 py-1.5 text-sm border rounded"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setLabelFilter("")} className={`px-2 py-1 rounded text-xs border ${!labelFilter ? "bg-blue-50 border-blue-400" : "border-zinc-200 hover:border-zinc-400"}`}>All</button>
            {LABEL_OPTIONS.filter(l => l !== "unclassified").map(l => (
              <button key={l} onClick={() => setLabelFilter(l)} className={`px-2 py-1 rounded text-xs border ${labelFilter === l ? "bg-blue-50 border-blue-400" : "border-zinc-200 hover:border-zinc-400"}`}>{l}</button>
            ))}
          </div>
          <span className="ml-auto text-xs text-gray-500">{replies.data?.total ?? 0} total · {replies.data?.items?.length ?? 0} shown</span>
          <Button variant="outline" size="sm" onClick={() => replies.refetch()} disabled={replies.isFetching}>
            {replies.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      {replies.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          {String((replies.error as Error)?.message || replies.error)}
        </div>
      )}

      {(replies.data?.items || []).length === 0 && !replies.isFetching ? (
        <Card><CardContent className="py-12 text-center text-sm text-gray-500">No replies found.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {(replies.data?.items || []).map((item) => (
            <Card key={item.classification_id || item.reply_id}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm">{item.business_name || "(unknown)"}</span>
                      <Badge className={LABEL_COLORS[item.label] || "bg-zinc-100 text-zinc-700"}>{item.label}</Badge>
                      {item.action_taken && item.action_taken !== "none" && (
                        <Badge className={ACTION_BADGES[item.action_taken] || "bg-zinc-100 text-zinc-700"}>{item.action_taken}</Badge>
                      )}
                      <Badge className={`${item.classified_by === "manual" ? "bg-violet-100 text-violet-700" : "bg-zinc-100 text-zinc-500"}`}>{item.classified_by}</Badge>
                      <span className="text-xs text-gray-400">{item.root_domain}</span>
                    </div>
                    <div className="text-xs text-gray-500 mb-0.5">
                      ✉️ {item.from_email} · {item.reply_subject || "(no subject)"}
                    </div>
                    {item.body_excerpt && (
                      <div className="text-xs text-gray-400 italic mt-1 line-clamp-2">"{item.body_excerpt}"</div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-400">
                      <span>Received {timeAgo(item.received_at)}</span>
                      <span>Confidence {Math.round((item.confidence || 0) * 100)}%</span>
                      {item.review_notes && <span>Notes: {item.review_notes}</span>}
                      <span>Prospect: <span className="font-mono">{item.prospect_id?.slice(0, 8)}…</span></span>
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
