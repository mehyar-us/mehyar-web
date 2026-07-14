import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, ChevronLeft, RefreshCcw, Mail, Activity, Phone, MapPin, Clock, Users, Search, X, Briefcase, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MEHYARSOFT_ADMIN_API_BASE_URL } from "@/lib/mehyarsoft-api";

const TOKEN_KEY = "mehyarsoft_admin_token";

type Lead = {
  id: string; created_at: string; source: string; source_channel?: string | null;
  form_type: string; status: string;
  name?: string | null; first_name?: string | null; last_name?: string | null;
  email?: string | null; phone?: string | null;
  company?: string | null; business_name?: string | null;
  website?: string | null;
  service_interest?: string | null; service_category?: string | null;
  budget_range?: string | null; timeline?: string | null;
  zip_code?: string | null;
  message?: string | null;
  request_type?: string | null;
  offer_code?: string | null;
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null;
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
type LeadsAllResponse = { ok: true; items: Lead[]; total: number; updatedAt: string };
type Prospect = {
  id: string;
  business_name: string | null;
  root_domain: string | null;
  website: string | null;
  email: string | null;
  vertical: string | null;
  city: string | null;
  status: string | null;
  leak_score: number | null;
  detected_platform: string | null;
  title: string | null;
  page_weight_kb: number | null;
  load_time_ms: number | null;
  last_scanned_at: string | null;
  last_drafted_at: string | null;
  last_sent_at: string | null;
};

function StatusBadge({ s }: { s?: string | null }) {
  if (!s) return null;
  const c = s === "new" ? "bg-blue-100 text-blue-700"
    : s === "queued" ? "bg-amber-100 text-amber-700"
    : s === "sent" || s === "replied" ? "bg-emerald-100 text-emerald-700"
    : s === "unsubscribed" ? "bg-zinc-200 text-zinc-700"
    : s === "bounced" ? "bg-red-100 text-red-700"
    : s === "draft_needed" || s === "scanned" ? "bg-indigo-100 text-indigo-700"
    : s === "drafted" ? "bg-violet-100 text-violet-700"
    : s === "approved" ? "bg-fuchsia-100 text-fuchsia-700"
    : s === "rejected" || s === "skipped" || s === "invalid" ? "bg-red-100 text-red-700"
    : "bg-zinc-100 text-zinc-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{s}</span>;
}

function Metric({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// Shared nav bar so /admin/today has the same tabs as /admin.
function AdminNav({ token, onLogout, isLoading, refreshFn }: { token: string; onLogout: () => void; isLoading?: boolean; refreshFn?: () => void }) {
  const [, setLocation] = useLocation();
  const tabs: { label: string; href: string; key: string }[] = [
    { label: "Today", href: "/admin/today", key: "today" },
    { label: "Metrics", href: "/admin", key: "metrics" },
    { label: "Analytics", href: "/admin/analytics", key: "analytics" },
    { label: "Prospects", href: "/admin/prospects", key: "prospects" },
    { label: "Signups", href: "/admin/newsletter", key: "newsletter" },
    { label: "Government", href: "/admin/government", key: "government" },
    { label: "Opportunity Scout", href: "/admin/opportunity-scout", key: "opportunity-scout" },
    { label: "Billing", href: "/admin/billing", key: "billing" },
    { label: "Email Command Center", href: "/admin/email", key: "email" },
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {tabs.map((t) => (
        <Button key={t.key} variant="outline" size="sm" onClick={() => setLocation(t.href)}>{t.label}</Button>
      ))}
      <Button variant="outline" size="sm" onClick={() => refreshFn && refreshFn()} disabled={isLoading}>
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCcw className="w-4 h-4 mr-1" />}
        Refresh
      </Button>
      <Button variant="secondary" size="sm" onClick={onLogout}>Logout</Button>
    </div>
  );
}

function LoginGate({ onLogin, onBack }: { onLogin: (t: string) => void; onBack: () => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="max-w-sm mx-auto mt-24">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Sign in</h2>
            <p className="text-xs text-gray-500 mt-1">Owner-only admin for mehyar.us.</p>
          </div>
          <form onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true); setErr(null);
            try {
              const r = await fetch(`${MEHYARSOFT_ADMIN_API_BASE_URL}/admin/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username: u, password: p }),
              });
              if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
              const data = await r.json();
              onLogin(data.token);
            } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
            finally { setBusy(false); }
          }} className="space-y-2">
            <input type="text" placeholder="username" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} disabled={busy} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input type="password" placeholder="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} disabled={busy} className="w-full rounded-lg border px-3 py-2 text-sm" />
            {err && <div className="text-xs text-red-600">{err}</div>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onBack}>Back</Button>
              <Button type="submit" variant="cta" size="sm" disabled={busy} className="flex-1">{busy ? "Connecting..." : "Login"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminToday() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) {
      const t = sessionStorage.getItem(TOKEN_KEY);
      if (t) setToken(t);
    }
  });

  // Existing windowed data
  const todayQuery = useQuery({
    enabled: !!token,
    queryKey: ["admin-today-window", token, days],
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

  // NEW: ALL leads (no time window) — so the page always shows real data
  const allLeadsQuery = useQuery({
    enabled: !!token,
    queryKey: ["admin-all-leads", token, search],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "100", offset: "0" });
      if (search) qs.set("q", search);
      const r = await fetch(`/api/admin/leads/list?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        if (r.status === 401) { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }
        throw new Error(`${r.status} ${r.statusText}`);
      }
      return (await r.json()) as LeadsAllResponse;
    },
  });

  // NEW: prospects with website + status (already-existing endpoint, new rendering)
  const prospectsQuery = useQuery({
    enabled: !!token,
    queryKey: ["admin-today-prospects", token],
    queryFn: async () => {
      const r = await fetch(`/api/prospects/list?limit=50`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      return (data.items || []) as Prospect[];
    },
  });

  // NEW: SAM.gov / government opportunities — from local Pages Function
  // (avoids the broken upstream /v1/admin/government/opportunities Worker route).
  const govOppsQuery = useQuery({
    enabled: !!token,
    queryKey: ["admin-today-gov", token],
    queryFn: async () => {
      const r = await fetch(`/api/admin/government/opportunities?limit=20`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        if (r.status === 401) { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }
        throw new Error(`${r.status} ${r.statusText}`);
      }
      const data = await r.json();
      return (data.opportunities || data.items || []) as any[];
    },
  });

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
  };

  const isLoading = todayQuery.isFetching || allLeadsQuery.isFetching || prospectsQuery.isFetching || govOppsQuery.isFetching;
  const refreshAll = () => {
    todayQuery.refetch();
    allLeadsQuery.refetch();
    prospectsQuery.refetch();
    govOppsQuery.refetch();
  };

  if (!token) {
    return <LoginGate onLogin={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }} onBack={() => setLocation("/admin")} />;
  }

  const allLeads = allLeadsQuery.data?.items || [];
  const allLeadsTotal = allLeadsQuery.data?.total ?? 0;
  const windowData = todayQuery.data;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Today &amp; Inbox</h1>
          <p className="text-sm text-gray-500">
            {windowData
              ? `Window: last ${windowData.window_days} day(s) · generated ${new Date(windowData.generated_at).toLocaleString()}`
              : "Loading window view…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border rounded px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
          >
            <option value={1}>Last 1 day</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Shared nav bar */}
      <AdminNav token={token} onLogout={handleLogout} isLoading={isLoading} refreshFn={refreshAll} />

      {todayQuery.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          Window metrics endpoint errored: {String((todayQuery.error as Error)?.message || todayQuery.error)}
        </div>
      )}

      {/* KPI cards (existing) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Metric label="Window leads" value={windowData?.leads.count ?? "—"} sub={`form_type: ${windowData?.leads.by_form_type.length ?? 0} · sources: ${windowData?.leads.by_source.length ?? 0}`} />
        <Metric label="ALL-TIME LEADS" value={allLeadsTotal} sub={`from local DB (no time filter)`} />
        <Metric label="Prospects in DB" value={(prospectsQuery.data || []).length} sub={`${(prospectsQuery.data || []).filter((p) => p.status === "draft_needed").length} need draft · ${(prospectsQuery.data || []).filter((p) => p.status === "sent").length} sent`} />
        <Metric label="Gov opps (latest)" value={(govOppsQuery.data || []).length} sub={govOppsQuery.isError ? `endpoint errored` : `from /api/admin/government`} />
      </div>

      {/* SECONDARY BREAKDOWNS — window view (existing) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><Activity className="w-4 h-4" /> Form type (window)</h2>
            <ul className="text-sm space-y-1">
              {windowData?.leads.by_form_type.length
                ? windowData.leads.by_form_type.map((b) => (
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
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><MapPin className="w-4 h-4" /> Source (window)</h2>
            <ul className="text-sm space-y-1">
              {windowData?.leads.by_source.length
                ? windowData.leads.by_source.map((b) => (
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
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Top service interest (window)</h2>
            <ul className="text-sm space-y-1">
              {windowData?.leads.top_service_interest.length
                ? windowData.leads.top_service_interest.map((b) => (
                    <li key={b.service_interest} className="flex justify-between">
                      <span>{b.service_interest}</span><span className="text-gray-600">{b.count}</span>
                    </li>
                  ))
                : <li className="text-gray-500 text-sm">No service interest recorded yet.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* NEW: POTENTIAL LEADS — full table of every lead, with site link */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              All Potential Leads
              <span className="text-xs font-normal text-gray-500">({allLeadsTotal} total)</span>
            </h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search name, email, site, message…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-7 py-1 text-sm border rounded w-72"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          {allLeadsQuery.isError ? (
            <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-yellow-900">
              Leads endpoint errored: {String((allLeadsQuery.error as Error)?.message || allLeadsQuery.error)}
            </div>
          ) : allLeads.length === 0 ? (
            <div className="text-sm text-gray-500">
              No leads yet. When someone submits contact/audit/booking forms they show up here. The window metrics above may show fewer because it filters by date.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">Name &amp; Email</th>
                    <th className="py-2 pr-3">Business / Site</th>
                    <th className="py-2 pr-3">What</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Phone</th>
                    <th className="py-2 pr-3">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {allLeads.map((l) => (
                    <tr key={l.id} className="border-t border-zinc-200 dark:border-zinc-700 align-top">
                      <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                        {l.created_at ? new Date(l.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{l.name || `${l.first_name || ""} ${l.last_name || ""}`.trim() || "—"}</div>
                        <a href={`mailto:${l.email}`} className="text-xs text-blue-600 break-all flex items-center gap-1">
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[200px]">{l.email || "—"}</span>
                        </a>
                      </td>
                      <td className="py-2 pr-3">
                        {l.business_name || l.company ? (
                          <div className="text-sm font-medium">{l.business_name || l.company}</div>
                        ) : <div className="text-xs text-gray-500">—</div>}
                        {l.website && (
                          <a href={l.website} target="_blank" rel="noreferrer" className="text-xs text-blue-600 flex items-center gap-1 hover:underline">
                            <Globe className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-[180px]">{l.website.replace(/^https?:\/\//, "")}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge>{l.form_type || "?"}</Badge>
                        {l.service_interest && <div className="text-xs text-gray-600 mt-1">wants: {l.service_interest}</div>}
                        {l.budget_range && <div className="text-xs text-gray-600">budget: {l.budget_range}</div>}
                        {l.timeline && <div className="text-xs text-gray-600">when: {l.timeline}</div>}
                        {l.zip_code && <div className="text-xs text-gray-500">ZIP {l.zip_code}</div>}
                      </td>
                      <td className="py-2 pr-3"><StatusBadge s={l.status} /></td>
                      <td className="py-2 pr-3 text-xs">
                        {l.phone ? (
                          <a href={`tel:${l.phone}`} className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {l.phone}
                          </a>
                        ) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-gray-700 max-w-md">
                        {l.message ? (
                          <span className="line-clamp-3">{l.message}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NEW: PROSPECTS — discovered sites + their status */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Prospect Pipeline (Business Sites Discovered)
              <span className="text-xs font-normal text-gray-500">({(prospectsQuery.data || []).length})</span>
            </h2>
            <Button variant="outline" size="sm" onClick={() => prospectsQuery.refetch()} disabled={prospectsQuery.isFetching}>
              {prospectsQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            </Button>
          </div>
          {prospectsQuery.isError ? (
            <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-yellow-900">
              Prospects endpoint errored: {String((prospectsQuery.error as Error)?.message || prospectsQuery.error)}
            </div>
          ) : (prospectsQuery.data || []).length === 0 ? (
            <div className="text-sm text-gray-500">
              No prospects yet. Run <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">/api/prospects/scan</code> to start discovering businesses via Google Places.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 pr-3">Business</th>
                    <th className="py-2 pr-3">Site</th>
                    <th className="py-2 pr-3">Vertical / City</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Leak score</th>
                    <th className="py-2 pr-3">Last scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {(prospectsQuery.data || []).map((p) => (
                    <tr key={p.id} className="border-t border-zinc-200 dark:border-zinc-700 align-top">
                      <td className="py-2 pr-3 font-medium">{p.business_name || p.root_domain || "—"}</td>
                      <td className="py-2 pr-3">
                        {p.website ? (
                          <a href={p.website} target="_blank" rel="noreferrer" className="text-blue-600 flex items-center gap-1 hover:underline">
                            <span className="truncate max-w-[200px]">{p.website.replace(/^https?:\/\//, "")}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : "—"}
                        {p.detected_platform && <div className="text-xs text-gray-500 mt-1">platform: {p.detected_platform}</div>}
                        {p.email && (
                          <a href={`mailto:${p.email}`} className="text-xs text-blue-600 flex items-center gap-1 mt-1">
                            <Mail className="w-3 h-3" />
                            <span className="truncate max-w-[180px]">{p.email}</span>
                          </a>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {p.vertical && <div>{p.vertical}</div>}
                        {p.city && <div className="text-gray-500">{p.city}</div>}
                        {p.page_weight_kb != null && <div className="text-gray-500">{p.page_weight_kb} KB · {p.load_time_ms}ms</div>}
                      </td>
                      <td className="py-2 pr-3"><StatusBadge s={p.status} /></td>
                      <td className="py-2 pr-3 text-xs">{p.leak_score != null ? p.leak_score : "—"}</td>
                      <td className="py-2 pr-3 text-xs text-gray-500">
                        {p.last_scanned_at ? new Date(p.last_scanned_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NEW: SAM.gov opportunities — local source */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              New SAM.gov Opportunities
              <span className="text-xs font-normal text-gray-500">({(govOppsQuery.data || []).length})</span>
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => govOppsQuery.refetch()} disabled={govOppsQuery.isFetching}>
                {govOppsQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/admin/government")}>Full view</Button>
            </div>
          </div>
          {govOppsQuery.isError ? (
            <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-yellow-900">
              SAM.gov opportunities endpoint errored: {String((govOppsQuery.error as Error)?.message || govOppsQuery.error)}
              <div className="mt-1 text-xs">Open <button onClick={() => setLocation("/admin/government")} className="underline">the full Gov tab</button> for drafts, agencies, and ingestion controls.</div>
            </div>
          ) : (govOppsQuery.data || []).length === 0 ? (
            <div className="text-sm text-gray-500">
              No SAM.gov opportunities cached. Click <button onClick={() => setLocation("/admin/government")} className="underline">Government</button> to trigger ingestion.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3">Agency</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Value</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {(govOppsQuery.data || []).map((o: any, idx: number) => (
                    <tr key={o.id || o.opportunity_id || idx} className="border-t border-zinc-200 dark:border-zinc-700 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{o.title || o.name || "—"}</div>
                        {o.solicitation_number && <div className="text-xs text-gray-500 mt-1">#{o.solicitation_number}</div>}
                        {o.response_deadline && <div className="text-xs text-amber-700 mt-1">due {new Date(o.response_deadline).toLocaleDateString()}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {o.agency || "—"}
                        {o.office && <div className="text-gray-500">{o.office}</div>}
                        {o.naics && <div className="text-gray-500">{o.naics}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs">{o.source || "SAM.gov"}</td>
                      <td className="py-2 pr-3 text-xs">{o.estimated_value ? `$${Math.round(Number(o.estimated_value) / 1000).toLocaleString()}` : "—"}</td>
                      <td className="py-2 pr-3"><StatusBadge s={o.status || o.workflow_state} /></td>
                      <td className="py-2 pr-3">
                        {o.source_url || o.url ? (
                          <a href={o.source_url || o.url} target="_blank" rel="noreferrer" className="text-blue-600 flex items-center gap-1 hover:underline">
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* OLD: Lead events (window) */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Clock className="w-4 h-4" /> Recent lead events (window)</h2>
          {windowData?.recent_events.length
            ? (
              <ul className="text-sm divide-y divide-zinc-200 dark:divide-zinc-700">
                {windowData.recent_events.map((ev) => (
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

      <div className="mt-4 text-xs text-gray-500 text-center">
        Suppression list: {windowData?.suppression_total ?? 0} · prospect pipeline queued: {windowData?.prospect_pipeline.queued_now ?? 0} · unsubscribes in window: {windowData?.prospect_pipeline.unsubscribed_in_window ?? 0}
      </div>
    </div>
  );
}
