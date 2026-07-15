// AdminToday.tsx — /admin/today
// Three-column triage dashboard + Jarvis AI bar.
// Replaces the old single-panel "Today & Inbox" view.
// No Telegram/email side-effects. Idempotent.
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AdminNav, useAdminSession, LoginGate } from "./AdminChrome";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCcw, Send, Bot, AlertCircle, CheckCircle2, Clock, ArrowRight, Zap, MessageSquare, ExternalLink } from "lucide-react";

const TOKEN_KEY = "mehyarsoft_admin_token";

// ── Types ─────────────────────────────────────────────────────────────────────
type OppItem = {
  kind: "prospect" | "sam";
  id: string;
  title: string;
  subtitle: string;
  subsubtitle: string;
  status: string | null;
  stage: string;
  email: string | null;
  phone: string | null;
  leak_score: number | null;
  detected_platform: string | null;
  last_touched_at: string | null;
  last_event_at: string | null;
  href: string;
  deadline: string | null; // SAM only
  agency: string | null;
  fit_score: number | null;
  set_aside: string | null;
  opportunity_type: string | null;
};

type ListResponse = { ok: boolean; items: OppItem[]; total: number; updatedAt: string };

type JarvisResponse = {
  ok: boolean;
  question: string;
  answer: string;
  source: "sql" | "llm" | "appsolut";
  sqlResult: { query: string; count: number } | null;
  sqlError: string | null;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function JarvisBar({ token }: { token: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const r = await fetch("/api/admin/jarvis", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: q }),
      });
      const data: JarvisResponse = await r.json();
      if (!data.ok) throw new Error((data as any).error || "jarvis failed");
      setAnswer(data.answer);
      setSource(data.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 border-blue-200 dark:border-blue-800">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-sm">Jarvis AI</span>
          {source && (
            <Badge className="text-xs" variant="outline">
              {source === "sql" ? "SQL" : source === "llm" ? "LLM" : "template"}
            </Badge>
          )}
          <span className="text-xs text-gray-500">Ask anything about your leads, prospects, and pipeline.</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. How many leads this week? What's in the drafting stage?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
            disabled={busy}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
          />
          <Button onClick={ask} disabled={busy || !question.trim()} size="sm" className="gap-1">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Ask
          </Button>
        </div>
        {error && (
          <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </div>
        )}
        {answer && (
          <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 text-sm">
            <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200 font-sans" style={{ fontFamily: "inherit" }}>{answer}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TriageColumn({
  title,
  icon,
  color,
  items,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  items: OppItem[];
  emptyText: string;
}) {
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 mb-3 ${color}`}>
          {icon}
          <h2 className="font-semibold text-sm">{title}</h2>
          <Badge variant="outline" className="ml-auto text-xs">{items.length}</Badge>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 italic">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 20).map((item) => (
              <a
                key={item.id + item.kind}
                href={item.href}
                className="flex flex-col gap-0.5 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-sm"
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="font-medium text-xs leading-tight">{item.title}</span>
                  {item.deadline && (
                    <span className="text-xs text-red-600 shrink-0 flex items-center gap-0.5">
                      <Clock className="w-3 h-3" /> {new Date(item.deadline).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">{item.subtitle}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Badge className="text-[10px] py-0">{item.kind}</Badge>
                  <Badge className="text-[10px] py-0">{item.stage}</Badge>
                  {item.leak_score != null && (
                    <span className="text-[10px] text-orange-600 ml-auto">leak {item.leak_score}</span>
                  )}
                  {item.fit_score != null && (
                    <span className="text-[10px] text-blue-600 ml-auto">fit {item.fit_score}</span>
                  )}
                </div>
              </a>
            ))}
            {items.length > 20 && (
              <p className="text-xs text-gray-400 text-center">+{items.length - 20} more</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminToday() {
  const { token, isLoggedIn, login, logout } = useAdminSession();
  const [, setLocation] = useLocation();

  const oppsQuery = useQuery({
    enabled: !!token,
    queryKey: ["admin-today-opps", token],
    queryFn: async () => {
      const r = await fetch("/api/admin/opportunities/list?kind=all&limit=200", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        if (r.status === 401) logout();
        throw new Error(`${r.status} ${r.statusText}`);
      }
      const data: ListResponse = await r.json();
      return data.items || [];
    },
  });

  const isLoading = oppsQuery.isFetching;
  const refreshAll = () => { oppsQuery.refetch(); };

  if (!isLoggedIn) {
    return <LoginGate onLogin={login} onBack={() => setLocation("/admin")} />;
  }

  const allOpps: OppItem[] = oppsQuery.data || [];

  // ── Triage bucketing ───────────────────────────────────────────────────────
  // Do now: opportunities with deadline in next 3 days or stage=Drafting/ReadyToSend
  const doNowItems = allOpps.filter((o) => {
    if (o.stage === "Drafting" || o.stage === "ReadyToSend") return true;
    if (o.deadline) {
      const d = new Date(o.deadline);
      const now = Date.now();
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      return d.getTime() - now < threeDays;
    }
    return false;
  });

  // Today follow-ups: Replied stage (got a response, need to follow up)
  const todayFollowUps = allOpps.filter((o) => o.stage === "Replied");

  // Responding now: Sent stage (email has been sent, waiting)
  const respondingNow = allOpps.filter((o) => o.stage === "Sent");

  // Quick stats
  const total = allOpps.length;
  const wonCount = allOpps.filter((o) => o.stage === "Won").length;
  const lostCount = allOpps.filter((o) => o.stage === "Lost").length;
  const activeCount = allOpps.filter((o) => !["Won", "Lost", "Archived"].includes(o.stage)).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Today</h1>
          <p className="text-sm text-gray-500">
            Triage view · {activeCount} active · {wonCount} won · {lostCount} lost
            {oppsQuery.dataUpdatedAt ? ` · updated ${new Date(oppsQuery.dataUpdatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <AdminNav token={token} onLogout={logout} isLoading={isLoading} refreshFn={refreshAll} />

      {/* Jarvis AI bar */}
      <JarvisBar token={token as string} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-semibold">{total}</div>
            <div className="text-xs text-gray-500">Total opportunities</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-semibold text-blue-600">{activeCount}</div>
            <div className="text-xs text-gray-500">Active</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-semibold text-emerald-600">{wonCount}</div>
            <div className="text-xs text-gray-500">Won</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-semibold text-red-600">{lostCount}</div>
            <div className="text-xs text-gray-500">Lost</div>
          </CardContent>
        </Card>
      </div>

      {/* Three-column triage */}
      {oppsQuery.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          Failed to load opportunities: {String((oppsQuery.error as Error)?.message || oppsQuery.error)}
        </div>
      )}

      <div className="flex gap-4 flex-wrap">
        <TriageColumn
          title="Do now"
          icon={<AlertCircle className="w-4 h-4 text-red-600" />}
          color="text-red-700"
          items={doNowItems}
          emptyText="Nothing urgent — you're clear."
        />
        <TriageColumn
          title="Today follow-ups"
          icon={<MessageSquare className="w-4 h-4 text-blue-600" />}
          color="text-blue-700"
          items={todayFollowUps}
          emptyText="No replies to follow up yet."
        />
        <TriageColumn
          title="Responding now"
          icon={<Zap className="w-4 h-4 text-amber-600" />}
          color="text-amber-700"
          items={respondingNow}
          emptyText="No active sends right now."
        />
      </div>
    </div>
  );
}
