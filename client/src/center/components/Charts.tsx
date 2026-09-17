import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  ComposedChart,
  Line,
  Legend,
} from "recharts";

const GRID_STROKE = "#27272a";
const AXIS_STROKE = "#71717a";
const TOOLTIP_STYLE = {
  backgroundColor: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  fontSize: 12,
} as const;

// Distinct, color-blind-friendlier palette cycled across brands.
const BRAND_PALETTE = [
  "#10b981", "#22d3ee", "#f59e0b", "#a78bfa", "#f472b6",
  "#60a5fa", "#34d399", "#fbbf24", "#94a3b8", "#fb7185",
  "#2dd4bf", "#818cf8", "#e879f9", "#facc15", "#38bdf8",
];

function colorFor(index: number): string {
  return BRAND_PALETTE[index % BRAND_PALETTE.length];
}

function shortDate(value: string): string {
  // Keep axis labels compact: "2026-09-16" -> "9/16".
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${Number(m[2])}/${Number(m[3])}`;
}

export interface StackedSeriesRow {
  date: string;
  [brandId: string]: number | string;
}

/** Stacked per-brand daily sends bar chart. */
export function SendsStackedBar({
  series,
  brands,
  height = 240,
}: {
  series: StackedSeriesRow[];
  brands: string[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => String(v)} />
        {brands.map((brandId, i) => (
          <Bar
            key={brandId}
            dataKey={brandId}
            name={brandId}
            stackId="sends"
            fill={colorFor(i)}
            radius={i === brands.length - 1 ? [2, 2, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Single-series area chart for clicks. */
export function ClicksArea({
  series,
  height = 240,
}: {
  series: { date: string; clicks: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => String(v)} />
        <Area
          type="monotone"
          dataKey="clicks"
          name="Clicks"
          stroke="#22d3ee"
          fill="#22d3ee"
          fillOpacity={0.25}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Single-series area chart for revenue (dollars). */
export function RevenueArea({
  series,
  height = 240,
}: {
  series: { date: string; total: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelFormatter={(v) => String(v)}
          formatter={(v) => [`$${Number(v).toFixed(2)}`, "Revenue"]}
        />
        <Area
          type="monotone"
          dataKey="total"
          name="Revenue"
          stroke="#10b981"
          fill="#10b981"
          fillOpacity={0.25}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface WarmupDayRow {
  date: string;
  planned: number;
  sent: number;
}

/**
 * Warmup ladder chart: per-day planned (zinc) vs sent (emerald) bars,
 * with the ladder target as an amber dashed line.
 */
export function WarmupLadder({
  days,
  ladder,
  height = 260,
}: {
  days: WarmupDayRow[];
  ladder: number[];
  height?: number;
}) {
  const data = days.map((d, i) => ({
    date: d.date,
    planned: d.planned,
    sent: d.sent,
    target: ladder[i] ?? null,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={20}
        />
        <YAxis
          stroke={AXIS_STROKE}
          tick={{ fill: AXIS_STROKE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => String(v)} />
        <Legend wrapperStyle={{ fontSize: 12, color: AXIS_STROKE }} />
        <Bar dataKey="planned" name="Planned" fill="#3f3f46" radius={[2, 2, 0, 0]} />
        <Bar dataKey="sent" name="Sent" fill="#10b981" radius={[2, 2, 0, 0]} />
        <Line
          type="monotone"
          dataKey="target"
          name="Ladder target"
          stroke="#f59e0b"
          strokeDasharray="5 4"
          strokeWidth={2}
          dot={{ r: 3, fill: "#f59e0b" }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
