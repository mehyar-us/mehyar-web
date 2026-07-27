import { Link } from "wouter";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export function BillingSuccess() {
  const sessionId = new URLSearchParams(window.location.search).get("session_id") || "";

  return (
    <section className="min-h-screen px-4 pb-16 pt-28 md:pt-32">
      <Card className="mx-auto max-w-2xl border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)]"><CardContent className="p-8 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-600" />
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-foreground">Manual invoice path active.</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Online checkout is disabled. MehyarSoft confirms scope first, then sends manual ACH, wire, check, or cash instructions through a reviewed invoice.</p>
        <div className="mt-6 rounded-2xl border border-border bg-secondary/40 p-4 text-left text-sm text-muted-foreground">
          <p><span className="font-semibold text-foreground">Old checkout session:</span> {sessionId || "None"}</p>
          <p className="mt-2">No live card payment is processed from this page.</p>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center"><Link href="/services" className={buttonVariants({ variant: "outline" })}>Services</Link><Link href="/billing/checkout" className={buttonVariants({ variant: "cta" })}>Request manual invoice</Link></div>
      </CardContent></Card>
    </section>
  );
}

export function BillingCancel() {
  return (
    <section className="min-h-screen px-4 pb-16 pt-28 md:pt-32">
      <Card className="mx-auto max-w-2xl border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)]"><CardContent className="p-8 text-center">
        <XCircle className="mx-auto mb-4 h-12 w-12 text-amber-600" />
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-foreground">Online checkout is off.</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">No payment was completed. Request a manual invoice or book a scope review before any ACH, wire, check, or cash payment.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center"><Link href="/billing/checkout" className={buttonVariants({ variant: "cta" })}>Request manual invoice</Link><Link href="/contact" className={buttonVariants({ variant: "outline" })}>Ask a question</Link></div>
      </CardContent></Card>
    </section>
  );
}

export function BillingPending() {
  return <Clock className="h-4 w-4" />;
}
