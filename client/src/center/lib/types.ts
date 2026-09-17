// Shared API types for the MehyarSoft Command Center (/api/admin/center/*).
// Every center endpoint returns { ok: true, ... } on success or { ok: false, error }.

export type BrandKind = "agency" | "app" | "digital-product" | "tool" | "hub";
export type BrandStatus = "live" | "building" | "parked";
export type HealthLevel = "ok" | "warn" | "paused" | "unknown";
export type AlertSeverity = "crit" | "warn" | "info";
export type LearningKind = "win" | "loss" | "insight" | "rule_change";

export interface BrandMeta {
  id: string;
  name: string;
  domain: string;
  url: string;
  kind: BrandKind;
  price?: string;
  instagram?: string;
  status: BrandStatus;
}

export interface BrandRow extends BrandMeta {
  todaySends: number;
  todayPlanned: number;
  clicks7d: number;
  revenueMTD: number;
  health: HealthLevel;
  healthNote?: string;
}

export interface BrandsResponse {
  ok: boolean;
  error?: string;
  date: string;
  missing: { intel: boolean; jobs: boolean; leads: boolean };
  brands: BrandRow[];
}

export interface BrandKpis {
  sends7d: number;
  clicks7d: number;
  opens7d: number;
  bounceRate7d: number;
  revenueMTD: number;
  revenue30d: number;
  purchases30d: number;
}

export interface CampaignDay {
  campaignDay: number;
  planned: number;
  sent: number;
  delivered: number;
  date: string;
}

export interface CampaignHistoryRow extends CampaignDay {
  opens: number;
  clicks: number;
  bounces: number;
  unsubs: number;
  complaints: number;
}

export interface DayCount {
  date: string;
  sends: number;
}

export interface DayClicks {
  date: string;
  clicks: number;
}

export interface TopLink {
  code: string;
  url: string;
  label: string;
  destination: string;
  clicks7d: number;
  clicks30d: number;
}

export interface BrandTemplate {
  id: string;
  name: string;
  version: number;
  subject: string;
  status: string;
  preflightScore: number | null;
  preflightVerdict: string | null;
  judgeScore: number | null;
  judgeVerdict: string | null;
  regret7d: number | null;
}

export interface WarmupDay extends CampaignDay {
  opens: number;
  clicks: number;
  bounces: number;
  unsubs: number;
  complaints: number;
}

export interface BrandWarmup {
  ladder: number[];
  currentDay: number;
  paused: boolean;
  pauseReason?: string;
  days: WarmupDay[];
}

export interface HealthSnapshot {
  date: string;
  domain: string;
  esp: string;
  sent: number;
  delivered: number;
  bounceRate: number;
  complaintRate: number;
  verdict: string;
}

export interface BrandHealth {
  paused: boolean;
  pauseReason?: string;
  bounceRate7d: number;
  complaintRate7d: number;
  snapshots: HealthSnapshot[];
}

export interface BrandRevenue {
  series: { date: string; revenue: number }[];
  purchases: {
    purchasedAt: string;
    amountCents: number;
    offerId: string;
    source: string;
  }[];
}

export interface BrandFunnel {
  leads24h: number;
  leadsTotal: number;
  deepRequested: number;
  deepPaid: number;
  deepDelivered: number;
  dripSends24h: number;
  dripFails: number;
  scanErrors: number;
}

export interface BrandDetailResponse {
  ok: boolean;
  error?: string;
  brand: BrandMeta;
  kpis: BrandKpis;
  todayCampaign: CampaignDay | null;
  prevCampaigns: CampaignHistoryRow[];
  seriesSends: DayCount[];
  seriesClicks: DayClicks[];
  topLinks: TopLink[];
  templates: BrandTemplate[];
  warmup: BrandWarmup | null;
  health: BrandHealth;
  revenue: BrandRevenue;
  funnel?: BrandFunnel;
}

export interface TodayRow {
  id: string;
  name: string;
  campaigns: {
    name: string;
    campaignDay: number;
    planned: number;
    sent: number;
  }[];
  planned: number;
  sent: number;
}

export interface TodayResponse {
  ok: boolean;
  error?: string;
  date: string;
  totals: { planned: number; sent: number };
  rows: TodayRow[];
}

export interface CampaignRow {
  id: string;
  brandId: string;
  brandName: string;
  kind: string;
  name: string;
  status: string;
  lastDate: string | null;
  sends7d: number;
  opens7d: number;
  clicks7d: number;
  bounces7d: number;
}

export interface CampaignsResponse {
  ok: boolean;
  error?: string;
  campaigns: CampaignRow[];
}

export interface HealthAlert {
  severity: AlertSeverity;
  brandId: string;
  brandName: string;
  message: string;
  at: string;
}

export interface HealthSnapshotRow extends HealthSnapshot {
  brandId: string;
  brandName: string;
}

export interface Learning {
  id: string;
  createdAt: string;
  brandId: string | null;
  kind: LearningKind;
  summary: string;
  actionTaken: string | null;
}

export interface HealthResponse {
  ok: boolean;
  error?: string;
  alerts: HealthAlert[];
  snapshots: HealthSnapshotRow[];
  learnings: Learning[];
}

export interface RevenueResponse {
  ok: boolean;
  error?: string;
  perBrand: { brandId: string; brandName: string; mtd: number; d30: number }[];
  series: { date: string; total: number }[];
  purchases: {
    purchasedAt: string;
    amountCents: number;
    offerId: string;
    brandId: string;
    brandName: string;
    source: string;
  }[];
}

export interface SendsChartResponse {
  ok: boolean;
  error?: string;
  brands: string[];
  series: Record<string, number | string>[];
}

export interface ClicksChartResponse {
  ok: boolean;
  error?: string;
  series: { date: string; clicks: number }[];
}

export interface RevenueChartResponse {
  ok: boolean;
  error?: string;
  series: { date: string; total: number }[];
}
