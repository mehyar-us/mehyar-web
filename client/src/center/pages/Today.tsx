import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { CenterShell } from "../CenterShell";
import { useCenterData } from "../lib/useCenterData";
import type { TodayResponse } from "../lib/types";
import {
  EmptyState,
  ProgressBar,
  Spinner,
  StatTile,
  WiringError,
  fmtNum,
} from "../components/ui";

export default function Today() {
  const { data, loading, error } = useCenterData<TodayResponse>("today");

  const completion =
    data && data.totals.planned > 0 ? (data.totals.sent / data.totals.planned) * 100 : 0;

  return (
    <CenterShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Today</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data
            ? new Date(`${data.date}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : "Loading today's send plan..."}
        </p>
      </div>

      {loading && <Spinner />}
      {error && !loading && <WiringError error={error} />}
      {!loading && !error && !data && <EmptyState title="No data" />}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <StatTile label="Planned" value={fmtNum(data.totals.planned)} />
            <StatTile label="Sent" value={fmtNum(data.totals.sent)} />
            <StatTile label="Completion" value={`${completion.toFixed(1)}%`} />
          </div>

          <div className="mb-6">
            <ProgressBar pct={completion} />
          </div>

          <div className="space-y-3">
            {data.rows.length === 0 && (
              <EmptyState title="Nothing scheduled today" desc="No brand campaigns are planned for today." />
            )}
            {data.rows.map((row) => {
              const rowPct = row.planned > 0 ? (row.sent / row.planned) * 100 : 0;
              return (
                <Card key={row.id} className="border-zinc-800 bg-zinc-900 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/admin/brand/${row.id}`} className="text-base font-semibold text-zinc-100 hover:underline">
                      {row.name}
                    </Link>
                    <div className="text-sm text-zinc-400">
                      {fmtNum(row.sent)} / {fmtNum(row.planned)}
                    </div>
                  </div>
                  <div className="mt-2">
                    <ProgressBar pct={rowPct} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {row.campaigns.map((c, i) => (
                      <div
                        key={`${c.name}-${i}`}
                        className="flex items-center justify-between gap-3 rounded-md bg-zinc-950 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-zinc-200">
                            {c.name}
                            <span className="ml-2 text-xs text-zinc-500">Day {c.campaignDay}</span>
                          </div>
                        </div>
                        <div className="flex w-40 shrink-0 items-center gap-2">
                          <div className="flex-1">
                            <ProgressBar
                              pct={c.planned > 0 ? (c.sent / c.planned) * 100 : 0}
                              className="h-1.5"
                            />
                          </div>
                          <div className="text-xs text-zinc-400">
                            {fmtNum(c.sent)}/{fmtNum(c.planned)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </CenterShell>
  );
}
