import { useEffect, useState } from "react";
import { BarChart3, CalendarClock, ClipboardCheck, ShieldCheck, Users } from "lucide-react";
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
    <>
      <section className="pt-28 pb-16 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="text-primary" size={32} />
            <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white">Admin Metrics</h1>
          </div>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl">
            Owner-only shell for lead intake, audit, booking, and suppression counts. Credentials stay in Cloudflare environment secrets.
          </p>
        </div>
      </section>

      <section className="py-16 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-5xl">
          {!token ? (
            <Card className="max-w-md bg-white dark:bg-neutral-800 shadow-lg">
              <CardContent className="p-6">
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-6">Admin Login</h2>
                <form className="space-y-5" onSubmit={handleLogin}>
                  <div className="space-y-2">
                    <Label htmlFor="admin-username">Username</Label>
                    <Input id="admin-username" type="text" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Password</Label>
                    <Input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>{isLoading ? "Connecting..." : "Login"}</Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">CRM Command Center</h2>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    Last update: {metrics.updatedAt ? new Date(metrics.updatedAt).toLocaleString() : "API response"}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => void loadMetrics()} disabled={isLoading}>Refresh</Button>
                  <Button variant="secondary" onClick={handleLogout}>Logout</Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {metricCards.map(({ key, label, icon: Icon }) => (
                  <Card key={key} className="bg-white dark:bg-neutral-800 shadow-md">
                    <CardContent className="p-6">
                      <Icon className="text-primary mb-4" size={28} />
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">{label}</p>
                      <p className="text-3xl font-bold text-neutral-900 dark:text-white">{metrics[key]}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
};

export default Admin;
