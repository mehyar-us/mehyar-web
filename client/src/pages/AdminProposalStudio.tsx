// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Copy, ExternalLink, Globe2, Loader2, RefreshCw, Send, Sparkles, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AdminProposalStudio({ token }: { token: string }) {
  const [url, setUrl] = useState("");
  const [instruction, setInstruction] = useState("Study this business and create a persuasive, plain-language growth proposal using the services that would help it most.");
  const [proposals, setProposals] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const headers = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);
  const load = async (openId?: string) => {
    const response = await fetch("/api/admin/proposals", { headers, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Proposal directory unavailable");
    setProposals(payload.proposals || []);
    const id = openId || selected?.id;
    if (id) {
      const detailResponse = await fetch(`/api/admin/proposals/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
      if (detailResponse.ok) setSelected(await detailResponse.json());
    }
  };

  useEffect(() => { void load().catch((caught) => setError(String(caught?.message || caught))); }, [token]);
  useEffect(() => {
    if (!proposals.some((proposal) => ["queued", "running"].includes(proposal.status))) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 4000);
    return () => window.clearInterval(timer);
  }, [proposals.map((item) => `${item.id}:${item.status}:${item.progress}`).join("|")]);

  const create = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/proposals", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ url, instruction }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Proposal could not start");
      setUrl("");
      await load(payload.proposal_id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Proposal could not start"); }
    finally { setBusy(false); }
  };

  const revise = async () => {
    if (!selected?.proposal?.id || !revisionPrompt.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/proposals/${encodeURIComponent(selected.proposal.id)}/revise`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ instruction: revisionPrompt }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Revision could not start");
      setRevisionPrompt("");
      await load(selected.proposal.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Revision could not start"); }
    finally { setBusy(false); }
  };

  const setVisibility = async (id: string, visibility: string) => {
    const response = await fetch(`/api/admin/proposals/${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ visibility }) });
    if (!response.ok) throw new Error("Visibility update failed");
    await load(id);
  };

  const copy = async (proposal: any) => {
    const value = `${window.location.origin}/proposals/${proposal.slug}`;
    await navigator.clipboard.writeText(value);
    setCopied(proposal.id); window.setTimeout(() => setCopied(""), 1800);
  };

  return <div className="space-y-4">
    <Card className="overflow-hidden border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-blue-50 dark:border-cyan-950 dark:from-cyan-950/30 dark:via-zinc-950 dark:to-blue-950/30">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-cyan-600 p-3 text-white"><WandSparkles className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800 dark:text-cyan-300">Proposal studio</p><h2 className="mt-1 text-xl font-bold sm:text-2xl">Turn any business website into a tailored sales page</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">Cloudflare reads the public site, reasons through fit and pricing, generates business-specific copy and artwork, and saves every version. New proposals are public by unlisted link; only proposals you mark Featured appear in the public directory.</p></div></div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_.8fr]"><div className="space-y-2"><Label htmlFor="proposal-url">Business website</Label><Input id="proposal-url" inputMode="url" autoCapitalize="none" placeholder="https://business.com" value={url} onChange={(event) => setUrl(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="proposal-instruction">Direction for the AI</Label><Textarea id="proposal-instruction" rows={3} value={instruction} onChange={(event) => setInstruction(event.target.value)} /></div></div>
        {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p> : null}
        <Button className="mt-4 w-full sm:w-auto" size="lg" disabled={busy || !url.trim()} onClick={create}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Research and create proposal</Button>
      </CardContent>
    </Card>

    <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Your proposal directory</h2><p className="text-xs text-muted-foreground">Private owner history with public share links.</p></div><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    <div className="grid gap-3 lg:grid-cols-2">{proposals.map((proposal) => {
      const ready = proposal.status === "complete";
      return <Card key={proposal.id} className={selected?.proposal?.id === proposal.id ? "border-cyan-400 ring-1 ring-cyan-300" : ""}><CardContent className="p-4 sm:p-5">
        <button className="w-full text-left" onClick={async () => { const response = await fetch(`/api/admin/proposals/${encodeURIComponent(proposal.id)}`, { headers, cache: "no-store" }); if (response.ok) setSelected(await response.json()); }}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-semibold">{proposal.business_name || new URL(proposal.source_url).hostname}</div><div className="mt-1 truncate text-xs text-muted-foreground">{proposal.source_url}</div></div><ProposalStatus value={proposal.status} /></div>
          {!ready ? <div className="mt-4"><div className="mb-1 flex justify-between text-xs"><span>{proposal.current_step || "Queued"}</span><span>{proposal.progress || 0}%</span></div><div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${proposal.progress || 3}%` }} /></div></div> : null}
          {ready ? <p className="mt-3 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{proposal.subtitle || proposal.title}</p> : null}
        </button>
        <div className="mt-4 flex flex-wrap gap-2">{ready ? <><Button size="sm" variant="outline" onClick={() => void copy(proposal)}>{copied === proposal.id ? <Check className="mr-2 h-3.5 w-3.5" /> : <Copy className="mr-2 h-3.5 w-3.5" />}{copied === proposal.id ? "Copied" : "Copy link"}</Button><Button size="sm" variant="outline" asChild><a href={`/proposals/${proposal.slug}`} target="_blank" rel="noreferrer">Open <ExternalLink className="ml-2 h-3.5 w-3.5" /></a></Button></> : null}<Badge variant="outline">{proposal.visibility || "unlisted"}</Badge><Badge variant="outline">{proposal.revision_count || 0} version{Number(proposal.revision_count) === 1 ? "" : "s"}</Badge></div>
      </CardContent></Card>;
    })}{!proposals.length ? <Card className="lg:col-span-2"><CardContent className="py-14 text-center text-muted-foreground"><Bot className="mx-auto mb-3 h-8 w-8 opacity-40" />Your generated proposals will appear here.</CardContent></Card> : null}</div>

    {selected?.proposal ? <Card className="border-cyan-200 dark:border-cyan-950"><CardContent className="p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-cyan-700">Selected proposal</p><h2 className="mt-1 text-xl font-bold">{selected.proposal.business_name || selected.proposal.title}</h2><p className="mt-1 text-sm text-muted-foreground">{selected.proposal.industry}{selected.proposal.location ? ` · ${selected.proposal.location}` : ""}</p></div>{selected.proposal.status === "complete" ? <Button asChild><a href={`/proposals/${selected.proposal.slug}`} target="_blank" rel="noreferrer"><Globe2 className="mr-2 h-4 w-4" />View client page</a></Button> : null}</div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_280px]"><div className="space-y-2"><Label htmlFor="revision-prompt">Revise using the saved context</Label><Textarea id="revision-prompt" rows={5} placeholder="Example: Make the wording simpler, emphasize missed calls, lower Level 1 setup by $200, and add more restaurant-specific examples." value={revisionPrompt} onChange={(event) => setRevisionPrompt(event.target.value)} /><Button disabled={busy || selected.proposal.status !== "complete" || !revisionPrompt.trim()} onClick={revise}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Create revised version</Button></div><div className="space-y-2"><Label>Public visibility</Label>{["unlisted", "featured", "private"].map((value) => <button key={value} onClick={() => void setVisibility(selected.proposal.id, value)} className={`block w-full rounded-xl border p-3 text-left text-sm ${selected.proposal.visibility === value ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}><strong className="capitalize">{value}</strong><span className="mt-1 block text-xs text-muted-foreground">{value === "unlisted" ? "Anyone with the link can view it." : value === "featured" ? "Also show it in the public proposal directory." : "Owner access only."}</span></button>)}</div></div>
      <details className="mt-6 rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Version and generation history</summary><div className="mt-4 space-y-3">{(selected.revisions || []).map((revision: any) => <div key={revision.id} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Version {revision.revision_number}</strong><span className="text-xs text-muted-foreground">{formatDate(revision.created_at)} · {revision.model}</span></div><p className="mt-2 text-muted-foreground">{revision.instruction || "Initial proposal"}</p>{revision.gateway_log_id ? <p className="mt-1 break-all text-[11px] text-muted-foreground">Gateway log: {revision.gateway_log_id}</p> : null}</div>)}</div></details>
    </CardContent></Card> : null}
  </div>;
}

function ProposalStatus({ value }: { value: string }) {
  const colors = value === "complete" ? "bg-emerald-100 text-emerald-800" : value === "failed" ? "bg-red-100 text-red-800" : "bg-cyan-100 text-cyan-900";
  return <Badge className={colors}>{String(value || "queued").replaceAll("_", " ")}</Badge>;
}

function formatDate(value: string) {
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
