import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAdminSession } from "./lib/session";

const NAV_LINKS = [
  { href: "/admin", label: "Brands" },
  { href: "/admin/today", label: "Today" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/revenue", label: "Revenue" },
];

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function LoginGate({ onLogin }: { onLogin: (u: string, p: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900 p-8">
        <div className="flex items-center gap-2 text-zinc-400">
          <ShieldAlert className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-widest">Owner access</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-100">Command Center</h1>
        <p className="mt-1 text-sm text-zinc-500">Sign in to view the brand dashboards.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc-username">Username</Label>
            <Input
              id="cc-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              className="border-zinc-700 bg-zinc-950"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-password">Password</Label>
            <Input
              id="cc-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="border-zinc-700 bg-zinc-950"
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy || !username || !password} className="w-full">
            {busy ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function TopNav() {
  const [location] = useLocation();
  const { logout } = useAdminSession();

  const isActive = (href: string) => {
    if (href === "/admin") return location === "/admin" || location === "/admin/";
    return location === href || location.startsWith(`${href}/`);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-zinc-100">Command Center</div>
          <div className="text-xs text-zinc-500">{todayLabel()}</div>
        </div>
        <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(link.href)
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
              )}
            >
              {link.label}
            </Link>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="ml-1 shrink-0 text-zinc-400 hover:text-zinc-200"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </nav>
      </div>
    </header>
  );
}

/**
 * Dark command-center shell. Renders a login gate when no session exists;
 * otherwise the top nav + a max-w-7xl main wrapper around the children.
 */
export function CenterShell({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, login } = useAdminSession();

  if (!isLoggedIn) {
    return <LoginGate onLogin={login} />;
  }

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100">
      <TopNav />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
