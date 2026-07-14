// @ts-nocheck
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCcw, Plus, X, Search, Send, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, useAdminSession } from "./AdminChrome";

const STEP_TYPE_COLORS = {
  email:    "bg-blue-100 text-blue-700",
  followup: "bg-violet-100 text-violet-700",
  linkedin: "bg-sky-100 text-sky-700",
  phone:    "bg-amber-100 text-amber-700",
  manual:   "bg-zinc-100 text-zinc-700",
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

export default function AdminOutreach() {
  const [, setLocation] = useLocation();
  const { token, isLoggedIn, logout } = useAdminSession();
  const queryClient = useQueryClient();
  const [filterSource, setFilterSource] = useState("");
  const [tab, setTab] = useState<"steps" | "send-due">("steps");
  const [showNewStep, setShowNewStep] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [sendErr, setSendErr] = useState(null);
  const [sendOk, setSendOk] = useState(null);

  // Step form state
  const [stepForm, setStepForm] = useState({
    name: "", source_id: "", step_order: "1", type: "email",
    delay_days: "0", require_manual_approval: true, skip_if_replied: true,
    subject_template: "", body_template: "",
  });

  const steps = useQuery({
    enabled: !!token && isLoggedIn,
    queryKey: ["admin-outreach-steps", token, filterSource],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (filterSource) qs.set("source_id", filterSource);
      const r = await fetch(`/api/admin/outreach?${qs}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      return d.items || [];
    },
  });

  const sendDue = useQuery({
    enabled: !!token && isLoggedIn && tab === "send-due",
    queryKey: ["admin-outreach-send-due", token],
    queryFn: async () => {
      const r = await fetch("/api/admin/outreach/send-due", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      return d.items || [];
    },
  });

  const createStep = useMutation({
    mutationFn: async (payload) => {
      const r = await fetch("/api/admin/outreach", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText); }
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries(["admin-outreach-steps"]); setShowNewStep(false); setStepForm({ name: "", source_id: "", step_order: "1", type: "email", delay_days: "0", require_manual_approval: true, skip_if_replied: true, subject_template: "", body_template: "" }); },
    onError: (e) => setErr(e.message),
  });

  const [err, setErr] = useState(null);

  const handleCreateStep = async (e) => {
    e.preventDefault();
    if (!stepForm.name || !stepForm.source_id) return;
    setErr(null);
    createStep.mutate({
      name: stepForm.name.trim(),
      source_id: stepForm.source_id,
      step_order: parseInt(stepForm.step_order) || 1,
      type: stepForm.type,
      delay_days: parseInt(stepForm.delay_days) || 0,
      require_manual_approval: !!stepForm.require_manual_approval,
      skip_if_replied: !!stepForm.skip_if_replied,
      subject_template: stepForm.subject_template,
      body_template: stepForm.body_template,
    });
  };

  const handleApproveSend = async (item) => {
    setSendingId(item.prospect_id + ":" + item.step_id);
    setSendErr(null);
    setSendOk(null);
    try {
      // Apply template to get resolved subject/body
      const prospect = { business_name: item.business_name, city: item.city, region: item.region, vertical: item.vertical, email: item.email, root_domain: item.root_domain };
      const resolvedSubject = resolveTpl(item.subject_template, prospect);
      const resolvedBody = resolveTpl(item.body_template, prospect);
      const r = await fetch("/api/admin/outreach/send-due", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prospect_id: item.prospect_id,
          step_id: item.step_id,
          to_email: item.email,
          subject: resolvedSubject,
          body_text: resolvedBody,
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || `${r.status}`); }
      const d = await r.json();
      setSendOk(`Queued: ${d.send_id} — "${resolvedSubject}"`);
      queryClient.invalidateQueries(["admin-outreach-send-due"]);
    } catch (e) {
      setSendErr(e.message);
    } finally {
      setSendingId(null);
    }
  };

  const resolveTpl = (tpl, p) =>
    (tpl || "")
      .replace(/\{\{business_name\}\}/g, p.business_name || "")
      .replace(/\{\{first_name\}\}/g, (p.business_name || "").split(" ")[0] || "")
      .replace(/\{\{city\}\}/g, p.city || "")
      .replace(/\{\{region\}\}/g, p.region || "")
      .replace(/\{\{vertical\}\}/g, p.vertical || "");

  // Group steps by source
  const groupedSteps = {};
  for (const s of (steps.data || [])) {
    if (!groupedSteps[s.source_id]) groupedSteps[s.source_id] = { source_name: s.source_name, source_id: s.source_id, steps: [] };
    groupedSteps[s.source_id].steps.push(s);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <AdminNav token={token} onLogout={logout} isLoading={steps.isFetching || sendDue.isFetching} />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Outreach Sequences</h1>
          <p className="text-sm text-gray-500 mt-1">Multi-step cold-email sequences per source. All sends require manual approval — never auto-dispatched.</p>
        </div>
        <Button size="sm" onClick={() => setShowNewStep(true)}><Plus className="w-4 h-4 mr-1" />Add Step</Button>
      </div>

      {err && <div className="bg-red-50 border border-red-300 rounded p-3 mb-4 text-sm text-red-700">{err}</div>}
      {sendErr && <div className="bg-red-50 border border-red-300 rounded p-3 mb-4 text-sm text-red-700">Send error: {sendErr}</div>}
      {sendOk && <div className="bg-emerald-50 border border-emerald-300 rounded p-3 mb-4 text-sm text-emerald-700">{sendOk}</div>}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("steps")} className={`px-4 py-1.5 rounded-lg text-sm border ${tab === "steps" ? "bg-blue-50 border-blue-400 font-medium" : "border-zinc-200 hover:border-zinc-400"}`}>Sequence Steps</button>
        <button onClick={() => setTab("send-due")} className={`px-4 py-1.5 rounded-lg text-sm border ${tab === "send-due" ? "bg-blue-50 border-blue-400 font-medium" : "border-zinc-200 hover:border-zinc-400"}`}>
          Send Queue
          {(sendDue.data?.length || 0) > 0 && <span className="ml-2 bg-blue-600 text-white rounded-full px-1.5 py-0.5 text-xs">{sendDue.data?.length}</span>}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {filterSource && <span className="text-xs text-gray-500">Source filtered</span>}
          <select className="border rounded px-2 py-1 text-sm" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
            <option value="">All sources</option>
            {Object.values(groupedSteps).map((g) => <option key={g.source_id} value={g.source_id}>{g.source_name}</option>)}
          </select>
        </div>
      </div>

      {/* New step form */}
      {showNewStep && (
        <Card className="mb-4 border-blue-300">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">New Outreach Step</h3>
              <button onClick={() => setShowNewStep(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreateStep} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Step Name *</label>
                  <input className="w-full border rounded px-3 py-1.5 text-sm" value={stepForm.name} onChange={(e) => setStepForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Day 4 — Follow-Up" required />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Source *</label>
                  <select className="w-full border rounded px-3 py-1.5 text-sm" value={stepForm.source_id} onChange={(e) => setStepForm(f => ({ ...f, source_id: e.target.value }))} required>
                    <option value="">Select source…</option>
                    {Object.values(groupedSteps).map((g) => <option key={g.source_id} value={g.source_id}>{g.source_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Step Order</label>
                  <input type="number" className="w-full border rounded px-3 py-1.5 text-sm" value={stepForm.step_order} onChange={(e) => setStepForm(f => ({ ...f, step_order: e.target.value }))} min="1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Type</label>
                  <select className="w-full border rounded px-3 py-1.5 text-sm" value={stepForm.type} onChange={(e) => setStepForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="email">Email</option>
                    <option value="followup">Follow-up</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="phone">Phone</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Delay Days</label>
                  <input type="number" className="w-full border rounded px-3 py-1.5 text-sm" value={stepForm.delay_days} onChange={(e) => setStepForm(f => ({ ...f, delay_days: e.target.value }))} min="0" />
                </div>
              </div>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stepForm.require_manual_approval} onChange={(e) => setStepForm(f => ({ ...f, require_manual_approval: e.target.checked }))} /> Requires Manual Approval</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stepForm.skip_if_replied} onChange={(e) => setStepForm(f => ({ ...f, skip_if_replied: e.target.checked }))} /> Skip if already replied</label>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Subject Template</label>
                <input className="w-full border rounded px-3 py-1.5 text-sm" value={stepForm.subject_template} onChange={(e) => setStepForm(f => ({ ...f, subject_template: e.target.value }))} placeholder='{{business_name}} — quick question' />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Body Template</label>
                <textarea className="w-full border rounded px-3 py-1.5 text-sm" rows={6} value={stepForm.body_template} onChange={(e) => setStepForm(f => ({ ...f, body_template: e.target.value }))} placeholder="Hi {{first_name}},&#10;&#10;..." />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNewStep(false)}>Cancel</Button>
                <Button type="submit" variant="cta" size="sm" disabled={createStep.isPending}>{createStep.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Step"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── STEPS TAB ── */}
      {tab === "steps" && (
        <>
          {(steps.data || []).length === 0 && !steps.isFetching ? (
            <Card><CardContent className="py-12 text-center text-sm text-gray-500">No outreach steps yet. Add one to build a sequence.</CardContent></Card>
          ) : (
            <div className="space-y-6">
              {Object.values(groupedSteps).map((group) => (
                <div key={group.source_id}>
                  <h3 className="text-sm font-semibold text-gray-600 mb-2">{group.source_name}</h3>
                  <div className="space-y-2">
                    {group.steps.sort((a, b) => a.step_order - b.step_order).map((s) => (
                      <Card key={s.id} className={!s.active ? "opacity-60" : ""}>
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col items-center mr-1">
                              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold">{s.step_order}</span>
                              <ChevronRight className="w-3 h-3 text-gray-400 mt-1" />
                            </div>
                            <div className="flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <span className="font-medium text-sm">{s.name}</span>
                                <Badge className={STEP_TYPE_COLORS[s.type] || "bg-zinc-100 text-zinc-700"}>{s.type}</Badge>
                                {s.delay_days > 0 && <span className="text-xs text-gray-500">+{s.delay_days}d delay</span>}
                                {s.require_manual_approval && <Badge className="bg-amber-100 text-amber-700 text-xs">Manual approval</Badge>}
                                {!s.active && <Badge className="bg-red-100 text-red-700 text-xs">Inactive</Badge>}
                              </div>
                              <div className="text-xs text-gray-500">Subject: {s.subject_template || <span className="italic">(none)</span>}</div>
                              <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{s.body_template || <span className="italic">(no body template)</span>}</div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── SEND-DUE TAB ── */}
      {tab === "send-due" && (
        <>
          <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-4 text-sm text-amber-800">
            ⚠️ <strong>Manual approval required.</strong> Clicking "Approve & Send" queues the email for dispatch — it is NOT sent automatically.
          </div>
          {(sendDue.data || []).length === 0 && !sendDue.isFetching ? (
            <Card><CardContent className="py-12 text-center text-sm text-gray-500">No send-due prospects right now. Check back after your next intake run.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(sendDue.data || []).map((item) => {
                const key = item.prospect_id + ":" + item.step_id;
                const isSending = sendingId === key;
                const prospect = { business_name: item.business_name, city: item.city, region: item.region, vertical: item.vertical, email: item.email, root_domain: item.root_domain };
                const previewSubject = resolveTpl(item.subject_template, prospect);
                return (
                  <Card key={key}>
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-0.5">
                            <span className="font-medium text-sm">{item.business_name}</span>
                            <Badge className="bg-emerald-100 text-emerald-700 text-xs">{item.step_name}</Badge>
                            <Badge className="bg-blue-100 text-blue-700 text-xs">{item.source_name}</Badge>
                            {item.enforce_30day && <span className="text-xs text-gray-500">30-day rule active</span>}
                          </div>
                          <div className="text-xs text-gray-500 mb-1">
                            {item.email} · {item.vertical} · {item.city}, {item.region}
                          </div>
                          <div className="text-xs text-gray-400 mb-1">Subject: <span className="font-mono">{previewSubject}</span></div>
                          <div className="text-xs text-gray-400">
                            Last sent: {item.last_sent_at ? timeAgo(item.last_sent_at) : "never"} · Created: {timeAgo(item.created_at)} · {item.delay_days}d delay
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="cta"
                          disabled={isSending}
                          onClick={() => handleApproveSend(item)}
                        >
                          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                          Approve &amp; Send
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
