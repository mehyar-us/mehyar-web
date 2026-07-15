// @ts-nocheck
// ============================================================================
// MehyarSoft Admin — 2026 redesign
//   4 tabs: NOW · CRM · MONEY · SYSTEM
//   Top bar: Jarvis search + session
//   Side rail: tab-specific filters
// ============================================================================

import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Sparkles, LogOut, Search, Zap, Briefcase, DollarSign, Settings,
  RefreshCw, Bell, ChevronRight, X, Command, Send, Mail, Brain, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ── Session ────────────────────────────────────────────────────────────────
export const TOKEN_KEY = "mehyarsoft_admin_token";

export function useAdminSession() {
  const [token, setToken] = useState<string | null>(() => (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null));
  useEffect(() => {
    const onFocus = () => setToken(sessionStorage.getItem(TOKEN_KEY));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const login = (t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); };
  const logout = () => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); };
  return { token, isLoggedIn: !!token, login, logout };
}

// ── Status badge ──────────────────────────────────────────────────────────
export const STAGE_BADGE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  discovery: "bg-blue-100 text-blue-700",
  scanned: "bg-indigo-100 text-indigo-700",
  draft_needed: "bg-indigo-100 text-indigo-700",
  evaluating: "bg-indigo-100 text-indigo-700",
  drafting: "bg-violet-100 text-violet-700",
  draft_generated: "bg-violet-100 text-violet-700",
  ready: "bg-fuchsia-100 text-fuchsia-700",
  readytosend: "bg-fuchsia-100 text-fuchsia-700",
  approved: "bg-fuchsia-100 text-fuchsia-700",
  queued: "bg-amber-100 text-amber-700",
  sent: "bg-emerald-100 text-emerald-700",
  replied: "bg-emerald-100 text-emerald-700",
  won: "bg-green-200 text-green-900",
  lost: "bg-zinc-200 text-zinc-700",
  archived: "bg-zinc-100 text-zinc-600",
  no_bid: "bg-zinc-100 text-zinc-600",
  on_hold: "bg-amber-100 text-amber-700",
  unsubscribed: "bg-zinc-200 text-zinc-700",
  bounced: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
};

// ── Tab definitions ───────────────────────────────────────────────────────
const TABS = [
  { key: "now",   label: "⚡ Now",      href: "/admin",                  icon: Zap,         tagline: "Inbox-zero for the next 5 minutes" },
  { key: "crm",   label: "🧲 CRM",      href: "/admin/leads",            icon: Briefcase,   tagline: "Every lead, every deal — one table" },
  { key: "money", label: "💰 Money",    href: "/admin/money",            icon: DollarSign,  tagline: "Forecast · Win · Case studies" },
  { key: "system", label: "⚙ System",   href: "/admin/system",           icon: Settings,    tagline: "Audit · Cron · Backups" },
];

export function AdminNav({ active, onLogout, onRefresh }: { active: "now"|"crm"|"money"|"system"; onLogout: () => void; onRefresh?: () => void; }) {
  const [, setLocation] = useLocation();
  return (
    <div className="sticky top-0 z-30 backdrop-blur bg-white/85 border-b border-zinc-200 -mx-6 -mt-6 px-6 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 mr-4">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white font-bold">M</div>
          <div>
            <div className="font-semibold leading-tight">MehyarSoft</div>
            <div className="text-[10px] text-zinc-500 leading-tight">Admin · 2026</div>
          </div>
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = active === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setLocation(t.href)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  isActive
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onRefresh && (
            <Button variant="ghost" size="sm" onClick={onRefresh}><RefreshCw className="w-4 h-4" /></Button>
          )}
          <Button variant="ghost" size="sm" onClick={onLogout}><LogOut className="w-4 h-4 mr-1" />Logout</Button>
        </div>
      </div>
    </div>
  );
}

// ── Jarvis command bar — every page can drop one in ───────────────────────
export function JarvisBar({ token, onResult, defaultQuery = "", placeholder = "Ask Jarvis · try 'count prospects last 7d', 'enrich a0daf6…', or 'sql: select *…'" }: { token: string; onResult?: (r: any) => void; defaultQuery?: string; placeholder?: string; }) {
  const [q, setQ] = useState(defaultQuery);
  const [running, setRunning] = useState(false);
  const [resp, setResp] = useState<any>(null);

  const submit = async (raw?: string) => {
    const useQ = (raw ?? q).trim();
    if (!useQ) return;
    setRunning(true); setResp(null);
    try {
      const r = await fetch("/api/admin/jarvis", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query: useQ }),
      });
      const data = await r.json();
      setResp(data);
      onResult?.(data);
    } catch (e) {
      setResp({ ok: false, error: String((e as any).message || e) });
    }
    setRunning(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('[data-jarvis-input]');
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Command className="w-4 h-4 text-zinc-400" />
        <input
          data-jarvis-input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm focus:outline-none"
          disabled={running}
        />
        {q && <button onClick={() => { setQ(""); setResp(null); }} className="text-zinc-400 hover:text-zinc-600"><X className="w-4 h-4" /></button>}
        <Button size="sm" onClick={() => submit()} disabled={!q || running}>
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
      {resp && (
        <div className={`px-4 py-3 border-t text-sm ${resp.ok ? "bg-emerald-50/40 border-emerald-100" : "bg-red-50 border-red-100"}`}>
          {resp.ok ? <JarvisResult r={resp} /> : <div className="text-red-700">⚠ {String(resp.error || resp.details || "failed")}</div>}
        </div>
      )}
    </div>
  );
}

function JarvisResult({ r }: { r: any }) {
  if (r.kind === "sql") {
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-1">📊 SQL · {r.row_count} rows · {r.elapsed_ms}ms</div>
        {Array.isArray(r.rows) && r.rows.length > 0 ? (
          <div className="overflow-auto max-h-64 rounded border bg-white">
            <table className="text-xs min-w-full">
              <thead className="bg-zinc-100 sticky top-0">
                <tr>{Object.keys(r.rows[0]).map((k) => <th key={k} className="px-2 py-1 text-left font-medium">{k}</th>)}</tr>
              </thead>
              <tbody>
                {r.rows.slice(0, 30).map((row, i) => (
                  <tr key={i} className="odd:bg-zinc-50/50">
                    {Object.values(row).map((v, j) => <td key={j} className="px-2 py-1 whitespace-nowrap">{String(v ?? "").slice(0, 80)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {r.rows.length > 30 && <div className="text-xs text-zinc-500 px-2 py-1">… {r.rows.length - 30} more rows</div>}
          </div>
        ) : <div className="text-zinc-500 italic">no rows</div>}
      </div>
    );
  }
  if (r.kind === "count") return <div className="text-sm">📈 <strong className="font-mono">{r.count}</strong> {r.target}</div>;
  if (r.kind === "last") {
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-1">🕒 Last {r.events?.length || 0} {r.event_type}</div>
        <ul className="text-xs space-y-0.5">
          {r.events?.slice(0, 10).map((e, i) => (
            <li key={i}>
              <span className="font-mono text-zinc-500">{new Date(e.created_at).toLocaleString()}</span>
              <span className="ml-2">{String(e.summary || e.payload).slice(0, 120)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (r.kind === "llm") return <div className="text-sm whitespace-pre-wrap">🧠 {r.text}</div>;
  if (r.kind === "info") return <div className="text-sm">ℹ️ {r.text}</div>;
  return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(r, null, 2)}</pre>;
}

// ── Shared small UI atoms ────────────────────────────────────────────────
export function ScoreBar({ score = 0, max = 100, label = "Score", tone }: { score?: number; max?: number; label?: string; tone?: "leak"|"fit" }) {
  const pct = Math.max(0, Math.min(max, score));
  const color = tone === "leak"
    ? (pct >= 60 ? "bg-red-500" : pct >= 30 ? "bg-amber-500" : "bg-emerald-500")
    : (pct >= 60 ? "bg-emerald-500" : pct >= 30 ? "bg-amber-500" : "bg-red-500");
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 w-12">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-200 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${(pct/max)*100}%` }} />
      </div>
      <span className="text-xs font-mono w-12 text-right">{pct}/{max}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon = Sparkles, title, desc, actionLabel, onAction }: { icon?: any; title: string; desc: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Icon className="w-10 h-10 mx-auto text-zinc-300" />
        <div className="mt-3 text-sm font-medium text-zinc-700">{title}</div>
        <div className="text-xs text-zinc-500 mt-1">{desc}</div>
        {actionLabel && onAction && (
          <Button size="sm" variant="cta" className="mt-3" onClick={onAction}>{actionLabel}</Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Login gate ───────────────────────────────────────────────────────────
export function LoginGate({ onLogin }: { onLogin: (t: string) => void }) {
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/v1/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, password: pw }),
      });
      const data = await r.json();
      if (!r.ok || !data.token) {
        setError(data?.error || "Login failed");
      } else {
        onLogin(data.token);
      }
    } catch (e) {
      setError(String((e as any).message || e));
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6">
      <Card className="w-full max-w-sm shadow-xl">
        <CardContent className="p-7">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white font-bold text-lg">M</div>
            <div>
              <div className="font-bold text-base">MehyarSoft Admin</div>
              <div className="text-xs text-zinc-500">Built for 2026</div>
            </div>
          </div>
          <div className="space-y-2">
            <Input placeholder="username" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
            <Input type="password" placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoComplete="current-password" />
            {error && <div className="text-sm text-red-600">⚠ {error}</div>}
            <Button onClick={submit} disabled={loading || !user || !pw} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Sign in
            </Button>
          </div>
          <div className="text-xs text-zinc-500 mt-4 text-center">
            Press <kbd className="px-1 rounded bg-zinc-100">⌘K</kbd> anywhere to summon Jarvis
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── App-level guard (wraps an entire tab) ────────────────────────────────
export function AdminGate({ children }: { children: (token: string) => React.ReactNode }) {
  const { token, isLoggedIn, login, logout } = useAdminSession();
  if (!isLoggedIn) return <LoginGate onLogin={login} />;
  return <>{children(token!)}{logout && <></>}</>;
}
