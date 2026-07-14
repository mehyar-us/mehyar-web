// AdminAudit.tsx — /admin/audit
// Searchable audit trail across both opportunity kinds + decision log.
// Reuses useAdminSession from AdminChrome. Read-only. No side-effects.
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AdminNav, useAdminSession, LoginGate } from "./AdminChrome";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCcw, Search, Clock, CheckCircle, XCircle, ArrowRight, Filter } from "lucide-react";

type AuditEvent = {
  id: string;
  kind: "prospect" | "sam";
  opportunity_id: string;
  event_type: string;
  from_stage: string | null;
  to_stage: string | null;
  actor: string;
  payload_json: string;
  created_at: string;
};

type DecisionRecord = {
  id: string;
  kind: "prospect" | "sam";
  opportunity_id: string;
  decision: string;
  reason_code: string | null;
  reason_body: string | null;
  decided_by: string;
  decided_at: string;
  created_at: string;
};

type AuditResponse = {
  ok: boolean;
  items: AuditEvent[];
  decisions: DecisionRecord[];
  total: number;
  updatedAt: string;
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  stage_change: "bg-indigo-100 text-indigo-700",
  note: "bg-zinc-100 text-zinc-700",
  draft: "bg-amber-100 text-amber-700",
  sent: "bg-emerald-100 text-emerald-700",
  application: "bg-blue-100 text-blue-700",
  view: "bg-zinc-100 text-zinc-500",
  decision: "bg-violet-100 text-violet-700",
};

function EventRow({ ev }: { ev: AuditEvent | DecisionRecord }) {
  const isDecision = "decision" in ev;
  return (
    <tr className="border-t border-zinc-200 dark:border-zinc-700 text-sm">
      <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
        {ev.created_at ? new Date(ev.created_at).toLocaleString() : "—"}
      </td>
      <td className="py-2 pr-3">
        <Badge className={isDecision ? "bg-violet-100 text-violet-700" : (ev as AuditEvent).event_type ? EVENT_TYPE_COLORS[(ev as AuditEvent).event_type] || "bg-zinc-100 text-zinc-700" : "bg-zinc-100 text-zinc-700"}>
          {isDecision ? "decision" : (ev as AuditEvent).event_type}
        </Badge>
      </td>
      <td className="py-2 pr-3">
        <span className="rounded-full px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700">{isDecision ? (ev as DecisionRecord).kind : (ev as AuditEvent).kind}</span>
      </td>
      <td className="py-2 pr-3 font-mono text-xs">
        {(ev as AuditEvent).from_stage ? (
          <span className="flex items-center gap-1">
            <span>{String((ev as AuditEvent).from_stage)}</span>
            <ArrowRight className="w-3 h-3 text-gray-400" />
            <span>{(ev as AuditEvent).to_stage}</span>
          </span>
        ) : isDecision ? (
          <span className={(ev as DecisionRecord).decision === "won" ? "text-emerald-600" : (ev as DecisionRecord).decision === "lost" ? "text-red-600" : "text-gray-600"}>
            {String((ev as DecisionRecord).decision)}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="py-2 pr-3">
        {isDecision && (ev as DecisionRecord).reason_code ? (
          <span className="text-xs">
            <span className="font-mono bg-zinc-100 dark:bg-zinc-700 px-1 rounded">{(ev as DecisionRecord).reason_code}</span>
            {(ev as DecisionRecord).reason_body && <span className="ml-2 text-gray-600">{(ev as DecisionRecord).reason_body}</span>}
          </span>
        ) : !isDecision && (ev as AuditEvent).payload_json ? (
          <span className="text-xs text-gray-600 line-clamp-2 max-w-xs">{(() => { try { return JSON.parse((ev as AuditEvent).payload_json || "{}").note || ""; } catch { return (ev as AuditEvent).payload_json; } })()}</span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-xs text-gray-500">{(ev as AuditEvent).actor || (ev as DecisionRecord).decided_by}</td>
      <td className="py-2 pr-3 font-mono text-xs text-blue-600">
        {String((ev as AuditEvent).opportunity_id || (ev as DecisionRecord).opportunity_id).slice(0, 20)}…
      </td>
    </tr>
  );
}

export default function AdminAudit() {
  const { token, isLoggedIn, login, logout } = useAdminSession();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "prospect" | "sam">("all");
  const [eventFilter, setEventFilter] = useState("all");

  const query = useQuery({
    enabled: !!token,
    queryKey: ["admin-audit", token, search, kindFilter, eventFilter],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "100" });
      if (search) qs.set("q", search.slice(0, 100));
      if (kindFilter !== "all") qs.set("kind", kindFilter);
      if (eventFilter !== "all") qs.set("event_type", eventFilter);
      const r = await fetch(`/api/admin/audit/search?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        if (r.status === 401) logout();
        throw new Error(`${r.status} ${r.statusText}`);
      }
      return (await r.json()) as AuditResponse;
    },
  });

  const isLoading = query.isFetching;
  const refreshAll = () => { query.refetch(); };

  if (!isLoggedIn) {
    return <LoginGate onLogin={login} onBack={() => setLocation("/admin")} />;
  }

  const items: AuditEvent[] = query.data?.items || [];
  const decisions: DecisionRecord[] = query.data?.decisions || [];

  // Merge + sort by created_at desc
  type RowWithType =
    | (AuditEvent & { _type: "event" })
    | (DecisionRecord & { _type: "decision" });

  const allRows: RowWithType[] = [
    ...items.map((e): RowWithType => ({ ...e, _type: "event" })),
    ...decisions.map((d): RowWithType => ({ ...d, _type: "decision" })),
  ]
    .filter((row) => kindFilter === "all" || row.kind === kindFilter)
    .filter((row) => eventFilter === "all" || ("event_type" in row ? row.event_type === eventFilter : row._type === "decision"))
    .filter((row) => {
      if (!search) return true;
      const q = search.toLowerCase();
      const id = "opportunity_id" in row ? row.opportunity_id.toLowerCase() : "";
      const payload = "payload_json" in row ? row.payload_json.toLowerCase() : "";
      const reason = "reason_body" in row ? (row.reason_body || "").toLowerCase() : "";
      return id.includes(q) || payload.includes(q) || reason.includes(q);
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Trail</h1>
          <p className="text-sm text-gray-500">
            Full history: stage changes, decisions, notes across all opportunities.
            {query.dataUpdatedAt ? ` · as of ${new Date(query.dataUpdatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <AdminNav token={token} onLogout={logout} isLoading={isLoading} refreshFn={refreshAll} />

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by opportunity ID, notes, reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border rounded w-full"
            />
          </div>
          <select
            className="border rounded px-2 py-1.5 text-sm"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as "all" | "prospect" | "sam")}
          >
            <option value="all">All kinds</option>
            <option value="prospect">Prospects</option>
            <option value="sam">SAM/Gov</option>
          </select>
          <select
            className="border rounded px-2 py-1.5 text-sm"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
          >
            <option value="all">All events</option>
            <option value="stage_change">Stage changes</option>
            <option value="note">Notes</option>
            <option value="draft">Drafts</option>
            <option value="sent">Sends</option>
            <option value="decision">Decisions</option>
          </select>
          <div className="text-xs text-gray-500">{allRows.length} record(s)</div>
        </CardContent>
      </Card>

      {query.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          Failed to load audit data: {String((query.error as Error)?.message || query.error)}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500 bg-zinc-50 dark:bg-zinc-800">
                <tr>
                  <th className="py-2 pr-3 px-4">When</th>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Change / Decision</th>
                  <th className="py-2 pr-3">Detail</th>
                  <th className="py-2 pr-3">Actor</th>
                  <th className="py-2 pr-3">Opportunity</th>
                </tr>
              </thead>
              <tbody>
                {allRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500 text-sm">
                      No audit records found. Try adjusting your filters.
                    </td>
                  </tr>
                ) : (
                  allRows.map((row) => (
                    <EventRow key={row.id + row._type} ev={row as any} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
