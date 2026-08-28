// @ts-nocheck
import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowRight, Bot, Check, CircleDollarSign, Clock3, ExternalLink, MessageSquareText, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ProposalPublic() {
  const [, params] = useRoute("/proposals/:slug");
  const [state, setState] = useState<any>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/proposals/${encodeURIComponent(params?.slug || "")}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Proposal not found");
      setState({ loading: false, proposal: payload.proposal });
    }).catch((error) => { if (error.name !== "AbortError") setState({ loading: false, error: error.message }); });
    return () => controller.abort();
  }, [params?.slug]);
  useEffect(() => { const tag = document.querySelector('meta[name="robots"]'); if (tag) tag.setAttribute("content", "noindex,nofollow"); }, []);
  if (state.loading) return <div className="grid min-h-[70vh] place-items-center"><Sparkles className="h-8 w-8 animate-pulse text-brand-700" /></div>;
  if (state.error) return <section className="site-hero min-h-[70vh] text-center"><div className="site-shell max-w-xl"><h1 className="site-heading">This proposal is not available</h1><p className="site-lede mt-3">It may be private or still being prepared.</p><Button className="mt-6" asChild><Link href="/contact">Contact MehyarSoft</Link></Button></div></section>;
  return <Proposal proposal={state.proposal} />;
}

function Proposal({ proposal }: any) {
  const content = proposal.content || {};
  useEffect(() => { document.title = `${content.business?.name || "Business"} growth proposal | MehyarSoft`; }, [content.business?.name]);
  return <div className="bg-background text-foreground">
    <section className="relative overflow-hidden border-b border-border">
      {proposal.hero_url ? <img src={proposal.hero_url} alt={`${content.business?.name || "Business"} growth proposal`} className="absolute inset-0 h-full w-full object-cover" /> : null}<div className="absolute inset-0 bg-gradient-to-r from-brand-950 via-brand-950/90 to-brand-950/35" />
      <div className="site-shell relative flex min-h-[72vh] flex-col justify-end px-4 py-16 text-white sm:px-6 md:py-24"><Badge className="mb-5 w-fit bg-brand-100 text-brand-950">Prepared for {content.business?.name}</Badge><p className="site-eyebrow text-brand-100">{content.hero?.eyebrow}</p><h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-[0.96] tracking-[-0.05em] sm:text-6xl lg:text-7xl">{content.hero?.headline}</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-white/80 sm:text-xl">{content.hero?.subheadline}</p><div className="mt-8 flex flex-wrap gap-3"><Button size="lg" className="bg-white text-brand-950 hover:bg-brand-100" asChild><Link href="/booking">{content.hero?.primary_cta || "Book a call"}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button size="lg" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20" asChild><a href={proposal.source_url} target="_blank" rel="noreferrer">Current website <ExternalLink className="ml-2 h-4 w-4" /></a></Button></div></div>
    </section>

    <div className="site-shell space-y-16 px-4 py-14 sm:px-6 md:space-y-24 md:py-24">
      <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]"><SectionTitle eyebrow="What we found" title="The clearest opportunities" body={content.diagnosis?.summary} /><div className="grid gap-3 sm:grid-cols-2">{content.diagnosis?.friction_points?.map((item: any) => <Card key={item.title}><CardContent className="p-5"><TrendingUp className="h-5 w-5 text-cyan-600" /><h3 className="mt-4 text-lg font-bold">{item.title}</h3><p className="mt-2 text-sm leading-6">{item.impact}</p><p className="mt-3 text-xs text-muted-foreground">Basis: {item.evidence}</p></CardContent></Card>)}</div></section>

      {content.opportunity?.scenarios?.length ? <section><SectionTitle eyebrow="Business case" title="What improvement could be worth" body={content.opportunity?.summary} /><div className="mt-7 grid gap-3 md:grid-cols-3">{content.opportunity.scenarios.map((item: any) => <Card key={item.label} className="border-emerald-200"><CardContent className="p-5"><CircleDollarSign className="h-5 w-5 text-emerald-600" /><h3 className="mt-3 font-bold">{item.label}</h3><div className="mt-2 text-2xl font-black">{money(item.monthly_value_low)}–{money(item.monthly_value_high)}<span className="text-xs font-medium text-muted-foreground"> / mo</span></div><p className="mt-3 text-sm leading-6">{item.explanation}</p><p className="mt-3 text-xs text-muted-foreground">Assumption: {item.assumption}</p></CardContent></Card>)}</div></section> : null}

      <section id="services"><SectionTitle eyebrow="Recommended services" title="Choose the amount of help you want" body="Each option is written around the customer experience and business result—not a pile of technical features." /><div className="mt-7 grid gap-4 lg:grid-cols-3">{content.offers?.map((offer: any, index: number) => <OfferCard key={offer.key} offer={offer} featured={index === 1} />)}</div></section>

      <section className="bg-brand-950 px-5 py-10 text-white sm:p-10"><div className="grid gap-9 lg:grid-cols-[0.8fr_1.2fr]"><div><Bot className="h-9 w-9 text-brand-100" /><p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-brand-100">Agentic operations</p><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">{content.agentic?.headline}</h2><p className="mt-5 leading-7 text-white/75">{content.agentic?.summary}</p><div className="mt-5 flex flex-wrap gap-2">{content.agentic?.mobile_channels?.map((channel: string) => <Badge key={channel} className="bg-white/10 text-white">{channel}</Badge>)}</div></div><div className="grid gap-3 sm:grid-cols-2">{content.agentic?.use_cases?.map((item: any, index: number) => <div key={`${item.title}-${index}`} className="border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-brand-100" /><h3 className="font-bold">{item.title}</h3></div><p className="mt-3 bg-black/30 p-2 text-xs text-brand-100">“{item.command}”</p><p className="mt-3 text-sm leading-6 text-white/75">{item.action}</p><p className="mt-2 text-xs text-emerald-300">Business value: {item.business_value}</p>{item.approval_required ? <p className="mt-2 flex gap-1 text-[11px] text-amber-200"><ShieldCheck className="h-3 w-3 shrink-0" />You approve before external action.</p> : null}</div>)}</div></div></section>

      <section className="grid gap-6 lg:grid-cols-2"><Card className="bg-secondary/55"><CardContent className="p-6 sm:p-8"><Sparkles className="h-7 w-7 text-brand-700" /><h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">{content.social?.headline}</h2><p className="mt-3 leading-7">{content.social?.summary}</p><List items={content.social?.monthly_outputs} /></CardContent></Card><Card><CardContent className="p-6 sm:p-8"><Clock3 className="h-7 w-7 text-brand-700" /><h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">A practical launch plan</h2><div className="mt-5 space-y-4">{content.roadmap?.map((step: any) => <div key={step.phase} className="border-l-2 border-brand-700 pl-4"><p className="text-xs font-bold uppercase tracking-wider text-brand-700">{step.timing}</p><h3 className="font-bold">{step.phase}</h3><p className="mt-1 text-sm text-muted-foreground">{step.outcome}</p></div>)}</div></CardContent></Card></section>

      <section><SectionTitle eyebrow="Questions" title="Straight answers before you decide" /><div className="mt-6 grid gap-3 md:grid-cols-2">{content.faq?.map((item: any) => <details key={item.question} className="rounded-2xl border bg-background p-5"><summary className="cursor-pointer font-bold">{item.question}</summary><p className="mt-3 text-sm leading-6 text-muted-foreground">{item.answer}</p></details>)}</div><p className="mt-5 text-xs leading-5 text-muted-foreground">{content.risk_note}</p></section>

      <section className="bg-brand-100 p-7 text-brand-950 sm:p-12"><h2 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">{content.closing?.headline}</h2><p className="mt-4 max-w-2xl text-lg leading-8">{content.closing?.body}</p><Button size="lg" className="mt-7 bg-brand-950 text-white" asChild><Link href="/booking">{content.closing?.cta || "Book a call"}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></section>

      <section className="grid gap-4 rounded-2xl border bg-background p-5 text-sm md:grid-cols-2"><div><h2 className="font-bold">Facts observed from the website</h2><List items={content.business?.observed_facts} /></div><div><h2 className="font-bold">Items to confirm together</h2><List items={content.business?.assumptions} /></div></section>
    </div>
  </div>;
}

function OfferCard({ offer, featured }: any) { return <Card className={featured ? "border-brand-700 shadow-xl ring-1 ring-brand-700" : ""}><CardContent className="p-5 sm:p-6">{featured ? <Badge className="mb-3 bg-brand-700">Most useful starting point</Badge> : null}<h3 className="text-2xl font-semibold tracking-[-0.03em]">{offer.name}</h3><p className="mt-3 min-h-16 text-sm leading-6 text-muted-foreground">{offer.plain_summary}</p><div className="mt-5"><span className="text-3xl font-semibold tracking-[-0.03em]">{money(offer.setup_price)}</span><span className="text-sm text-muted-foreground"> setup</span></div><p className="font-semibold">then {money(offer.monthly_price)}/month <span className="text-xs font-normal text-muted-foreground">or {money(offer.annual_price)}/year</span></p>{offer.owned_infrastructure_price ? <p className="mt-2 text-xs text-muted-foreground">Own-infrastructure option from {money(offer.owned_infrastructure_price)}</p> : null}<p className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Your customers can</p><List items={offer.customer_experience} /><p className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Your business gets</p><List items={offer.business_outcomes?.length ? offer.business_outcomes : offer.features} /><Button className="mt-6 w-full" variant={featured ? "default" : "outline"} asChild><Link href="/booking">Talk about this option</Link></Button></CardContent></Card>; }
function List({ items }: any) { return <ul className="mt-3 space-y-2">{(items || []).map((item: string, index: number) => <li key={`${item}-${index}`} className="flex gap-2 text-sm leading-6"><Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />{item}</li>)}</ul>; }
function SectionTitle({ eyebrow, title, body }: any) { return <div><p className="site-eyebrow">{eyebrow}</p><h2 className="site-heading mt-3">{title}</h2>{body ? <p className="site-lede mt-4 max-w-2xl">{body}</p> : null}</div>; }
function money(value: any) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0)); }
