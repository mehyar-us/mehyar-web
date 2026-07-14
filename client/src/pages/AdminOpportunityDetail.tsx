// @ts-nocheck
import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, ChevronLeft, Briefcase, Globe, AlertTriangle, Mail, Phone, MapPin, Clock, FileText, ListChecks, Send, CheckCircle2, History, BookmarkPlus, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, useAdminSession, STATUS_BADGE } from "./AdminChrome";

const STAGES = ["Discovery", "Evaluating", "Drafting", "ReadyToSend", "Sent", "Replied", "Won", "Lost", "Archived"];

function stageColor(stage: string) {
  switch (stage) {
    case "Discovery": return "bg-zinc-100 text-zinc-700";
    case "Evaluating": return "bg-amber-100 text-amber-700";
    case "Drafting": return "bg-violet-100 text-violet-700";
    case "ReadyToSend": return "bg-indigo-100 text-indigo-700";
    case "Sent": return "bg-blue-100 text-blue-700";
    case "Replied": return "bg-cyan-100 text-cyan-700";
    case "Won": return "bg-emerald-100 text-emerald-700";
    case "Lost": return "bg-red-100 text-red-700";
    case "Archived": return "bg-zinc-200 text-zinc-600 line-through";
    default: return "bg-zinc-100 text-zinc-700";
  }
}

export default function AdminOpportunityDetail() {
  const [, params] = useRoute("/admin/opportunities/:id");
  const [, setLocation] = useLocation();
  const { token, isLoggedIn, logout, login } = useAdminSession();

  const url = new URL(window.location.href);
  const kind = (url.searchParams.get("kind") || "sam") as "prospect" | "sam";
  const id = params?.id;

  const [moving, setMoving] = useState<string | null>(null);
  const [moveErr, setMoveErr] = useState<string | null>(null);

  const detail = useQuery({
    enabled: !!token && !!id,
    queryKey: ["admin-opp-detail", token, kind, id],
    queryFn: async () => {
      const r = await fetch(`/api/admin/opportunities/${encodeURIComponent(id || "")}?kind=${kind}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    },
  });

  if (!isLoggedIn) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <AdminNav token={null} onLogout={() => {}} isLoading={false} />
        <Card><CardContent className="p-6">Loading session…</CardContent></Card>
      </div>
    );
  }

  const opp = detail.data?.opportunity;
  const events = detail.data?.events || [];

  const moveTo = async (stage: string) => {
    if (!id) return;
    setMoving(stage);
    setMoveErr(null);
    try {
      const r = await fetch(`/api/admin/opportunities/${encodeURIComponent(id)}/stage?kind=${kind}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      detail.refetch();
    } catch (e) {
      setMoveErr(String((e as Error)?.message || e));
    }
    setMoving(null);
  };

  const logEvent = async (event_type: string, payload: Record<string, unknown> = {}) => {
    if (!id) return;
    await fetch(`/api/admin/opportunities/${encodeURIComponent(id)}/events?kind=${kind}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ event_type, payload }),
    });
    detail.refetch();
  };

  const [enriched, setEnriched] = useState<any>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const runEnrich = async (force = false) => {
    if (!id) return;
    setEnriching(true);
    setEnrichError(null);
    try {
      const r = await fetch(`/api/admin/opportunities/${encodeURIComponent(id)}/enrich?kind=${kind}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.details || data?.error || "enrich_failed");
      setEnriched(data);
    } catch (e) {
      setEnrichError(String((e as Error)?.message || e));
    }
    setEnriching(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav token={token} onLogout={logout} isLoading={detail.isFetching} />

      <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/opportunities")} className="mb-3 -ml-2">
        <ChevronLeft className="w-4 h-4 mr-1" />
        All opportunities
      </Button>

      {detail.isError ? (
        <Card><CardContent className="p-6">
          <div className="text-red-700 font-semibold">Failed to load</div>
          <div className="text-sm text-gray-700 mt-1">{String((detail.error as Error)?.message || detail.error)}</div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => detail.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : !opp ? (
        <Card><CardContent className="p-6"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</CardContent></Card>
      ) : (
        <>
          {/* Header */}
          <Card className="mb-4">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-start gap-4">
                <span className="mt-1">
                  {kind === "sam" ? <Briefcase className="w-6 h-6 text-blue-600" /> : <Globe className="w-6 h-6 text-emerald-600" />}
                </span>
                <div className="flex-1 min-w-[260px]">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h1 className="text-2xl font-semibold">{kind === "sam" ? opp.title : (opp.business_name || opp.title)}</h1>
                    <Badge className={stageColor(opp.stage)}>{opp.stage}</Badge>
                    {opp.status && <span className={`rounded-full px-2 py-0.5 text-xs ${(STATUS_BADGE as any)[opp.status] || "bg-zinc-100 text-zinc-700"}`}>{opp.status}</span>}
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    {kind === "sam" ? (
                      <>
                        {opp.agency && <div><span className="text-gray-500">Agency:</span> {opp.agency}{opp.office ? ` · ${opp.office}` : ""}</div>}
                        {opp.opportunity_type && <div><span className="text-gray-500">Type:</span> {opp.opportunity_type}</div>}
                        {opp.set_aside && opp.set_aside !== "" && <div><span className="text-gray-500">Set-Aside:</span> {opp.set_aside}</div>}
                        {opp.response_deadline && <div>📅 Deadline: <strong>{opp.response_deadline}</strong></div>}
                        {opp.posted_date && <div>📰 Posted: {opp.posted_date}</div>}
                        {opp.fit_score != null && <div>🎯 Fit: <strong>{opp.fit_score}</strong></div>}
                        {opp.confidence && <div>🔍 Confidence: {opp.confidence}</div>}
                      </>
                    ) : (
                      <>
                        {(opp.root_domain || opp.website) && <div>🌐 <a href={opp.website || `https://${opp.root_domain}`} target="_blank" rel="noreferrer" className="text-blue-600 underline">{opp.website || opp.root_domain}</a></div>}
                        {(opp.vertical || opp.city) && <div>🏷️ {[opp.vertical, opp.city, opp.country].filter(Boolean).join(" · ")}</div>}
                        {opp.email && <div>✉️ <a href={`mailto:${opp.email}`} className="text-blue-600 underline">{opp.email}</a></div>}
                        {opp.phone && <div>📞 {opp.phone}</div>}
                        {opp.leak_score != null && <div>🩸 Leak score: <strong>{opp.leak_score}</strong>{opp.detected_platform ? ` (${opp.detected_platform})` : ""}</div>}
                      </>
                    )}
                  </div>
                </div>
                {/* Actions */}
                <div className="min-w-[260px] flex flex-col gap-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Move to stage</div>
                  <div className="grid grid-cols-2 gap-1">
                    {STAGES.map((s) => (
                      <Button key={s} variant={opp.stage === s ? "secondary" : "outline"} size="sm" disabled={moving === s || opp.stage === s} onClick={() => moveTo(s)}>
                        {moving === s ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        {s}
                      </Button>
                    ))}
                  </div>
                  {moveErr && <div className="text-xs text-red-600">{moveErr}</div>}
                  <div className="flex gap-2 mt-2">
                    {kind === "sam" && opp.source_url && (
                      <Button variant="outline" size="sm" asChild><a href={opp.source_url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4 mr-1" />SAM.gov</a></Button>
                    )}
                    {kind === "prospect" && (opp.website || opp.root_domain) && (
                      <Button variant="outline" size="sm" asChild><a href={opp.website || `https://${opp.root_domain}`} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4 mr-1" />Visit site</a></Button>
                    )}
                    {kind === "prospect" && opp.email && (
                      <Button variant="cta" size="sm" asChild><a href={`mailto:${opp.email}`}><Mail className="w-4 h-4 mr-1" />Email</a></Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left col: deep data */}
            <div className="lg:col-span-2 space-y-4">

              {/* 🔮 LLM review */}
              <Card className="border-2 border-violet-300 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-500" /> AI review
                      {enriched?.cached && <span className="ml-1 text-xs font-normal text-gray-500">(cached)</span>}
                      {enriched?.used_llm === false && <span className="ml-1 text-xs font-normal text-gray-500">(heuristic — LLM unavailable)</span>}
                    </h3>
                    <Button variant="cta" size="sm" onClick={() => runEnrich(false)} disabled={enriching}>
                      {enriching ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
                      {enriching ? "Reviewing…" : enriched ? "Refresh review" : "Run AI review"}
                    </Button>
                  </div>
                  {enrichError && <div className="text-xs text-red-600">{enrichError}</div>}
                  {!enriched && !enrichError && (
                    <p className="text-sm text-gray-600">
                      Press the button to ask the AI to score this {kind === "sam" ? "federal solicitation" : "prospect"} and produce a structured,
                      emoji-rich breakdown: verdict, why-care, requirements, apply-plan, risks, next action.
                      Result is cached and recorded in <code>opportunity_events</code>.
                    </p>
                  )}
                  {enriched?.enriched && (
                    <ReviewBody data={enriched.enriched} />
                  )}
                </CardContent>
              </Card>

              {kind === "sam" && opp.brief && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> AI brief</h3>
                  {opp.brief.executive_summary && (
                    <div className="text-sm">
                      <strong>Executive summary:</strong>
                      <p className="mt-1 whitespace-pre-wrap">{opp.brief.executive_summary}</p>
                    </div>
                  )}
                  {opp.brief.why_we_fit && <div className="mt-2 text-sm">✅ Why we fit: <span className="whitespace-pre-wrap">{opp.brief.why_we_fit}</span></div>}
                  {opp.brief.why_we_dont_fit && <div className="mt-2 text-sm">⚠ Why we don't: <span className="whitespace-pre-wrap">{opp.brief.why_we_dont_fit}</span></div>}
                  {opp.brief.bid_decision && <div className="mt-2 text-sm">🎯 Decision: <span className="whitespace-pre-wrap">{opp.brief.bid_decision}</span></div>}
                  {opp.brief.next_step && <div className="mt-2 text-sm">➡️ Next step: <span className="whitespace-pre-wrap">{opp.brief.next_step}</span></div>}
                  {Array.isArray(opp.brief.capability_match_json) && opp.brief.capability_match_json.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Capability match</div>
                      <div className="flex flex-wrap gap-1">
                        {opp.brief.capability_match_json.map((c, i) => (
                          <Badge key={i} className="bg-emerald-100 text-emerald-700">{typeof c === "string" ? c : JSON.stringify(c)}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {Array.isArray(opp.brief.risk_flags_json) && opp.brief.risk_flags_json.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Risk flags</div>
                      <div className="flex flex-wrap gap-1">
                        {opp.brief.risk_flags_json.map((c, i) => (
                          <Badge key={i} className="bg-amber-100 text-amber-700">{typeof c === "string" ? c : JSON.stringify(c)}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent></Card>
              )}

              {kind === "sam" && opp.summary && !opp.brief && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-2 flex items-center gap-2"><FileText className="w-4 h-4" /> Summary</h3>
                  <p className="text-sm whitespace-pre-wrap">{opp.summary}</p>
                </CardContent></Card>
              )}

              {kind === "sam" && (Array.isArray(opp.requirements) && opp.requirements.length > 0) && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><ListChecks className="w-4 h-4" /> What they need & requirements</h3>
                  <div className="space-y-2">
                    {opp.requirements.map((r, i) => (
                      <div key={i} className="flex gap-3 text-sm">
                        <span className="text-gray-500 w-44 shrink-0">{r.label}</span>
                        <span className="flex-1">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent></Card>
              )}

              {kind === "sam" && (Array.isArray(opp.how_to_apply) && opp.how_to_apply.length > 0) && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><Send className="w-4 h-4" /> How to apply</h3>
                  <ol className="space-y-3 text-sm">
                    {opp.how_to_apply.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-semibold">{s.step}</span>
                        <div>
                          <div className="font-medium">{s.label}</div>
                          {s.value && <div className="text-gray-600 mt-0.5">{s.value}</div>}
                          {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-600 text-sm underline">{s.url}</a>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent></Card>
              )}

              {kind === "sam" && (Array.isArray(opp.attachments) && opp.attachments.length > 0) && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-3">Attachments ({opp.attachments.length})</h3>
                  <ul className="text-sm space-y-1">
                    {opp.attachments.map((a, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 underline truncate">{a.name}</a>
                        {a.type && <span className="text-xs text-gray-500">{a.type}</span>}
                      </li>
                    ))}
                  </ul>
                </CardContent></Card>
              )}

              {kind === "sam" && (Array.isArray(opp.poc) && opp.poc.length > 0) && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><Phone className="w-4 h-4" /> Contacts</h3>
                  <ul className="text-sm space-y-2">
                    {opp.poc.map((p, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div>
                          {p.name && <div className="font-medium">{p.name}{p.role ? ` <${p.role}>` : ""}</div>}
                          {p.email && <a href={`mailto:${p.email}`} className="text-blue-600 underline">{p.email}</a>}
                          {p.phone && <div className="text-gray-600">{p.phone}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent></Card>
              )}

              {kind === "prospect" && opp.signals && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Leak signals detected</h3>
                  {Array.isArray(opp.signals.leak_signals_json) && opp.signals.leak_signals_json.length > 0 ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex flex-wrap gap-1">
                        {opp.signals.leak_signals_json.map((s, i) => (
                          <Badge key={i} className="bg-red-100 text-red-700">{s}</Badge>
                        ))}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">Page weight: {opp.signals.page_weight_kb} KB · Load: {opp.signals.load_time_ms}ms · Platform: {opp.signals.detected_platform || "?"} · Score: {opp.signals.leak_score}/100</div>
                      {opp.signals.notes && <div className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{opp.signals.notes}</div>}
                    </div>
                  ) : <div className="text-sm text-gray-500">No leak signals recorded yet.</div>}
                </CardContent></Card>
              )}

              {kind === "prospect" && opp.latestDraft && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-2 flex items-center gap-2"><Mail className="w-4 h-4" /> Latest draft</h3>
                  <div className="text-sm"><strong>Subject:</strong> {opp.latestDraft.subject || "(no subject)"}</div>
                  {opp.latestDraft.body_text && <pre className="mt-2 text-xs text-gray-700 whitespace-pre-wrap bg-zinc-50 p-3 rounded">{opp.latestDraft.body_text}</pre>}
                  {opp.latestDraft.body_html && (
                    <details className="mt-2">
                      <summary className="text-blue-600 cursor-pointer text-xs">HTML body</summary>
                      <pre className="mt-1 text-xs text-gray-700 whitespace-pre-wrap bg-zinc-50 p-3 rounded">{opp.latestDraft.body_html}</pre>
                    </details>
                  )}
                </CardContent></Card>
              )}

              {kind === "prospect" && (opp.recentSends?.length > 0) && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-2 flex items-center gap-2"><Send className="w-4 h-4" /> Recent sends ({opp.recentSends.length})</h3>
                  <ul className="text-sm space-y-1">
                    {opp.recentSends.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span>{new Date(s.created_at).toLocaleDateString()}</span>
                        <span className="font-mono">{s.status}</span>
                        <span>{s.to_email}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent></Card>
              )}

              {kind === "prospect" && (opp.replies?.length > 0) && (
                <Card><CardContent className="p-5">
                  <h3 className="font-semibold mb-2 flex items-center gap-2"><Mail className="w-4 h-4" /> Replies ({opp.replies.length})</h3>
                  <ul className="text-sm space-y-2">
                    {opp.replies.map((r, i) => (
                      <li key={i} className="border-l-2 border-emerald-500 pl-2">
                        <div className="text-xs text-gray-500">{new Date(r.received_at).toLocaleString()} · <span className="font-mono">{r.classification || "?"}</span></div>
                        {r.subject && <div className="font-medium">{r.subject}</div>}
                        {r.body_excerpt && <div className="text-xs text-gray-700 mt-0.5 whitespace-pre-wrap">{r.body_excerpt}</div>}
                      </li>
                    ))}
                  </ul>
                </CardContent></Card>
              )}
            </div>

            {/* Right col: timeline */}
            <div className="space-y-4">
              <Card><CardContent className="p-5">
                <h3 className="font-semibold mb-3 flex items-center gap-2"><History className="w-4 h-4" /> Activity timeline</h3>
                {events.length === 0 ? (
                  <div className="text-sm text-gray-500">No events yet. Move stage or log an action below.</div>
                ) : (
                  <ol className="text-sm space-y-2">
                    {events.map((e) => (
                      <li key={e.id} className="flex gap-2 border-l-2 border-zinc-200 pl-2">
                        <div className="flex-1">
                          <div className="font-mono text-xs text-gray-500">{new Date(e.created_at).toLocaleString()}</div>
                          <div><strong>{e.event_type}</strong>{e.from_stage && e.to_stage ? ` (${e.from_stage} → ${e.to_stage})` : ""}</div>
                          {e.payload_json && Object.keys(e.payload_json).length > 0 && (
                            <pre className="mt-1 text-xs text-gray-600 bg-zinc-50 p-2 rounded">{JSON.stringify(e.payload_json, null, 2).slice(0, 400)}</pre>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => logEvent("note", { text: "owner opened detail" })} disabled={detail.isFetching}><BookmarkPlus className="w-3 h-3 mr-1" />Note opened</Button>
                  {kind === "prospect" && opp.email && (
                    <Button variant="outline" size="sm" onClick={() => logEvent("email_sent", { to: opp.email })}><Mail className="w-3 h-3 mr-1" />Mark email sent</Button>
                  )}
                  {kind === "sam" && (
                    <Button variant="outline" size="sm" onClick={() => logEvent("draft_started")}><Send className="w-3 h-3 mr-1" />Started proposal draft</Button>
                  )}
                </div>
              </CardContent></Card>
              <Card><CardContent className="p-5 text-xs text-gray-600">
                <h3 className="font-semibold mb-2 flex items-center gap-2"><Clock className="w-4 h-4" /> Quick actions</h3>
                <ul className="space-y-1">
                  <li>📌 Move to <strong>Evaluating</strong> to mark "looking at it"</li>
                  <li>✍️ Move to <strong>Drafting</strong> when writing proposal/email</li>
                  <li>🚀 <strong>ReadyToSend</strong> when approved</li>
                  <li>📬 <strong>Sent</strong> triggers no Telegram — /admin is the log</li>
                  <li>🏆 <strong>Won</strong> for closed deals; we get paid</li>
                </ul>
              </CardContent></Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Pretty LLM review renderer ───────────────────────────────────────────────
function ReviewBody({ data }) {
  if (!data) return null;
  const score = data.score ?? null;
  const verdictColor =
    (data.verdict || "").includes("🟢") ? "text-emerald-600" :
    (data.verdict || "").includes("🔴") ? "text-red-600" :
    "text-amber-600";

  return (
    <div className="text-sm space-y-4">
      {data.headline && (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={`text-xl font-bold ${verdictColor}`}>{data.verdict || "?"}</span>
          {score != null && (
            <span className="text-gray-500">
              <span className="font-mono text-2xl text-gray-900">{score}</span><span className="text-gray-400">/100</span>
            </span>
          )}
          <p className="text-gray-700 flex-1 min-w-[260px] leading-snug">{data.headline}</p>
        </div>
      )}

      {Array.isArray(data.why_care) && data.why_care.length > 0 && (
        <Section title="🎯 Why we should care" rows={data.why_care} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.isArray(data.must_haves) && data.must_haves.length > 0 && (
          <Section title="✅ Must-haves" rows={data.must_haves} tone="emerald" />
        )}
        {Array.isArray(data.nice_to_haves) && data.nice_to_haves.length > 0 && (
          <Section title="✨ Nice-to-haves" rows={data.nice_to_haves} tone="violet" />
        )}
        {Array.isArray(data.risk_flags) && data.risk_flags.length > 0 && (
          <Section title="⚠️ Risk flags" rows={data.risk_flags} tone="amber" />
        )}
        {(data.estimated_hours != null || data.estimated_value_usd != null || data.win_probability_pct != null) && (
          <div className="rounded-lg bg-zinc-50 p-3 space-y-1">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">📊 Estimates</div>
            {data.estimated_hours != null && <div>⏱️ <strong>{data.estimated_hours}h</strong> effort</div>}
            {data.estimated_value_usd != null && <div>💰 <strong>${Number(data.estimated_value_usd).toLocaleString()}</strong> estimated value</div>}
            {data.win_probability_pct != null && (
              <div>
                🏆 Win probability
                <div className="mt-1 h-2 bg-zinc-200 rounded overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, Number(data.win_probability_pct) || 0))}%` }} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{data.win_probability_pct}%</div>
              </div>
            )}
          </div>
        )}
      </div>

      {Array.isArray(data.apply_plan) && data.apply_plan.length > 0 && (
        <Section title="📋 Apply / outreach plan" rows={data.apply_plan} ordered />
      )}

      {Array.isArray(data.emails_to_target) && data.emails_to_target.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">📧 Targets</div>
          <div className="flex flex-wrap gap-1">
            {data.emails_to_target.map((e, i) => (
              <a key={i} href={`mailto:${e}`} className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 underline">{e}</a>
            ))}
          </div>
        </div>
      )}

      {data.next_action && (
        <div className="rounded-lg bg-gradient-to-r from-emerald-50 to-cyan-50 p-3 border border-emerald-200">
          <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-1">➡️ Next action</div>
          <p className="text-sm font-medium">{data.next_action}</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, rows, tone = "zinc", ordered = false }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const toneClass = {
    zinc:   "bg-zinc-50 border-zinc-200",
    emerald:"bg-emerald-50 border-emerald-200",
    violet: "bg-violet-50 border-violet-200",
    amber:  "bg-amber-50 border-amber-200",
  }[tone];
  return (
    <div className={`rounded-lg p-3 border ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">{title}</div>
      {ordered ? (
        <ol className="space-y-1">
          {rows.map((r, i) => <li key={i} className="flex gap-2"><span className="font-mono text-gray-500">{i + 1}.</span><span>{r}</span></li>)}
        </ol>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => <li key={i} className="flex gap-2"><span className="text-gray-400">•</span><span>{r}</span></li>)}
        </ul>
      )}
    </div>
  );
}
