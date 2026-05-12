import { useEffect, useState } from "react";
import { BarChart3, CalendarClock, ClipboardCheck, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AdminMetrics, mehyarSoftApi } from "@/lib/mehyarsoft-api";

const emptyMetrics: AdminMetrics = {
  leads: 0,
  contactRequests: 0,
  auditRequests: 0,
  bookingRequests: 0,
  newsletterRequests: 0,
  suppressions: 0,
};

const metricCards = [
  { key: "leads", label: "Total leads", icon: Users },
  { key: "contactRequests", label: "General", icon: Users },
  { key: "auditRequests", label: "Audits", icon: ClipboardCheck },
  { key: "bookingRequests", label: "Booking", icon: CalendarClock },
  { key: "suppressions", label: "Suppressions", icon: ShieldCheck },
] as const;

const Admin = () => {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(() => sessionStorage.getItem("mehyarsoft_admin_token") || "");
  const [metrics, setMetrics] = useState<AdminMetrics>(emptyMetrics);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    document.title = "Admin Metrics | MehyarSoft";
  }, []);

  const loadMetrics = async (sessionToken = token) => {
    if (!sessionToken) return;
    setIsLoading(true);
    try {
      const nextMetrics = await mehyarSoftApi.getMetrics(sessionToken);
      setMetrics({ ...emptyMetrics, ...nextMetrics });
    } catch (error) {
      sessionStorage.removeItem("mehyarsoft_admin_token");
      setToken("");
      toast({
        title: "Admin session unavailable",
        description: error instanceof Error ? error.message : "Could not load metrics.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (token) void loadMetrics(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      const session = await mehyarSoftApi.login({ username, password });
      sessionStorage.setItem("mehyarsoft_admin_token", session.token);
      setToken(session.token);
      setPassword("");
      toast({ title: "Admin session started", description: "Metrics are connected to the Cloudflare intake store." });
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Check admin credentials and API availability.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("mehyarsoft_admin_token");
    setToken("");
    setMetrics(emptyMetrics);
  };

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.14),transparent_34%),linear-gradient(180deg,hsl(var(--background))_0%,#fff_100%)] px-4 pb-16 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_34%),linear-gradient(180deg,hsl(var(--brand-950))_0%,hsl(var(--background))_100%)] md:pt-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
              Owner-only
            </p>
            <h1 className="text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">
              Admin Metrics
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
              Private operating shell for lead intake, audit demand, booking requests, and suppression counts. Credentials stay in Cloudflare environment secrets.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
            <span className="font-semibold text-foreground">SEO boundary:</span> this route is noindex, nofollow, noarchive and excluded from public sitemap surfaces.
          </div>
        </div>

        {!token ? (
          <Card className="max-w-md border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
            <CardContent className="p-6 md:p-7">
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Admin Login</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Authenticate before metrics or owner workflow data loads.</p>
                </div>
              </div>
              <form className="space-y-5" onSubmit={handleLogin}>
                <div className="space-y-2">
                  <Label htmlFor="admin-username">Username</Label>
                  <Input id="admin-username" type="text" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Password</Label>
                  <Input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
                </div>
                <Button type="submit" variant="cta" className="w-full" disabled={isLoading}>{isLoading ? "Connecting..." : "Login"}</Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">CRM Command Center</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Last update: {metrics.updatedAt ? new Date(metrics.updatedAt).toLocaleString() : "API response"}
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => void loadMetrics()} disabled={isLoading}>Refresh</Button>
                <Button variant="secondary" onClick={handleLogout}>Logout</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {metricCards.map(({ key, label, icon: Icon }) => (
                <Card key={key} className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
                  <CardContent className="p-6">
                    <Icon className="mb-4 text-brand-700 dark:text-brand-100" size={28} aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-foreground">{metrics[key]}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default Admin;
