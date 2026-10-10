import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import MayorAutomaticAudit from "./MayorAutomaticAudit";

// Pricing is NOT hardcoded here. The single source of truth is the Mayor
// worker's public catalog: GET https://mayor.mehyar.us/api/billing/catalog
// (workers/mayor/src/billing/plans.ts). This component fetches it on mount and
// falls back to the last verified catalog only if the fetch fails, so the page
// never renders empty — but the worker always wins when reachable.
// (Full-QA fix F3: hardcoded $14/$4/$8/$12 removed.)
const CATALOG_URL = "https://mayor.mehyar.us/api/billing/catalog";
type CatalogPlan = { id: string; name: string; priceCents: number; replyLimit: number; voiceMinuteLimit: number };
type CatalogPack = { id: string; name: string; priceCents: number; replyAttempts: number; voiceMinutes: number };
type Catalog = { plans: CatalogPlan[]; creditPacks: CatalogPack[] };
const FALLBACK_CATALOG: Catalog = {
  plans: [
    { id: "free", name: "Free", priceCents: 0, replyLimit: 100, voiceMinuteLimit: 10 },
    { id: "pro", name: "Pro", priceCents: 1400, replyLimit: 1000, voiceMinuteLimit: 120 },
  ],
  creditPacks: [
    { id: "small", name: "Small", priceCents: 400, replyAttempts: 200, voiceMinutes: 15 },
    { id: "medium", name: "Medium", priceCents: 800, replyAttempts: 500, voiceMinutes: 45 },
    { id: "large", name: "Large", priceCents: 1200, replyAttempts: 800, voiceMinutes: 90 },
  ],
};
const money = (cents: number) => `$${cents / 100}`;
const num = (n: number) => n.toLocaleString("en-US");
export default function MayorPlans({ showAddOns = true }: { showAddOns?: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>(FALLBACK_CATALOG);
  useEffect(() => {
    let cancelled = false;
    fetch(CATALOG_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.plans) || !Array.isArray(d.creditPacks)) return;
        setCatalog({ plans: d.plans, creditPacks: d.creditPacks });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const free = catalog.plans.find((p) => p.id === "free") ?? FALLBACK_CATALOG.plans[0];
  const pro = catalog.plans.find((p) => p.id === "pro") ?? FALLBACK_CATALOG.plans[1];
  const packs = catalog.creditPacks.length ? catalog.creditPacks : FALLBACK_CATALOG.creditPacks;
  const minPack = Math.min(...packs.map((p) => p.priceCents));
  const planCards = [
    { id: free.id, name: free.name, price: money(free.priceCents), tag: "Start with one business", replies: `${num(free.replyLimit)} assistant reply attempts`, voice: `${num(free.voiceMinuteLimit)} app microphone minutes`, period: "Per business, per calendar month", cta: "Start free with The Mayor" },
    { id: pro.id, name: pro.name, price: money(pro.priceCents), tag: "More room for a busier workday", replies: `${num(pro.replyLimit)} assistant reply attempts`, voice: `${num(pro.voiceMinuteLimit)} app microphone minutes`, period: "Per business, per verified paid period", cta: "Sign in to choose Pro" },
  ];
  return <section className="mayor-plans-section px-4" aria-labelledby="mayor-plans-heading" id="mayor-plans">
    <div className="site-shell">
      <div className="mayor-plans-intro">
        <img src="/assets/mayor-avatar.webp" alt="The Mayor, illustrated AI companion" width="96" height="96" loading="lazy"/>
        <div><p className="site-eyebrow">The Mayor · your business workspace</p><h2 id="mayor-plans-heading">A clearer workday.<br/>An AI that knows your business.</h2><p>Bring your business profile, customers, tasks and appointments together. Set goals, choose useful playbooks and get draft plans for the next step. Optional scheduled reviews start paused.</p></div>
      </div>
      <p className="mayor-plan-preview">Start free. Choose more assistant time as your business grows.</p>
      <div className="mayor-plan-grid">
        {planCards.map(plan=><article key={plan.id} className={`mayor-plan-card ${plan.id==='pro'?'mayor-plan-pro':''}`}>
          <p className="site-eyebrow">{plan.tag}</p><h3>{plan.name}</h3><p className="mayor-plan-price"><strong>{plan.price}</strong><span>USD / month</span></p><p className="mayor-plan-period">{plan.period}</p>
          <ul>{[plan.replies,plan.voice,'Saved business profile, customers and tasks','Goals, reusable playbooks and optional planning reports','Appointment workspace and supported calendar connection'].map(item=><li key={item}><Check size={17} aria-hidden="true"/><span>{item}</span></li>)}</ul>
          <a className="mayor-primary" href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer">{plan.cta}<ArrowRight size={17}/></a>
        </article>)}
      </div>
      <p className="mayor-plan-notes">Allowances are shared by the business. Each manual or scheduled AI planning attempt uses one reply attempt; a report within a signed-in chat uses that already-counted turn. Failed reply attempts and reserved microphone time may count. No automatic overage charges. Phone-provider charges, third-party services and custom implementation are separate.</p>
      {showAddOns ? <section id="mayor-add-ons" className="mt-8 scroll-mt-[90px] border-t border-border pt-7" aria-labelledby="mayor-add-ons-heading">
        <h3 id="mayor-add-ons-heading" className="text-xl font-semibold tracking-tight">Optional extra usage</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">More room when work picks up. Buy a one-time add-on for your business on Free or Pro.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {packs.map(pack=><article key={pack.id} className="rounded-[22px] border border-border bg-background p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-base font-semibold">{pack.name}</h4><span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">One-time</span></div>
            <p className="mt-3 flex flex-wrap items-baseline gap-2"><strong className="text-3xl font-semibold tracking-tight">{money(pack.priceCents)}</strong><span className="text-xs text-muted-foreground">USD · paid once</span></p>
            <ul className="mt-4 grid gap-2 text-sm leading-relaxed"><li>{num(pack.replyAttempts)} extra reply attempts</li><li>{num(pack.voiceMinutes)} app microphone minutes</li></ul>
          </article>)}
        </div>
        <p className="mt-4 max-w-4xl text-xs leading-relaxed text-muted-foreground">Extra usage is added after payment is verified and belongs to your business’s current usage period: the UTC calendar month for Free, or the paid billing period for Pro. Extra usage expires when the current period ends or changes, including a plan change. No rollover, recurring charge or automatic purchase. Refunds or payment disputes remove the extra allowance, without resetting prior usage.</p>
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-relaxed text-muted-foreground">In your workspace, open <strong className="font-medium text-foreground">Plan &amp; usage → buy an add-on</strong>.</p>
          <a className="mayor-primary !mt-0 w-full shrink-0 sm:w-auto" href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer">Sign in to add usage<ArrowRight size={17} aria-hidden="true"/></a>
        </div>
      </section> : <div className="mt-6 flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-t border-border pt-4 text-sm leading-relaxed">
        <p className="text-muted-foreground">Need more time? One-time usage packs start at {money(minPack)}.</p>
        <Link href="/pricing#mayor-add-ons" className="inline-flex min-h-[44px] items-center gap-2 font-medium underline underline-offset-4">See usage packs<ArrowRight size={16} aria-hidden="true"/></Link>
      </div>}
      <MayorAutomaticAudit compact={!showAddOns}/>
      <div className="mayor-plans-footer"><p>Public questions here are free, with their own usage limits. Saved website chats stay on this device and do not sync to your private account.</p><Link href="/contact">Need AI built around your team? Discuss a custom setup <ArrowRight size={16}/></Link></div>
    </div>
  </section>;
}
