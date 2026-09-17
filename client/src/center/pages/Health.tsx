import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CenterShell } from "../CenterShell";
import { useCenterData } from "../lib/useCenterData";
import type { AlertSeverity, HealthResponse, LearningKind } from "../lib/types";
import {
  DataTable,
  EmptyState,
  SectionTitle,
  Spinner,
  TableHead,
  Td,
  Th,
  WiringError,
  fmtNum,
} from "../components/ui";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  crit: "border-red-800 bg-red-950/60",
  warn: "border-amber-800 bg-amber-950/60",
  info: "border-blue-800 bg-blue-950/60",
};

const SEVERITY_TEXT: Record<AlertSeverity, string> = {
  crit: "text-red-300",
  warn: "text-amber-300",
  info: "text-blue-300",
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  crit: "Critical",
  warn: "Warning",
  info: "Info",
};

const KIND_BADGE: Record<LearningKind, string> = {
  win: "border-emerald-800 bg-emerald-950 text-emerald-300",
  loss: "border-red-800 bg-red-950 text-red-300",
  insight: "border-blue-800 bg-blue-950 text-blue-300",
  rule_change: "border-amber-800 bg-amber-950 text-amber-300",
};

const KIND_LABEL: Record<LearningKind, string> = {
  win: "Win",
  loss: "Loss",
  insight: "Insight",
  rule_change: "Rule change",
};

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(2)}%`;
}

export default function Health() {
  const { data, loading, error } = useCenterData<HealthResponse>("health");

  return (
    <CenterShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Health</h1>
        <p className="mt-1 text-sm text-zinc-500">Alerts, deliverability snapshots, and learnings.</p>
      </div>

      {loading && <Spinner />}
      {error && !loading && <WiringError error={error} />}
      {!loading && !error && !data && <EmptyState title="No data" />}

      {data && (
        <div className="space-y-6">
          <div>
            <div className="mb-3">
              <SectionTitle>Alerts</SectionTitle>
            </div>
            {data.alerts.length === 0 ? (
              <Card className="border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
                No active alerts.
              </Card>
            ) : (
              <div className="space-y-2">
                {data.alerts.map((a, i) => (
                  <Card key={`${a.brandId}-${a.at}-${i}`} className={cn("p-4", SEVERITY_STYLE[a.severity])}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className={cn("text-xs font-semibold uppercase tracking-wide", SEVERITY_TEXT[a.severity])}>
                          {SEVERITY_LABEL[a.severity]}
                        </div>
                        <div className="mt-1 text-sm text-zinc-200">{a.message}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          <Link href={`/admin/brand/${a.brandId}`} className="text-cyan-400 hover:underline">
                            {a.brandName}
                          </Link>
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-zinc-500">{formatDateTime(a.at)}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <Card className="border-zinc-800 bg-zinc-900 p-4">
            <SectionTitle>Deliverability snapshots</SectionTitle>
            <div className="mt-3">
              {data.snapshots.length === 0 ? (
                <p className="text-sm text-zinc-500">No snapshots.</p>
              ) : (
                <DataTable>
                  <TableHead>
                    <Th>Date</Th>
                    <Th>Brand</Th>
                    <Th>Domain</Th>
                    <Th>ESP</Th>
                    <Th className="text-right">Sent</Th>
                    <Th className="text-right">Delivered</Th>
                    <Th className="text-right">Bounce</Th>
                    <Th className="text-right">Complaint</Th>
                    <Th>Verdict</Th>
                  </TableHead>
                  <tbody>
                    {data.snapshots.map((s, i) => (
                      <tr key={`${s.brandId}-${s.date}-${i}`}>
                        <Td>{formatDateTime(s.date)}</Td>
                        <Td>
                          <Link href={`/admin/brand/${s.brandId}`} className="text-cyan-400 hover:underline">
                            {s.brandName}
                          </Link>
                        </Td>
                        <Td className="text-zinc-500">{s.domain}</Td>
                        <Td>{s.esp}</Td>
                        <Td className="text-right">{fmtNum(s.sent)}</Td>
                        <Td className="text-right">{fmtNum(s.delivered)}</Td>
                        <Td className="text-right">{pct(s.bounceRate)}</Td>
                        <Td className="text-right">{pct(s.complaintRate)}</Td>
                        <Td>
                          <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-300">
                            {s.verdict}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </div>
          </Card>

          <div>
            <div className="mb-3">
              <SectionTitle>Latest learnings</SectionTitle>
            </div>
            {data.learnings.length === 0 ? (
              <Card className="border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
                No learnings recorded yet.
              </Card>
            ) : (
              <div className="space-y-2">
                {data.learnings.map((l) => (
                  <Card key={l.id} className="border-zinc-800 bg-zinc-900 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Badge variant="outline" className={KIND_BADGE[l.kind]}>
                          {KIND_LABEL[l.kind]}
                        </Badge>
                        <p className="mt-2 text-sm text-zinc-200">{l.summary}</p>
                        {l.actionTaken && (
                          <p className="mt-1 text-xs text-zinc-500">
                            <span className="font-medium text-zinc-400">Action:</span> {l.actionTaken}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-xs text-zinc-500">{formatDateTime(l.createdAt)}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </CenterShell>
  );
}
