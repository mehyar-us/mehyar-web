import { ArrowRight, Bot, BrainCircuit, Check, MessageSquareText, Mic2, ShieldCheck, Smartphone, Workflow } from "lucide-react";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";

const jobs = [
  [MessageSquareText, "Bring the inbox together", "Summarize calls, forms, email, texts, and social messages."],
  [Workflow, "Prepare the next action", "Draft follow-ups, update records, route work, and assemble reports."],
  [Mic2, "Work from your phone", "Send a text or voice note from Telegram or another approved channel."],
  [ShieldCheck, "Keep approval in your hands", "Sensitive messages, publishing, and payments wait for permission."],
] as const;

export default function HomeAgentCommandCenter() {
  return (
    <section id="ai-command-center" className="site-section scroll-mt-24 border-b border-border py-14 md:py-20">
      <div className="site-shell">
        <div className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
          <div className="order-2 border border-border bg-white shadow-[0_20px_65px_rgba(6,47,66,0.12)] dark:bg-brand-950 lg:order-1">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-8 w-8 place-items-center bg-brand-950 text-white dark:bg-white dark:text-brand-950"><Bot className="h-4 w-4" /></span>Business command center</div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-500" />Ready</span>
            </div>
            <div className="grid gap-0 md:grid-cols-[1fr_0.72fr]">
              <div className="border-b border-border p-4 sm:p-6 md:border-b-0 md:border-r">
                <div className="ml-auto max-w-[88%] bg-brand-950 p-3 text-sm leading-6 text-white">Show me today’s bookings, unanswered leads, and the three follow-ups I should approve first.</div>
                <div className="mt-4 max-w-[92%] border border-brand-700/20 bg-secondary/55 p-4">
                  <p className="flex items-center gap-2 text-xs font-semibold text-brand-800 dark:text-brand-100"><BrainCircuit className="h-4 w-4" />Prepared for your review</p>
                  <p className="mt-3 text-sm leading-6 text-foreground">You have 6 bookings, 2 unanswered leads, and 3 follow-ups ready. The highest-priority lead asked about availability tomorrow.</p>
                  <div className="mt-4 divide-y divide-border border-y border-border">
                    {["Reply to the tomorrow request", "Confirm the 2:00 appointment", "Send two return-client reminders"].map((item) => <div key={item} className="flex items-center gap-2 py-2.5 text-xs text-foreground"><span className="grid h-5 w-5 place-items-center border border-brand-700/25 bg-white text-brand-700 dark:bg-white/10"><Check className="h-3 w-3" /></span>{item}</div>)}
                  </div>
                  <div className="mt-4 flex gap-2"><button type="button" className="bg-brand-950 px-3 py-2 text-xs font-semibold text-white dark:bg-white dark:text-brand-950">Approve selected</button><button type="button" className="border border-border px-3 py-2 text-xs font-semibold text-foreground">Edit first</button></div>
                </div>
              </div>
              <div className="bg-muted/20 p-4 sm:p-5">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Connected, with permission</p>
                <div className="mt-4 divide-y divide-border border-y border-border">
                  {["Calendar", "Customer inbox", "CRM or spreadsheet", "Email and SMS"].map((item) => <div key={item} className="flex items-center justify-between py-3 text-xs font-medium text-foreground"><span>{item}</span><span className="text-emerald-700 dark:text-emerald-300">Connected</span></div>)}
                </div>
                <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />Use it from mobile without opening another complicated dashboard.</p>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <p className="site-eyebrow">Managed AI command center</p>
            <h2 className="site-heading mt-3">Ask in plain language. Stay in control.</h2>
            <p className="site-lede mt-5">We install and maintain a private assistant around your real tools and rules. OpenClaw handles approved actions. Hermes adds deeper memory, research, and recurring specialist routines.</p>
            <div className="mt-7 divide-y divide-border border-y border-border">
              {jobs.map(([Icon, title, text]) => <div key={title} className="grid grid-cols-[2rem_1fr] gap-3 py-4"><Icon className="mt-0.5 h-5 w-5 text-brand-700 dark:text-brand-100" /><div><h3 className="text-sm font-semibold text-foreground">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></div>)}
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/services#ai-business-operators" className={buttonVariants({ variant: "cta", size: "lg" })}>Compare OpenClaw and Hermes<ArrowRight className="ml-2 h-4 w-4" /></Link>
              <Link href="/booking?service=AI%20business%20command%20center" className={buttonVariants({ variant: "outline", size: "lg" })}>Talk through my setup</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
