import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { CenterShell } from "../CenterShell";
import { useCenterData } from "../lib/useCenterData";
import type { BrandsResponse } from "../lib/types";
import {
  EmptyState,
  HealthBadge,
  Spinner,
  StatTile,
  StatusDot,
  WiringError,
  fmt$,
  fmtNum,
} from "../components/ui";

function formatHeaderDate(date: string | undefined): string {
  const d = date || new Date().toISOString().slice(0, 10);
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function Home() {
  const { data, loading, error } = useCenterData<BrandsResponse>("brands");

  return (
    <CenterShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Command Center</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data ? formatHeaderDate(data.date) : "Loading brand overview..."}
        </p>
      </div>

      {loading && <Spinner />}
      {error && !loading && <WiringError error={error} />}
      {!loading && !error && !data && <EmptyState title="No data" desc="No brands returned." />}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Sends today"
              value={fmtNum(data.brands.reduce((s, b) => s + (b.todaySends || 0), 0))}
              sub={`${fmtNum(data.brands.reduce((s, b) => s + (b.todayPlanned || 0), 0))} planned`}
            />
            <StatTile
              label="Clicks (7d)"
              value={fmtNum(data.brands.reduce((s, b) => s + (b.clicks7d || 0), 0))}
            />
            <StatTile
              label="Revenue MTD"
              value={fmt$(data.brands.reduce((s, b) => s + (b.revenueMTD || 0), 0))}
            />
            <StatTile
              label="Need attention"
              value={String(data.brands.filter((b) => b.health === "warn" || b.health === "paused").length)}
              sub="warn or paused brands"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.brands.map((brand) => (
              <Link key={brand.id} href={`/admin/brand/${brand.id}`}>
                <Card className="h-full cursor-pointer border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-600">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-zinc-100">
                        {brand.name}
                      </div>
                      <a
                        href={brand.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-cyan-400 hover:underline"
                      >
                        {brand.domain}
                      </a>
                    </div>
                    <StatusDot status={brand.status} showLabel />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <HealthBadge health={brand.health} />
                    {brand.healthNote && (
                      <span className="truncate text-xs text-zinc-500">{brand.healthNote}</span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-zinc-950 px-2 py-2">
                      <div className="text-sm font-semibold text-zinc-100">
                        {fmtNum(brand.todaySends || 0)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                        sent / {fmtNum(brand.todayPlanned || 0)}
                      </div>
                    </div>
                    <div className="rounded-md bg-zinc-950 px-2 py-2">
                      <div className="text-sm font-semibold text-zinc-100">
                        {fmtNum(brand.clicks7d || 0)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                        clicks 7d
                      </div>
                    </div>
                    <div className="rounded-md bg-zinc-950 px-2 py-2">
                      <div className="text-sm font-semibold text-zinc-100">
                        {fmt$(brand.revenueMTD || 0)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                        rev MTD
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </CenterShell>
  );
}
