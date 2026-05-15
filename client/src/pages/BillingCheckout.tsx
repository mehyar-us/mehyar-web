import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackPublicAnalyticsEvent } from "@/components/GoogleAnalytics";
import { BillingService, mehyarSoftApi } from "@/lib/mehyarsoft-api";

const FALLBACK_BILLING_SERVICES: BillingService[] = [
  {
    id: "tech-audit-330",
    name: "$330 Website + Booking Leak Audit",
    category: "audit",
    description: "Founder-led review of website trust, booking friction, missed-call follow-up, and the smallest practical fixes before buying more tools.",
    unit_amount_cents: 33000,
    estimated_cost_cents: 0,
    currency: "usd",
    mode: "test",
    delivery_window: "3-5 business days",
    features: ["Website and booking leak map", "Missed-call/follow-up diagnosis", "Prioritized fix list", "Founder review notes"],
    requires_scope_review: false,
  },
  {
    id: "consulting-hour",
    name: "Senior consulting hour",
    category: "consulting",
    description: "Focused systems, software, or AI automation advisory session for a defined operational decision or blocker.",
    unit_amount_cents: 25000,
    estimated_cost_cents: 0,
    currency: "usd",
    mode: "test",
    delivery_window: "Scheduled after intake",
    features: ["One focused advisory session", "Systems/automation triage", "Recommended next step", "No long agency retainer required"],
    requires_scope_review: true,
  },
];

function isLocalPreviewHost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(window.location.hostname);
}

function dollars(cents?: number | null) {
  return `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function BillingCheckout() {
  const params = new URLSearchParams(window.location.search);
  const pathServiceId = decodeURIComponent(window.location.pathname.replace(/^\/billing\/checkout\/?/, "")).replace(/^\//, "");
  const serviceParam = pathServiceId || params.get("service") || params.get("service_id") || "tech-audit-330";
  const [services, setServices] = useState<BillingService[]>(FALLBACK_BILLING_SERVICES);
  const [selectedServiceId, setSelectedServiceId] = useState(serviceParam);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [isLoading, setIsLoading] = useState(!isLocalPreviewHost());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLocalPreviewHost()) {
      setServices(FALLBACK_BILLING_SERVICES);
      if (!FALLBACK_BILLING_SERVICES.some((service) => service.id === serviceParam)) setSelectedServiceId(FALLBACK_BILLING_SERVICES[0].id);
      setIsLoading(false);
      return;
    }

    let mounted = true;
    setIsLoading(true);
    mehyarSoftApi.getBillingServices("test")
      .then((response) => {
        if (!mounted) return;
        const nextServices = response.services.length ? response.services : FALLBACK_BILLING_SERVICES;
        setServices(nextServices);
        if (!nextServices.some((service) => service.id === serviceParam)) setSelectedServiceId(nextServices[0]?.id || "tech-audit-330");
      })
      .catch((err) => {
        if (!mounted) return;
        setServices(FALLBACK_BILLING_SERVICES);
        setError(err instanceof Error ? err.message : "Billing catalog is unavailable.");
      })
      .finally(() => mounted && setIsLoading(false));
    return () => { mounted = false; };
  }, [serviceParam]);

  const selected = useMemo(() => services.find((service) => service.id === selectedServiceId) || services[0], [services, selectedServiceId]);

  useEffect(() => {
    trackPublicAnalyticsEvent("checkout_start", { service_id: selectedServiceId, mode: "test", step: "checkout_shell_view" });
  }, [selectedServiceId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setIsSubmitting(true);
    setError(null);
    try {
      trackPublicAnalyticsEvent("checkout_start", { service_id: selected.id, mode: "test", step: "stripe_redirect_attempt" });
      const response = await mehyarSoftApi.createBillingCheckout({
        service_id: selected.id,
        mode: "test",
        quantity: 1,
        customer_email: email,
        customer_name: name,
        business_name: businessName,
      });
      if (!response.ok || !response.checkout?.url) throw new Error(response.error || "Stripe Checkout URL was not returned.");
      window.location.href = response.checkout.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout could not start.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.14),transparent_34%),linear-gradient(180deg,hsl(var(--background))_0%,#fff_100%)] px-4 pb-16 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_34%),linear-gradient(180deg,hsl(var(--brand-950))_0%,hsl(var(--background))_100%)] md:pt-32">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
        <div>
          <Badge variant="outline" className="mb-4 border-border bg-card px-3 py-1 uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">Sandbox billing</Badge>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">Start a paid MehyarSoft service safely.</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">Checkout uses Stripe test mode by default. Live charges remain blocked unless Boss explicitly enables the live environment and owner approval gate.</p>
          <div className="mt-6 grid gap-3 rounded-[1.5rem] border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
            <div className="flex gap-3"><ShieldCheck className="mt-1 h-4 w-4 text-brand-700" /><span>No secret keys in browser code. Public page receives only catalog and Checkout redirect.</span></div>
            <div className="flex gap-3"><CreditCard className="mt-1 h-4 w-4 text-brand-700" /><span>Sandbox proof uses Stripe test cards. Do not enter real card data on test checkout.</span></div>
          </div>
        </div>

        <Card className="border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)]">
          <CardContent className="p-6 md:p-7">
            <form className="space-y-5" onSubmit={submit}>
              <div>
                <Label htmlFor="service">Service</Label>
                <select id="service" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)} disabled={isLoading}>
                  {services.map((service) => <option key={service.id} value={service.id}>{service.name} — {dollars(service.unit_amount_cents)}</option>)}
                </select>
              </div>
              {selected ? (
                <div className="rounded-2xl border border-border bg-secondary/40 p-4">
                  <p className="text-xl font-semibold text-foreground">{selected.name}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{selected.description}</p>
                  <div className="mt-3 space-y-2">
                    {selected.features?.slice(0, 4).map((feature) => <div key={feature} className="flex gap-2 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 text-brand-700" />{feature}</div>)}
                  </div>
                  <p className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground">{dollars(selected.unit_amount_cents)}</p>
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Delivery: {selected.delivery_window}</p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
                <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="business">Business name</Label><Input id="business" value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></div>
              {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100">{error}</p> : null}
              <Button type="submit" variant="cta" className="w-full" disabled={isSubmitting || isLoading || !selected}>{isSubmitting ? "Opening Stripe..." : "Continue to Stripe test Checkout"} <ArrowRight className="h-4 w-4" /></Button>
              <Link href="/services" className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}>Back to services</Link>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
