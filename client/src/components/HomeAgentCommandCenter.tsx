import { ArrowRight, Building2, CalendarCheck2, CheckCircle2, FileSearch, MapPin, MessageSquareText, PhoneCall, Send, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";

const jobs = [
  [PhoneCall, "Answer calls", "Handle approved questions and capture what the customer needs."],
  [MessageSquareText, "Follow up with leads", "Prepare or send the right next message through approved rules."],
  [CalendarCheck2, "Schedule work", "Check availability, offer valid times, and confirm the booking."],
  [FileSearch, "Summarize feedback", "Turn reviews, comments, and messages into a short owner brief."],
  [Send, "Prepare outreach", "Research the context, draft a personal message, and wait for approval."],
] as const;

export default function HomeAgentCommandCenter() {
  return (
    <section id="ai-command-center" className="site-section scroll-mt-24 border-b border-border py-14 md:py-20">
      <div className="site-shell">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="site-eyebrow">Your 24/7 AI command center</p>
            <h2 className="site-heading mt-3">A business assistant that helps from your phone.</h2>
            <p className="site-lede mt-5">
              Ask in plain language from Telegram or another approved channel. Your assistant can prepare work across the tools you choose while sending, publishing, payments, and sensitive decisions stay behind your approval.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-2 text-brand-950"><ShieldCheck className="h-4 w-4" />Trained around your business</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-brand-700" />Human approval where it matters</span>
            </div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/services#ai-business-operators" className={buttonVariants({ variant: "cta", size: "lg" })}>See managed AI options<ArrowRight className="ml-2 h-4 w-4" /></Link>
              <Link href="/booking?service=AI%20business%20command%20center" className={buttonVariants({ variant: "outline", size: "lg" })}>Discuss my assistant</Link>
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.75rem] border border-brand-700/20 bg-card shadow-[0_20px_65px_rgba(6,47,66,0.12)]">
            <img src="/assets/sales-system/ai-system.webp" alt="" className="aspect-[16/9] w-full bg-muted/25 object-cover" loading="lazy" />
            <div className="grid grid-cols-2 border-t border-border sm:grid-cols-5">
              {jobs.map(([Icon, title, text], index) => (
                <div key={title} className="border-b border-r border-border p-3 last:border-r-0 sm:border-b-0 sm:p-4">
                  <Icon className="h-4 w-4 text-brand-700 dark:text-brand-100" />
                  <h3 className="mt-2 text-xs font-semibold leading-5 text-foreground">{title}</h3>
                  <p className="mt-1 hidden text-[0.7rem] leading-5 text-muted-foreground sm:block">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mx-auto mt-9 grid max-w-4xl overflow-hidden rounded-2xl border border-white/15 bg-white text-left shadow-sm dark:bg-white/[0.06] sm:grid-cols-2">
          <Link href="/pricing" className="group flex items-center gap-4 border-b border-border p-4 text-foreground transition hover:bg-brand-100/45 sm:border-b-0 sm:border-r sm:p-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><MapPin className="h-5 w-5" /></span>
            <span className="min-w-0"><strong className="block text-sm">I run a customer-facing business</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">See industry examples and clear starting prices.</span></span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-brand-700 transition group-hover:translate-x-0.5" />
          </Link>
          <Link href="/services" className="group flex items-center gap-4 p-4 text-foreground transition hover:bg-brand-100/45 sm:p-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-950 text-white dark:bg-white dark:text-brand-950"><Building2 className="h-5 w-5" /></span>
            <span className="min-w-0"><strong className="block text-sm">I lead a team or enterprise</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">Explore custom systems, integrations, cloud, and AI.</span></span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-brand-700 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
