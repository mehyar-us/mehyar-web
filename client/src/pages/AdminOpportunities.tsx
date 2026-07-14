import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCcw, ChevronLeft, ExternalLink, Search, X, Briefcase, Globe, AlertTriangle, Filter, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, useAdminSession, STATUS_BADGE } from "./AdminChrome";

type Opp = {
  kind: "prospect" | "sam";
  id: string;
  title: string;
  subtitle?: string | null;
  subsubtitle?: string | null;
  status?: string | null;
  stage: string;
  email?: string | null;
  phone?: string | null;
  leak_score?: number | null;
  detected_platform?: string | null;
  last_touched_at?: string | null;
  last_event_at?: string | null;
  href: string;
  deadline?: string | null;
  agency?: string | null;
  fit_score?: number | null;
  set_aside?: string | null;
  opportunity_type?: string | null;
};

const STAGES = ["Discovery", "Evaluating", "Drafting", "ReadyToSend", "Sent", "Replied", "Won", "Lost", "Archived"];
const KIND_FILTERS = [
  { key: "all", label: "All" },
  { key: "prospect", label: "Prospects (B2B)" },
  { key: "sam", label: "SAM.gov" },
];

function stageColor(stage) {
  switch (stage) {
    case "Discovery": return "bg-zinc-100 text-zinc-700";
    case "Evaluating": return "bg-amber-100 text-amber-700";
    case "Drafting": return "bg-violet-100 text-violet-700";
    case "ReadyToSend": return "bg-indigo-100 text-indigo-700";
    case "Sent": return "bg-blue-100 text-blue-700";
    case "Replied": return "bg-cyan-100 text-cyan-700";
    case "Won": return "bg-emerald-100 text-emerald-700";
    case "Lost": return "bg-red-100 text-red-700";
    case "Archived": return "bg-zinc-200 text-zinc-600 line-through";
    default: return "bg-zinc-100 text-zinc-700";
  }
}

function deadlineLabel(deadline) {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline;
  const ms = d.getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return <span className="text-red-600 font-semibold">{Math.abs(days)}d overdue</span>;
  if (days <= 3) return <span className="text-amber-700 font-semibold">{days}d left</span>;
  if (days <= 14) return <span className="text-amber-600">{days}d left</span>;
  return <span className="text-gray-500">{days}d left</span>;
}

export default function AdminOpportunities() {
  const [, setLocation] = useLocation();
  const { token, isLoggedIn, logout, login } = useAdminSession();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<"all" | "prospect" | "sam">("all");
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);

  // debounce search
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  const list = useQuery({
    enabled: !!token && isLoggedIn,
    queryKey: ["admin-opps", token, kind, stage, debouncedSearch],
    queryFn: async () => {
      const qs = new URLSearchParams({ kind, limit: "100", offset: "0" });
      if (stage) qs.set("stage", stage);
      if (debouncedSearch) qs.set("q", debouncedSearch);
      const r = await fetch(`/api/admin/opportunities/list?${qs.toString()}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      return (data.items || []) as Opp[];
    },
  });

  const counts = useMemo(() => {
    const c = { all: 0, prospect: 0, sam: 0, byStage: { Discovery: 0, Evaluating: 0, Drafting: 0, ReadyToSend: 0, Sent: 0, Replied: 0, Won: 0, Lost: 0, Archived: 0 } as Record<string, number> };
    for (const o of list.data || []) {
      c.all++;
      c[o.kind]++;
      c.byStage[o.stage] = (c.byStage[o.stage] || 0) + 1;
    }
    return c;
  }, [list.data]);

  // No per-page login — useAdminSession handles initial token restore
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav token={token} onLogout={logout} isLoading={list.isFetching} />

      {/* Top: pipeline KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStage(stage === s ? "" : s)}
            className={`p-3 rounded-lg border text-left transition ${stage === s ? "ring-2 ring-blue-500 border-blue-500 bg-blue-50" : "border-zinc-200 hover:border-zinc-400"}`}
            title={`Filter by stage ${s}`}
          >
            <div className="text-xs text-gray-500">{s}</div>
            <div className="text-2xl font-semibold">{counts.byStage[s] ?? 0}</div>
          </button>
        ))}
      </div>

      {/* Filter row */}
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <div className="flex bg-zinc-100 rounded-lg p-1 text-sm">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setKind(f.key as any)}
                className={`px-3 py-1 rounded-md ${kind === f.key ? "bg-white shadow-sm font-medium" : "text-gray-600 hover:text-gray-900"}`}
              >
                {f.label}
                {f.key !== "all" && <span className="ml-1 text-xs text-gray-500">({counts[f.key]})</span>}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search title, agency, site, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-7 pr-7 py-1.5 text-sm border rounded"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {stage && <Button variant="outline" size="sm" onClick={() => setStage("")}>Clear stage</Button>}
          <span className="ml-auto text-xs text-gray-500">{list.data?.length ?? 0} shown</span>
          <Button variant="outline" size="sm" onClick={() => list.refetch()} disabled={list.isFetching}>
            {list.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          </Button>
        </CardContent>
      </Card>

      {list.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          {String((list.error as Error)?.message || list.error)}
        </div>
      )}

      {/* List */}
      {(list.data || []).length === 0 && !list.isFetching ? (
        <Card><CardContent className="py-12 text-center text-sm text-gray-500">
          No opportunities yet. Run <button onClick={() => setLocation("/admin/opportunity-scout")} className="text-blue-600 underline">Opportunity Scout</button> to discover SAM.gov listings and B2B businesses.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {(list.data || []).map((o) => (
            <Card key={`${o.kind}:${o.id}`} className="hover:border-blue-400 transition cursor-pointer" onClick={() => setLocation(o.href)}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    {o.kind === "sam" ? <Briefcase className="w-5 h-5 text-blue-600" /> : <Globe className="w-5 h-5 text-emerald-600" />}
                  </span>
                  <div className="flex-1 min-w-[280px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{o.title}</h3>
                      <Badge className={kind === "sam" ? undefined : "bg-emerald-100 text-emerald-700"}>{o.kind === "sam" ? "SAM" : "Prospect"}</Badge>
                      <Badge className={stageColor(o.stage)}>{o.stage}</Badge>
                      {o.status && <StatusBadgePill status={o.status} kind={o.kind} />}
                    </div>
                    {o.subtitle && <div className="text-sm text-gray-600 mt-0.5">{o.subtitle}{o.subsubtitle ? ` · ${o.subsubtitle}` : ""}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      {o.deadline && (
                        <span>📅 Deadline {deadlineLabel(o.deadline)}</span>
                      )}
                      {o.leak_score != null && (
                        <span>🩸 Leak score <span className="font-mono">{o.leak_score}</span>{o.detected_platform ? ` · ${o.detected_platform}` : ""}</span>
                      )}
                      {o.fit_score != null && (
                        <span>🎯 Fit {o.fit_score}{o.set_aside ? ` · ${o.set_aside}` : ""}</span>
                      )}
                      {o.email && <span>✉️ {o.email}</span>}
                      {o.phone && <span>📞 {o.phone}</span>}
                      {o.last_touched_at && <span>🕒 {timeAgo(o.last_touched_at)}</span>}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 mt-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadgePill({ status, kind }: { status?: string | null; kind: "prospect" | "sam" }) {
  if (!status) return null;
  const color = (STATUS_BADGE as any)[status] || "bg-zinc-100 text-zinc-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{status}</span>;
}

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
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
