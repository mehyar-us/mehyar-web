import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, ChevronLeft, RefreshCcw, Mail, Activity, Phone, MapPin, Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MEHYARSOFT_ADMIN_API_BASE_URL } from "@/lib/mehyarsoft-api";

const TOKEN_KEY = "mehyarsoft_admin_token";

type Lead = {
  id: string; created_at: string; source: string; form_type: string; status: string;
  name?: string | null; email?: string | null; phone?: string | null;
  company?: string | null; website?: string | null;
  service_interest?: string | null; budget_range?: string | null; timeline?: string | null;
  message_excerpt?: string | null;
};
type TodayResponse = {
  ok: true;
  window_days: number;
  generated_at: string;
  leads: {
    count: number;
    by_form_type: { form_type: string; count: number }[];
    by_source: { source: string; count: number }[];
    top_service_interest: { service_interest: string; count: number }[];
    rows: Lead[];
  };
  prospect_pipeline: {
    total_prospects: number;
    scanned_in_window: number;
    drafted_in_window: number;
    sent_in_window: number;
    queued_now: number;
    unsubscribed_in_window: number;
  };
  recent_events: { id: string; lead_id?: string | null; created_at: string; event_type: string; actor: string; metadata_json?: string | null }[];
  suppression_total: number;
};

function StatusBadge({ s }: { s?: string | null }) {
  if (!s) return null;
  const c = s === "new" ? "bg-blue-100 text-blue-700"
    : s === "queued" ? "bg-amber-100 text-amber-700"
    : s === "sent" ? "bg-emerald-100 text-emerald-700"
    : s === "replied" ? "bg-emerald-100 text-emerald-700"
    : s === "unsubscribed" ? "bg-zinc-200 text-zinc-700"
    : s === "bounced" ? "bg-red-100 text-red-700"
    : s === "scanned" ? "bg-indigo-100 text-indigo-700"
    : s === "drafted" ? "bg-violet-100 text-violet-700"
    : s === "approved" ? "bg-fuchsia-100 text-fuchsia-700"
    : "bg-zinc-100 text-zinc-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{s}</span>;
}

function Metric({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
        <div className="mt-1 text-3xl font-semibold">{value}</div>
        {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function LoginGate({ onLogin, onBack }: { onLogin: (token: string) => void; onBack: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`${MEHYARSOFT_ADMIN_API_BASE_URL}/v1/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const j = await r.json();
      if (!j.token) throw new Error("no token returned");
      onLogin(j.token);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-6 max-w-md mx-auto">
      <Button variant="ghost" size="sm" onClick={onBack} className="px-2"><ChevronLeft className="w-4 h-4" /> Back to /admin</Button>
      <Card className="mt-4">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-xl font-semibold">Sign in to Today</h2>
          <p className="text-sm text-gray-500">Same credentials as the main admin dashboard.</p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <input className="border rounded px-2 py-1 w-full" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input type="password" className="border rounded px-2 py-1 w-full" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {err && <div className="text-red-600 text-sm">{err}</div>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminToday() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [days, setDays] = useState(1);

  // If the main Admin page already has a token, we'll use it. If not, show login.
  useEffect(() => {
    if (!token) {
      // check storage on every render in case Admin set it after mount
      const t = sessionStorage.getItem(TOKEN_KEY);
      if (t) setToken(t);
    }
  });

  const query = useQuery({
    enabled: !!token,
    queryKey: ["admin-today", token, days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/dashboard/today?days=${days}&limit=100`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        if (r.status === 401) { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }
        throw new Error(`${r.status} ${r.statusText}`);
      }
      return (await r.json()) as TodayResponse;
    },
  });

  if (!token) {
    return <LoginGate onLogin={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }} onBack={() => setLocation("/admin")} />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Today</h1>
          <p className="text-sm text-gray-500">
            {query.data
              ? `Window: last ${query.data.window_days} day(s) · generated ${new Date(query.data.generated_at).toLocaleString()}`
              : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="border rounded px-2 py-1 text-sm" value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}>
            <option value="1">Last 1 day</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            <span className="ml-1">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }}>Sign out</Button>
        </div>
      </header>

      {query.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          Dashboard endpoint errored: {String((query.error as Error)?.message || query.error)}
        </div>
      )}

      {/* Top KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Metric label="Leads" value={query.data?.leads.count ?? "—"} sub={`form_type: ${query.data?.leads.by_form_type.length ?? 0} · sources: ${query.data?.leads.by_source.length ?? 0}`} />
        <Metric label="Top service interest" value={query.data?.leads.top_service_interest[0]?.service_interest ?? "—"} sub={query.data?.leads.top_service_interest[0] ? `${query.data.leads.top_service_interest[0].count} lead(s)` : "no data"} />
        <Metric label="Prospects drafted" value={query.data?.prospect_pipeline.drafted_in_window ?? 0} sub={`scanned ${query.data?.prospect_pipeline.scanned_in_window ?? 0} · total ${query.data?.prospect_pipeline.total_prospects ?? 0}`} />
        <Metric label="Prospect emails sent" value={query.data?.prospect_pipeline.sent_in_window ?? 0} sub={`queued now: ${query.data?.prospect_pipeline.queued_now ?? 0} · unsub: ${query.data?.prospect_pipeline.unsubscribed_in_window ?? 0}`} />
      </div>

      {/* Source + form-type breakdowns + lead list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><Activity className="w-4 h-4" /> Form type</h2>
            <ul className="text-sm space-y-1">
              {query.data?.leads.by_form_type.length
                ? query.data.leads.by_form_type.map((b) => (
                    <li key={b.form_type} className="flex justify-between">
                      <span className="font-mono">{b.form_type}</span><span className="text-gray-600">{b.count}</span>
                    </li>
                  ))
                : <li className="text-gray-500 text-sm">No form submissions in this window.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><MapPin className="w-4 h-4" /> Source</h2>
            <ul className="text-sm space-y-1">
              {query.data?.leads.by_source.length
                ? query.data.leads.by_source.map((b) => (
                    <li key={b.source} className="flex justify-between">
                      <span className="font-mono">{b.source}</span><span className="text-gray-600">{b.count}</span>
                    </li>
                  ))
                : <li className="text-gray-500 text-sm">No source data.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Top service interest</h2>
            <ul className="text-sm space-y-1">
              {query.data?.leads.top_service_interest.length
                ? query.data.leads.top_service_interest.map((b) => (
                    <li key={b.service_interest} className="flex justify-between">
                      <span>{b.service_interest}</span><span className="text-gray-600">{b.count}</span>
                    </li>
                  ))
                : <li className="text-gray-500 text-sm">No service interest recorded yet.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Lead list */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3">Leads in window</h2>
          {query.data?.leads.rows.length
            ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Who</th>
                      <th className="py-2 pr-3">What</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Reach</th>
                      <th className="py-2 pr-3">Site</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.leads.rows.map((l) => (
                      <tr key={l.id} className="border-t border-zinc-200 dark:border-zinc-700 align-top">
                        <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                          {l.created_at ? new Date(l.created_at).toLocaleString() : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="font-medium">{l.name || "—"}</div>
                          <div className="text-xs text-gray-500">{l.email || "—"}</div>
                          {l.company && <div className="text-xs text-gray-500">{l.company}</div>}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="text-xs"><Badge>{l.form_type}</Badge></div>
                          {l.service_interest && <div className="text-xs text-gray-600 mt-1">wants: {l.service_interest}</div>}
                          {l.budget_range && <div className="text-xs text-gray-600">budget: {l.budget_range}</div>}
                          {l.timeline && <div className="text-xs text-gray-600">when: {l.timeline}</div>}
                          {l.message_excerpt && <div className="text-xs text-gray-500 mt-1 max-w-md line-clamp-3">"{l.message_excerpt}"</div>}
                        </td>
                        <td className="py-2 pr-3"><StatusBadge s={l.status} /></td>
                        <td className="py-2 pr-3 text-xs">
                          {l.phone && <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{l.phone}</div>}
                          {l.email && <div className="flex items-center gap-1 text-blue-600 break-all"><Mail className="w-3 h-3 shrink-0" /><span className="truncate max-w-[200px]">{l.email}</span></div>}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {l.website && <a href={l.website} target="_blank" rel="noreferrer" className="text-blue-600 flex items-center gap-1">visit<ExternalLink className="w-3 h-3" /></a>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
            : <div className="text-sm text-gray-500">No leads in the last {days} day(s). When someone submits a contact/audit/booking form, they show up here.</div>}
        </CardContent>
      </Card>

      {/* Recent events */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Clock className="w-4 h-4" /> Recent lead events</h2>
          {query.data?.recent_events.length
            ? (
              <ul className="text-sm divide-y divide-zinc-200 dark:divide-zinc-700">
                {query.data.recent_events.map((ev) => (
                  <li key={ev.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{new Date(ev.created_at).toLocaleString()}</span>
                      <span>·</span>
                      <span className="font-mono">{ev.event_type}</span>
                      <span>·</span>
                      <span>{ev.actor}</span>
                    </div>
                    {ev.metadata_json && <pre className="mt-1 text-xs text-gray-600 whitespace-pre-wrap break-all">{ev.metadata_json}</pre>}
                  </li>
                ))}
              </ul>
            )
            : <div className="text-sm text-gray-500">No events in this window.</div>}
        </CardContent>
      </Card>

      <div className="mt-6 text-xs text-gray-500 text-center">
        Suppression list: {query.data?.suppression_total ?? 0} · prospect pipeline queued: {query.data?.prospect_pipeline.queued_now ?? 0} · unsubscribes in window: {query.data?.prospect_pipeline.unsubscribed_in_window ?? 0}
      </div>
    </div>
  );
}
