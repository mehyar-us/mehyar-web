import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { BillingOrderSummary, mehyarSoftApi } from "@/lib/mehyarsoft-api";

function dollars(cents?: number | null) {
  return `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function BillingSuccess() {
  const sessionId = new URLSearchParams(window.location.search).get("session_id") || "";
  const [order, setOrder] = useState<BillingOrderSummary | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    mehyarSoftApi.getBillingSession(sessionId).then((response) => setOrder(response.order || null)).catch(() => setOrder(null));
  }, [sessionId]);

  return (
    <section className="min-h-screen px-4 pb-16 pt-28 md:pt-32">
      <Card className="mx-auto max-w-2xl border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)]"><CardContent className="p-8 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-600" />
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-foreground">Checkout received.</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Stripe will confirm payment through the verified webhook. MehyarSoft will follow up using the email attached to Checkout.</p>
        <div className="mt-6 rounded-2xl border border-border bg-secondary/40 p-4 text-left text-sm text-muted-foreground">
          <p><span className="font-semibold text-foreground">Session:</span> {sessionId || "Not provided"}</p>
          {order ? <p><span className="font-semibold text-foreground">Order:</span> {order.service_name} · {dollars(order.amount_cents)} · {order.payment_status || order.status}</p> : <p>Order status will appear after webhook/ledger sync.</p>}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center"><Link href="/services" className={buttonVariants({ variant: "outline" })}>Services</Link><Link href="/contact" className={buttonVariants({ variant: "cta" })}>Send project details</Link></div>
      </CardContent></Card>
    </section>
  );
}

export function BillingCancel() {
  return (
    <section className="min-h-screen px-4 pb-16 pt-28 md:pt-32">
      <Card className="mx-auto max-w-2xl border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)]"><CardContent className="p-8 text-center">
        <XCircle className="mx-auto mb-4 h-12 w-12 text-amber-600" />
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-foreground">Checkout canceled.</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">No payment was completed. You can return to the service catalog or request scope review before paying.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center"><Link href="/billing/checkout" className={buttonVariants({ variant: "cta" })}>Try checkout again</Link><Link href="/contact" className={buttonVariants({ variant: "outline" })}>Request invoice help</Link></div>
      </CardContent></Card>
    </section>
  );
}

export function BillingPending() {
  return <Clock className="h-4 w-4" />;
}
