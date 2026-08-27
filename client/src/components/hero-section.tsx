import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Globe2, LifeBuoy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { openSupportTicket } from "@/components/SupportTicketModal";

const outcomes = [
  "Branded website and customer app",
  "Booking, AI texting, and phone support",
  "Maintenance and a real support ticket path",
];

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_32%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_58%,#fff_100%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.13),transparent_32%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_58%,hsl(var(--brand-950))_100%)] md:pt-32">
      <div className="mx-auto grid max-w-7xl items-center gap-9 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-700/15 bg-card/80 px-3 py-1.5 text-sm font-semibold text-brand-800 shadow-sm dark:text-brand-100"><Globe2 className="h-4 w-4" />Built for ambitious businesses worldwide</div>
          <h1 className="max-w-4xl text-4xl font-semibold leading-[1] tracking-[-0.05em] text-ink dark:text-white sm:text-5xl lg:text-[4rem]">Your website, customer app, AI follow-up, and ongoing support.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">MehyarSoft builds the customer-facing system and keeps it working: branded pages, secure customer accounts, booking or requests, email and text follow-up, AI phone help, social content, maintenance, and support.</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href="/pricing#industry-pricing" className={buttonVariants({ variant: "cta", size: "lg", className: "h-12 px-7 text-base" })}>Find my business<ArrowRight className="ml-2 h-4 w-4" /></Link>
            <Link href="/contact" className={buttonVariants({ variant: "outline", size: "lg", className: "h-12 px-7 text-base" })}>Start a project</Link>
            <button type="button" onClick={openSupportTicket} className={buttonVariants({ variant: "ghost", size: "lg", className: "h-12 px-5 text-base" })}><LifeBuoy className="mr-2 h-4 w-4" />Create support ticket</button>
          </div>
          <div className="mt-6 grid max-w-3xl gap-2 sm:grid-cols-3">
            {outcomes.map((outcome) => <div key={outcome} className="flex items-start gap-2 rounded-2xl border border-border bg-card/75 p-3 text-sm leading-6 text-foreground shadow-sm"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-100" />{outcome}</div>)}
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-5 rounded-[2.5rem] bg-brand-700/12 blur-3xl" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-[2rem] border border-border bg-card p-2 shadow-[0_28px_90px_rgba(8,63,84,0.18)]">
            <img src="/assets/agent-services/mobile-command-assistant.webp" alt="Business owner using a phone and laptop to manage customer operations" className="min-h-[390px] w-full rounded-[1.55rem] object-cover" loading="eager" />
            <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-white/15 bg-brand-950/88 p-4 text-white backdrop-blur"><p className="font-semibold">Run the business from your phone.</p><p className="mt-1 text-sm leading-6 text-white/75">Check bookings, request follow-up, review messages, approve outreach, or open a support ticket.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}
