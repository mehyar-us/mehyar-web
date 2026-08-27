import { ArrowRight, CheckCircle2, CircleDollarSign, MailCheck, Smartphone, UserRoundCheck } from "lucide-react";
import { Link } from "wouter";
import type { IndustryOffer } from "@/data/industry-offers";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SlideNumber = ({ value }: { value: number }) => <span className="absolute right-5 top-5 rounded-full border border-white/20 bg-black/20 px-3 py-1 text-xs font-semibold text-white backdrop-blur">{String(value).padStart(2, "0")} / 07</span>;

export default function IndustrySalesDeck({ industry }: { industry: IndustryOffer }) {
  return (
    <section className="bg-muted/35 px-4 py-12 md:py-20" aria-label={`${industry.shortName} visual sales presentation`}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="overflow-hidden rounded-[2rem] border border-border bg-brand-950 text-white shadow-[0_26px_90px_rgba(8,63,84,0.2)]">
          <div className="relative min-h-[520px] md:min-h-[620px]">
            <img src={industry.heroImage} alt={`${industry.shortName} owner helping a customer`} className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
            <div className="absolute inset-0 bg-gradient-to-r from-brand-950 via-brand-950/88 to-brand-950/10" />
            <SlideNumber value={1} />
            <div className="relative flex min-h-[520px] max-w-2xl flex-col justify-end p-7 md:min-h-[620px] md:p-14">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-100">A MehyarSoft concept presentation</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] md:text-6xl">Own the customer journey.</h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-white/80">A simple website and follow-up system designed around how {industry.shortName.toLowerCase()} actually work.</p>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[2rem] border border-border bg-card p-7 shadow-sm md:p-14">
          <span className="absolute right-5 top-5 rounded-full bg-brand-950 px-3 py-1 text-xs font-semibold text-white">02 / 07</span>
          <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:items-center">
            <div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">The everyday problem</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Customers should not have to chase you.</h2></div>
            <div className="space-y-3">{industry.outcomes.map((outcome) => <div key={outcome} className="rounded-2xl border border-border bg-background p-5"><p className="text-lg font-semibold text-foreground">{outcome}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Without a clear system, this can depend on a call, an inbox, or somebody remembering.</p></div>)}</div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[2rem] border border-border bg-brand-100/70 p-7 dark:bg-white/[0.05] md:p-14">
          <span className="absolute right-5 top-5 rounded-full bg-brand-950 px-3 py-1 text-xs font-semibold text-white">03 / 07</span>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">The simple customer journey</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Find you. Take action. Get a clear answer.</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {[{ icon: Smartphone, title: "1. Find", text: "Open your direct link or scan your QR code." }, { icon: UserRoundCheck, title: "2. Choose", text: "Pick the right service, time, or request." }, { icon: MailCheck, title: "3. Confirm", text: "Receive an email or text with the next step." }, { icon: CircleDollarSign, title: "4. Return", text: "Rebook, reply, or come back without starting over." }].map(({ icon: Icon, title, text }) => <div key={title} className="rounded-2xl border border-border bg-card p-5"><Icon className="h-6 w-6 text-brand-700 dark:text-brand-100" /><h3 className="mt-4 font-semibold text-foreground">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></div>)}
          </div>
          <div className="mt-6 rounded-2xl border border-brand-700/20 bg-card p-5"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-100">Realistic example</p><p className="mt-2 text-base leading-7 text-foreground">{industry.example}</p></div>
        </div>

        {industry.packages.map((pkg, index) => (
          <div key={pkg.name} className={cn("relative overflow-hidden rounded-[2rem] border p-7 shadow-sm md:p-14", pkg.featured ? "border-brand-700 bg-brand-950 text-white" : "border-border bg-card")}>
            <span className={cn("absolute right-5 top-5 rounded-full px-3 py-1 text-xs font-semibold", pkg.featured ? "border border-white/20 bg-white/10 text-white" : "bg-brand-950 text-white")}>{String(index + 4).padStart(2, "0")} / 07</span>
            <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
              <div>
                <p className={cn("text-sm font-semibold uppercase tracking-[0.2em]", pkg.featured ? "text-brand-100" : "text-brand-700 dark:text-brand-100")}>Level {index + 1}</p>
                <h2 className={cn("mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl", pkg.featured ? "text-white" : "text-ink dark:text-white")}>{pkg.name}</h2>
                <p className={cn("mt-4 text-base leading-7", pkg.featured ? "text-white/75" : "text-muted-foreground")}>{pkg.plainSummary}</p>
                <div className={cn("mt-6 rounded-2xl border p-5", pkg.featured ? "border-white/15 bg-white/[0.06]" : "border-border bg-background")}><p className="text-3xl font-semibold">{pkg.price}</p><p className={cn("mt-1 text-sm", pkg.featured ? "text-white/70" : "text-muted-foreground")}>{pkg.cadence}</p></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={cn("rounded-2xl border p-5", pkg.featured ? "border-white/15 bg-white/[0.05]" : "border-border bg-background")}><p className="font-semibold">Your customers can:</p><ul className={cn("mt-3 space-y-3 text-sm leading-6", pkg.featured ? "text-white/75" : "text-muted-foreground")}>{pkg.customerCan.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />{item}</li>)}</ul></div>
                <div className={cn("rounded-2xl border p-5", pkg.featured ? "border-white/15 bg-white/[0.05]" : "border-border bg-background")}><p className="font-semibold">You get:</p><ul className={cn("mt-3 space-y-3 text-sm leading-6", pkg.featured ? "text-white/75" : "text-muted-foreground")}>{pkg.ownerGets.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />{item}</li>)}</ul></div>
              </div>
            </div>
          </div>
        ))}

        <div className="relative overflow-hidden rounded-[2rem] border border-brand-700/25 bg-[radial-gradient(circle_at_top_right,rgba(143,211,221,0.22),transparent_34%),hsl(var(--card))] p-7 text-center shadow-sm md:p-16">
          <span className="absolute right-5 top-5 rounded-full bg-brand-950 px-3 py-1 text-xs font-semibold text-white">07 / 07</span>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700 dark:text-brand-100">The next step</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Tell us what customers need to do. We will recommend the smallest useful level.</h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground">No pressure and no surprise scope. We confirm the one-time setup price, monthly price, outside software costs, and launch plan before work begins.</p>
          <Link href={`/contact?service=industry_package&industry=${encodeURIComponent(industry.shortName)}`} className={buttonVariants({ variant: "cta", size: "lg", className: "mt-7" })}>Talk through my business <ArrowRight className="ml-2 h-4 w-4" /></Link>
        </div>
      </div>
    </section>
  );
}
