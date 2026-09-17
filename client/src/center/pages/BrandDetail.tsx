import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CenterShell } from "../CenterShell";
import { useCenterData } from "../lib/useCenterData";
import type { BrandDetailResponse } from "../lib/types";
import {
  DataTable,
  EmptyState,
  ProgressBar,
  SectionTitle,
  Spinner,
  StatTile,
  StatusDot,
  TableHead,
  Td,
  Th,
  WiringError,
  fmt$,
  fmtNum,
} from "../components/ui";
import { ClicksArea, RevenueArea, SendsStackedBar, WarmupLadder } from "../components/Charts";

function useBrandId(): string | null {
  const [, params] = useRoute("/admin/brand/:id");
  const [location] = useLocation();
  if (params?.id) return decodeURIComponent(params.id);
  // Trailing-slash fallback: /admin/brand/<id>/
  const m = /^\/admin\/brand\/([^/]+)\/?$/.exec(location);
  return m ? decodeURIComponent(m[1]) : null;
}

function verdictBadgeClass(verdict: string | null | undefined): string {
  const v = (verdict || "").toLowerCase();
  if (["pass", "ok", "healthy", "good", "clean"].includes(v))
    return "border-emerald-800 bg-emerald-950 text-emerald-300";
  if (["warn", "watch", "warning", "review"].includes(v))
    return "border-amber-800 bg-amber-950 text-amber-300";
  if (["fail", "failed", "blocked", "paused", "critical", "bad"].includes(v))
    return "border-red-800 bg-red-950 text-red-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  return (
    <Badge variant="outline" className={verdictBadgeClass(verdict)}>
      {verdict || "—"}
    </Badge>
  );
}

/** Rates arrive as fractions (0-1); display as percentages. */
function pct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(2)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US");
}

export default function BrandDetail() {
  const brandId = useBrandId();
  const { data, loading, error } = useCenterData<BrandDetailResponse>(
    brandId ? `brand?id=${encodeURIComponent(brandId)}` : null,
  );
  const [tab, setTab] = useState("overview");

  const tabs = useMemo(() => {
    if (!data) return [];
    const list = [{ id: "overview", label: "Overview" }];
    if (data.todayCampaign || (data.prevCampaigns?.length ?? 0) > 0)
      list.push({ id: "campaigns", label: "Campaigns" });
    if ((data.topLinks?.length ?? 0) > 0) list.push({ id: "links", label: "Links" });
    if ((data.templates?.length ?? 0) > 0) list.push({ id: "templates", label: "Templates" });
    if (data.warmup) list.push({ id: "warmup", label: "Warmup" });
    list.push({ id: "health", label: "Health" });
    list.push({ id: "revenue", label: "Revenue" });
    return list;
  }, [data]);

  const activeTab = tabs.some((t) => t.id === tab) ? tab : "overview";
  const brand = data?.brand;

  const sendsStacked =
    data?.seriesSends.map((d) => ({ date: d.date, [brandId ?? ""]: d.sends })) ?? [];

  return (
    <CenterShell>
      <div className="mb-4">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Brands
        </Link>
      </div>

      {loading && <Spinner />}
      {error && !loading && <WiringError error={error} />}
      {!loading && !error && !data && <EmptyState title="Brand not found" />}

      {data && brand && (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-100">{brand.name}</h1>
              <a href={brand.url} target="_blank" rel="noreferrer" className="text-sm text-cyan-400 hover:underline">
                {brand.domain}
              </a>
              <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                <StatusDot status={brand.status} showLabel />
                {brand.price && <span>{brand.price}</span>}
                {brand.instagram && <span>{brand.instagram}</span>}
              </div>
            </div>
          </div>

          <div className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-800">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  activeTab === t.id
                    ? "whitespace-nowrap border-b-2 border-emerald-500 px-3 py-2 text-sm font-medium text-zinc-100"
                    : "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300"
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatTile label="Sends 7d" value={fmtNum(data.kpis.sends7d)} />
                <StatTile label="Clicks 7d" value={fmtNum(data.kpis.clicks7d)} />
                <StatTile label="Opens 7d" value={fmtNum(data.kpis.opens7d)} />
                <StatTile label="Bounce rate 7d" value={pct(data.kpis.bounceRate7d)} />
                <StatTile label="Revenue MTD" value={fmt$(data.kpis.revenueMTD)} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="border-zinc-800 bg-zinc-900 p-4">
                  <SectionTitle>Sends — 14 days</SectionTitle>
                  <div className="mt-3">
                    <SendsStackedBar series={sendsStacked} brands={brandId ? [brandId] : []} />
                  </div>
                </Card>
                <Card className="border-zinc-800 bg-zinc-900 p-4">
                  <SectionTitle>Clicks — 14 days</SectionTitle>
                  <div className="mt-3">
                    <ClicksArea series={data.seriesClicks} />
                  </div>
                </Card>
              </div>

              {data.funnel && (
                <Card className="border-zinc-800 bg-zinc-900 p-4">
                  <SectionTitle>Audit funnel</SectionTitle>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatTile label="Leads 24h" value={fmtNum(data.funnel.leads24h)} />
                    <StatTile label="Leads total" value={fmtNum(data.funnel.leadsTotal)} />
                    <StatTile
                      label="Deep scans"
                      value={fmtNum(data.funnel.deepDelivered)}
                      sub={`${fmtNum(data.funnel.deepRequested)} requested / ${fmtNum(data.funnel.deepPaid)} paid`}
                    />
                    <StatTile
                      label="Drip sends 24h"
                      value={fmtNum(data.funnel.dripSends24h)}
                      sub={`${fmtNum(data.funnel.dripFails)} fails / ${fmtNum(data.funnel.scanErrors)} scan errors`}
                    />
                  </div>
                </Card>
              )}
            </div>
          )}

          {activeTab === "campaigns" && (
            <div className="space-y-6">
              {data.todayCampaign && (
                <Card className="border-zinc-800 bg-zinc-900 p-4">
                  <SectionTitle>Today's campaign</SectionTitle>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-zinc-300">
                      Day {data.todayCampaign.campaignDay} — {data.todayCampaign.date}
                    </div>
                    <div className="text-sm text-zinc-400">
                      {fmtNum(data.todayCampaign.sent)} / {fmtNum(data.todayCampaign.planned)} sent
                      {" · "}
                      {fmtNum(data.todayCampaign.delivered)} delivered
                    </div>
                  </div>
                  <div className="mt-2">
                    <ProgressBar
                      pct={
                        data.todayCampaign.planned > 0
                          ? (data.todayCampaign.sent / data.todayCampaign.planned) * 100
                          : 0
                      }
                    />
                  </div>
                </Card>
              )}
              <Card className="border-zinc-800 bg-zinc-900 p-4">
                <SectionTitle>Previous campaigns</SectionTitle>
                <div className="mt-3">
                  {data.prevCampaigns.length === 0 ? (
                    <p className="text-sm text-zinc-500">No previous campaigns.</p>
                  ) : (
                    <DataTable>
                      <TableHead>
                        <Th>Date</Th>
                        <Th>Day</Th>
                        <Th className="text-right">Sent</Th>
                        <Th className="text-right">Delivered</Th>
                        <Th className="text-right">Opens</Th>
                        <Th className="text-right">Clicks</Th>
                        <Th className="text-right">Bounces</Th>
                        <Th className="text-right">Unsubs</Th>
                      </TableHead>
                      <tbody>
                        {data.prevCampaigns.map((c) => (
                          <tr key={`${c.date}-${c.campaignDay}`}>
                            <Td>{formatDate(c.date)}</Td>
                            <Td>{c.campaignDay}</Td>
                            <Td className="text-right">{fmtNum(c.sent)}</Td>
                            <Td className="text-right">{fmtNum(c.delivered)}</Td>
                            <Td className="text-right">{fmtNum(c.opens)}</Td>
                            <Td className="text-right">{fmtNum(c.clicks)}</Td>
                            <Td className="text-right">{fmtNum(c.bounces)}</Td>
                            <Td className="text-right">{fmtNum(c.unsubs)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
                </div>
              </Card>
            </div>
          )}

          {activeTab === "links" && (
            <Card className="border-zinc-800 bg-zinc-900 p-4">
              <SectionTitle>Tracked links</SectionTitle>
              <div className="mt-3">
                <DataTable>
                  <TableHead>
                    <Th>Short URL</Th>
                    <Th>Label</Th>
                    <Th>Destination</Th>
                    <Th className="text-right">Clicks 7d</Th>
                    <Th className="text-right">Clicks 30d</Th>
                  </TableHead>
                  <tbody>
                    {data.topLinks.map((l) => (
                      <tr key={l.code}>
                        <Td>
                          <a href={l.url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">
                            {l.code}
                          </a>
                        </Td>
                        <Td>{l.label || "—"}</Td>
                        <Td className="max-w-[240px] truncate text-zinc-500" title={l.destination}>
                          {l.destination}
                        </Td>
                        <Td className="text-right">{fmtNum(l.clicks7d)}</Td>
                        <Td className="text-right">{fmtNum(l.clicks30d)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            </Card>
          )}

          {activeTab === "templates" && (
            <Card className="border-zinc-800 bg-zinc-900 p-4">
              <SectionTitle>Templates</SectionTitle>
              <div className="mt-3">
                <DataTable>
                  <TableHead>
                    <Th>Template</Th>
                    <Th>Subject</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Preflight</Th>
                    <Th className="text-right">Judge</Th>
                    <Th className="text-right">Regret 7d</Th>
                  </TableHead>
                  <tbody>
                    {data.templates.map((t) => (
                      <tr key={t.id}>
                        <Td>
                          {t.name} <span className="text-zinc-500">v{t.version}</span>
                        </Td>
                        <Td className="max-w-[220px] truncate" title={t.subject}>
                          {t.subject}
                        </Td>
                        <Td>
                          <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
                            {t.status}
                          </Badge>
                        </Td>
                        <Td className="text-right">
                          {t.preflightScore != null ? (
                            <span className="mr-1">{t.preflightScore}</span>
                          ) : (
                            "—"
                          )}
                          <VerdictBadge verdict={t.preflightVerdict} />
                        </Td>
                        <Td className="text-right">
                          {t.judgeScore != null ? <span className="mr-1">{t.judgeScore}</span> : "—"}
                          <VerdictBadge verdict={t.judgeVerdict} />
                        </Td>
                        <Td className="text-right">
                          {t.regret7d != null ? (
                            <Badge
                              variant="outline"
                              className={
                                t.regret7d > 15
                                  ? "border-red-800 bg-red-950 text-red-300"
                                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
                              }
                            >
                              {t.regret7d}%
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            </Card>
          )}

          {activeTab === "warmup" && data.warmup && (
            <div className="space-y-4">
              {data.warmup.paused && (
                <div className="rounded-md border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
                  Warmup paused{data.warmup.pauseReason ? `: ${data.warmup.pauseReason}` : ""}
                </div>
              )}
              <Card className="border-zinc-800 bg-zinc-900 p-4">
                <SectionTitle>
                  Warmup ladder — day {data.warmup.currentDay} of {data.warmup.ladder.length}
                </SectionTitle>
                <div className="mt-3">
                  <WarmupLadder days={data.warmup.days} ladder={data.warmup.ladder} />
                </div>
              </Card>
            </div>
          )}

          {activeTab === "health" && (
            <div className="space-y-4">
              {data.health.paused && (
                <div className="rounded-md border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
                  Sending paused{data.health.pauseReason ? `: ${data.health.pauseReason}` : ""}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Bounce rate 7d" value={pct(data.health.bounceRate7d)} />
                <StatTile label="Complaint rate 7d" value={pct(data.health.complaintRate7d)} />
              </div>
              <Card className="border-zinc-800 bg-zinc-900 p-4">
                <SectionTitle>Deliverability snapshots</SectionTitle>
                <div className="mt-3">
                  {data.health.snapshots.length === 0 ? (
                    <p className="text-sm text-zinc-500">No snapshots.</p>
                  ) : (
                    <DataTable>
                      <TableHead>
                        <Th>Date</Th>
                        <Th>Domain</Th>
                        <Th>ESP</Th>
                        <Th className="text-right">Sent</Th>
                        <Th className="text-right">Delivered</Th>
                        <Th className="text-right">Bounce</Th>
                        <Th className="text-right">Complaint</Th>
                        <Th>Verdict</Th>
                      </TableHead>
                      <tbody>
                        {data.health.snapshots.map((s, i) => (
                          <tr key={`${s.date}-${s.domain}-${i}`}>
                            <Td>{formatDate(s.date)}</Td>
                            <Td>{s.domain}</Td>
                            <Td>{s.esp}</Td>
                            <Td className="text-right">{fmtNum(s.sent)}</Td>
                            <Td className="text-right">{fmtNum(s.delivered)}</Td>
                            <Td className="text-right">{pct(s.bounceRate)}</Td>
                            <Td className="text-right">{pct(s.complaintRate)}</Td>
                            <Td>
                              <VerdictBadge verdict={s.verdict} />
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
                </div>
              </Card>
            </div>
          )}

          {activeTab === "revenue" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile label="Revenue MTD" value={fmt$(data.kpis.revenueMTD)} />
                <StatTile label="Revenue 30d" value={fmt$(data.kpis.revenue30d)} />
                <StatTile label="Purchases 30d" value={fmtNum(data.kpis.purchases30d)} />
              </div>
              <Card className="border-zinc-800 bg-zinc-900 p-4">
                <SectionTitle>Revenue — 30 days</SectionTitle>
                <div className="mt-3">
                  <RevenueArea
                    series={data.revenue.series.map((d) => ({ date: d.date, total: d.revenue }))}
                  />
                </div>
              </Card>
              <Card className="border-zinc-800 bg-zinc-900 p-4">
                <SectionTitle>Recent purchases</SectionTitle>
                <div className="mt-3">
                  {data.revenue.purchases.length === 0 ? (
                    <p className="text-sm text-zinc-500">No purchases recorded.</p>
                  ) : (
                    <DataTable>
                      <TableHead>
                        <Th>Date</Th>
                        <Th>Offer</Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Source</Th>
                      </TableHead>
                      <tbody>
                        {data.revenue.purchases.map((p, i) => (
                          <tr key={`${p.purchasedAt}-${i}`}>
                            <Td>{formatDate(p.purchasedAt)}</Td>
                            <Td>{p.offerId}</Td>
                            <Td className="text-right">{fmt$(p.amountCents / 100)}</Td>
                            <Td>{p.source}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </CenterShell>
  );
}
