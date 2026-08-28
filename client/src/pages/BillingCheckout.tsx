import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, FileText, Mail, ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackPublicAnalyticsEvent } from "@/components/GoogleAnalytics";

type ManualInvoiceService = {
  id: string;
  name: string;
  category: string;
  description: string;
  unit_amount_cents: number;
  delivery_window: string;
  features: string[];
  requires_scope_review?: boolean;
};

const MANUAL_INVOICE_SERVICES: ManualInvoiceService[] = [
  {
    id: "tech-audit-330",
    name: "$330 Website + Booking Leak Audit",
    category: "audit",
    description: "Founder-led review of website trust, booking friction, missed-call follow-up, and the smallest practical fixes before buying more tools.",
    unit_amount_cents: 33000,
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
    delivery_window: "Scheduled after intake",
    features: ["One focused advisory session", "Systems/automation triage", "Recommended next step", "No long agency retainer required"],
    requires_scope_review: true,
  },
  {
    id: "automation-sprint",
    name: "Automation sprint deposit",
    category: "sprint",
    description: "Owner-scoped implementation sprint for CRM cleanup, missed-lead follow-up, booking automation, or internal workflow repair.",
    unit_amount_cents: 250000,
    delivery_window: "Scheduled after scope confirmation",
    features: ["Scope review before invoicing", "Manual invoice only", "ACH, wire, check, or cash", "No card checkout"],
    requires_scope_review: true,
  },
];

function dollars(cents?: number | null) {
  return `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function BillingCheckout() {
  const params = new URLSearchParams(window.location.search);
  const pathServiceId = decodeURIComponent(window.location.pathname.replace(/^\/billing\/checkout\/?/, "")).replace(/^\//, "");
  const serviceParam = pathServiceId || params.get("service") || params.get("service_id") || "tech-audit-330";
  const [selectedServiceId, setSelectedServiceId] = useState(serviceParam);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!MANUAL_INVOICE_SERVICES.some((service) => service.id === serviceParam)) {
      setSelectedServiceId(MANUAL_INVOICE_SERVICES[0].id);
    }
  }, [serviceParam]);

  const selected = useMemo(() => MANUAL_INVOICE_SERVICES.find((service) => service.id === selectedServiceId) || MANUAL_INVOICE_SERVICES[0], [selectedServiceId]);

  useEffect(() => {
    trackPublicAnalyticsEvent("invoice_request", { service_id: selectedServiceId, step: "manual_invoice_view" });
  }, [selectedServiceId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setIsSubmitting(true);
    trackPublicAnalyticsEvent("invoice_request", { service_id: selected.id, step: "manual_invoice_mailto" });
    const subject = encodeURIComponent(`Manual invoice request: ${selected.name}`);
    const lines = [
      `Service: ${selected.name}`,
      `Price shown: ${dollars(selected.unit_amount_cents)}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Business: ${businessName || "Not provided"}`,
      "",
      "Please send a manual invoice and confirm ACH/wire/check instructions.",
    ];
    window.location.href = `mailto:info@mehyar.us?subject=${subject}&body=${encodeURIComponent(lines.join("\n"))}`;
    window.setTimeout(() => setIsSubmitting(false), 600);
  };

  return (
    <section className="site-hero min-h-screen">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
        <div>
          <Badge variant="outline" className="mb-4 border-border bg-card px-3 py-1 uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">Manual invoicing</Badge>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">Request a MehyarSoft invoice.</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">Online checkout is disabled. MehyarSoft sends invoices manually and confirms ACH, wire, check, or cash instructions before any payment is made.</p>
          <div className="mt-6 grid gap-3 rounded-[1.5rem] border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
            <div className="flex gap-3"><ShieldCheck className="mt-1 h-4 w-4 text-brand-700" /><span>No card form, no live payment link, and no Stripe redirect on this route.</span></div>
            <div className="flex gap-3"><FileText className="mt-1 h-4 w-4 text-brand-700" /><span>The next step is a reviewed invoice or quote, then manual remittance after scope is accepted.</span></div>
          </div>
        </div>

        <Card className="border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)]">
          <CardContent className="p-6 md:p-7">
            <form className="space-y-5" onSubmit={submit}>
              <div>
                <Label htmlFor="service">Service</Label>
                <select id="service" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)}>
                  {MANUAL_INVOICE_SERVICES.map((service) => <option key={service.id} value={service.id}>{service.name} — {dollars(service.unit_amount_cents)}</option>)}
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
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Manual invoice · {selected.delivery_window}</p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
                <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="business">Business name</Label><Input id="business" value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></div>
              <Button type="submit" variant="cta" className="w-full" disabled={isSubmitting || !selected}>{isSubmitting ? "Opening email..." : "Request manual invoice"} <Mail className="h-4 w-4" /></Button>
              <Link href="/booking" className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}>Book before invoicing <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/services" className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}>Back to services</Link>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
