import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CenterShell } from "../CenterShell";
import { useCenterData } from "../lib/useCenterData";
import type { CampaignsResponse } from "../lib/types";
import {
  DataTable,
  EmptyState,
  Spinner,
  TableHead,
  Td,
  Th,
  WiringError,
  fmtNum,
} from "../components/ui";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US");
}

export default function Campaigns() {
  const { data, loading, error } = useCenterData<CampaignsResponse>("campaigns");

  return (
    <CenterShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Campaigns</h1>
        <p className="mt-1 text-sm text-zinc-500">All campaigns across every brand, 7-day activity.</p>
      </div>

      {loading && <Spinner />}
      {error && !loading && <WiringError error={error} />}
      {!loading && !error && !data && <EmptyState title="No data" />}

      {data && (
        <Card className="border-zinc-800 bg-zinc-900 p-4">
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-zinc-500">No campaigns found.</p>
          ) : (
            <DataTable>
              <TableHead>
                <Th>Brand</Th>
                <Th>Campaign</Th>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th>Last activity</Th>
                <Th className="text-right">Sends 7d</Th>
                <Th className="text-right">Opens 7d</Th>
                <Th className="text-right">Clicks 7d</Th>
                <Th className="text-right">Bounces 7d</Th>
              </TableHead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/admin/brand/${c.brandId}`} className="text-cyan-400 hover:underline">
                        {c.brandName}
                      </Link>
                    </Td>
                    <Td className="text-zinc-200">{c.name}</Td>
                    <Td>
                      <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
                        {c.kind}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge
                        variant="outline"
                        className={
                          c.status === "active"
                            ? "border-emerald-800 bg-emerald-950 text-emerald-300"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                        }
                      >
                        {c.status}
                      </Badge>
                    </Td>
                    <Td className="text-zinc-500">{formatDate(c.lastDate)}</Td>
                    <Td className="text-right">{fmtNum(c.sends7d)}</Td>
                    <Td className="text-right">{fmtNum(c.opens7d)}</Td>
                    <Td className="text-right">{fmtNum(c.clicks7d)}</Td>
                    <Td className="text-right">{fmtNum(c.bounces7d)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      )}
    </CenterShell>
  );
}
