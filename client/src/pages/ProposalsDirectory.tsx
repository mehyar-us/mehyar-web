// @ts-nocheck
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BriefcaseBusiness, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ProposalsDirectory() {
  const [state, setState] = useState<any>({ loading: true, proposals: [] });
  useEffect(() => { fetch("/api/proposals").then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setState({ loading: false, proposals: payload.proposals || [] }); }).catch(() => setState({ loading: false, proposals: [] })); }, []);
  return <section className="site-hero min-h-[70vh]"><div className="site-shell"><p className="site-eyebrow">Client growth plans</p><h1 className="site-display mt-3 max-w-3xl">See how practical systems fit real businesses.</h1><p className="site-lede mt-5 max-w-2xl">Selected examples created around a business’s actual customer journey, needs, and economics.</p>{state.loading ? <Loader2 className="mt-12 h-7 w-7 animate-spin text-brand-700" /> : <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{state.proposals.map((proposal: any) => <Link key={proposal.slug} href={`/proposals/${proposal.slug}`}><Card className="site-panel-flat h-full transition hover:-translate-y-1 hover:border-brand-700/40 hover:shadow-lg"><CardContent className="p-6"><BriefcaseBusiness className="h-6 w-6 text-brand-700" /><p className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{proposal.industry}{proposal.location ? ` · ${proposal.location}` : ""}</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{proposal.business_name}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{proposal.subtitle || proposal.title}</p><span className="mt-5 inline-flex items-center text-sm font-bold text-brand-700">View growth plan <ArrowRight className="ml-2 h-4 w-4" /></span></CardContent></Card></Link>)}{!state.proposals.length ? <p className="site-panel-flat col-span-full p-8 text-muted-foreground">Featured client examples will appear here. Private client links remain unlisted.</p> : null}</div>}</div></section>;
}
