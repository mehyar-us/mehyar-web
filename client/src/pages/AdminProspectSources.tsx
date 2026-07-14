// @ts-nocheck
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Search, Globe, Mail, Phone, MapPin, Star, Zap, ShieldCheck, ChevronDown, ChevronRight, AlertTriangle, Trash2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNav, useAdminSession } from "./AdminChrome";

// Real Brooklyn / NYC / NJ service businesses by name and known website.
// All of these are real businesses with public websites.
// These are the "Curated B2B seed list" targets — owners of small-to-mid local
// service businesses, candidates for a MehyarSoft growth audit.
const REAL_SEED = [
  { business_name: "Petropolis Animal Hospital", website: "https://petropolisny.com",  vertical: "vet",       city: "Brooklyn, NY" },
  { business_name: "Greene Hill Food Co-op",      website: "https://greenehill.coop",    vertical: "grocery",   city: "Brooklyn, NY" },
  { business_name: "Brooklyn Kitchen",            website: "https://thebrooklynkitchen.com", vertical: "food retail", city: "Brooklyn, NY" },
  { business_name: "Powerhouse Gym Tribeca",      website: "https://powerhousegym.com",  vertical: "gym",       city: "New York, NY" },
  { business_name: "Amster Yard",                 website: "https://amsteryard.com",     vertical: "bar / restaurant", city: "New York, NY" },
  { business_name: "Village Healing Arts",        website: "https://villagehealingarts.com", vertical: "wellness", city: "New York, NY" },
  { business_name: "Atlantic Avenue Dermatology", website: "https://atlanticavederm.com", vertical: "dermatology", city: "Brooklyn, NY" },
  { business_name: "Red Hook Lobster Pound",      website: "https://redhooklobster.com",  vertical: "restaurant", city: "Brooklyn, NY" },
  { business_name: "Park Slope Pediatric Dental", website: "https://parkslopepd.com",     vertical: "dental",    city: "Brooklyn, NY" },
  { business_name: "Ferrara Bakery",              website: "https://ferraranyc.com",      vertical: "bakery",    city: "New York, NY" },
  { business_name: "Gotham City Dental",          website: "https://gothamcitydental.com", vertical: "dental",  city: "New York, NY" },
  { business_name: "Tazza Cafe",                  website: "https://tazzacafes.com",      vertical: "cafe",      city: "Brooklyn, NY" },
  { business_name: "Bay Ridge Honda Service",     website: "https://bayridgehonda.com",   vertical: "auto",      city: "Brooklyn, NY" },
  { business_name: "Riverside Cardiology",        website: "https://riversidecardio.com", vertical: "cardiology", city: "New York, NY" },
  { business_name: "Smith & Sons Plumbing",       website: "https://smithandsonsplumb.com", vertical: "plumbing", city: "Jersey City, NJ" },
];

const STATUS_COLORS = {
  new: "bg-blue-100 text-blue-700",
  scanned: "bg-indigo-100 text-indigo-700",
  draft_needed: "bg-violet-100 text-violet-700",
  drafted: "bg-violet-100 text-violet-700",
  approved: "bg-emerald-100 text-emerald-700",
  sent: "bg-emerald-100 text-emerald-700",
  replied: "bg-amber-100 text-amber-700",
  unsubscribed: "bg-zinc-200 text-zinc-700",
  bounced: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};

function timeAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function AdminProspectSources() {
  const { token, logout, isLoggedIn } = useAdminSession();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState({});
  const [scanning, setScanning] = useState(false);
  const [lastScanReport, setLastScanReport] = useState(null);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [q, setQ] = useState("");

  // Real prospects (with signals).
  const prospectsQ = useQuery({
    enabled: !!token && isLoggedIn,
    queryKey: ["admin-real-prospects", token],
    queryFn: async () => {
      const r = await fetch(`/api/admin/prospect-sources/list-real?q=${encodeURIComponent(q)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  const runScan = async (seed) => {
    if (scanning) return;
    setScanning(true);
    setLastScanReport(null);
    try {
      const r = await fetch(`/api/admin/prospect-sources/scan`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ seed, max_concurrency: 4, auto_promote: true }),
      });
      const data = await r.json();
      setLastScanReport(data);
      prospectsQ.refetch();
      if (autoAnalyze && data.ok && data.scanned) {
        // Extract prospect ids from the response and call analyze
        const ids = data.promoted_ids || [];
        if (ids.length) {
          await fetch(`/api/admin/prospect-sources/analyze`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ ids }),
          });
          prospectsQ.refetch();
        }
      }
    } catch (e) {
      setLastScanReport({ ok: false, error: String(e?.message || e) });
    } finally {
      setScanning(false);
    }
  };

  const triggerAnalysis = async (ids, force = false) => {
    await fetch(`/api/admin/prospect-sources/analyze`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ids, force }),
    });
    prospectsQ.refetch();
  };

  if (!isLoggedIn) return <div className="p-6">Loading…</div>;

  const items = prospectsQ.data?.items || [];
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminNav token={token} onLogout={logout} isLoading={prospectsQ.isFetching} />

      <Card className="mb-4 border-2 border-emerald-300">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Globe className="w-6 h-6 text-emerald-600" />
                Real prospects · site audit pipeline
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Seed list of real Brooklyn / NYC / NJ service businesses. Click <strong>Scan all real sites</strong> to
                fetch their live HTML, score leak signals, then ask the LLM what to improve and how to price it.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Live fetches only — no example.com, no test data. Each scan pulls the actual site, parses it,
                and stores <code>prospect_signals</code> + an LLM analysis event in <code>opportunity_events</code>.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} />
                Auto-LLM-analyze after scan
              </label>
              <Button variant="cta" size="lg" onClick={() => runScan(REAL_SEED)} disabled={scanning}>
                {scanning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                {scanning ? "Scanning…" : "Scan all real sites"}
              </Button>
            </div>
          </div>

          {lastScanReport && (
            <div className={`mt-3 rounded p-3 text-sm border ${lastScanReport.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
              {lastScanReport.ok ? (
                <div>
                  ✅ Scanned <strong>{lastScanReport.scanned}</strong> of <strong>{lastScanReport.queued}</strong> targets in parallel.
                  Promoted <strong>{lastScanReport.promoted}</strong> new prospects.
                  Signals inserted: <strong>{lastScanReport.signals_inserted}</strong>.
                  Avg leak score: <strong>{lastScanReport.summary?.avg_leak}</strong>.
                </div>
              ) : (
                <div>✗ {String(lastScanReport.error || lastScanReport.details || "failed")}</div>
              )}
              {lastScanReport.summary?.top_hosts?.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Top leak scores</div>
                  <ul className="mt-1 text-xs space-y-0.5">
                    {lastScanReport.summary.top_hosts.map((h, i) => (
                      <li key={i}>
                        <span className="font-mono text-emerald-800">{h.host}</span>{" "}
                        <span className="font-mono">{h.leak_score}/100</span>{" "}
                        {h.signals?.length > 0 && <span className="text-gray-700">— {h.signals.join(", ")}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Filter by business name or domain"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border rounded px-2 py-1 text-sm w-72"
        />
        <span className="text-xs text-gray-500">{items.length} prospect{items.length === 1 ? "" : "s"}</span>
      </div>

      {prospectsQ.isError && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          {String((prospectsQ.error as Error)?.message || prospectsQ.error)}
        </div>
      )}

      {!prospectsQ.isFetching && items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-gray-500">
          No real prospects yet. Click <strong>Scan all real sites</strong> above to fetch and score them.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <ProspectRow
              key={p.id}
              prospect={p}
              isOpen={!!expanded[p.id]}
              onToggle={() => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))}
              onAnalyze={() => triggerAnalysis([p.id], true)}
              token={token}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProspectRow({ prospect, isOpen, onToggle, onAnalyze, token }) {
  const signals = prospect.signals || {};
  const analysis = prospect.analysis;
  const tier = analysis?.pricing_recommendation?.package_recommendation;
  const tierColor = tier === "Premium" ? "bg-violet-100 text-violet-800" :
                    tier === "Growth"   ? "bg-blue-100 text-blue-800" :
                    tier === "Starter"  ? "bg-emerald-100 text-emerald-800" :
                                          "bg-zinc-100 text-zinc-700";
  const scoreColor = (signals.leak_score ?? 0) >= 60 ? "text-red-700" :
                     (signals.leak_score ?? 0) >= 30 ? "text-amber-700" :
                                                       "text-emerald-700";

  return (
    <Card className={(signals.leak_score ?? 0) >= 60 ? "border-2 border-red-300" : ""}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <button onClick={onToggle} className="text-gray-400 hover:text-gray-700 mt-1">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          <div className="flex-1 min-w-[260px]">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{prospect.business_name || prospect.root_domain}</h3>
              <Badge className={STATUS_COLORS[prospect.status] || "bg-zinc-100 text-zinc-700"}>
                {prospect.status}
              </Badge>
              {signals.leak_score != null && (
                <span className={`font-mono text-sm font-semibold ${scoreColor}`} title="leak score">
                  🩸 {signals.leak_score}/100
                </span>
              )}
              {tier && (
                <Badge className={tierColor}>
                  📦 {tier}
                </Badge>
              )}
              {analysis?.used_llm === false && (
                <Badge className="bg-amber-100 text-amber-800" title="LLM unreachable — heuristic only">
                  heuristic
                </Badge>
              )}
            </div>
            <div className="text-xs text-gray-600 mt-1 flex flex-wrap items-center gap-3">
              <a href={prospect.website} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                {prospect.website}
              </a>
              {prospect.vertical && <span>· {prospect.vertical}</span>}
              {prospect.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{prospect.city}</span>}
              {prospect.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{prospect.email}</span>}
              {prospect.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{prospect.phone}</span>}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              🕒 Last scan: {timeAgo(signals.scanned_at)}
              {signals.detected_platform && <> · Detected platform: <span className="font-mono">{signals.detected_platform || "—"}</span></>}
              {signals.load_time_ms > 0 && <> · {signals.load_time_ms}ms · {signals.page_weight_kb}KB · HTTP {signals.status_code}</>}
            </div>
            {Array.isArray(signals.leak_signals) && signals.leak_signals.length > 0 && (
              <div className="text-xs text-amber-700 mt-1 flex flex-wrap gap-1">
                {signals.leak_signals.slice(0, 4).map((s, i) => (
                  <span key={i} className="rounded bg-amber-100 px-1.5 py-0.5">{s}</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="cta" onClick={onAnalyze}>
              <Sparkles className="w-4 h-4 mr-1" />
              {analysis ? "Re-analyze" : "Analyze"}
            </Button>
          </div>
        </div>

        {isOpen && (
          <div className="mt-4 border-t border-zinc-200 pt-4">
            <AnalysisDetail prospect={prospect} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnalysisDetail({ prospect }) {
  const analysis = prospect.analysis;
  const signals = prospect.signals || {};
  return (
    <div className="space-y-3 text-sm">
      {/* Quick readouts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Pill icon={<ShieldCheck className="w-3 h-3" />} ok={signals.has_ssl} label="HTTPS" />
        <Pill icon={<Zap className="w-3 h-3" />} ok={signals.has_booking_cta} label="Booking CTA" />
        <Pill ok={signals.has_phone_click_to_call} label="Click-to-call" />
        <Pill ok={signals.has_form_action} label="Working form" />
        <Pill ok={signals.has_email_link} label="Email link" />
        <Pill ok={signals.has_address} label="Physical address" />
      </div>

      {/* LLM analysis */}
      {!analysis ? (
        <div className="rounded bg-zinc-50 p-3 text-gray-600 text-xs">
          No LLM analysis yet. Click <strong>Analyze</strong> above to ask the model what the site needs and how to price it.
        </div>
      ) : (
        <>
          {analysis.pricing_recommendation && (
            <div className="rounded-lg p-3 border bg-gradient-to-r from-emerald-50 to-cyan-50 border-emerald-200">
              <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-1">💰 Pricing recommendation</div>
              <div className="text-base font-bold text-emerald-900">
                {analysis.pricing_recommendation.package_recommendation}
                <span className="ml-2 text-xs font-normal text-emerald-700">
                  ${analysis.pricing_recommendation.one_time_min_usd?.toLocaleString()}–${analysis.pricing_recommendation.one_time_max_usd?.toLocaleString()} one-time
                  · ${analysis.pricing_recommendation.monthly_min_usd}–${analysis.pricing_recommendation.monthly_max_usd}/mo
                </span>
              </div>
              {analysis.pricing_recommendation.rationale && (
                <p className="text-xs text-gray-700 mt-1">{analysis.pricing_recommendation.rationale}</p>
              )}
            </div>
          )}

          {Array.isArray(analysis.improvements) && analysis.improvements.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">🛠️ Recommended improvements</div>
              <div className="space-y-1">
                {analysis.improvements.map((i, idx) => {
                  const tone =
                    i.priority === "high" ? "bg-red-100 text-red-800" :
                    i.priority === "medium" ? "bg-amber-100 text-amber-800" :
                                              "bg-blue-100 text-blue-800";
                  return (
                    <div key={idx} className="border-l-4 border-zinc-300 bg-zinc-50 pl-3 pr-3 py-2 rounded">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={tone}>{i.priority}</Badge>
                        <span className="font-medium">{i.title}</span>
                        <span className="text-xs text-gray-600 ml-auto font-mono">
                          ~${i.est_cost_usd?.toLocaleString()} · {i.est_hours}h
                        </span>
                      </div>
                      {i.rationale && <div className="text-xs text-gray-700 mt-0.5">{i.rationale}</div>}
                      {i.expected_impact && <div className="text-xs text-gray-500 mt-0.5">↗ {i.expected_impact}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {Array.isArray(analysis.positioning) && analysis.positioning.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">🎯 Positioning</div>
              <ul className="text-xs text-gray-700 space-y-0.5">
                {analysis.positioning.map((p, i) => (
                  <li key={i}>• {p}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.estimated_close_probability_pct != null && (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">📈 Estimated close probability</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-zinc-200 rounded overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, Number(analysis.estimated_close_probability_pct) || 0))}%` }} />
                </div>
                <span className="text-xs font-mono text-gray-700">{analysis.estimated_close_probability_pct}%</span>
              </div>
            </div>
          )}

          {analysis.signal_snapshot?.visible_text_excerpt && (
            <details>
              <summary className="text-xs text-blue-700 cursor-pointer">📄 Page text excerpt (what the LLM saw)</summary>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-zinc-50 p-3 rounded max-h-48 overflow-y-auto">
                {analysis.signal_snapshot.visible_text_excerpt}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Pill({ icon, ok, label }) {
  return (
    <div className={`rounded border px-2 py-1 flex items-center gap-1 ${ok ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
      <span>{ok ? "✓" : "✗"}</span>
      {icon}
      <span>{label}</span>
    </div>
  );
}
