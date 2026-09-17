import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { CenterShell } from "../CenterShell";
import { useCenterData } from "../lib/useCenterData";
import type { RevenueResponse } from "../lib/types";
import {
  DataTable,
  EmptyState,
  SectionTitle,
  Spinner,
  StatTile,
  TableHead,
  Td,
  Th,
  WiringError,
  fmt$,
  fmtNum,
} from "../components/ui";
import { RevenueArea } from "../components/Charts";

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US");
}

export default function Revenue() {
  const { data, loading, error } = useCenterData<RevenueResponse>("revenue");

  const totalMTD = data ? data.perBrand.reduce((s, b) => s + (b.mtd || 0), 0) : 0;
  const total30d = data ? data.perBrand.reduce((s, b) => s + (b.d30 || 0), 0) : 0;

  return (
    <CenterShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Revenue</h1>
        <p className="mt-1 text-sm text-zinc-500">Stripe-backed revenue per brand.</p>
      </div>

      {loading && <Spinner />}
      {error && !loading && <WiringError error={error} />}
      {!loading && !error && !data && <EmptyState title="No data" />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Revenue MTD" value={fmt$(totalMTD)} />
            <StatTile label="Revenue trailing 30d" value={fmt$(total30d)} />
          </div>

          <Card className="border-zinc-800 bg-zinc-900 p-4">
            <SectionTitle>Per-brand revenue — MTD vs trailing 30d</SectionTitle>
            <div className="mt-3">
              {data.perBrand.length === 0 ? (
                <p className="text-sm text-zinc-500">No per-brand revenue yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(240, data.perBrand.length * 44)}>
                  <BarChart
                    data={data.perBrand}
                    layout="vertical"
                    margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      stroke="#71717a"
                      tick={{ fill: "#71717a", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="brandName"
                      stroke="#71717a"
                      tick={{ fill: "#a1a1aa", fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={130}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid #3f3f46",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [`$${Number(v).toFixed(2)}`]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="mtd" name="MTD" fill="#10b981" radius={[0, 3, 3, 0]} />
                    <Bar dataKey="d30" name="Trailing 30d" fill="#22d3ee" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900 p-4">
            <SectionTitle>Revenue — 30 days</SectionTitle>
            <div className="mt-3">
              <RevenueArea series={data.series} />
            </div>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900 p-4">
            <SectionTitle>Recent purchases</SectionTitle>
            <div className="mt-3">
              {data.purchases.length === 0 ? (
                <p className="text-sm text-zinc-500">No purchases recorded.</p>
              ) : (
                <DataTable>
                  <TableHead>
                    <Th>Date</Th>
                    <Th>Brand</Th>
                    <Th>Offer</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Source</Th>
                  </TableHead>
                  <tbody>
                    {data.purchases.map((p, i) => (
                      <tr key={`${p.purchasedAt}-${i}`}>
                        <Td>{formatDate(p.purchasedAt)}</Td>
                        <Td>
                          <Link href={`/admin/brand/${p.brandId}`} className="text-cyan-400 hover:underline">
                            {p.brandName}
                          </Link>
                        </Td>
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
    </CenterShell>
  );
}
