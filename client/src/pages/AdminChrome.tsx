// Shared chrome used by every admin page.
//   • AdminNav — top navigation bar so the user can switch tabs.
//   • useAdminSession — restores token from sessionStorage; provides login() + logout().
//     Pages render children immediately when token exists; they show a tiny
//     LoginGate only if there's no token.
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail, Activity, Phone, MapPin, Clock, Users, Search, X, Briefcase, Globe, Trash2, AlertTriangle, CheckCircle2, ExternalLink, BookmarkPlus, History, Eye, EyeOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const TOKEN_KEY = "mehyarsoft_admin_token";

export const STATUS_BADGE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  queued: "bg-amber-100 text-amber-700",
  sent: "bg-emerald-100 text-emerald-700",
  replied: "bg-emerald-100 text-emerald-700",
  unsubscribed: "bg-zinc-200 text-zinc-700",
  bounced: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
  scanned: "bg-indigo-100 text-indigo-700",
  draft_needed: "bg-indigo-100 text-indigo-700",
  drafted: "bg-violet-100 text-violet-700",
  approved: "bg-fuchsia-100 text-fuchsia-700",
};

export function AdminNav({ token, onLogout, isLoading, refreshFn }: {
  token: string | null;
  onLogout: () => void;
  isLoading?: boolean;
  refreshFn?: () => void;
}) {
  const [, setLocation] = useLocation();
  const tabs = [
    { key: "today", label: "Today", href: "/admin/today" },
    { key: "opps", label: "Opportunities", href: "/admin/opportunities" },
    { key: "metrics", label: "Metrics", href: "/admin" },
    { key: "analytics", label: "Analytics", href: "/admin/analytics" },
    { key: "prospects", label: "Prospects", href: "/admin/prospects" },
    { key: "signups", label: "Signups", href: "/admin/newsletter" },
    { key: "government", label: "Government", href: "/admin/government" },
    { key: "scout", label: "Opportunity Scout", href: "/admin/opportunity-scout" },
    { key: "billing", label: "Billing", href: "/admin/billing" },
    { key: "email", label: "Email", href: "/admin/email" },
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {tabs.map((t) => (
        <Button key={t.key} variant="outline" size="sm" onClick={() => setLocation(t.href)}>{t.label}</Button>
      ))}
      {refreshFn && (
        <Button variant="outline" size="sm" onClick={refreshFn} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Refresh
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={onLogout}>Logout</Button>
    </div>
  );
}

export function useAdminSession() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));

  // Refresh when navigating in the same tab (route-only changes don't re-read storage)
  useEffect(() => {
    const onFocus = () => {
      const t = sessionStorage.getItem(TOKEN_KEY);
      setToken(t);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const login = (newToken: string) => {
    sessionStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  };
  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
  };
  return { token, isLoggedIn: !!token, login, logout };
}

export function LoginGate({ onLogin, onBack }: { onLogin: (t: string) => void; onBack: () => void }) {
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
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              try {
                const r = await fetch("/v1/admin/login", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ username: u, password: p }),
                });
                if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
                const d = await r.json();
                onLogin(d.token);
              } catch (e2) {
                setErr(e2 instanceof Error ? e2.message : String(e2));
              } finally {
                setBusy(false);
              }
            }}
            className="space-y-2">
            <input type="text" placeholder="username" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} disabled={busy} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input type="password" placeholder="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} disabled={busy} className="w-full rounded-lg border px-3 py-2 text-sm" />
            {err && <div className="text-xs text-red-600">{err}</div>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onBack}>Back</Button>
              <Button type="submit" variant="cta" size="sm" disabled={busy} className="flex-1">{busy ? "Connecting…" : "Login"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
