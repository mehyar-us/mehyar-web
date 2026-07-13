import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ExternalLink, MailCheck, ShieldCheck, AlertTriangle, MailX, Send, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MEHYARSOFT_ADMIN_API_BASE_URL } from "@/lib/mehyarsoft-api";

// Prospect pipeline page — owner-only. Re-uses the JWT issued by the
// same /v1/admin/login as the main /admin dashboard, then proxies to
// the protected Pages Functions endpoints at /api/prospects/*.

const TOKEN_KEY = "mehyarsoft_admin_token";

type Prospect = {
  id: string; business_name: string; root_domain: string; website: string;
  vertical?: string | null; city?: string | null; email?: string | null;
  status: string;
  leak_score?: number | null; leak_signals_json?: string | null;
  detected_platform?: string | null; title?: string | null;
  page_weight_kb?: number | null; load_time_ms?: number | null;
  draft_subject?: string | null; draft_status?: string | null;
  last_send_status?: string | null; last_send_at?: string | null;
};

const STATI = ["new", "scanned", "drafted", "approved", "queued", "sent", "replied", "unsubscribed", "bounced", "skipped", "invalid"];

async function adminApi<T = any>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const url = `${MEHYARSOFT_ADMIN_API_BASE_URL}${path}`;
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as any) };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(url, { ...init, headers });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} — ${text.slice(0, 200)}`);
  }
  return r.json();
}

function LeakChips({ json }: { json?: string | null }) {
  let arr: string[] = [];
  try { arr = JSON.parse(json || "[]"); } catch {}
  if (!arr.length) return <span className="text-green-600 text-xs">clean signal set</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {arr.map((s, i) => (
        <span key={i} className="rounded-full border border-red-300 bg-red-50 text-red-700 text-xs px-2 py-0.5">{s}</span>
      ))}
    </div>
  );
}

function ProspectsBody({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [status, setStatus] = useState("drafted");
  const [q, setQ] = useState("");
  const [testMode, setTestMode] = useState(true);
  const [items, setItems] = useState<Prospect[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const sp = useMemo(() => {
    const u = new URLSearchParams();
    if (status) u.set("status", status);
    if (q) u.set("q", q);
    u.set("limit", "100");
    return u.toString();
  }, [status, q]);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // CF Pages Functions: /api/prospects/list
      const r = await fetch(`/api/prospects/list?${sp}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`${r.status} ${r.statusText} — ${text.slice(0, 200)}`);
      }
      const j = await r.json();
      setItems(j.items || []);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  const post = async (path: string, body: any) => {
    const r = await fetch(`/api/prospects/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`${r.status} ${r.statusText} — ${text.slice(0, 200)}`);
    }
    return r.json();
  };

  const runAction = async (label: string, fn: () => Promise<any>, id: string) => {
    setWorking(id);
    try {
      await fn();
      await load();
    } catch (e) {
      alert(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(null);
    }
  };

  const rescan = (p: Prospect) => runAction("Re-scan", () => post("scan", { prospect_id: p.id }), p.id);
  const redraft = (p: Prospect) => runAction("Re-draft", () => post("draft", { prospect_id: p.id }), p.id);

  const approveAndSend = async (p: Prospect) => {
    setWorking(p.id);
    try {
      // 1. (re)draft → get draft_id
      const d = await post("draft", { prospect_id: p.id });
      // 2. send (test or real)
      await post("send", { prospect_id: p.id, draft_id: d.draft_id, approve: true, test_only: testMode });
      await load();
    } catch (e) {
      alert(`Send failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Prospect pipeline</h1>
          <p className="text-sm text-gray-500">Scan → Draft → Approve → Send. Owner-led approval gate. CAN-SPAM + RFC 8058 in every send.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
            Test mode (route to founder)
          </label>
          <Button variant="outline" size="sm" onClick={onLogout}>Sign out</Button>
        </div>
      </header>

      <div className="flex gap-3 mb-4 flex-wrap">
        <select className="border rounded px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">— all statuses —</option>
          {STATI.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="border rounded px-2 py-1 text-sm flex-1 min-w-[200px]" placeholder="Search business, domain, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-3">
        {items.length === 0 && !isLoading && (
          <div className="rounded border border-dashed p-6 text-center text-sm text-gray-500">
            No prospects match. Drop a CSV at POST <code>/api/prospects/seed</code> or use the dashboard.
          </div>
        )}
        {items.map((p) => (
          <Card key={p.id} className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{p.business_name}</span>
                    <a href={p.website} target="_blank" rel="noreferrer" className="text-blue-600 text-sm flex items-center gap-1 truncate">
                      {p.root_domain} <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="rounded-full bg-gray-100 dark:bg-zinc-800 text-xs px-2 py-0.5">{p.status}</span>
                    {p.vertical && <span className="rounded-full border text-xs px-2 py-0.5">{p.vertical}</span>}
                    {p.city && <span className="rounded-full border text-xs px-2 py-0.5">{p.city}</span>}
                    {p.detected_platform && p.detected_platform !== "unknown" && (
                      <span className="rounded-full border text-xs px-2 py-0.5">{p.detected_platform}</span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
                    <span>leak score: <b>{p.leak_score ?? "-"}</b>/100</span>
                    {p.page_weight_kb != null && <span>page weight: <b>{p.page_weight_kb}</b> kB</span>}
                    {p.load_time_ms != null && <span>load: <b>{p.load_time_ms}</b> ms</span>}
                    {p.last_send_at && <span>last send: {new Date(p.last_send_at).toLocaleString()}</span>}
                  </div>

                  <div className="mt-2"><LeakChips json={p.leak_signals_json} /></div>

                  {p.draft_subject && (
                    <div className="mt-3 border-l-2 border-blue-300 pl-3 text-sm">
                      <div className="text-xs text-gray-500">draft · <span className="font-mono">{p.draft_status}</span></div>
                      <div className="font-medium">Subject: {p.draft_subject}</div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 w-40 shrink-0">
                  <Button variant="outline" size="sm" disabled={!!working} onClick={() => rescan(p)}>
                    Re-scan
                  </Button>
                  <Button variant="outline" size="sm" disabled={!!working || !p.leak_score} onClick={() => redraft(p)}>
                    Re-draft
                  </Button>
                  <Button
                    size="sm"
                    disabled={!!working || !p.draft_subject}
                    onClick={() => approveAndSend(p)}
                    className="flex items-center justify-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" /> {testMode ? "Send (test)" : "Approve & Send"}
                  </Button>
                </div>
              </div>

              {p.last_send_status && (
                <div className="mt-3 text-xs flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  {p.last_send_status === "sent" ? <MailCheck className="w-4 h-4 text-green-600" /> :
                    p.last_send_status === "skipped_suppressed" ? <ShieldCheck className="w-4 h-4 text-blue-600" /> :
                    p.last_send_status === "unsubscribed" ? <MailX className="w-4 h-4 text-red-600" /> :
                    <AlertTriangle className="w-4 h-4 text-amber-600" />}
                  Last send: <span className="font-mono">{p.last_send_status}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// The protected wrapper — reuses the JWT from Admin login (sessionStorage)
export function AdminProspectsProtected() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    // Verify the token by hitting a lightweight endpoint
    fetch("/api/prospects/list?limit=1", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) {
          sessionStorage.removeItem(TOKEN_KEY);
          setToken(null);
        } else {
          setToken(token);
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" />Checking admin session…</div>;
  }

  if (!token) {
    return <ProspectsLogin onLogin={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }} onBack={() => setLocation("/admin")} />;
  }

  return <ProspectsBody token={token} onLogout={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }} />;
}

function ProspectsLogin({ onLogin, onBack }: { onLogin: (token: string) => void; onBack: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const r = await adminApi<{ token: string }>("/v1/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (!r.token) throw new Error("no token returned");
      onLogin(r.token);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4">
          <div>
            <Button variant="ghost" size="sm" onClick={onBack} className="px-2"><ChevronLeft className="w-4 h-4" /> Back to /admin</Button>
          </div>
          <h2 className="text-xl font-semibold">Sign in to the prospect pipeline</h2>
          <p className="text-sm text-gray-500">Same credentials as the main admin dashboard.</p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
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

export default AdminProspectsProtected;
